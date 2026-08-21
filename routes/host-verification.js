const rateLimit = require('express-rate-limit');

const { isProduction } = require('../database/context');
const { getGamesByHostPhone } = require('../database/games');
const { getRosterForHost } = require('../database/roster');
const { formatPhoneNumber } = require('../utils/sms-format');
const {
  HostVerificationError,
  sendVerificationCode,
  confirmVerificationCode
} = require('../services/host-verification');
const { routeFailed } = require('../utils/route-error');

const requestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  skip: () => !isProduction,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification codes requested. Please wait 15 minutes.' }
});

function validPhone(value) {
  return /^\d{10}$/.test(value || '');
}

function verificationFailed(req, res, error, fallback) {
  if (error instanceof HostVerificationError) {
    if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  return routeFailed(req, res, error, fallback);
}

module.exports = function mountHostVerificationRoutes(app) {
  app.post('/api/host-verification/request', requestLimiter, async (req, res) => {
    try {
      const phone = formatPhoneNumber(req.body?.phone);
      if (!validPhone(phone)) {
        return res.status(400).json({ error: 'Please enter a valid 10-digit phone number.' });
      }

      const [games, roster] = await Promise.all([
        getGamesByHostPhone(phone),
        getRosterForHost(phone)
      ]);
      if (!games.length && !roster.length) {
        return res.status(404).json({
          error: 'We could not find any games hosted with that phone number.'
        });
      }

      const result = await sendVerificationCode(phone);
      res.json({
        success: true,
        phoneNumber: phone,
        expiresInSeconds: result.expiresInSeconds,
        ...(!isProduction && result.devCode ? { devCode: result.devCode } : {})
      });
    } catch (error) {
      verificationFailed(req, res, error, 'Failed to send host verification code');
    }
  });

  app.post('/api/host-verification/confirm', async (req, res) => {
    try {
      const phone = formatPhoneNumber(req.body?.phone);
      const code = String(req.body?.code || '').trim();
      if (!validPhone(phone) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: 'Enter the 6-digit verification code.' });
      }

      const result = confirmVerificationCode(phone, code);
      res.json({
        success: true,
        phoneNumber: phone,
        token: result.token,
        expiresInSeconds: result.expiresInSeconds
      });
    } catch (error) {
      verificationFailed(req, res, error, 'Failed to confirm host verification code');
    }
  });
};
