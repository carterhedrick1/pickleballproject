// config.js - one place that reads the environment and decides whether this process is
// safe to serve production traffic.
//
// isProduction matches database/context.js: the presence of DATABASE_URL is what switches
// the app onto PostgreSQL, so it is also what switches these rules on.
//
// Production rules are graded on purpose:
//   - TEXTBELT_API_KEY missing is fatal. Outbound texts and inbound webhook signature
//     verification both depend on it, so its absence means a misconfigured deploy. Exiting
//     during boot leaves the previous deploy running on Render rather than serving broken.
//   - DEV_PASSWORD missing, or left on the old "vibe123" default, does NOT kill the
//     process; it disables the developer area instead. Crashing would turn a weak
//     dashboard password into a full production outage, which is the worse trade.
require('dotenv').config();

const DEFAULT_DEV_PASSWORD = 'vibe123';

function buildConfig(env = process.env) {
  const isProduction = Boolean(env.DATABASE_URL);
  const devPassword = env.DEV_PASSWORD || (isProduction ? null : DEFAULT_DEV_PASSWORD);
  const devPasswordIsDefault = !devPassword || devPassword === DEFAULT_DEV_PASSWORD;

  return {
    isProduction,
    databaseUrl: env.DATABASE_URL || null,
    textbeltApiKey: env.TEXTBELT_API_KEY || null,
    baseUrl: env.BASE_URL || null,
    devPassword,
    // In production a missing or default password would let anyone who has read this
    // repository into the dashboard, so the area closes instead.
    devAreaEnabled: !(isProduction && devPasswordIsDefault),
    hostAuthSecret: env.HOST_AUTH_SECRET || null
  };
}

function validateConfig(config) {
  const errors = [];
  const warnings = [];

  if (config.isProduction) {
    if (!config.textbeltApiKey) {
      errors.push(
        'TEXTBELT_API_KEY is required in production: SMS sending and webhook signature verification depend on it.'
      );
    }
    if (!config.baseUrl) {
      warnings.push('BASE_URL is not set; SMS links will fall back to hard-coded defaults.');
    } else if (!/^https:\/\//.test(config.baseUrl)) {
      errors.push('BASE_URL must be an https:// URL in production.');
    }
    if (!config.devAreaEnabled) {
      warnings.push(
        'DEV_PASSWORD is missing or still the known default; the developer area is disabled until a real password is set.'
      );
    }
    if (!config.hostAuthSecret) {
      warnings.push('HOST_AUTH_SECRET is not set; host verification falls back to signing with TEXTBELT_API_KEY.');
    }
  }

  return { errors, warnings };
}

// Called once from server startup, before anything listens.
function assertStartupConfig(
  config = module.exports.config,
  { log = console, exit = (code) => process.exit(code) } = {}
) {
  const { errors, warnings } = validateConfig(config);
  warnings.forEach((warning) => log.warn(`[CONFIG] ${warning}`));
  if (errors.length > 0) {
    errors.forEach((error) => log.error(`[CONFIG] FATAL: ${error}`));
    exit(1);
  }
  return { errors, warnings };
}

module.exports = {
  DEFAULT_DEV_PASSWORD,
  buildConfig,
  validateConfig,
  assertStartupConfig,
  config: buildConfig()
};
