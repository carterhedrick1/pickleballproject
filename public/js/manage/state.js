// What the management page knows about the game it is managing.
//
// These three values used to be `let` declarations at the top of manage-scripts.js that the
// other four files read as globals, which is why the page depended on its script tags being in
// the right order. They are module exports now: ES modules give live bindings, so a module that
// imports `gameData` sees whatever setGameData last stored, and nothing has to be passed down
// through call chains that do not otherwise care about it.
//
// Only this module writes them. Everywhere else reads.

/** The game as the server last described it, or null before the first load. */
export let gameData = null;

/** The game being managed, from ?id= in the URL. */
export let gameId = '';

/** The host's key for that game. See captureHostToken for where it comes from. */
export let hostToken = '';

export function setGameData(next) {
  gameData = next;
  return gameData;
}

const HOST_TOKEN_STORAGE_PREFIX = 'inorout.hostToken.';

/**
 * The management link is the host's key, and it arrives with the token in the query string
 * (that is how the SMS link has always worked, and it keeps working). Once seen, the token is
 * remembered per game on this device and stripped from the address bar, so browser history and
 * copied URLs no longer carry it. A revisit without the token on the same device falls back to
 * the remembered one; a new device needs the SMS link again.
 */
function captureHostToken(id, urlParams) {
  let token = urlParams.get('token') || '';
  try {
    if (token && id) {
      localStorage.setItem(HOST_TOKEN_STORAGE_PREFIX + id, token);
    } else if (!token && id) {
      token = localStorage.getItem(HOST_TOKEN_STORAGE_PREFIX + id) || '';
    }
  } catch (storageError) {
    // Storage blocked (private mode): the URL token still runs this page view.
  }
  if (urlParams.get('token')) {
    try {
      const url = new URL(window.location);
      url.searchParams.delete('token');
      history.replaceState(history.state, '', url);
    } catch (historyError) {
      // A browser that cannot rewrite the URL simply keeps the old behavior.
    }
  }
  return token;
}

/**
 * Reads the game and its token out of the URL, once, at boot.
 * @returns {{gameId: string, hostToken: string}}
 */
export function readGameFromUrl(search = window.location.search) {
  const urlParams = new URLSearchParams(search);
  gameId = urlParams.get('id') || '';
  hostToken = captureHostToken(gameId, urlParams);
  return { gameId, hostToken };
}
