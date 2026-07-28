// Event photos: upload, list, fetch, delete.
// Usage: node photos.js [baseUrl]
//
// Photos live in the database (Render gives the app no persistent disk), so this checks the
// bytes survive a full round trip rather than just that the endpoints answer.
//
// No phone numbers are used anywhere here, so nothing can be texted.
//   npm run verify:photos

const BASE = process.argv[2] || 'http://localhost:3002';

let failures = 0;
const ok = (m) => console.log(`  PASS  ${m}`);
const bad = (m) => { console.log(`  FAIL  ${m}`); failures++; };
const check = (c, m) => (c ? ok(m) : bad(m));

async function req(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

// A real 1x1 PNG, byte for byte - the upload route sniffs the magic bytes and rejects
// anything that is not genuinely an image, so a made-up buffer would not get through.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
// A minimal JPEG (SOI + APP0 + enough to be recognised), used to check the sniffed type is
// stored rather than whatever Content-Type the client claimed.
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'ascii'),
  Buffer.alloc(32, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

async function upload(gameId, token, bytes, { contentType = 'image/png', caption = '' } = {}) {
  const qs = new URLSearchParams();
  if (token) qs.set('token', token);
  if (caption) qs.set('caption', caption);
  const res = await fetch(`${BASE}/api/games/${gameId}/photos?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

(async () => {
  console.log(`\n=== Event photos (${BASE}) ===\n`);

  const created = await req('POST', '/api/games', {
    location: 'Test Court', organizerName: 'Host',
    organizerPlaying: false, date: '2026-09-19', time: '18:00', duration: 90,
    totalPlayers: 4, message: 'photo verification', registrationMode: 'fcfs',
  });
  if (created.status !== 201) {
    console.error('could not create the test game:', created.text.slice(0, 200));
    process.exit(1);
  }
  const { gameId, hostToken } = created.json;
  console.log(`test game: ${gameId}\n`);

  console.log('1. Only the host can upload');
  const noToken = await upload(gameId, null, PNG_1PX);
  check(noToken.status === 403, `no token -> HTTP ${noToken.status} (expected 403)`);
  const wrongToken = await upload(gameId, 'deadbeef', PNG_1PX);
  check(wrongToken.status === 403, `wrong token -> HTTP ${wrongToken.status} (expected 403)`);

  console.log('\n2. A real image uploads');
  const first = await upload(gameId, hostToken, PNG_1PX, { caption: 'Court 1 at sunset' });
  check(first.status === 201, `HTTP ${first.status} (expected 201)`);
  check(!!first.json?.id, `got a photo id (${first.json?.id})`);
  check(first.json?.caption === 'Court 1 at sunset', 'the caption came back');
  check(first.json?.url === `/api/games/${gameId}/photos/${first.json?.id}`, 'and a url to fetch it');

  console.log('\n3. Anything that is not an image is refused');
  const notAnImage = await fetch(`${BASE}/api/games/${gameId}/photos?token=${hostToken}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'this is just text',
  });
  check(notAnImage.status === 400, `a text body claiming to be a PNG -> HTTP ${notAnImage.status} (expected 400)`);

  console.log('\n4. The stored type comes from the bytes, not the header');
  const lying = await upload(gameId, hostToken, JPEG_BYTES, { contentType: 'image/png' });
  check(lying.status === 201, `a JPEG sent as image/png is accepted (HTTP ${lying.status})`);
  const lyingFetch = await fetch(`${BASE}${lying.json.url}`);
  check(lyingFetch.headers.get('content-type')?.includes('image/jpeg'),
    `and served as image/jpeg (got ${lyingFetch.headers.get('content-type')})`);

  console.log('\n5. Listing photos is public, and reports sizes without the bytes');
  const list = await req('GET', `/api/games/${gameId}/photos`);
  check(list.status === 200, `HTTP ${list.status} with no token (players can see them)`);
  check((list.json?.photos || []).length === 2, `2 photos listed (got ${(list.json?.photos || []).length})`);
  const listed = (list.json?.photos || []).find((p) => p.id === first.json.id);
  check(listed?.bytes === PNG_1PX.length, `size reported (${listed?.bytes} bytes, expected ${PNG_1PX.length})`);
  check(!('data' in (listed || {})), 'the image bytes are NOT in the listing');

  console.log('\n6. The bytes survive the round trip');
  const fetched = await fetch(`${BASE}${first.json.url}`);
  const roundTripped = Buffer.from(await fetched.arrayBuffer());
  check(fetched.status === 200, `HTTP ${fetched.status}`);
  check(fetched.headers.get('content-type')?.includes('image/png'), 'served as image/png');
  check(roundTripped.equals(PNG_1PX), 'the bytes come back identical');
  check(/immutable/.test(fetched.headers.get('cache-control') || ''),
    `cached hard (${fetched.headers.get('cache-control')})`);

  console.log('\n7. A photo id cannot be fetched against a different game');
  const other = await req('POST', '/api/games', {
    location: 'Test Court', organizerName: 'Host',
    organizerPlaying: false, date: '2026-09-19', time: '19:00', duration: 90,
    totalPlayers: 4, message: 'photo verification (other)', registrationMode: 'fcfs',
  });
  const crossGame = await fetch(`${BASE}/api/games/${other.json.gameId}/photos/${first.json.id}`);
  check(crossGame.status === 404, `another game's id -> HTTP ${crossGame.status} (expected 404)`);

  console.log('\n8. Twelve is the limit');
  for (let i = 3; i <= 12; i++) {
    const r = await upload(gameId, hostToken, PNG_1PX, { caption: `Photo ${i}` });
    if (r.status !== 201) bad(`photo ${i} -> HTTP ${r.status}: ${r.text.slice(0, 120)}`);
  }
  const twelve = await req('GET', `/api/games/${gameId}/photos`);
  check((twelve.json?.photos || []).length === 12, `12 photos stored (got ${(twelve.json?.photos || []).length})`);
  const thirteenth = await upload(gameId, hostToken, PNG_1PX);
  check(thirteenth.status === 400, `a 13th -> HTTP ${thirteenth.status} (expected 400)`);

  console.log('\n9. My Games shows the count');
  const byPhone = await req('GET', `/api/games/by-phone/5555559001?all=1`);
  check(byPhone.status === 200, 'the host history still answers');
  check(byPhone.json?.games?.every((g) => typeof g.photoCount === 'number'),
    'every card carries a photoCount');

  console.log('\n10. Deleting');
  const delNoToken = await req('DELETE', `/api/games/${gameId}/photos/${first.json.id}`);
  check(delNoToken.status === 403, `no token -> HTTP ${delNoToken.status} (expected 403)`);

  const del = await req('DELETE', `/api/games/${gameId}/photos/${first.json.id}?token=${hostToken}`);
  check(del.status === 200, `the host can delete (HTTP ${del.status})`);

  const delAgain = await req('DELETE', `/api/games/${gameId}/photos/${first.json.id}?token=${hostToken}`);
  check(delAgain.status === 404, `deleting it twice -> HTTP ${delAgain.status} (expected 404)`);

  const afterDelete = await req('GET', `/api/games/${gameId}/photos`);
  check((afterDelete.json?.photos || []).length === 11, `11 left (got ${(afterDelete.json?.photos || []).length})`);

  const gone = await fetch(`${BASE}${first.json.url}`);
  check(gone.status === 404, `and the image itself is gone (HTTP ${gone.status})`);

  console.log('\n11. Cleaning up');
  const { deleteGamesById, deletePhotosForGames } = require('./_cleanup');
  await deletePhotosForGames([gameId, other.json.gameId]);
  const removed = await deleteGamesById([gameId, other.json.gameId]);
  ok(`removed ${removed} test game(s) and their photos`);

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
