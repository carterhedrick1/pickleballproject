// The text message editors: one per category, plus the You're In rotation.
import { el, escapeHtml } from './shared.js';
import { sendJson, signedOut } from './api.js';

let textMessageCategories = [];
let activeTextMessageCategoryId = 'youre-in';
let youreInConfig = { messages: [], detailsTemplate: '' }; // Kept for the browser smoke test.
let editingYoureInIndex = null;

function activeTextMessageCategory() {
  return textMessageCategories.find(
    (category) => category.id === activeTextMessageCategoryId
  ) || null;
}

function setYoureInStatus(message, isError) {
  const status = el('youreInStatus');
  status.textContent = message || '';
  status.style.color = isError ? 'var(--danger)' : 'var(--brand)';
}

function addBulkMessageField(value = '') {
  const category = activeTextMessageCategory();
  if (!category) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'bulk-message-field';
  wrapper.innerHTML = `
    <textarea class="text-message-input" rows="3"
      placeholder="Write a random opening message"
      maxlength="${category.maxLength}">${escapeHtml(value)}</textarea>
    <button type="button" class="ghost" data-action="remove-bulk-text"
      aria-label="Remove this opening">Remove</button>`;
  el('bulkMessageFields').appendChild(wrapper);
  wrapper.querySelector('textarea').focus();
  updateBulkMessageControls();
}

function updateBulkMessageControls() {
  const fields = el('bulkMessageFields').querySelectorAll('.bulk-message-field');
  fields.forEach((field) => {
    field.querySelector('[data-action="remove-bulk-text"]').classList.toggle(
      'hidden',
      fields.length === 1
    );
  });
  el('addAllTexts').textContent = fields.length === 1
    ? 'Add Opening'
    : `Add All ${fields.length} Openings`;
}

function resetBulkMessageFields() {
  el('bulkMessageFields').innerHTML = '';
  el('bulkPasteTexts').value = '';
  el('bulkPasteTexts').closest('details').open = false;
  addBulkMessageField();
}

function renderSampleText(template, category) {
  const values = {
    DEFAULT_TEXT: category.detailsPreview || category.preview,
    LOCATION: 'Oak Park Courts',
    DATE: 'Sat, Aug 1',
    TIME: '9:00 AM',
    POSITION: category.id === 'youre-in' ? 2 : 1,
    TOTAL_PLAYERS: 4,
    STATUS: 'reservation',
    DAY: 'tomorrow',
    REASON: 'Courts are closed',
    ANNOUNCEMENT: 'We moved to courts 3 and 4. Please arrive ten minutes early.',
    EVENT: 'playerJoins',
    PLAYER_NAME: 'Jamie',
    SPOTS_LEFT: 1,
    WAITLIST_COUNT: 1,
    PROMOTED_NAME: 'Riley',
    DURATION: 90,
    ROLE: 'Confirmed Player',
    MANAGEMENT_LINK: 'https://inorout.club/manage.html?id=example&token=example',
    GAME_COUNT: 1
  };
  return String(template || '').replace(/\{([A-Z][A-Z0-9_]*)\}/g, (token, key) => (
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : token
  ));
}

function renderTextMessagePreview() {
  const category = activeTextMessageCategory();
  if (!category) return;
  if (!category.live && !category.enabled) {
    el('textMessagePreviewBody').textContent = category.preview;
    return;
  }
  const opening = category.messages[0] ? renderSampleText(category.messages[0], category) : '';
  const details = renderSampleText(category.detailsTemplate, category);
  el('textMessagePreviewBody').textContent = [opening, details].filter(Boolean).join('\n\n');
}

