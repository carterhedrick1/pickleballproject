// Court images: the per-court library a host picks a photo from, and the one they select.
// Usage: node court-images.js [baseUrl]
//
// Court images are keyed by COURT NAME, not by game, so one library is shared by every game
// at that court while the *selection* belongs to a single game. That split is the thing most
// likely to break, so it is checked directly rather than inferred from the endpoints answering.
//
// Like photos, the bytes live in the database (Render gives the app no persistent disk), so
// this checks they survive a full round trip.
//
// No phone numbers are used anywhere here, so nothing can be texted.
//   npm run verify:court-images

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

// A real 1x1 PNG, byte for byte - the upload route sniffs the magic bytes and rejects anything
// that is not genuinely an image, so a made-up buffer would not get through.
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);
// A minimal JPEG, used to check the sniffed type is stored rather than the claimed Content-Type.
const JPEG_BYTES = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0', 'ascii'),
  Buffer.alloc(32, 0x20),
  Buffer.from([0xff, 0xd9]),
]);

const COURT = 'Court Image Court';
const OTHER_COURT = 'Court Image Court Two';

async function upload(gameId, token, bytes, { contentType = 'image/png' } = {}) {
  const qs = new URLSearchParams();
  if (token) qs.set('token', token);
  const res = await fetch(`${BASE}/api/games/${gameId}/court-images?${qs}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: bytes,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}

function makeGame(location, courtNumber, time) {
  return req('POST', '/api/games', {
    location, courtNumber, organizerName: 'Host',
    organizerPlaying: false, date: '2026-09-19', time, duration: 90,
    totalPlayers: 4, message: 'court image verification', registrationMode: 'fcfs',
  });
}

(async () => {
  console.log(`\n=== Court images (${BASE}) ===\n`);

  const created = await makeGame(COURT, '1', '18:00');
  if (created.status !== 201) {
    console.error('could not create the test game:', created.text.slice(0, 200));
    process.exit(1);
  }
  const { gameId, hostToken } = created.json;
  console.log(`test game: ${gameId} at ${COURT}\n`);

  console.log('1. Only the host can add to the library');
  const noToken = await upload(gameId, null, PNG_1PX);
  check(noToken.status === 403, `no token -> HTTP ${noToken.status} (expected 403)`);
  const wrongToken = await upload(gameId, 'deadbeef', PNG_1PX);
  check(wrongToken.status === 403, `wrong token -> HTTP ${wrongToken.status} (expected 403)`);

  console.log('\n2. A real image uploads');
  const first = await upload(gameId, hostToken, PNG_1PX);
  check(first.status === 201, `HTTP ${first.status} (expected 201)`);
  check(!!first.json?.imageId, `got an image id (${first.json?.imageId})`);
  const imageId = first.json?.imageId;

  console.log('\n3. Anything that is not an image is refused');
  const notAnImage = await fetch(`${BASE}/api/games/${gameId}/court-images?token=${hostToken}`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'this is just text',
  });
  check(notAnImage.status === 400, `a text body claiming to be a PNG -> HTTP ${notAnImage.status} (expected 400)`);

  console.log('\n4. The stored type comes from the bytes, not the header');
  const lying = await upload(gameId, hostToken, JPEG_BYTES, { contentType: 'image/png' });
  check(lying.status === 201, `a JPEG sent as image/png is accepted (HTTP ${lying.status})`);
  const lyingFetch = await fetch(`${BASE}/api/court-images/${lying.json?.imageId}`);
  check(lyingFetch.headers.get('content-type')?.includes('image/jpeg'),
    `and served as image/jpeg (got ${lyingFetch.headers.get('content-type')})`);

  console.log('\n5. The bytes survive the round trip, by either path');
  const viaGame = await fetch(`${BASE}/api/games/${gameId}/court-images/${imageId}`);
  const viaGameBytes = Buffer.from(await viaGame.arrayBuffer());
  check(viaGame.status === 200, `game-scoped fetch -> HTTP ${viaGame.status}`);
  check(viaGame.headers.get('content-type')?.includes('image/png'), 'served as image/png');
  check(viaGameBytes.equals(PNG_1PX), 'the bytes come back identical');

  const viaLibrary = await fetch(`${BASE}/api/court-images/${imageId}`);
  const viaLibraryBytes = Buffer.from(await viaLibrary.arrayBuffer());
  check(viaLibrary.status === 200, `library fetch -> HTTP ${viaLibrary.status}`);
  check(viaLibraryBytes.equals(PNG_1PX), 'and are identical by that path too');

  const missing = await fetch(`${BASE}/api/court-images/no-such-image`);
  check(missing.status === 404, `an unknown image id -> HTTP ${missing.status} (expected 404)`);

  console.log('\n6. Listing the library is public');
  const list = await req('GET', `/api/games/${gameId}/court-images`);
  check(list.status === 200, `HTTP ${list.status} with no token (players can see them)`);
  check((list.json?.images || []).length === 2, `2 images listed (got ${(list.json?.images || []).length})`);
  check(!('image_data' in ((list.json?.images || [])[0] || {})), 'the image bytes are NOT in the listing');
  check(list.json?.selectedImageId === null || list.json?.selectedImageId === undefined,
    `nothing selected yet (got ${JSON.stringify(list.json?.selectedImageId)})`);

  console.log('\n7. Selecting an image is host-only, and belongs to the game');
  const selNoToken = await req('PUT', `/api/games/${gameId}/court-image/${imageId}`);
  check(selNoToken.status === 403, `no token -> HTTP ${selNoToken.status} (expected 403)`);

  const sel = await req('PUT', `/api/games/${gameId}/court-image/${imageId}?token=${hostToken}`);
  check(sel.status === 200, `the host can select (HTTP ${sel.status})`);

  const afterSelect = await req('GET', `/api/games/${gameId}/court-images`);
  check(afterSelect.json?.selectedImageId === imageId, 'the selection comes back');
  check((afterSelect.json?.images || []).find((i) => i.id === imageId)?.isSelected === true,
    'and the chosen image is flagged isSelected');

  console.log('\n8. The library is shared by court, the selection is not');
  const sameCourt = await makeGame(COURT, '2', '19:00');
  const sameCourtList = await req('GET', `/api/games/${sameCourt.json.gameId}/court-images`);
  check((sameCourtList.json?.images || []).length === 2,
    `a second game at ${COURT} sees the same 2 images (got ${(sameCourtList.json?.images || []).length})`);
  check(!sameCourtList.json?.selectedImageId,
    'but inherits no selection of its own');

  const otherCourt = await makeGame(OTHER_COURT, '1', '20:00');
  const otherCourtList = await req('GET', `/api/games/${otherCourt.json.gameId}/court-images`);
  check((otherCourtList.json?.images || []).length === 0,
    `a game at a different court sees none (got ${(otherCourtList.json?.images || []).length})`);

  console.log('\n9. The by-court-name library answers too');
  const byName = await req('GET', `/api/courts/${encodeURIComponent(COURT)}/library`);
  check(byName.status === 200, `HTTP ${byName.status}`);
  check((byName.json?.images || []).length === 2, `2 images for ${COURT} (got ${(byName.json?.images || []).length})`);

  const allCourts = await req('GET', '/api/courts/images/list');
  check(allCourts.status === 200, `the global court list answers (HTTP ${allCourts.status})`);

  console.log('\n10. The dev-only single court image refuses anonymous uploads');
  // 401 rather than 403: this route uses the developer area's own sign-in (requireDevAuth),
  // which answers "Not signed in" - it no longer keeps a second copy of the password check.
  const devUpload = await fetch(`${BASE}/api/courts/${encodeURIComponent(COURT)}/image`, {
    method: 'POST', headers: { 'Content-Type': 'image/png' }, body: PNG_1PX,
  });
  check(devUpload.status === 401, `not signed in -> HTTP ${devUpload.status} (expected 401)`);

  const devUploadAuthed = await fetch(`${BASE}/api/courts/${encodeURIComponent(COURT)}/image`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', 'x-dev-password': process.env.DEV_PASSWORD || 'vibe123' },
    body: PNG_1PX,
  });
  check(devUploadAuthed.status === 201, `signed in -> HTTP ${devUploadAuthed.status} (expected 201)`);

  console.log('\n11. Clearing the selection');
  const clearNoToken = await req('PUT', `/api/games/${gameId}/court-image-none`);
  check(clearNoToken.status === 403, `no token -> HTTP ${clearNoToken.status} (expected 403)`);

  const clear = await req('PUT', `/api/games/${gameId}/court-image-none?token=${hostToken}`);
  check(clear.status === 200, `the host can clear (HTTP ${clear.status})`);
  const afterClear = await req('GET', `/api/games/${gameId}/court-images`);
  check(!afterClear.json?.selectedImageId, 'and nothing is selected any more');
  check((afterClear.json?.images || []).length === 2, 'while the library itself is untouched');

  console.log('\n12. Deleting from the library');
  const delNoToken = await req('DELETE', `/api/games/${gameId}/court-images/${imageId}`);
  check(delNoToken.status === 403, `no token -> HTTP ${delNoToken.status} (expected 403)`);

  const del = await req('DELETE', `/api/games/${gameId}/court-images/${imageId}?token=${hostToken}`);
  check(del.status === 200, `the host can delete (HTTP ${del.status})`);

  const afterDelete = await req('GET', `/api/games/${gameId}/court-images`);
  check((afterDelete.json?.images || []).length === 1,
    `1 left (got ${(afterDelete.json?.images || []).length})`);

  const gone = await fetch(`${BASE}/api/court-images/${imageId}`);
  check(gone.status === 404, `and the image itself is gone (HTTP ${gone.status})`);

  console.log('\n13. Cleaning up');
  // Only ever touch the local database, and only when the run really was local. Creating a game
  // remembers its court, so without the locations sweep the two invented courts above would show
  // up in the real create-form picker.
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE)) {
    const {
      deleteGamesById, deleteTestCourtImages, cleanupTestRosterAndLocations,
    } = require('./_cleanup');
    const removedImages = await deleteTestCourtImages();
    const removed = await deleteGamesById([
      gameId, sameCourt.json.gameId, otherCourt.json.gameId,
    ]);
    await cleanupTestRosterAndLocations();
    ok(`removed ${removed} test game(s), ${removedImages} court image(s) and the test courts`);
  } else {
    ok('not a local run - left the remote database alone');
  }

  console.log(`\n=== ${failures} failure(s) ===\n`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR:', e); process.exit(1); });
