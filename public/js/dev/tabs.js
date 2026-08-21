// The tab strip, including the Text Messaging dropdown.
//
// This is the one module that knows every other one: switching to a tab is what loads it.
import { el, TEXT_MESSAGE_TAB_IDS, STANDARD_TAB_IDS } from './shared.js';
import { loadStatus } from './status.js';
import { loadNotes } from './ideas.js';
import { loadSlogans } from './slogans.js';
import { loadReplyOptions } from './reply-options.js';
import { loadTextMessageCategory } from './text-messages.js';
import { loadRosters } from './rosters.js';
import { loadErrors } from './errors.js';
import { loadImages } from './images.js';

export function closeTextMessagingMenu({ restoreFocus = false } = {}) {
  el('textMessagingMenu').classList.add('hidden');
  el('textMessagingTab').setAttribute('aria-expanded', 'false');
  if (restoreFocus) el('textMessagingTab').focus();
}

export function activateTab(tab) {
  const isTextMessaging = TEXT_MESSAGE_TAB_IDS.includes(tab);
  document.querySelectorAll('.tabs > button[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });
  el('textMessagingTab').classList.toggle('active', isTextMessaging);
  el('textMessagingMenu').querySelectorAll('[data-tab]').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
    button.setAttribute('aria-current', button.dataset.tab === tab ? 'page' : 'false');
  });
  STANDARD_TAB_IDS.forEach((name) => {
    el('tab-' + name).classList.toggle('hidden', name !== tab);
  });
  el('tab-youre-in').classList.toggle('hidden', !isTextMessaging);
  if (tab === 'status') loadStatus();
  if (tab === 'ideas') loadNotes();
  if (tab === 'message-randomizer' && window.MessageRandomizerAdmin) {
    window.MessageRandomizerAdmin.load();
  }
  if (tab === 'slogans') loadSlogans();
  if (tab === 'reply-options') loadReplyOptions();
  if (isTextMessaging) loadTextMessageCategory(tab);
  if (tab === 'errors') loadErrors();
  if (tab === 'rosters') loadRosters();
  if (tab === 'images') loadImages();
}

document.querySelectorAll('.tabs > button[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    closeTextMessagingMenu();
    activateTab(button.dataset.tab);
  });
});

el('textMessagingTab').addEventListener('click', () => {
  const menu = el('textMessagingMenu');
  const willOpen = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !willOpen);
  el('textMessagingTab').setAttribute('aria-expanded', String(willOpen));
});

el('textMessagingMenu').querySelectorAll('[data-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    activateTab(button.dataset.tab);
    closeTextMessagingMenu({ restoreFocus: true });
  });
});

document.addEventListener('click', (event) => {
  if (!event.target.closest('.tab-dropdown')) closeTextMessagingMenu();
});

el('textMessagingTab').addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown') return;
  event.preventDefault();
  el('textMessagingMenu').classList.remove('hidden');
  el('textMessagingTab').setAttribute('aria-expanded', 'true');
  el('textMessagingMenu').querySelector('[data-tab]').focus();
});

el('textMessagingMenu').addEventListener('keydown', (event) => {
  const items = [...el('textMessagingMenu').querySelectorAll('[data-tab]')];
  const currentIndex = items.indexOf(document.activeElement);
  if (event.key === 'Escape') {
    event.preventDefault();
    closeTextMessagingMenu({ restoreFocus: true });
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const offset = event.key === 'ArrowDown' ? 1 : -1;
    items[(currentIndex + offset + items.length) % items.length].focus();
  }
});
