const PERMANENT_SMS_ERRORS = [
  'out of quota',
  'invalid phone number',
  'invalid api key',
  'message too long'
];

async function sendSMS(to, message, gameId = null) {
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
      body: new URLSearchParams(params)
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

function isPermanentSmsError(error) {
  if (!error) return false;
  const text = String(error).toLowerCase();
  return PERMANENT_SMS_ERRORS.some((candidate) => text.includes(candidate));
}

async function sendSMSWithRetry(
  to,
  message,
  gameId = null,
  { retries = 1, delayMs = 600 } = {}
) {
  let attempts = 0;
  let result;

  do {
    attempts++;
    result = await sendSMS(to, message, gameId);

    if (result.success) return { ...result, attempts };

    if (isPermanentSmsError(result.error)) {
      console.error(`[SMS] Permanent failure to ${to}, not retrying: ${result.error}`);
      return { ...result, attempts, permanent: true };
    }

    if (attempts <= retries) {
      console.warn(`[SMS] Send to ${to} failed (${result.error}); retrying once`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  } while (attempts <= retries);

  console.error(`[SMS] Giving up on ${to} after ${attempts} attempt(s): ${result.error}`);
  return { ...result, attempts };
}

module.exports = {
  PERMANENT_SMS_ERRORS,
  isPermanentSmsError,
  sendSMS,
  sendSMSWithRetry
};
