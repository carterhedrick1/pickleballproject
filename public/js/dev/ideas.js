// The idea board: what is unfinished, what is finished but not deployed, and what is live.
import { el, escapeHtml, timeAgo } from './shared.js';
import { sendJson, signedOut } from './api.js';

// Both of these were shared globals at the top of dev.html, and the idea board is the only
// thing that ever read them.
const STATUS_LABELS = {
  'idea': 'Ideas',
  'building': 'Building now',
  'done-not-deployed': 'Done, not deployed',
  'live': 'Live'
};
let noteStatuses = ['idea', 'building', 'done-not-deployed', 'live'];

function statusOptions(selected) {
  return noteStatuses.map((s) =>
    `<option value="${s}"${s === selected ? ' selected' : ''}>${STATUS_LABELS[s] || s}</option>`).join('');
}

export async function loadNotes() {
  let data;
  try {
    const res = await fetch('/api/dev/notes');
    if (signedOut(res)) return;
    data = await res.json();
  } catch (err) {
    el('ideaList').innerHTML = '<p class="muted">Could not load ideas.</p>';
    return;
  }

  if (data.statuses) noteStatuses = data.statuses;
  if (!el('ideaStatus').options.length) el('ideaStatus').innerHTML = statusOptions('idea');

  const notes = data.notes || [];
  if (!notes.length) {
    el('ideaList').innerHTML = '<p class="muted">Nothing here yet. Add the first idea above.</p>';
    return;
  }

  el('ideaList').innerHTML = noteStatuses.map((status) => {
    const group = notes.filter((n) => n.status === status);
    if (!group.length) return '';
    return `<div class="status-group">
      <h3>${STATUS_LABELS[status] || status} (${group.length})</h3>
      ${group.map((note) => `
        <div class="idea idea-status-${status}" data-id="${note.id}">
          <div class="idea-title">${escapeHtml(note.title)}</div>
          ${note.body ? `<div class="idea-body">${escapeHtml(note.body)}</div>` : ''}
          <div class="idea-actions">
            <select data-action="status">${statusOptions(note.status)}</select>
            <button class="ghost" data-action="delete">Delete</button>
            <span class="stamp">updated ${timeAgo(note.updatedAt)}</span>
          </div>
        </div>`).join('')}
    </div>`;
  }).join('');
}

el('ideaForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = el('ideaTitle').value.trim();
  if (!title) return;
  await sendJson('/api/dev/notes', 'POST', { title, body: el('ideaBody').value, status: el('ideaStatus').value });
  el('ideaTitle').value = '';
  el('ideaBody').value = '';
  loadNotes();
});

el('ideaList').addEventListener('change', async (e) => {
  if (e.target.dataset.action !== 'status') return;
  const id = e.target.closest('.idea').dataset.id;
  await sendJson('/api/dev/notes/' + id, 'PUT', { status: e.target.value });
  loadNotes();
});

el('ideaList').addEventListener('click', async (e) => {
  if (e.target.dataset.action !== 'delete') return;
  const card = e.target.closest('.idea');
  if (!confirm('Delete this idea?')) return;
  await fetch('/api/dev/notes/' + card.dataset.id, { method: 'DELETE' });
  loadNotes();
});
