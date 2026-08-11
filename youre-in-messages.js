const DEFAULT_MESSAGES = Object.freeze([
  "You're IN. The others have been warned.",
  "You're IN. Feel free to leave the new paddle at home. It was never the problem.",
  "You're IN. Your one good shot is scheduled for game three.",
  "You're IN. Somebody had to be.",
  "You're IN. They needed one more, and you were available. That's the whole reason.",
  "You're IN, and you have been randomly selected to bring snacks for everyone.",
  "You're IN. You committed, which is more than most people managed today.",
  "You're IN. Availability beats ability, and today you've got the first one.",
  "You're IN. Don't make me regret the automation.",
  "You're IN. The bar was low and you cleared it.",
  "You're IN. You answered, which narrowed the field considerably.",
  "You're IN. Not the first choice. First to respond.",
  "You're IN. A pulse and a paddle were the entire requirement.",
  "You're IN. Congratulations on being reachable.",
  "You're IN. Standards were adjusted to accommodate.",
  "You're IN. Supply met demand. Do the math.",
  "You're IN. You're here because you're here.",
  "You're IN. Your thumbs performed admirably.",
  "You're IN. You've been flagged for a surprise DUPR audit.",
  "You're IN. A background check was run, and we're choosing to overlook it.",
  "You're IN. Somebody immediately checked who else is playing.",
  "You're IN. Somewhere, a waitlist is coping."
]);
const DEFAULT_DETAILS_TEMPLATE =
  'Pickleball at {LOCATION} on {DATE} at {TIME}! You are Player {POSITION} of {TOTAL_PLAYERS}. Reply 2 for who is playing and game details, or 9 to cancel.';

function cleanMessages(value) {
  if (!Array.isArray(value)) return DEFAULT_MESSAGES.slice();
  const seen = new Set();
  const messages = [];
  value.forEach((item) => {
    const text = String(item == null ? '' : item).trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    messages.push(text);
  });
  return messages.length ? messages : DEFAULT_MESSAGES.slice();
}

function normalizeConfig(value) {
  const config = value && typeof value === 'object' ? value : {};
  const detailsTemplate = String(config.detailsTemplate || '').trim();
  return {
    messages: cleanMessages(config.messages),
    detailsTemplate: detailsTemplate || DEFAULT_DETAILS_TEMPLATE
  };
}

function choose(config, random = Math.random) {
  const messages = normalizeConfig(config).messages;
  const index = Math.floor(random() * messages.length);
  return messages[Math.min(Math.max(index, 0), messages.length - 1)];
}

function renderTemplate(template, values = {}) {
  const normalized = {};
  Object.entries(values).forEach(([key, value]) => {
    normalized[String(key).toUpperCase()] = value == null ? '' : String(value);
  });
  return String(template).replace(/\{([A-Z][A-Z0-9_]*)\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(normalized, key) ? normalized[key] : token
  ));
}

function build(config, defaultDetails, values = {}, random = Math.random) {
  if (typeof values === 'function') {
    random = values;
    values = {};
  }
  const normalized = normalizeConfig(config);
  const details = renderTemplate(normalized.detailsTemplate, {
    ...values,
    DEFAULT_TEXT: defaultDetails
  });
  return `${choose(normalized, random)}\n\n${details.trim()}`.trim();
}

module.exports = {
  DEFAULT_MESSAGES,
  DEFAULT_DETAILS_TEMPLATE,
  normalizeConfig,
  choose,
  renderTemplate,
  build
};
