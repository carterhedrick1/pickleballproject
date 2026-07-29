// header.js - Updated with In or Out logo

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

document.addEventListener('DOMContentLoaded', async function() {
const slogan = window.InOrOutSlogans
    ? await window.InOrOutSlogans.getForPage()
    : 'Pickleball Organizer';
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
 </nav>
 </div>
 </header>
 `;
// Insert header at the beginning of body
document.body.insertAdjacentHTML('afterbegin', headerHTML);
document.querySelector('.header-slogan').textContent = slogan;
// Adjust body padding to account for header
document.body.style.paddingTop = '0';
});