function renderTextMessageCategory() {
  const category = activeTextMessageCategory();
  if (!category) return;
  youreInConfig = {
    messages: category.messages,
    detailsTemplate: category.detailsTemplate
  };
  editingYoureInIndex = null;
  el('textMessageRecipient').textContent = category.recipient;
  renderTextMessagePreview();
  el('textMessagePreview').setAttribute(
    'aria-label',
    `${category.title} current text preview for ${category.recipient}`
  );
  el('textMessageDescription').textContent = category.description;
  el('textMessageDetailsTitle').textContent = `Edit The ${category.title} Details`;
  el('textMessageAddTitle').textContent = 'Add A Random Opening Message';
  el('textMessageListTitle').textContent = 'Random Opening Messages';
  el('textMessagePreviewTitle').textContent = `Current ${category.title} Text`;
  const note = el('textMessagePreviewNote');
  note.textContent = category.previewNote || '';
  note.classList.toggle('hidden', !category.previewNote);
  const mode = el('textMessageMode');
  const liveNote = el('textMessageLiveNote');
  mode.classList.toggle('hidden', category.live === true);
  liveNote.classList.toggle('hidden', category.live !== true);
  el('useRandomTexts').checked = category.enabled === true;
  el('textMessageModeDetail').textContent = category.enabled
    ? category.messages.length
      ? 'On — the saved details and one random opening are live.'
      : 'On — the saved details are live without a random opening.'
    : 'Off — the current app text is used.';
  const tokenPanel = el('textMessageTokens');
  const tokens = category.tokens || [];
  tokenPanel.classList.toggle('hidden', !tokens.length);
  el('textMessageTokenList').innerHTML = tokens
    .map((token) => `<code>{${escapeHtml(token)}}</code>`)
    .join('');
  el('textMessageDetailsTemplate').maxLength = category.detailsMaxLength;
  el('textMessageDetailsTemplate').value = category.detailsTemplate;
  resetBulkMessageFields();
  renderYoureInMessages();
  setYoureInStatus(
    category.live
      ? 'Changes to either section affect live You’re In texts.'
      : category.enabled
        ? 'The saved details and any random openings are live for this category.'
        : 'Edits are saved as drafts until Use Edited Text is turned on.'
  );
}

function renderYoureInMessages() {
  const category = activeTextMessageCategory();
  if (!category) return;
  if (!youreInConfig.messages.length) {
    el('youreInList').innerHTML = `
      <div class="empty-rotation">
        <p class="muted">No random openings have been added. The details section is sent by itself.</p>
      </div>`;
    return;
  }
  el('youreInList').innerHTML = youreInConfig.messages.map((message, index) => `
    <div class="slogan-entry">
      <span class="number">${index + 1}.</span>
      ${editingYoureInIndex === index ? `
        <form class="slogan-edit-form youre-in-edit-form" data-index="${index}">
          <textarea rows="3" maxlength="${category.maxLength}"
            aria-label="Edit ${escapeHtml(category.title)} opening ${index + 1}"
            required>${escapeHtml(message)}</textarea>
          <button type="submit" class="primary">Save</button>
          <button type="button" class="ghost" data-action="cancel-edit-youre-in">Cancel</button>
        </form>` : `
        <span class="copy">${escapeHtml(message)}</span>
        <span class="slogan-actions">
          <button type="button" class="ghost" data-action="edit-youre-in" data-index="${index}">Edit</button>
          <button type="button" class="ghost" data-action="delete-youre-in" data-index="${index}">Delete</button>
        </span>`}
    </div>`).join('');
}

export async function loadTextMessageCategories() {
  if (textMessageCategories.length) return true;
  try {
    const res = await fetch('/api/dev/text-message-categories');
    if (signedOut(res)) return false;
    if (!res.ok) throw new Error('Could not load text message categories');
    const data = await res.json();
    textMessageCategories = data.categories || [];
    return true;
  } catch (_err) {
    el('youreInList').innerHTML = '<p class="muted">Could not load text message editors.</p>';
    setYoureInStatus('Could not reach the server.', true);
    return false;
  }
}

export async function loadTextMessageCategory(categoryId) {
  activeTextMessageCategoryId = categoryId;
  if (await loadTextMessageCategories()) renderTextMessageCategory();
}

export async function loadYoureInMessages() {
  return loadTextMessageCategory('youre-in');
}

