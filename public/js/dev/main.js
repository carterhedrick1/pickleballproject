// The developer dashboard's one entry point.
//
// dev.html was 3,853 lines: 836 of CSS, 1,617 of script, and the markup for eleven tabs in
// between. The CSS is /css/dev.css now and the script is this directory - one module per tab,
// plus shared.js for the four helpers they all use. The markup did not move.
//
// Importing a module is what runs its top-level `addEventListener` calls, so the imports below
// are what wires each tab's buttons up. Nothing here has to call an init function per tab.
import { showApp } from './auth.js';
import { activateTab } from './tabs.js';
import { loadStatus } from './status.js';
import { loadNotes } from './ideas.js';
import { loadSlogans } from './slogans.js';
import { loadReplyOptions } from './reply-options.js';
import { loadTextMessageCategory } from './text-messages.js';
import { loadRosters } from './rosters.js';
import { loadErrors } from './errors.js';
import { loadImages } from './images.js';

/**
 * The page's public face.
 *
 * Modules do not create globals, and the browser smoke drives this page directly: it signs in
 * by posting the password and calling showApp(), and it redraws a tab after uploading a fixture
 * so the new row is on screen before it looks for it. The loaders are here rather than only on
 * the tab buttons because those are awaitable and a click is not.
 */
window.DevDashboard = {
  showApp,
  activateTab,
  loadStatus,
  loadNotes,
  loadSlogans,
  loadReplyOptions,
  loadTextMessageCategory,
  loadRosters,
  loadErrors,
  loadImages
};

// A valid cookie means we can go straight in without asking for the password again.
(async function boot() {
  try {
    const res = await fetch('/api/dev/status');
    if (res.ok) showApp();
  } catch (err) { /* stay on the sign-in screen */ }
})();
