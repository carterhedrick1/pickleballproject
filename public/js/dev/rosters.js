// The Hosts And Players tab: the master directory, and editing or removing people in it.
import { el, escapeHtml } from './shared.js';
import { sendJson, signedOut } from './api.js';

let rosterDirectory = { hosts: [], players: [], counts: {}, source: null };

function formatDisplayPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length !== 10) return phone || 'No phone number';
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function rosterPlayerCard(player) {
  const hostRosters = Array.isArray(player.hostRosters) ? player.hostRosters : [];
  const hostNames = hostRosters.map((host) => host.name || formatDisplayPhone(host.phone));
  const hostLabel = hostNames.length === 1
    ? `Host Roster: ${hostNames[0]}`
    : `Host Rosters: ${hostNames.join(', ')}`;
  return `
    <article class="master-player" data-player-phone="${escapeHtml(player.phone)}">
      <div class="master-player-main">
        <div class="roster-person">
          <div class="roster-person-name">${escapeHtml(player.name || 'Name Not Available')}</div>
          <div class="roster-person-phone">${escapeHtml(formatDisplayPhone(player.phone))}</div>
          <div class="roster-person-meta">${escapeHtml(hostLabel)}</div>
        </div>
        <div class="roster-actions">
          <button type="button" class="ghost" data-roster-action="edit">Edit</button>
          <button type="button" class="danger-button" data-roster-action="delete">Delete</button>
        </div>
      </div>
      <form class="player-edit-form hidden">
        <div class="player-edit-fields">
          <label>Player Name
            <input name="name" value="${escapeHtml(player.name)}" maxlength="100" required>
          </label>
          <label>Phone Number
            <input name="phone" value="${escapeHtml(formatDisplayPhone(player.phone))}"
              inputmode="tel" autocomplete="tel" required>
          </label>
        </div>
        <div class="roster-actions">
          <button type="submit" class="primary">Save Changes</button>
          <button type="button" class="ghost" data-roster-action="cancel">Cancel</button>
        </div>
        <div class="roster-form-status" aria-live="polite"></div>
      </form>
      <div class="player-delete-confirm hidden">
        <p>
          This permanently removes <strong>${escapeHtml(player.name || formatDisplayPhone(player.phone))}</strong>
          from every host roster and every game roster. No text message will be sent.
        </p>
        <div class="roster-actions">
          <button type="button" class="danger-button" data-roster-action="confirm-delete">Delete Player</button>
          <button type="button" class="ghost" data-roster-action="cancel">Cancel</button>
        </div>
        <div class="roster-form-status" aria-live="polite"></div>
      </div>
    </article>`;
}

function renderRosters() {
  const query = el('rosterSearch').value.trim().toLowerCase();
  const matches = (name, phone) =>
    !query ||
    String(name || '').toLowerCase().includes(query) ||
    String(phone || '').includes(query.replace(/\D/g, ''));
  const visiblePlayers = rosterDirectory.players.filter((player) => matches(player.name, player.phone));

  el('rosterSearchCount').textContent = query
    ? `${visiblePlayers.length} of ${rosterDirectory.players.length} players`
    : `${rosterDirectory.players.length} players`;
  el('masterRosterList').innerHTML = visiblePlayers.length
    ? visiblePlayers.map(rosterPlayerCard).join('')
    : '<p class="muted">No players match that search.</p>';

  const visibleHosts = rosterDirectory.hosts
    .map((host) => ({
      ...host,
      players: query
        ? host.players.filter((player) => matches(player.name, player.phone))
        : host.players
    }))
    .filter((host) => !query || matches(host.name, host.phone) || host.players.length);

  el('hostRosterList').innerHTML = visibleHosts.length
    ? visibleHosts.map((host) => `
      <details class="host-roster" data-host-phone="${escapeHtml(host.phone)}"${query ? ' open' : ''}>
        <summary>
          <div class="roster-person">
            <div class="roster-person-name">${escapeHtml(host.name || 'Host Name Not Available')}</div>
            <div class="roster-person-phone">${escapeHtml(formatDisplayPhone(host.phone))}</div>
          </div>
          <div class="host-roster-summary-actions">
            <span class="host-roster-count">${host.players.length} player${host.players.length === 1 ? '' : 's'}</span>
            <button type="button" class="host-delete-button" data-host-action="delete">Delete</button>
          </div>
        </summary>
        <div class="host-delete-confirm hidden">
          <p>
            This permanently deletes <strong>${escapeHtml(host.name || formatDisplayPhone(host.phone))}</strong>
            as a host, including every game they host, game photo, reminder record, and saved roster entry.
            People listed with other hosts will remain there. No text message will be sent.
          </p>
          <div class="roster-actions">
            <button type="button" class="danger-button" data-host-action="confirm-delete">Delete Host</button>
            <button type="button" class="ghost" data-host-action="cancel">Cancel</button>
          </div>
          <div class="roster-form-status" aria-live="polite"></div>
        </div>
        <div class="host-roster-players">
          ${host.players.length ? host.players.map((player) => `
            <div class="host-roster-player">
              <span class="roster-person-name">${escapeHtml(player.name || 'Name Not Available')}</span>
              <span class="roster-person-phone">${escapeHtml(formatDisplayPhone(player.phone))}</span>
            </div>`).join('') : '<p class="muted">No players on this roster.</p>'}
        </div>
      </details>`).join('')
    : '<p class="muted">No host rosters match that search.</p>';
}