async function saveTextMessageCategory(messages, detailsTemplate, successMessage) {
  const category = activeTextMessageCategory();
  if (!category) return false;
  setYoureInStatus('Saving…');
  try {
    const res = await sendJson(`/api/dev/text-message-categories/${category.id}`, 'PUT', {
      messages,
      detailsTemplate,
      enabled: category.enabled === true
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Could not save the ${category.title} texts.`);
    category.messages = data.messages || [];
    category.detailsTemplate = data.detailsTemplate;
    if (!category.live) category.enabled = data.enabled === true;
    youreInConfig = {
      messages: data.messages || [],
      detailsTemplate: data.detailsTemplate
    };
    editingYoureInIndex = null;
    renderYoureInMessages();
    renderTextMessagePreview();
    setYoureInStatus(successMessage);
    return true;
  } catch (err) {
    setYoureInStatus(err.message, true);
    return false;
  }
}

el('textMessageDetailsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = activeTextMessageCategory();
  const detailsTemplate = el('textMessageDetailsTemplate').value.trim();
  if (!detailsTemplate) {
    setYoureInStatus('The details section cannot be empty.', true);
    return;
  }
  if (detailsTemplate === category.detailsTemplate) {
    setYoureInStatus('No changes to save.');
    return;
  }
  await saveTextMessageCategory(
    category.messages,
    detailsTemplate,
    category.live || category.enabled
      ? 'Details updated and live.'
      : 'Details saved as a draft. Turn on Use Edited Text when ready.'
  );
});

el('youreInForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const category = activeTextMessageCategory();
  const newMessages = [...el('bulkMessageFields').querySelectorAll('.text-message-input')]
    .map((input) => input.value.trim())
    .filter(Boolean)
    .concat(
      el('bulkPasteTexts').value
        .split(/\r?\n/)
        .map((message) => message.trim())
        .filter(Boolean)
    );
  if (!newMessages.length) {
    setYoureInStatus('Write at least one opening before adding.', true);
    return;
  }
  const duplicates = newMessages.filter(
    (message, index) =>
      newMessages.indexOf(message) !== index || youreInConfig.messages.includes(message)
  );
  if (duplicates.length) {
    setYoureInStatus('Remove duplicate opening messages before adding.', true);
    return;
  }
  const saved = await saveTextMessageCategory(
    youreInConfig.messages.concat(newMessages),
    category.detailsTemplate,
    newMessages.length === 1
      ? 'Random opening added.'
      : `${newMessages.length} random openings added together.`
  );
  if (saved) resetBulkMessageFields();
});

el('addAnotherText').addEventListener('click', () => addBulkMessageField());

el('useRandomTexts').addEventListener('change', async (e) => {
  const category = activeTextMessageCategory();
  if (!category || category.live) return;
  const previous = category.enabled === true;
  category.enabled = e.target.checked;
  const saved = await saveTextMessageCategory(
    category.messages,
    category.detailsTemplate,
    category.enabled
      ? category.messages.length
        ? 'The saved details and random openings are now live.'
        : 'The saved details are now live without a random opening.'
      : 'The current app text is now live.'
  );
  if (!saved) {
    category.enabled = previous;
    e.target.checked = previous;
    return;
  }
  renderTextMessageCategory();
});

el('bulkMessageFields').addEventListener('click', (e) => {
  if (e.target.dataset.action !== 'remove-bulk-text') return;
  e.target.closest('.bulk-message-field').remove();
  updateBulkMessageControls();
});

el('youreInList').addEventListener('click', async (e) => {
  if (e.target.dataset.action === 'edit-youre-in') {
    editingYoureInIndex = Number(e.target.dataset.index);
    renderYoureInMessages();
    const input = el('youreInList').querySelector('.youre-in-edit-form textarea');
    input.focus();
    input.select();
    return;
  }
  if (e.target.dataset.action === 'cancel-edit-youre-in') {
    editingYoureInIndex = null;
    renderYoureInMessages();
    setYoureInStatus('');
    return;
  }
  if (e.target.dataset.action !== 'delete-youre-in') return;
  const index = Number(e.target.dataset.index);
  const category = activeTextMessageCategory();
  if (category.requiresOne && youreInConfig.messages.length === 1) {
    setYoureInStatus(`Keep at least one ${category.title} opening in the rotation.`, true);
    return;
  }
  if (!confirm(`Delete this ${category.title} opening?`)) return;
  await saveTextMessageCategory(
    youreInConfig.messages.filter((_message, i) => i !== index),
    category.detailsTemplate,
    'Random opening removed.'
  );
});

el('youreInList').addEventListener('submit', async (e) => {
  if (!e.target.classList.contains('youre-in-edit-form')) return;
  e.preventDefault();
  const index = Number(e.target.dataset.index);
  const category = activeTextMessageCategory();
  const message = e.target.querySelector('textarea').value.trim();
  if (!message) {
    setYoureInStatus(`A ${category.title} opening cannot be empty.`, true);
    return;
  }
  if (youreInConfig.messages.some((existing, i) => i !== index && existing === message)) {
    setYoureInStatus('That opening is already in the rotation.', true);
    return;
  }
  if (message === youreInConfig.messages[index]) {
    editingYoureInIndex = null;
    renderYoureInMessages();
    setYoureInStatus('No changes to save.');
    return;
  }
  const messages = youreInConfig.messages.slice();
  messages[index] = message;
  await saveTextMessageCategory(
    messages,
    category.detailsTemplate,
    'Random opening updated.'
  );
});
