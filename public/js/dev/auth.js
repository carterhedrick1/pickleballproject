// Signing in to the developer area, and revealing the dashboard once the cookie is good.
import { el } from './shared.js';
import { sendJson } from './api.js';
import { loadStatus } from './status.js';
import { loadNotes } from './ideas.js';

el('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  el('loginError').textContent = '';
  try {
    const res = await sendJson('/api/dev/login', 'POST', { password: el('password').value });
    if (res.ok) { el('password').value = ''; showApp(); return; }
    const body = await res.json().catch(() => ({}));
    el('loginError').textContent = body.error || 'That did not work.';
  } catch (err) {
    el('loginError').textContent = 'Could not reach the server.';
  }
});

el('signOut').addEventListener('click', async () => {
  await fetch('/api/dev/logout', { method: 'POST' }).catch(() => {});
  el('appView').classList.add('hidden');
  el('loginView').classList.remove('hidden');
});

export function showApp() {
  el('loginView').classList.add('hidden');
  el('appView').classList.remove('hidden');
  loadStatus();
  loadNotes();
}
