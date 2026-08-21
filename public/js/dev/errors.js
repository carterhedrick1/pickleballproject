// The Errors tab: what the server and players' browsers reported going wrong.
import { el, escapeHtml, timeAgo } from './shared.js';
import { signedOut } from './api.js';

export async function loadErrors() {
  let data;
  try {
    const res = await fetch('/api/dev/errors');
    if (signedOut(res)) return;
    data = await res.json();
  } catch (err) {
    el('errorList').innerHTML = '<p class="muted">Could not load errors.</p>';
    return;
  }

  const errors = data.errors || [];
  if (!errors.length) {
    el('errorList').innerHTML = '<p class="muted">No errors reported. That is the good outcome.</p>';
    return;
  }

  el('errorList').innerHTML = errors.map((error) => `
    <div class="err">
      <div class="err-head">
        <span class="badge ${error.source === 'client' ? 'client' : 'server'}">${escapeHtml(error.source)}</span>
        <span class="err-msg">${escapeHtml(error.message)}</span>
      </div>
      <div class="err-meta">
        ${error.page ? escapeHtml(error.page) + ' · ' : ''}${new Date(error.createdAt).toLocaleString()} (${timeAgo(error.createdAt)})
      </div>
      ${error.stack ? `<details><summary>Show Details</summary><pre>${escapeHtml(error.stack)}</pre></details>` : ''}
    </div>`).join('');
}
