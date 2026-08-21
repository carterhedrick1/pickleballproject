// Every call the management page makes to the API goes through here.
//
// This is where the host token is attached, and it is the only place that knows how. The page
// used to prove it was the host in two different ways depending on which button was pressed:
// the GET and DELETE calls sent an X-Host-Token header, while the POST and PUT calls put
// `token` in the JSON body, where it ended up copied into request logs by anything that logged
// bodies. Ten routes read `req.body.token` to match. They all read requestHostToken now, which
// still accepts the body and query forms for the SMS links and older clients, and this client
// sends the header and nothing else.
//
// Two entry points on purpose. `request` hands back the Response, because a good half of the
// call sites branch on the status themselves - a 403 sends the host to the unauthorized screen
// rather than showing an error, and the invitation sender treats a failure as something to
// retry. `json` is the shorter path for the calls that only ever wanted the body.
import { hostToken } from './state.js';

/** A failed call, carrying whatever the server said and the status it said it with. */
export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

function buildHeaders({ headers = {}, body, isRaw }) {
  const built = { ...headers };
  if (hostToken) built['X-Host-Token'] = hostToken;
  // A raw body (image bytes) brings its own content type; a plain object is JSON.
  if (body !== undefined && !isRaw && !built['Content-Type']) {
    built['Content-Type'] = 'application/json';
  }
  return built;
}

/**
 * A fetch with the host header already on it.
 *
 * @param {string} path - an /api/... path
 * @param {object} [options]
 * @param {string} [options.method]
 * @param {*} [options.body] - an object, which is serialized, unless `raw` is set
 * @param {object} [options.headers]
 * @param {boolean} [options.raw] - send body as-is (used by the two image uploads)
 * @returns {Promise<Response>}
 */
export function request(path, { method = 'GET', body, headers, raw = false } = {}) {
  return fetch(path, {
    method,
    headers: buildHeaders({ headers, body, isRaw: raw }),
    body: body === undefined ? undefined : (raw ? body : JSON.stringify(body))
  });
}

/**
 * The same call, resolved to the parsed body.
 * @throws {ApiError} on any non-2xx, carrying the server's own `error` wording so the page can
 *   show it the way it always has.
 */
export async function json(path, options) {
  const response = await request(path, options);
  let body = null;
  try {
    body = await response.json();
  } catch (parseError) {
    body = null;
  }
  if (!response.ok) {
    throw new ApiError(
      (body && body.error) || `Request failed (${response.status})`,
      response.status,
      body
    );
  }
  return body;
}

export const api = { request, json, ApiError };
export default api;
