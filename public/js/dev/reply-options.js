// The Reply Options tab: the custom numbered replies a player can text back.
import { el, escapeHtml } from './shared.js';
import { sendJson, signedOut } from './api.js';

let replyOptionConfig = {
  systemOptions: [],
  customOptions: [],
  availableCommands: [],
  tokens: []
};
let editingReplyCommand = null;

function replyAudienceLabel(audience) {
  if (audience === 'host') return 'Host';
  if (audience === 'player') return 'Player';
  return 'Host And Player';
}

function setReplyOptionStatus(message, isError) {
  const status = el('replyOptionStatus');
  status.textContent = message || '';
  status.style.color = isError ? 'var(--danger)' : 'var(--brand)';
}

function renderReplyCommandChoices(selected = '') {
  const used = new Set(
    replyOptionConfig.customOptions
      .filter((option) => option.command !== editingReplyCommand)
      .map((option) => option.command)
  );
  const choices = replyOptionConfig.availableCommands.filter((command) => !used.has(command));
  el('replyOptionCommand').innerHTML = choices
    .map((command) => (
      `<option value="${command}"${command === selected ? ' selected' : ''}>Reply ${command}</option>`
    ))
    .join('');
}

function renderReplyOptions() {
  el('systemReplyOptions').innerHTML = replyOptionConfig.systemOptions.map((option) => `
    <div class="reply-option">
      <div class="reply-option-head">
        <span class="reply-command">${escapeHtml(option.command)}</span>
        <span class="reply-option-title">${escapeHtml(option.title)}</span>
        <span class="reply-audience">${escapeHtml(replyAudienceLabel(option.audience))}</span>
        <span class="badge client">Built-In</span>
      </div>
      <p class="reply-option-description">${escapeHtml(option.description)}</p>
    </div>`).join('');

  if (!replyOptionConfig.customOptions.length) {
    el('customReplyOptions').innerHTML =
      '<p class="muted">No custom reply options yet. Create the first one above.</p>';
  } else {
    el('customReplyOptions').innerHTML = replyOptionConfig.customOptions.map((option) => `
      <div class="reply-option${option.enabled ? '' : ' inactive'}" data-command="${option.command}">
        <div class="reply-option-head">
          <span class="reply-command">${escapeHtml(option.command)}</span>
          <span class="reply-option-title">${escapeHtml(option.title)}</span>
          <span class="reply-audience">${escapeHtml(replyAudienceLabel(option.audience))}</span>
          ${option.enabled ? '' : '<span class="badge server">Inactive</span>'}
        </div>
        <p class="reply-option-description">${escapeHtml(option.message)}</p>
        <div class="reply-option-actions">
          <button type="button" class="ghost" data-action="edit-reply-option">Edit</button>
          <button type="button" class="ghost" data-action="toggle-reply-option">
            ${option.enabled ? 'Disable' : 'Enable'}
          </button>
          <button type="button" class="ghost" data-action="delete-reply-option">Delete</button>
        </div>
      </div>`).join('');
  }

  el('replyOptionTokens').innerHTML = replyOptionConfig.tokens
    .map((token) => `<code>{${escapeHtml(token)}}</code>`)
    .join('');
  renderReplyCommandChoices(editingReplyCommand || '');
}

function resetReplyOptionForm() {
  editingReplyCommand = null;
  el('replyOptionForm').reset();
  el('replyOptionAudience').value = 'host';
  el('replyOptionFormTitle').textContent = 'Create A Reply Option';
  el('saveReplyOption').textContent = 'Create Option';
  el('cancelReplyOptionEdit').classList.add('hidden');
  renderReplyCommandChoices();
}

export async function loadReplyOptions() {
  try {
    const res = await fetch('/api/dev/reply-options');
    if (signedOut(res)) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not load reply options.');
    replyOptionConfig = data;
    renderReplyOptions();
  } catch (err) {
    el('systemReplyOptions').innerHTML = '<p class="muted">Could not load reply options.</p>';
    el('customReplyOptions').innerHTML = '';
    setReplyOptionStatus(err.message, true);
  }
}

async function saveReplyOptions(customOptions, successMessage) {
  setReplyOptionStatus('Saving…');
  try {
    const res = await sendJson('/api/dev/reply-options', 'PUT', { customOptions });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not save the reply options.');
    replyOptionConfig.customOptions = data.customOptions || [];
    resetReplyOptionForm();
    renderReplyOptions();
    setReplyOptionStatus(successMessage);
    return true;
  } catch (err) {
    setReplyOptionStatus(err.message, true);
    return false;
  }
}

el('replyOptionForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const option = {
    command: el('replyOptionCommand').value,
    audience: el('replyOptionAudience').value,
    title: el('replyOptionTitle').value.trim(),
    message: el('replyOptionMessage').value.trim(),
    enabled: editingReplyCommand
      ? replyOptionConfig.customOptions.find((item) => item.command === editingReplyCommand)?.enabled !== false
      : true
  };
  const nextOptions = editingReplyCommand
    ? replyOptionConfig.customOptions.map((item) => (
        item.command === editingReplyCommand ? option : item
      ))
    : replyOptionConfig.customOptions.concat(option);
  await saveReplyOptions(
    nextOptions,
    editingReplyCommand ? 'Reply option updated and live.' : 'Reply option created and live.'
  );
});

el('cancelReplyOptionEdit').addEventListener('click', () => {
  resetReplyOptionForm();
  setReplyOptionStatus('');
});

el('customReplyOptions').addEventListener('click', async (event) => {
  const action = event.target.dataset.action;
  if (!action) return;
  const command = event.target.closest('.reply-option').dataset.command;
  const option = replyOptionConfig.customOptions.find((item) => item.command === command);
  if (!option) return;

  if (action === 'edit-reply-option') {
    editingReplyCommand = command;
    renderReplyCommandChoices(command);
    el('replyOptionCommand').value = command;
    el('replyOptionAudience').value = option.audience;
    el('replyOptionTitle').value = option.title;
    el('replyOptionMessage').value = option.message;
    el('replyOptionFormTitle').textContent = 'Edit Reply Option';
    el('saveReplyOption').textContent = 'Save Changes';
    el('cancelReplyOptionEdit').classList.remove('hidden');
    el('replyOptionFormTitle').scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }

  if (action === 'toggle-reply-option') {
    await saveReplyOptions(
      replyOptionConfig.customOptions.map((item) => (
        item.command === command ? { ...item, enabled: !item.enabled } : item
      )),
      option.enabled ? 'Reply option disabled.' : 'Reply option enabled and live.'
    );
    return;
  }

  if (action === 'delete-reply-option') {
    if (!confirm(`Delete Reply ${command}: ${option.title}?`)) return;
    await saveReplyOptions(
      replyOptionConfig.customOptions.filter((item) => item.command !== command),
      'Reply option deleted.'
    );
  }
});
