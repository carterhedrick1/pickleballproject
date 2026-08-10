// header.js - Updated with IN or OUT logo

// Reports browser errors to the developer area so a player hitting a broken page
// shows up somewhere Scott can see. Capped and fail-silent: a reporting problem
// must never become a second thing wrong with the page.
(function reportClientErrors() {
  var sent = 0;
  var MAX_PER_PAGE = 3;

  function report(message, stack) {
    if (sent >= MAX_PER_PAGE) return;
    sent++;
    try {
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: String(message || 'Unknown error').slice(0, 500),
          stack: stack ? String(stack).slice(0, 2000) : null,
          page: window.location.pathname + window.location.search
        })
      }).catch(function () {});
    } catch (e) { /* never let the reporter break the page */ }
  }

  window.addEventListener('error', function (event) {
    if (event.error) report(event.error.message, event.error.stack);
    else report(event.message, event.filename + ':' + event.lineno);
  });

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    if (reason && reason.message) report('Unhandled promise: ' + reason.message, reason.stack);
    else report('Unhandled promise: ' + String(reason), null);
  });
})();

// Every page pulls this script, so the favicon rides along instead of being pasted
// into fifteen <head> sections. Without it, every page 404s on /favicon.ico and the
// browser tab shows a blank globe.
(function attachFavicon() {
  if (document.querySelector('link[rel="icon"]')) return;
  var link = document.createElement('link');
  link.rel = 'icon';
  link.type = 'image/svg+xml';
  link.href = '/favicon.svg';
  document.head.appendChild(link);
})();

document.addEventListener('DOMContentLoaded', function() {
// The header must never wait on the network: paint it with a bundled slogan
// right away and swap in the server rotation's pick when it arrives.
const slogan = window.InOrOutSlogans
    ? window.InOrOutSlogans.chooseLocal()
    : 'Pickleball Organizer';

async function showLocalPreviewNotice() {
    try {
        const response = await fetch('/api/health', { cache: 'no-store' });
        if (!response.ok) return;

        const health = await response.json();
        if (health.environment !== 'local' && health.database !== 'SQLite') return;

        const livePaths = new Set([
            '/', '/create.html', '/my-games.html', '/roster.html', '/stats.html'
        ]);
        const livePath = livePaths.has(window.location.pathname) ? window.location.pathname : '/';
        const notice = document.createElement('aside');
        notice.className = 'local-preview-notice';
        notice.setAttribute('role', 'status');
        notice.innerHTML = `
            <div>
                <strong>Local Preview</strong>
                <span>You’re viewing the local test copy. Its games and roster are separate from inorout.club.</span>
            </div>
            <a href="https://inorout.club${livePath}">Open Live Site</a>
        `;
        document.querySelector('.site-header').insertAdjacentElement('afterend', notice);
    } catch (error) {
        // The notice is helpful context, but a health-check failure must not break navigation.
    }
}

// Determine the current page for navigation highlighting
const currentPath = window.location.pathname;
let currentPage = 'home';
if (currentPath.includes('create.html')) {
    currentPage = 'create';
} else if (currentPath.includes('game.html')) {
    currentPage = 'game';
} else if (currentPath.includes('manage.html')) {
    currentPage = 'manage';
} else if (currentPath.includes('my-games.html')) {
    currentPage = 'my-games';
} else if (currentPath.includes('demo.html')) {
    currentPage = 'demo';
} else if (currentPath.includes('privacy.html')) {
    currentPage = 'privacy';
} else if (currentPath.includes('terms.html')) {
    currentPage = 'terms';
} else if (currentPath.includes('roster.html')) {
    currentPage = 'roster';
} else if (currentPath.includes('stats.html')) {
    currentPage = 'stats';
} else if (currentPath.includes('lookup.html')) {
    // lookup.html now just redirects to My Games; keep it highlighting the same link.
    currentPage = 'my-games';
} else if (currentPath === '/') {
    currentPage = 'home';
}
const headerHTML = `
 <header class="site-header">
 <div class="header-container">
 <div class="header-brand">
 <a href="/">
 <span class="header-wordmark" aria-label="IN or OUT"><strong>IN</strong> or OUT</span>
 <span class="header-slogan"></span>
 </a>
 </div>
 <nav class="header-nav">
 <a href="/create.html" class="${currentPage === 'create' ? 'active' : ''}">Create Game</a>
<a href="/my-games.html" class="${currentPage === 'my-games' ? 'active' : ''}">My Games</a>
<a href="/roster.html" class="${currentPage === 'roster' ? 'active' : ''}">Roster</a>
<a href="/stats.html" class="${currentPage === 'stats' ? 'active' : ''}">Stats</a>
 </nav>
 </div>
 </header>
 `;
// Insert header at the beginning of body
document.body.insertAdjacentHTML('afterbegin', headerHTML);
document.querySelector('.header-slogan').textContent = slogan;
if (window.InOrOutSlogans) {
    window.InOrOutSlogans.getForPage().then(function(rotated) {
        const sloganEl = document.querySelector('.header-slogan');
        if (sloganEl && rotated) sloganEl.textContent = rotated;
    }).catch(function() {});
}
showLocalPreviewNotice();
// Adjust body padding to account for header
document.body.style.paddingTop = '0';
});
