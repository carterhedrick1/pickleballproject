// Hits every route the app registers, once, and fails if any of them returns a 500.
// Usage: node all-routes.js [baseUrl]
//
// This exists because splitting server.js into routes/ made one specific mistake easy: moving
// a handler without the thing it calls, which throws a ReferenceError the first time anyone
// hits that route. Eight routes had no coverage at all, so nothing would have caught it.
// Auth failures, 404s and validation errors are all fine here - only a 500 is a failure.
//
// No phone numbers are given to any test player, so nothing can be texted.
//   npm run verify:routes
const BASE = process.argv[2] || 'http://localhost:3002';

let broken = 0, checked = 0;

async function hit(method, path, { body, raw, headers = {} } = {}) {
  checked++;
  const res = await fetch(BASE + path, {
    method,
    headers: raw ? { 'Content-Type': 'image/png', ...headers }
                 : body ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: raw || (body ? JSON.stringify(body) : undefined),
  });
  const text = await res.text();
  // A 500 whose body is the generic message is what a thrown ReferenceError looks like now.
  if (res.status === 500) {
    console.log(`  BROKEN  ${method} ${path} -> 500 ${text.slice(0, 120)}`);
    broken++;
  }
  return { status: res.status, text };
}

(async () => {
  console.log('\n=== smoke: every route ===\n');

  const created = await fetch(`${BASE}/api/games`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      location: 'Test Court', organizerName: 'Host', organizerPlaying: false,
      organizerPhone: '5555559001',
      date: '2026-09-19', time: '18:00', duration: 90, totalPlayers: 4,
      message: 'smoke', registrationMode: 'fcfs',
    }),
  }).then((r) => r.json());
  const { gameId: id, hostToken: tok } = created;
  const { getLocalHostAuthHeaders } = require('./_host-verification');
  const hostAuth = await getLocalHostAuthHeaders(BASE, '5555559001');
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

  await hit('POST', `/api/games/${id}/players`, { body: { name: 'Alice' } });
  const photo = await hit('POST', `/api/games/${id}/photos?token=${tok}`, { raw: PNG });
  const photoId = (() => { try { return JSON.parse(photo.text).id; } catch { return 'x'; } })();
  const ci = await hit('POST', `/api/games/${id}/court-images?token=${tok}`, { raw: PNG });
  const imageId = (() => { try { return JSON.parse(ci.text).imageId; } catch { return 'x'; } })();

  // health + dev
  await hit('GET', '/api/health');
  await hit('POST', '/api/test-reminders');
  await hit('GET', '/api/dev/status');
  await hit('GET', '/api/dev/notes');
  await hit('GET', '/api/dev/errors');

  // locations, games
  await hit('GET', '/api/locations');
  await hit('GET', `/api/games/${id}`);
  await hit('GET', `/api/games/${id}?token=${tok}`);
  await hit('PUT', `/api/games/${id}`, { body: { token: tok, message: 'edited' } });
  await hit('PUT', `/api/games/${id}/notes`, { body: { token: tok, hostNotes: 'gate 4417' } });
  await hit('GET', '/api/games/by-phone/5555559001', { headers: hostAuth });
  await hit('GET', '/api/games/by-phone/5555559001?all=1', { headers: hostAuth });
  await hit('POST', '/api/games/lookup-and-notify', {
    body: { phone: '5555559001' },
    headers: hostAuth
  });

  // roster + stats
  await hit('GET', '/api/roster/5555559001', { headers: hostAuth });
  await hit('PUT', '/api/roster/5555559001/5555559002', {
    body: { name: 'Bob', duprId: '', duprRating: '' },
    headers: hostAuth
  });
  await hit('GET', '/api/stats/5555559001', { headers: hostAuth });

  // players
  await hit('POST', `/api/games/${id}/manual-player`, { body: { token: tok, name: 'Manual' } });
  await hit('POST', `/api/games/${id}/move-to-waitlist/nope`, { body: { token: tok } });
  await hit('POST', `/api/games/${id}/promote-from-waitlist/nope`, { body: { token: tok } });
  await hit('DELETE', `/api/games/${id}/players/nope?token=${tok}`);
  await hit('DELETE', `/api/games/${id}/out-players/nope?token=${tok}`);

  // photos
  await hit('GET', `/api/games/${id}/photos`);
  await hit('GET', `/api/games/${id}/photos/${photoId}`);
  await hit('DELETE', `/api/games/${id}/photos/${photoId}?token=${tok}`);

  // court images
  await hit('POST', `/api/courts/Test%20Court/image`, { raw: PNG, headers: { 'x-dev-password': process.env.DEV_PASSWORD || 'vibe123' } });
  await hit('GET', '/api/courts/Test%20Court/image');
  await hit('GET', '/api/courts/images/list');
  await hit('GET', '/api/courts/Test%20Court/library');
  await hit('GET', `/api/court-images/${imageId}`);
  await hit('GET', `/api/games/${id}/court-images`);
  await hit('GET', `/api/games/${id}/court-images/${imageId}`);
  await hit('PUT', `/api/games/${id}/court-image/${imageId}?token=${tok}`);
  await hit('PUT', `/api/games/${id}/court-image-none?token=${tok}`);
  await hit('DELETE', `/api/games/${id}/court-images/${imageId}?token=${tok}`);

  // announcements
  await hit('POST', `/api/games/${id}/announcement`, { body: { token: tok, message: 'hi', includeConfirmed: true } });
  await hit('POST', `/api/games/${id}/announcement-individual`, { body: { token: tok, message: 'hi', recipients: [] } });

  // sms webhook
  await hit('POST', '/api/sms/webhook', { body: { fromNumber: '5555559001', text: '2' } });

  // cancel + delete
  await hit('DELETE', `/api/games/${id}`, { body: { token: tok, reason: 'smoke' } });
  await hit('DELETE', `/api/games/${id}/permanent`, { body: { token: tok } });

  const { deleteGamesById, deleteTestCourtImages, deletePhotosForGames } =
    require('./_cleanup');
  await deletePhotosForGames([id]); await deleteTestCourtImages(); await deleteGamesById([id]);

  console.log(`\n${checked} routes hit, ${broken} returned a 500\n`);
  process.exit(broken ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
