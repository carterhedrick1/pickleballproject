/**
 * What counts as an image, and how to tell.
 *
 * Shared by the two upload surfaces - event photos and the court image library - which is why
 * this lives here rather than in either one. Both accept a raw image body rather than
 * multipart, which keeps the app dependency-free: express.raw is applied per upload route, and
 * the global express.json ignores image/* bodies, so the two coexist.
 */

const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const MAX_PHOTOS_PER_GAME = 12;

/**
 * Works out what the file actually is from its first bytes. The Content-Type header is
 * whatever the client felt like sending, so it is never trusted or stored.
 * @returns the real mime type, or null if these bytes are not an image we accept.
 */
function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null;

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';

  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (PNG_SIGNATURE.every((byte, i) => buffer[i] === byte)) return 'image/png';

  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  return null;
}

module.exports = { PHOTO_TYPES, MAX_PHOTOS_PER_GAME, sniffImageType };
