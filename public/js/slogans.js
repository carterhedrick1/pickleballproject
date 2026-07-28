(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InOrOutSlogans = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  const DEFAULT_SLOGANS = Object.freeze([
    'Because "maybe" is not an answer, it\'s a personality flaw.',
    'Fill the court, not the group chat.',
    'We don\'t care why. We care if.',
    'Slow responders, meet your replacement.',
    'Ghost us and the app moves on without you.',
    'Life\'s too short to text six people twice.',
    'Your spot is not guaranteed. Your replacement is.',
    'Your reply time is your reputation.',
    'Sign up. Show up. Shut up about the line call.',
    '"I\'m 90% in" means you\'re out.',
    'Nobody is putting you down as a maybe.',
    'Commitment issues are not a calendar problem.',
    'You\'re not busy. You\'re indecisive.',
    'Two buttons. Pick one.',
    'Quick responses improve your DUPR.',
    'Availability beats ability. Ask {NAME}.',
    'You found time to research a $280 paddle. Find 4 seconds to respond.',
    'You found time to read this. Find a second to respond.'
  ]);

  const DEFAULT_NAMES = Object.freeze(['Scott', 'Mike', 'Brett', 'Zac']);

  function cleanList(value, fallback) {
    if (!Array.isArray(value)) return fallback.slice();
    const seen = new Set();
    const cleaned = [];
    value.forEach(function(item) {
      const text = String(item == null ? '' : item).trim();
      if (!text || seen.has(text)) return;
      seen.add(text);
      cleaned.push(text);
    });
    return cleaned.length ? cleaned : fallback.slice();
  }

  function normalizeConfig(value) {
    const config = value && typeof value === 'object' ? value : {};
    return {
      slogans: cleanList(config.slogans, DEFAULT_SLOGANS),
      names: cleanList(config.names, DEFAULT_NAMES)
    };
  }

  function randomItem(items, random) {
    const index = Math.floor((random || Math.random)() * items.length);
    return items[Math.min(Math.max(index, 0), items.length - 1)];
  }

  function choose(config, random) {
    const normalized = normalizeConfig(config);
    const slogan = randomItem(normalized.slogans, random);
    const name = randomItem(normalized.names, random);
    return slogan.replace(/\{NAME\}/g, name);
  }

  let pageSloganPromise;

  function getForPage() {
    if (pageSloganPromise) return pageSloganPromise;

    pageSloganPromise = (async function() {
      let config = normalizeConfig();
      if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        try {
          const response = await window.fetch('/api/slogans', { headers: { Accept: 'application/json' } });
          if (response.ok) config = normalizeConfig(await response.json());
        } catch (_err) {
          // The built-in list keeps the brand visible if the API is temporarily unavailable.
        }
      }
      return choose(config);
    })();

    return pageSloganPromise;
  }

  return {
    DEFAULT_SLOGANS: DEFAULT_SLOGANS,
    DEFAULT_NAMES: DEFAULT_NAMES,
    normalizeConfig: normalizeConfig,
    choose: choose,
    getForPage: getForPage
  };
});