function renderRosterSource() {
  const notice = el('rosterSourceNotice');
  if (!rosterDirectory.showSourceNotice) {
    notice.classList.add('hidden');
    return;
  }
  const showingProduction = rosterDirectory.source === 'production';
  notice.classList.remove('hidden');
  notice.classList.toggle('local', !showingProduction);
  el('rosterSourceTitle').textContent = showingProduction
    ? 'Showing Live Production Data'
    : 'Showing Local Test Data';
  el('rosterSourceDetail').textContent = showingProduction
    ? 'These are the real rosters from inorout.club. Edits and deletions affect the live app.'
    : 'These rows only exist in this computer’s SQLite test database.';
  const toggle = el('rosterSourceToggle');
  toggle.classList.toggle('hidden', !rosterDirectory.canChooseSource);
  toggle.textContent = showingProduction
    ? 'Show Local Test Data'
    : 'Show Live Production Data';
}

function rosterSourceQuery() {
  return rosterDirectory.source
    ? `?source=${encodeURIComponent(rosterDirectory.source)}`
    : '';
}

export async function loadRosters(requestedSource = null) {
  try {
    const query = requestedSource ? `?source=${encodeURIComponent(requestedSource)}` : '';
    const res = await fetch('/api/dev/rosters' + query);
    if (signedOut(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load rosters.');
    rosterDirectory = data;
    renderRosterSource();
    el('rosterSummary').innerHTML = `
      <div class="stat good"><div class="label">Hosts</div>
        <div class="value">${data.counts.hosts}</div><div class="note">With a saved game or roster</div></div>
      <div class="stat good"><div class="label">Players</div>
        <div class="value">${data.counts.players}</div><div class="note">Unique phone numbers</div></div>
      <div class="stat"><div class="label">Roster Entries</div>
        <div class="value">${data.counts.rosterEntries}</div><div class="note">Across every host</div></div>`;
    renderRosters();
  } catch (err) {
    el('rosterSummary').innerHTML = '';
    if (requestedSource === 'production') {
      rosterDirectory = {
        ...rosterDirectory,
        source: 'production',
        showSourceNotice: true,
        canChooseSource: true
      };
      renderRosterSource();
    }
    el('masterRosterList').innerHTML = `<p class="muted">${escapeHtml(err.message)}</p>`;
    el('hostRosterList').innerHTML = '<p class="muted">Could not load host rosters.</p>';
  }
}

el('rosterSearch').addEventListener('input', renderRosters);
el('rosterSourceToggle').addEventListener('click', () => {
  loadRosters(rosterDirectory.source === 'production' ? 'local' : 'production');
});

el('hostRosterList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-host-action]');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const card = button.closest('.host-roster');
  const deleteConfirm = card.querySelector('.host-delete-confirm');
  const action = button.dataset.hostAction;

  if (action === 'delete') {
    card.open = true;
    deleteConfirm.classList.remove('hidden');
    deleteConfirm.querySelector('[data-host-action="confirm-delete"]').focus();
  } else if (action === 'cancel') {
    deleteConfirm.classList.add('hidden');
    card.querySelector('[data-host-action="delete"]').focus();
  } else if (action === 'confirm-delete') {
    const phone = card.dataset.hostPhone;
    const status = deleteConfirm.querySelector('.roster-form-status');
    button.disabled = true;
    status.textContent = 'Deleting host…';
    sendJson('/api/dev/hosts/' + encodeURIComponent(phone) + rosterSourceQuery(), 'DELETE', { confirmPhone: phone }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete the host.');
      await loadRosters(rosterDirectory.source);
    }).catch((err) => {
      status.textContent = err.message;
      button.disabled = false;
    });
  }
});

el('masterRosterList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-roster-action]');
  if (!button) return;
  const card = button.closest('.master-player');
  const editForm = card.querySelector('.player-edit-form');
  const deleteConfirm = card.querySelector('.player-delete-confirm');
  const action = button.dataset.rosterAction;

  if (action === 'edit') {
    deleteConfirm.classList.add('hidden');
    editForm.classList.remove('hidden');
    editForm.elements.name.focus();
  } else if (action === 'delete') {
    editForm.classList.add('hidden');
    deleteConfirm.classList.remove('hidden');
    deleteConfirm.querySelector('[data-roster-action="confirm-delete"]').focus();
  } else if (action === 'cancel') {
    editForm.classList.add('hidden');
    deleteConfirm.classList.add('hidden');
  } else if (action === 'confirm-delete') {
    const phone = card.dataset.playerPhone;
    const status = deleteConfirm.querySelector('.roster-form-status');
    button.disabled = true;
    status.textContent = 'Deleting player…';
    sendJson('/api/dev/players/' + encodeURIComponent(phone) + rosterSourceQuery(), 'DELETE', { confirmPhone: phone }).then(async (res) => {
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not delete the player.');
      await loadRosters(rosterDirectory.source);
    }).catch((err) => {
      status.textContent = err.message;
      button.disabled = false;
    });
  }
});

el('masterRosterList').addEventListener('submit', async (event) => {
  const form = event.target.closest('.player-edit-form');
  if (!form) return;
  event.preventDefault();
  const card = form.closest('.master-player');
  const oldPhone = card.dataset.playerPhone;
  const status = form.querySelector('.roster-form-status');
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  status.textContent = 'Saving changes…';

  try {
    const res = await sendJson(
      '/api/dev/players/' + encodeURIComponent(oldPhone) + rosterSourceQuery(),
      'PUT',
      { name: form.elements.name.value, phone: form.elements.phone.value }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not update the player.');
    await loadRosters(rosterDirectory.source);
  } catch (err) {
    status.textContent = err.message;
    submit.disabled = false;
  }
});
