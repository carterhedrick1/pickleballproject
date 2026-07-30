(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InOrOutSlogans = api;
})(typeof window !== 'undefined' ? window : null, function() {
  'use strict';

  const DEFAULT_SLOGANS = Object.freeze([
    'Because "maybe" is not an answer, it\'s a personality flaw.',
    'Fill the court, not a group chat.',
    'No one cares why. We care if.',
    'Slow responders, meet your replacement.',
    'Ghost us and we move on without you.',
    'Life\'s too short to text six people ten times.',
    'Your spot is not guaranteed. Your replacement is.',
    'Your reply time is your reputation.',
    'Sign up. Show up. Shut up about the line call.',
    '"I\'m 90% in" means you\'re Out.',
    'Nobody is putting you down as a Maybe.',
    'Commitment issues are not a calendar problem.',
    'You\'re not busy. You\'re indecisive.',
    'Two buttons. Pick one.',
    'Quick responses will improve your DUPR Rating.',
    'Availability beats ability. Ask {NAME}.',
    'You found time to research a $280 paddle. Find 4 seconds to respond.',
    'You had time to read this. Find a second to respond.',
    'Ignore this and you will be paddle stacking at The Y next time.'
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

  function rememberMessageId(id) {
    if (!id || typeof window === 'undefined' || !window.localStorage) return;
    try {
      const key = 'inorout:site-slogan-recent';
      const saved = JSON.parse(window.localStorage.getItem(key) || '[]');
      const recent = [id, ...(Array.isArray(saved) ? saved : []).filter(function(item) {
        return item !== id;
      })].slice(0, 5);
      window.localStorage.setItem(key, JSON.stringify(recent));
    } catch (_error) {
      // Storage is only a no-repeat hint. Selection still works when it is unavailable.
    }
  }

  function recentMessageIds() {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
      const saved = JSON.parse(
        window.localStorage.getItem('inorout:site-slogan-recent') || '[]'
      );
      return Array.isArray(saved) ? saved.filter(Boolean).slice(0, 5) : [];
    } catch (_error) {
      return [];
    }
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
        const fallback = choose(config);
        try {
          const name = randomItem(config.names);
          const params = new URLSearchParams({
            surface: 'site-slogan',
            fallback: fallback,
            name: name
          });
          const pageParams = new URLSearchParams(window.location.search);
          if (
            /\/game\.html$/.test(window.location.pathname) &&
            pageParams.get('id')
          ) {
            params.set('gameId', pageParams.get('id'));
          }
          const exclude = recentMessageIds();
          if (exclude.length) params.set('exclude', exclude.join(','));
          const response = await window.fetch(`/api/random-message?${params}`, {
            headers: { Accept: 'application/json' }
          });
          if (response.ok) {
            const result = await response.json();
            if (result && result.text) {
              rememberMessageId(result.id);
              return result.text;
            }
          }
        } catch (_err) {
          // The legacy saved rotation remains the page-level fallback.
        }
        return fallback;
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
    recentMessageIds: recentMessageIds,
    rememberMessageId: rememberMessageId,
    getForPage: getForPage
  };
});
