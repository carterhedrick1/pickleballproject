// The Slogans tab: the rotating tagline and the rotating names inside it.
import { el, escapeHtml } from './shared.js';
import { sendJson } from './api.js';

let sloganConfig = { slogans: [], names: [] };
let editingSloganIndex = null;

function setSloganStatus(message, isError) {
  const status = el('sloganStatus');
  status.textContent = message || '';
  status.style.color = isError ? 'var(--danger)' : 'var(--brand)';
}

function renderSlogans() {
  el('sloganList').innerHTML = sloganConfig.slogans.map((slogan, index) => `
    <div class="slogan-entry">
      <span class="number">${index + 1}.</span>
      ${editingSloganIndex === index ? `
        <form class="slogan-edit-form" data-index="${index}">
          <input type="text" value="${escapeHtml(slogan)}" maxlength="240" aria-label="Edit slogan ${index + 1}" required>
          <button type="submit" class="primary">Save</button>
          <button type="button" class="ghost" data-action="cancel-edit-slogan">Cancel</button>
        </form>` : `
        <span class="copy">${escapeHtml(slogan)}</span>
        <span class="slogan-actions">
          <button type="button" class="ghost" data-action="edit-slogan" data-index="${index}">Edit</button>
          <button type="button" class="ghost" data-action="delete-slogan" data-index="${index}">Delete</button>
        </span>`}
    </div>`).join('');

  el('sloganNameList').innerHTML = sloganConfig.names.map((name, index) => `
    <span class="name-chip">
      ${escapeHtml(name)}
      <button type="button" aria-label="Delete ${escapeHtml(name)}" data-action="delete-name" data-index="${index}">&times;</button>
    </span>`).join('');
}

export async function loadSlogans() {
  try {
    const res = await fetch('/api/slogans');
    if (!res.ok) throw new Error('Could not load slogans');
    const data = await res.json();
    sloganConfig = { slogans: data.slogans || [], names: data.names || [] };
    renderSlogans();
  } catch (_err) {
    el('sloganList').innerHTML = '<p class="muted">Could not load slogans.</p>';
    setSloganStatus('Could not reach the server.', true);
  }
}

async function saveSlogans(nextConfig, successMessage) {
  setSloganStatus('Saving…');
  try {
    const res = await sendJson('/api/dev/slogans', 'PUT', nextConfig);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the slogan rotation.');
    sloganConfig = { slogans: data.slogans, names: data.names };
    editingSloganIndex = null;
    renderSlogans();
    setSloganStatus(successMessage);
    return true;
  } catch (err) {
    setSloganStatus(err.message, true);
    return false;
  }
}

el('sloganForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const slogan = el('sloganText').value.trim();
  if (!slogan) return;
  const saved = await saveSlogans(
    { slogans: sloganConfig.slogans.concat(slogan), names: sloganConfig.names },
    'Slogan added to the rotation.'
  );
  if (saved) el('sloganText').value = '';
});

el('sloganNameForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = el('sloganName').value.trim();
  if (!name) return;
  const saved = await saveSlogans(
    { slogans: sloganConfig.slogans, names: sloganConfig.names.concat(name) },
    'Name added to the rotation.'
  );
  if (saved) el('sloganName').value = '';
});

el('sloganList').addEventListener('click', async (e) => {
  if (e.target.dataset.action === 'edit-slogan') {
    editingSloganIndex = Number(e.target.dataset.index);
    renderSlogans();
    const input = el('sloganList').querySelector('.slogan-edit-form input');
    input.focus();
    input.select();
    return;
  }
  if (e.target.dataset.action === 'cancel-edit-slogan') {
    editingSloganIndex = null;
    renderSlogans();
    setSloganStatus('');
    return;
  }
  if (e.target.dataset.action !== 'delete-slogan') return;
  const index = Number(e.target.dataset.index);
  if (sloganConfig.slogans.length === 1) {
    setSloganStatus('Keep at least one slogan in the rotation.', true);
    return;
  }
  if (!confirm('Delete this slogan?')) return;
  await saveSlogans(
    { slogans: sloganConfig.slogans.filter((_slogan, i) => i !== index), names: sloganConfig.names },
    'Slogan removed.'
  );
});

el('sloganList').addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('slogan-edit-form')) return;
  e.preventDefault();
  const index = Number(e.target.dataset.index);
  const slogan = e.target.querySelector('input').value.trim();
  if (!slogan) {
    setSloganStatus('A slogan cannot be empty.', true);
    return;
  }
  if (sloganConfig.slogans.some((existing, i) => i !== index && existing === slogan)) {
    setSloganStatus('That slogan is already in the rotation.', true);
    return;
  }
  if (slogan === sloganConfig.slogans[index]) {
    editingSloganIndex = null;
    renderSlogans();
    setSloganStatus('No changes to save.');
    return;
  }
  const slogans = sloganConfig.slogans.slice();
  slogans[index] = slogan;
  await saveSlogans(
    { slogans, names: sloganConfig.names },
    'Slogan updated.'
  );
});

el('sloganNameList').addEventListener('click', async (e) => {
  if (e.target.dataset.action !== 'delete-name') return;
  const index = Number(e.target.dataset.index);
  if (sloganConfig.names.length === 1) {
    setSloganStatus('Keep at least one rotating name.', true);
    return;
  }
  await saveSlogans(
    { slogans: sloganConfig.slogans, names: sloganConfig.names.filter((_name, i) => i !== index) },
    'Name removed.'
  );
});
