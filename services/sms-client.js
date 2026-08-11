const PERMANENT_SMS_ERRORS = [
  'out of quota',
  'invalid phone number',
  'invalid api key',
  'message too long'
];

const { normalizeSmsEventId } = require('../sms-event-catalog');

// A provider connection must finish before the hosting proxy gives up on the browser request.
// Callers turn this into an ordinary failed text, so one stalled provider response cannot leave
// a host looking at Safari's unhelpful "Load failed" message.
const SMS_PROVIDER_TIMEOUT_MS = 12000;

async function recordSmsResult(to, gameId, eventId, result, attempts = 1, ticket = null) {
  if (process.env.SMS_DISABLE_EVENT_LOGGING === '1') return;
  try {
    // Load lazily so the SMS client stays usable in isolated safety tests and during startup.
    const { logSmsEvent } = require('../database');
    await logSmsEvent({
      // The caller may have handed its ticket to a browser that is waiting to hear how
      // this text turned out, so the row is written under that id rather than a fresh one.
      id: ticket,
      eventId: normalizeSmsEventId(eventId),
      gameId,
      phoneNumber: to,
      status: result.success ? (result.dev ? 'simulated' : 'sent') : 'failed',
      attempts,
      error: result.error || null
    });
  } catch (error) {
    // Telemetry must never turn a successful notification into an app failure.
    if (String(error.message).includes('no such table: sms_events')) return;
    console.error('[SMS METRICS] Could not record send event:', error.message);
  }
}

async function performSendSMS(to, message, gameId = null) {
  try {
    if (process.env.SMS_SIMULATE_FAILURE === '1') {
      console.log(`[DEV MODE] Simulating SMS failure to ${to}`);
      return { success: false, error: 'simulated failure', simulated: true };
    }

    // A normal local server writes games to SQLite, but .env intentionally points BASE_URL at
    // the production site. Sending a real text from that combination creates a split
    // conversation: the game exists only locally while replies are delivered to production,
    // where commands 1, 2 and 9 cannot find it. Keep local sends simulated unless a developer
    // explicitly opts in while using a reachable callback (for example, a tunnel).
    if (!process.env.DATABASE_URL && process.env.ALLOW_LOCAL_SMS !== '1') {
      console.log(`[DEV MODE] SMS would be sent to ${to}: ${message}`);
      return { success: true, dev: true, localSafety: true };
    }

    if (!process.env.TEXTBELT_API_KEY) {
      console.log(`[DEV MODE] SMS would be sent to ${to}: ${message}`);
      return { success: true, dev: true };
    }

    const params = {
      phone: to,
      message,
      key: process.env.TEXTBELT_API_KEY
    };

    if (gameId) {
      params.replyWebhookUrl =
        `${process.env.BASE_URL || 'https://your-domain.com'}/api/sms/webhook`;
      params.webhookData = gameId;
    }

    const response = await fetch('https://textbelt.com/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
      signal: AbortSignal.timeout(SMS_PROVIDER_TIMEOUT_MS)
    });
    const result = await response.json();

    if (result.success) {
      console.log(`SMS sent to ${to}. TextID: ${result.textId}`);
      return { success: true, textId: result.textId };
    }

    console.error('TextBelt error:', result.error);
    return { success: false, error: result.error };
  } catch (error) {
    console.error('SMS sending failed:', error);
    return { success: false, error: error.message };
  }
}

async function sendSMS(to, message, gameId = null, { eventId, ticket = null } = {}) {
  const result = await performSendSMS(to, message, gameId);
  await recordSmsResult(to, gameId, eventId, result, 1, ticket);
  return result;
}

function isPermanentSmsError(error) {
  if (!error) return false;
  const text = String(error).toLowerCase();
  return PERMANENT_SMS_ERRORS.some((candidate) => text.includes(candidate));
}

async function sendSMSWithRetry(
  to,
  message,
  gameId = null,
  { retries = 1, delayMs = 600, eventId, ticket = null } = {}
) {
  let attempts = 0;
  let result;

  do {
    attempts++;
    result = await performSendSMS(to, message, gameId);

    if (result.success) {
      const finalResult = { ...result, attempts };
      await recordSmsResult(to, gameId, eventId, finalResult, attempts, ticket);
      return finalResult;
    }

    if (isPermanentSmsError(result.error)) {
      console.error(`[SMS] Permanent failure to ${to}, not retrying: ${result.error}`);
      const finalResult = { ...result, attempts, permanent: true };
      await recordSmsResult(to, gameId, eventId, finalResult, attempts, ticket);
      return finalResult;
    }

    if (attempts <= retries) {
      console.warn(`[SMS] Send to ${to} failed (${result.error}); retrying once`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } while (attempts <= retries);

  console.error(`[SMS] Giving up on ${to} after ${attempts} attempt(s): ${result.error}`);
  const finalResult = { ...result, attempts };
  await recordSmsResult(to, gameId, eventId, finalResult, attempts, ticket);
  return finalResult;
}

module.exports = {
  PERMANENT_SMS_ERRORS,
  SMS_PROVIDER_TIMEOUT_MS,
  isPermanentSmsError,
  sendSMS,
  sendSMSWithRetry
};
