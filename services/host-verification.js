const crypto = require('crypto');

const { sendSMS } = require('./sms-client');

const CODE_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const challenges = new Map();
const fallbackSecret = crypto.randomBytes(32).toString('hex');

class HostVerificationError extends Error {
  constructor(message, status = 400, code = 'verification_error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function signingSecret() {
  return process.env.HOST_AUTH_SECRET || process.env.TEXTBELT_API_KEY || fallbackSecret;
}

function codeDigest(code, salt) {
  return crypto.createHash('sha256').update(`${salt}:${code}`).digest();
}

function safeEqual(left, right) {
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function sign(payload) {
  return crypto.createHmac('sha256', signingSecret()).update(payload).digest('base64url');
}

function createSessionToken(phone, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({
    phone,
    expiresAt: now + SESSION_TTL_MS,
    nonce: crypto.randomBytes(12).toString('base64url')
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifySessionToken(token, expectedPhone, now = Date.now()) {
  if (!token || !expectedPhone) return false;
  const [payload, suppliedSignature, extra] = String(token).split('.');
  if (!payload || !suppliedSignature || extra) return false;

  const expectedSignature = sign(payload);
  if (!safeEqual(Buffer.from(suppliedSignature), Buffer.from(expectedSignature))) return false;

  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return parsed.phone === expectedPhone &&
      Number.isFinite(parsed.expiresAt) &&
      parsed.expiresAt > now;
  } catch (_error) {
    return false;
  }
}

async function sendVerificationCode(phone, options = {}) {
  const now = options.now ?? Date.now();
  const existing = challenges.get(phone);
  if (existing && now - existing.sentAt < RESEND_COOLDOWN_MS) {
    const retryAfter = Math.ceil((RESEND_COOLDOWN_MS - (now - existing.sentAt)) / 1000);
    const error = new HostVerificationError(
      `Please wait ${retryAfter} seconds before requesting another code.`,
      429,
      'code_cooldown'
    );
    error.retryAfter = retryAfter;
    throw error;
  }

  const code = options.code || String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = crypto.randomBytes(16).toString('hex');
  challenges.set(phone, {
    digest: codeDigest(code, salt),
    salt,
    sentAt: now,
    expiresAt: now + CODE_TTL_MS,
    attempts: 0
  });

  const result = await (options.send || sendSMS)(
    phone,
    `Your IN or OUT verification code is ${code}. It expires in 10 minutes.`,
    null,
    { eventId: 'host-verification-code' }
  );

  if (!result?.success) {
    challenges.delete(phone);
    throw new HostVerificationError(
      'We could not send a verification code. Please try again.',
      502,
      'sms_failed'
    );
  }

  return { expiresInSeconds: CODE_TTL_MS / 1000, devCode: result.dev ? code : undefined };
}

function confirmVerificationCode(phone, code, now = Date.now()) {
  const challenge = challenges.get(phone);
  if (!challenge || challenge.expiresAt <= now) {
    challenges.delete(phone);
    throw new HostVerificationError(
      'That verification code has expired. Please request a new one.',
      400,
      'code_expired'
    );
  }

  challenge.attempts += 1;
  const supplied = codeDigest(String(code || '').trim(), challenge.salt);
  if (!safeEqual(supplied, challenge.digest)) {
    if (challenge.attempts >= MAX_ATTEMPTS) {
      challenges.delete(phone);
      throw new HostVerificationError(
        'Too many incorrect attempts. Please request a new code.',
        429,
        'too_many_attempts'
      );
    }
    throw new HostVerificationError(
      'That verification code is not correct.',
      400,
      'incorrect_code'
    );
  }

  challenges.delete(phone);
  return {
    token: createSessionToken(phone, now),
    expiresInSeconds: SESSION_TTL_MS / 1000
  };
}

function resetChallengesForTests() {
  challenges.clear();
}

module.exports = {
  HostVerificationError,
  CODE_TTL_MS,
  RESEND_COOLDOWN_MS,
  SESSION_TTL_MS,
  MAX_ATTEMPTS,
  createSessionToken,
  verifySessionToken,
  sendVerificationCode,
  confirmVerificationCode,
  resetChallengesForTests
};
