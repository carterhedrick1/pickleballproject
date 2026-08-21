// The two shapes every tab's calls to /api/dev were written out longhand in.
//
// The first is sending JSON: `method`, a Content-Type header, and JSON.stringify. That was
// spelled out at nine call sites across six tabs, and every one of them had to remember the
// header - a POST that forgets it arrives with an empty body and fails in a way that looks
// like a server bug.
//
// The second is what a 401 means here. The developer area is cookie-authenticated, and the
// cookie lasts thirty days, so any loader can be the one that discovers it has expired. Each
// tab answered that by hiding the dashboard and showing the sign-in screen again, in its own
// copy of the same two lines.
import { el } from './shared.js';

/** POST/PUT/DELETE with a JSON body. Returns the Response, which callers read for the error. */
export function sendJson(path, method, body) {
  return fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

/**
 * Handles an expired sign-in.
 *
 * @returns {boolean} true when the caller should stop - the session is gone and the sign-in
 *   screen is back up.
 */
export function signedOut(response) {
  if (response.status !== 401) return false;
  el('appView').classList.add('hidden');
  el('loginView').classList.remove('hidden');
  return true;
}
