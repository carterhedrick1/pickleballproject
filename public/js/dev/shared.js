// The handful of things every tab on the developer dashboard needs.
//
// dev.html carried 1,617 lines of script inline, and these four helpers plus the two tab lists
// sat at the top of it as globals. Everything below this file is one tab's worth of behaviour,
// importing what it needs from here.
export const TEXT_MESSAGE_TAB_IDS = [
  'youre-in',
  'waitlist-confirmation',
  'application-confirmation',
  'roster-status-change',
  'player-cancellation',
  'upcoming-reminder',
  'game-day-reminder',
  'game-cancelled',
  'organizer-announcement',
  'game-created',
  'host-alerts',
  'management-links',
  'game-details',
  'cancellation-help'
];
export const STANDARD_TAB_IDS = [
  'status',
  'ideas',
  'message-randomizer',
  'slogans',
  'reply-options',
  'errors',
  'rosters',
  'images',
  'screens',
  'vibe-coder-101',
  'rules',
  'style-command-center'
];

export function el(id) { return document.getElementById(id); }
export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function timeAgo(iso) {
  if (!iso) return '';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.round(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.round(seconds / 3600) + 'h ago';
  return Math.round(seconds / 86400) + 'd ago';
}
export function formatUptime(seconds) {
  if (seconds == null) return '—';
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  if (d) return d + 'd ' + h + 'h';
  if (h) return h + 'h ' + m + 'm';
  return m + 'm';
}
