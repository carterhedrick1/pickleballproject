// Verifies that an inbound /api/sms/webhook request really came from Textbelt.
//
// Textbelt signs every reply webhook (https://docs.textbelt.com/):
//   X-textbelt-timestamp  - a unix timestamp in seconds
//   X-textbelt-signature  - hex HMAC-SHA256 over (timestamp + raw JSON body), keyed with
//                           the account's API key
// A request without a valid, fresh signature could be anyone on the internet, and a forged
// "9" reply cancels a real player's spot - so this check runs before the handler does
// anything at all.
//
// Known limitation, accepted deliberately: an attacker who captures a signed request can
// replay it verbatim inside the 15-minute freshness window. Blocking that needs persistent
// nonce storage; the commands themselves are close to idempotent (a repeated "9" finds
// nothing left to cancel), so the window is bounded rather than eliminated.
const crypto = require('crypto');

const MAX_TIMESTAMP_AGE_SECONDS = 15 * 60;

function computeSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac('sha256', secret)
    .update(String(timestamp))
    .update(rawBody || '')
    .digest('hex');
}

function verifyTextbeltSignature({ secret, signature, timestamp, rawBody, nowMs = Date.now() }) {
  if (!secret) return { ok: false, reason: 'no-secret-configured' };
  if (!signature || !timestamp) return { ok: false, reason: 'missing-headers' };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: 'malformed-timestamp' };
  if (Math.abs(nowMs / 1000 - ts) > MAX_TIMESTAMP_AGE_SECONDS) {
    return { ok: false, reason: 'stale-timestamp' };
  }

  if (!rawBody || rawBody.length === 0) return { ok: false, reason: 'missing-body' };

  const expected = Buffer.from(computeSignature(secret, timestamp, rawBody));
  const provided = Buffer.from(String(signature));
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'bad-signature' };
  }

  return { ok: true };
}

// Express middleware. Needs server.js to capture the raw request body via
// express.json({ verify }) as req.rawBody, because the signature covers the exact bytes
// Textbelt sent - not a re-serialization of the parsed object.
function requireTextbeltSignature({
  secret = () => process.env.TEXTBELT_API_KEY,
  isProduction = () => Boolean(process.env.DATABASE_URL)
} = {}) {
  return function textbeltSignatureGate(req, res, next) {
    const key = typeof secret === 'function' ? secret() : secret;

    if (!key) {
      // No API key means outbound texts are simulated, so real replies cannot exist. The
      // local verify rigs post simulated webhooks in exactly this state. Production must
      // never accept it - startup validation makes a keyless production boot fail, but
      // this guard holds even if that changes.
      const production = typeof isProduction === 'function' ? isProduction() : isProduction;
      if (production) {
        return res.status(401).json({ error: 'Webhook authentication is not configured.' });
      }
      return next();
    }

    const result = verifyTextbeltSignature({
      secret: key,
      signature: req.headers['x-textbelt-signature'],
      timestamp: req.headers['x-textbelt-timestamp'],
      rawBody: req.rawBody
    });

    if (!result.ok) {
      // The reason only - never the payload, the headers, or any phone number.
      console.warn(`[SMS WEBHOOK] Rejected webhook: ${result.reason}`);
      return res.status(401).json({ error: 'Invalid webhook signature.' });
    }

    return next();
  };
}

module.exports = {
  MAX_TIMESTAMP_AGE_SECONDS,
  computeSignature,
  verifyTextbeltSignature,
  requireTextbeltSignature
};
