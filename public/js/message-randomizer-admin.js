(function() {
  'use strict';

  const state = {
    loaded: false,
    config: null,
    personality: null,
    messages: [],
    rules: [],
    roster: []
  };

  const byId = (id) => document.getElementById(id);
  const escape = (value) => String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  async function request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed with HTTP ${response.status}.`);
    return data;
  }

  function selectedPersonality() {
    return state.config?.personalities.find(
      (personality) => personality.id === byId('randomizerPersonality').value
    ) || state.config?.personalities[0] || null;
  }

  function surfaceOptions({ includeAll = false } = {}) {
    const surfaces = state.personality?.surfaces || [];
    return [
      ...(includeAll ? ['<option value="">All Surfaces</option>'] : []),
      ...surfaces.map((surface) => (
        `<option value="${escape(surface.id)}">${escape(surface.name)}</option>`
      ))
    ].join('');
  }

  function fillSurfaceSelectors() {
    byId('randomizerGenerationSurface').innerHTML = surfaceOptions();
    byId('randomizerLibrarySurface').innerHTML = surfaceOptions({ includeAll: true });
    byId('randomizerRuleSurface').innerHTML = surfaceOptions();
    byId('randomizerPreviewSurface').innerHTML = surfaceOptions();
  }

  function renderPersonality() {
    state.personality = selectedPersonality();
    if (!state.personality) return;
    byId('randomizerEnabled').checked = state.personality.enabled;
    byId('randomizerDefault').checked = state.personality.isDefault;
    byId('randomizerDescription').value = state.personality.description;
    byId('randomizerGuidance').value = state.personality.generationGuidance;
    byId('randomizerLockedPercent').value = state.personality.lockedPercent;
    byId('randomizerLockedRange').value = state.personality.lockedPercent;
    updateRatioSummary();
    byId('randomizerFreshMinimum').value = state.personality.freshPoolMinimum;
    byId('randomizerBatchSize').value = state.personality.generationBatchSize;
    fillSurfaceSelectors();
    renderSurfaceRows();
  }

  function updateRatioSummary() {
    const locked = Math.min(
      Math.max(Number(byId('randomizerLockedPercent').value) || 0, 0),
      100
    );
    byId('randomizerRatioSummary').textContent =
      `${locked}% locked favorites / ${100 - locked}% fresh messages`;
  }

  function renderSurfaceRows() {
    byId('randomizerSurfaceRows').innerHTML = state.personality.surfaces.map((surface) => {
      const setting = surface.setting || {};
      const metrics = surface.metrics || {};
      const generationStatus = surface.generationStatus || {};
      return `<tr data-surface-id="${escape(surface.id)}">
        <td><strong>${escape(surface.name)}</strong><br><span class="muted">${escape(surface.id)}</span></td>
        <td><input type="checkbox" data-field="enabled" ${setting.enabled ? 'checked' : ''} aria-label="${escape(surface.name)} enabled"></td>
        <td>${metrics.locked || 0}</td>
        <td>${metrics.fresh || 0}</td>
        <td>${metrics.draft || 0}</td>
        <td><input type="number" data-field="lockedPercentOverride" min="0" max="100" value="${setting.lockedPercentOverride ?? ''}" placeholder="${state.personality.lockedPercent}" aria-label="${escape(surface.name)} locked percent"></td>
        <td><input type="number" data-field="freshPoolMinimumOverride" min="0" max="500" value="${setting.freshPoolMinimumOverride ?? ''}" placeholder="${state.personality.freshPoolMinimum}" aria-label="${escape(surface.name)} fresh minimum"></td>
        <td><input type="checkbox" data-field="autoPublishGenerated" ${setting.autoPublishGenerated ? 'checked' : ''} ${surface.autoPublishEligible ? '' : 'disabled'} aria-label="${escape(surface.name)} auto-publish"></td>
        <td><span class="muted">${metrics.lastSelectedAt ? `Selected ${escape(new Date(metrics.lastSelectedAt).toLocaleDateString())}` : 'Never selected'}<br>${metrics.lastGeneratedAt ? `Generated ${escape(new Date(metrics.lastGeneratedAt).toLocaleDateString())}` : 'Never generated'}${generationStatus.failureReason ? `<br><span class="error-text">${escape(generationStatus.failureReason)}</span>` : ''}</span></td>
        <td><button type="button" class="ghost" data-action="surface-preview">Preview</button></td>
      </tr>`;
    }).join('');
  }

  function readSurfaceSettings() {
    const surfaces = {};
    byId('randomizerSurfaceRows').querySelectorAll('tr[data-surface-id]').forEach((row) => {
      const locked = row.querySelector('[data-field="lockedPercentOverride"]').value;
      const minimum = row.querySelector('[data-field="freshPoolMinimumOverride"]').value;
      surfaces[row.dataset.surfaceId] = {
        enabled: row.querySelector('[data-field="enabled"]').checked,
        lockedPercentOverride: locked === '' ? null : Number(locked),
        freshPoolMinimumOverride: minimum === '' ? null : Number(minimum),
        autoPublishGenerated: row.querySelector('[data-field="autoPublishGenerated"]').checked
      };
    });
    return surfaces;
  }

  async function savePersonality(event) {
    event.preventDefault();
    const status = byId('randomizerPersonalityStatus');
    status.textContent = 'Saving…';
    try {
      const data = await request(
        `/api/dev/message-personalities/${encodeURIComponent(state.personality.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            description: byId('randomizerDescription').value,
            generationGuidance: byId('randomizerGuidance').value,
            enabled: byId('randomizerEnabled').checked,
            isDefault: byId('randomizerDefault').checked,
            lockedPercent: Number(byId('randomizerLockedPercent').value),
            freshPoolMinimum: Number(byId('randomizerFreshMinimum').value),
            generationBatchSize: Number(byId('randomizerBatchSize').value),
            surfaces: readSurfaceSettings()
          })
        }
      );
      status.textContent = 'Personality and surface settings saved.';
      state.loaded = false;
      await load();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function libraryQuery() {
    const params = new URLSearchParams({ personalityId: state.personality.id });
    for (const [controlId, key] of [
      ['randomizerLibrarySurface', 'surfaceId'],
      ['randomizerLibrarySource', 'source'],
      ['randomizerLibraryStatus', 'status'],
      ['randomizerLibraryLocked', 'locked']
    ]) {
      const value = byId(controlId).value;
      if (value) params.set(key, value);
    }
    return params;
  }

  async function loadMessages() {
    const list = byId('randomizerMessageList');
    list.innerHTML = '<p class="muted">Loading…</p>';
    try {
      const data = await request(`/api/dev/randomizer-messages?${libraryQuery()}`);
      state.messages = data.messages;
      renderMessages();
    } catch (error) {
      list.innerHTML = `<p class="error-text">${escape(error.message)}</p>`;
    }
  }

  function renderMessages() {
    const list = byId('randomizerMessageList');
    if (!state.messages.length) {
      list.innerHTML = '<p class="muted">No messages match these filters.</p>';
      return;
    }
    list.innerHTML = state.messages.map((message) => `
      <div class="randomizer-library-row" data-message-id="${escape(message.id)}">
        <label class="randomizer-toggle">
          <input type="checkbox" data-select-message aria-label="Select message"> Select
        </label>
        <div class="randomizer-library-copy">${escape(message.text)}</div>
        <div class="randomizer-meta">
          ${message.locked ? '<span class="randomizer-badge favorite">Locked Favorite</span>' : ''}
          ${message.vetted ? '<span class="randomizer-badge favorite">Vetted</span>' : ''}
          <span class="randomizer-badge">${escape(message.surfaceId)}</span>
          <span class="randomizer-badge">${escape(message.source)}</span>
          <span class="randomizer-badge">${escape(message.status)}</span>
          <span>${message.usageCount} uses</span>
          <span>${message.lastUsedAt ? `Last used ${escape(new Date(message.lastUsedAt).toLocaleString())}` : 'Never used'}</span>
        </div>
        <div class="randomizer-actions">
          <button type="button" class="ghost" data-action="edit-message">Edit</button>
          <button type="button" class="ghost" data-action="toggle-lock">${message.locked ? 'Unlock' : 'Lock'}</button>
          <button type="button" class="ghost" data-action="toggle-status">${message.status === 'active' ? 'Archive' : 'Activate'}</button>
          <button type="button" class="ghost" data-action="regenerate-similar">Regenerate Similar</button>
        </div>
      </div>
    `).join('');
  }

  async function updateMessage(message, fields) {
    await request(`/api/dev/randomizer-messages/${encodeURIComponent(message.id)}`, {
      method: 'PUT',
      body: JSON.stringify(fields)
    });
    await Promise.all([loadMessages(), refreshConfiguration()]);
  }

  async function handleMessageAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-message-id]');
    const message = state.messages.find((candidate) => candidate.id === row.dataset.messageId);
    if (!message) return;
    try {
      if (button.dataset.action === 'edit-message') {
        const text = prompt('Edit this message:', message.text);
        if (text == null || text.trim() === message.text) return;
        await updateMessage(message, { text: text.trim() });
      } else if (button.dataset.action === 'toggle-lock') {
        await updateMessage(message, { locked: !message.locked });
      } else if (button.dataset.action === 'toggle-status') {
        await updateMessage(message, {
          status: message.status === 'active' ? 'archived' : 'active'
        });
      } else if (button.dataset.action === 'regenerate-similar') {
        const direction = prompt('Bounded direction for a similar message:', `Use this as inspiration without copying it: ${message.text}`);
        if (!direction) return;
        await runGeneration({
          surfaceId: message.surfaceId,
          count: 3,
          direction
        });
      }
    } catch (error) {
      alert(error.message);
    }
  }

  async function bulkStatus(status) {
    const ids = Array.from(byId('randomizerMessageList').querySelectorAll(
      '[data-select-message]:checked'
    )).map((input) => input.closest('[data-message-id]').dataset.messageId);
    if (!ids.length) return;
    await Promise.all(ids.map((id) => request(
      `/api/dev/randomizer-messages/${encodeURIComponent(id)}`,
      { method: 'PUT', body: JSON.stringify({ status }) }
    )));
    await Promise.all([loadMessages(), refreshConfiguration()]);
  }

  async function addManualMessage() {
    const surfaceId = byId('randomizerLibrarySurface').value ||
      byId('randomizerGenerationSurface').value;
    const text = prompt('Enter a new manual message:');
    if (!text) return;
    await request('/api/dev/randomizer-messages', {
      method: 'POST',
      body: JSON.stringify({
        personalityId: state.personality.id,
        surfaceId,
        text,
        source: 'manual',
        status: 'draft',
        locked: false
      })
    });
    await loadMessages();
  }

  async function runGeneration({
    surfaceId = byId('randomizerGenerationSurface').value,
    count = Number(byId('randomizerGenerationCount').value),
    direction = null,
    targetRuleId = null
  } = {}) {
    const status = byId('randomizerGenerationStatus');
    status.textContent = 'Generating outside player-facing request paths…';
    try {
      const result = await request('/api/dev/message-generation', {
        method: 'POST',
        body: JSON.stringify({
          personalityId: state.personality.id,
          surfaceId,
          count,
          direction,
          targetRuleId
        })
      });
      status.textContent = `${result.accepted.length} draft message${result.accepted.length === 1 ? '' : 's'} created; ${result.rejected.length} rejected by validation.`;
      await Promise.all([loadMessages(), refreshConfiguration()]);
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function updateRuleMode() {
    const direction = byId('randomizerRuleMode').value === 'direction';
    byId('randomizerExactWrap').classList.toggle('hidden', direction);
    byId('randomizerDirectionWrap').classList.toggle('hidden', !direction);
    updateRuleSummary();
  }

  function updateRuleSummary() {
    const player = byId('randomizerRulePlayer').selectedOptions[0]?.textContent ||
      'the selected player';
    const game = byId('randomizerRuleGame').selectedOptions[0]?.textContent ||
      'all games';
    const audienceLabels = {
      'target-only': 'only the target player',
      confirmed: 'confirmed players in the scoped game',
      'known-game-audience': 'people already known to the scoped game',
      'invitation-copy': 'copied invitation text when the target is known or intended'
    };
    const audience = audienceLabels[byId('randomizerRuleAudience').value];
    byId('randomizerRuleAudienceSummary').textContent =
      `${player} is the phone-backed target. This rule can affect ${audience} for ${game}.`;
    const exact = byId('randomizerRuleMode').value === 'exact';
    const copy = exact
      ? byId('randomizerRuleExact').value
      : byId('randomizerRuleDirection').value;
    byId('randomizerRulePreview').textContent = copy || (
      exact ? 'Choose a player and enter the exact rule copy.' :
        'Choose a player and enter a bounded generation direction.'
    );
  }

  function clearRuleForm() {
    byId('randomizerRuleForm').reset();
    byId('randomizerRuleId').value = '';
    byId('randomizerRuleStatus').value = 'any-known';
    byId('randomizerRuleAudience').value = 'target-only';
    byId('randomizerRuleMode').value = 'exact';
    updateRuleMode();
  }

  async function loadRules() {
    const data = await request(
      `/api/dev/message-target-rules?personalityId=${encodeURIComponent(state.personality.id)}`
    );
    state.rules = data.rules;
    state.roster = data.roster;
    byId('randomizerRulePlayer').innerHTML = [
      '<option value="">Choose A Player</option>',
      ...state.roster.map((player) => (
        `<option value="${escape(player.phone)}">${escape(player.name || player.phone)}</option>`
      ))
    ].join('');
    byId('randomizerPreviewRecipient').innerHTML = [
      '<option value="">No Recipient</option>',
      ...state.roster.map((player) => (
        `<option value="${escape(player.phone)}">${escape(player.name || player.phone)}</option>`
      ))
    ].join('');
    renderRules();
  }

  function renderRules() {
    byId('randomizerRuleList').innerHTML = state.rules.length
      ? state.rules.map((rule) => `
        <div class="randomizer-library-row" data-rule-id="${escape(rule.id)}">
          <div class="randomizer-library-copy"><strong>${escape(rule.targetDisplayName || 'Saved Player')}</strong> · ${escape(rule.surfaceId)} · ${escape(rule.audience)}</div>
          <div class="randomizer-meta">
            <span class="randomizer-badge">${escape(rule.mode)}</span>
            <span class="randomizer-badge">${rule.enabled ? 'active' : 'disabled'}</span>
            <span>${escape(rule.exactText || rule.generationDirection || '')}</span>
            ${rule.startsAt ? `<span>Starts ${escape(new Date(rule.startsAt).toLocaleString())}</span>` : ''}
            ${rule.endsAt ? `<span>Ends ${escape(new Date(rule.endsAt).toLocaleString())}</span>` : ''}
          </div>
          <div class="randomizer-actions">
            <button type="button" class="ghost" data-action="edit-rule">Edit Rule</button>
            ${rule.mode === 'direction' ? '<button type="button" class="ghost" data-action="generate-rule">Generate Directed Drafts</button>' : ''}
            <button type="button" class="ghost" data-action="delete-rule">Delete Rule</button>
          </div>
        </div>
      `).join('')
      : '<p class="muted">No target rules yet.</p>';
  }

  async function saveRule(event) {
    event.preventDefault();
    const id = byId('randomizerRuleId').value;
    const selected = byId('randomizerRulePlayer').selectedOptions[0];
    const body = {
      personalityId: state.personality.id,
      targetPhone: byId('randomizerRulePlayer').value,
      targetDisplayName: selected?.textContent || '',
      gameId: byId('randomizerRuleGame').value || null,
      triggerStatus: byId('randomizerRuleStatus').value,
      surfaceId: byId('randomizerRuleSurface').value,
      audience: byId('randomizerRuleAudience').value,
      mode: byId('randomizerRuleMode').value,
      exactText: byId('randomizerRuleExact').value,
      generationDirection: byId('randomizerRuleDirection').value,
      enabled: byId('randomizerRuleEnabled').checked,
      startsAt: byId('randomizerRuleStartsAt').value || null,
      endsAt: byId('randomizerRuleEndsAt').value || null
    };
    const status = byId('randomizerRuleStatusMessage');
    try {
      await request(id
        ? `/api/dev/message-target-rules/${encodeURIComponent(id)}`
        : '/api/dev/message-target-rules', {
        method: id ? 'PUT' : 'POST',
        body: JSON.stringify(body)
      });
      status.textContent = 'Target rule saved.';
      clearRuleForm();
      await loadRules();
    } catch (error) {
      status.textContent = error.message;
    }
  }

  function editRule(rule) {
    byId('randomizerRuleId').value = rule.id;
    byId('randomizerRulePlayer').value = rule.targetPhone;
    byId('randomizerRuleGame').value = rule.gameId || '';
    byId('randomizerRuleStatus').value = rule.triggerStatus;
    byId('randomizerRuleSurface').value = rule.surfaceId;
    byId('randomizerRuleAudience').value = rule.audience;
    byId('randomizerRuleMode').value = rule.mode;
    byId('randomizerRuleExact').value = rule.exactText || '';
    byId('randomizerRuleDirection').value = rule.generationDirection || '';
    byId('randomizerRuleStartsAt').value = rule.startsAt
      ? new Date(rule.startsAt).toISOString().slice(0, 16)
      : '';
    byId('randomizerRuleEndsAt').value = rule.endsAt
      ? new Date(rule.endsAt).toISOString().slice(0, 16)
      : '';
    byId('randomizerRuleEnabled').checked = rule.enabled;
    updateRuleMode();
    updateRuleSummary();
  }

  async function handleRuleAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const row = button.closest('[data-rule-id]');
    const rule = state.rules.find((candidate) => candidate.id === row.dataset.ruleId);
    if (!rule) return;
    try {
      if (button.dataset.action === 'edit-rule') {
        editRule(rule);
      } else if (button.dataset.action === 'generate-rule') {
        await runGeneration({
          surfaceId: rule.surfaceId,
          count: state.personality.generationBatchSize,
          targetRuleId: rule.id
        });
      } else if (button.dataset.action === 'delete-rule') {
        if (!confirm('Delete this target rule?')) return;
        await request(`/api/dev/message-target-rules/${encodeURIComponent(rule.id)}`, {
          method: 'DELETE'
        });
        await loadRules();
      }
    } catch (error) {
      byId('randomizerRuleStatusMessage').textContent = error.message;
    }
  }

  function renderExampleOptions() {
    const games = state.config.exampleGames || [];
    const options = games.map((game) => (
      `<option value="${escape(game.gameId)}">${escape(game.location || game.gameId)} · ${escape(game.date || '')}</option>`
    )).join('');
    byId('randomizerRuleGame').innerHTML = '<option value="">All Games</option>' + options;
    byId('randomizerPreviewGame').innerHTML =
      '<option value="">No Game Context</option>' + options;
  }

  async function preview(surfaceId = null) {
    if (surfaceId) byId('randomizerPreviewSurface').value = surfaceId;
    const gameId = byId('randomizerPreviewGame').value;
    const game = state.config.exampleGames.find((candidate) => candidate.gameId === gameId) || null;
    const recipientPhone = byId('randomizerPreviewRecipient').value || null;
    const surface = byId('randomizerPreviewSurface').value;
    const audience = surface === 'invitation-opening' ? 'invitation-copy' : 'target-only';
    const output = byId('randomizerPreviewOutput');
    output.innerHTML = '<div class="randomizer-preview">Resolving stored inventory…</div>';
    try {
      const result = await request('/api/dev/message-randomizer/preview', {
        method: 'POST',
        body: JSON.stringify({
          personalityId: state.personality.id,
          surfaceId: surface,
          gameId,
          game,
          recipientPhone,
          audience,
          useTargetRules: byId('randomizerPreviewTargets').checked,
          templateValues: { NAME: 'Scott' },
          deterministicDetails: byId('randomizerPreviewDetails').value,
          fallbackText: byId('randomizerPreviewFallback').value
        })
      });
      output.innerHTML = `
        <div class="randomizer-preview">${escape(result.text)}</div>
        <div class="randomizer-meta">
          <span class="randomizer-badge">${escape(result.sourceBucket)}</span>
          ${result.locked ? '<span class="randomizer-badge favorite">Locked Favorite</span>' : ''}
          ${result.targetRuleId ? `<span class="randomizer-badge">Rule ${escape(result.targetRuleId)}</span>` : ''}
          <span>${result.characterCount} characters</span>
        </div>
        <p class="muted">Deterministic fallback: ${escape(result.fallbackText)}</p>`;
    } catch (error) {
      output.innerHTML = `<p class="error-text">${escape(error.message)}</p>`;
    }
  }

  async function refreshConfiguration() {
    state.config = await request('/api/dev/message-randomizer');
    const selectedId = state.personality?.id || state.config.personalities[0]?.id;
    byId('randomizerPersonality').innerHTML = state.config.personalities.map((personality) => (
      `<option value="${escape(personality.id)}">${escape(personality.name)}</option>`
    )).join('');
    byId('randomizerPersonality').value = selectedId;
    renderPersonality();
    const provider = state.config.provider;
    byId('randomizerGenerationStatus').textContent = provider.enabled
      ? `${provider.name} is ready. Generated messages remain drafts until reviewed.`
      : provider.reason;
  }

  async function load() {
    if (state.loaded) return;
    state.loaded = true;
    try {
      if (!byId('randomizerPreviewDetails').value) {
        byId('randomizerPreviewDetails').value =
          'Pickleball at Oak Park Courts on Sat, Aug 1 at 9:00 AM. Reply 9 to cancel.';
      }
      if (!byId('randomizerPreviewFallback').value) {
        byId('randomizerPreviewFallback').value =
          'The current deterministic message remains available.';
      }
      await refreshConfiguration();
      renderExampleOptions();
      await Promise.all([loadMessages(), loadRules()]);
    } catch (error) {
      state.loaded = false;
      byId('randomizerPersonalityStatus').textContent = error.message;
    }
  }

  byId('randomizerPersonalityForm').addEventListener('submit', savePersonality);
  byId('randomizerLockedRange').addEventListener('input', () => {
    byId('randomizerLockedPercent').value = byId('randomizerLockedRange').value;
    updateRatioSummary();
  });
  byId('randomizerLockedPercent').addEventListener('input', () => {
    byId('randomizerLockedRange').value = byId('randomizerLockedPercent').value;
    updateRatioSummary();
  });
  byId('randomizerPersonality').addEventListener('change', async () => {
    renderPersonality();
    await Promise.all([loadMessages(), loadRules()]);
  });
  byId('randomizerSurfaceRows').addEventListener('click', (event) => {
    const button = event.target.closest('[data-action="surface-preview"]');
    if (!button) return;
    preview(button.closest('[data-surface-id]').dataset.surfaceId);
  });
  byId('randomizerGenerate').addEventListener('click', () => runGeneration());
  for (const id of [
    'randomizerLibrarySurface',
    'randomizerLibrarySource',
    'randomizerLibraryStatus',
    'randomizerLibraryLocked'
  ]) {
    byId(id).addEventListener('change', loadMessages);
  }
  byId('randomizerMessageList').addEventListener('click', handleMessageAction);
  byId('randomizerActivateSelected').addEventListener('click', () => bulkStatus('active'));
  byId('randomizerArchiveSelected').addEventListener('click', () => bulkStatus('archived'));
  byId('randomizerAddMessage').addEventListener('click', addManualMessage);
  byId('randomizerRuleMode').addEventListener('change', updateRuleMode);
  for (const id of [
    'randomizerRulePlayer',
    'randomizerRuleGame',
    'randomizerRuleAudience',
    'randomizerRuleExact',
    'randomizerRuleDirection'
  ]) {
    byId(id).addEventListener('input', updateRuleSummary);
    byId(id).addEventListener('change', updateRuleSummary);
  }
  byId('randomizerRuleForm').addEventListener('submit', saveRule);
  byId('randomizerRuleReset').addEventListener('click', clearRuleForm);
  byId('randomizerRuleList').addEventListener('click', handleRuleAction);
  byId('randomizerPreviewButton').addEventListener('click', () => preview());

  window.MessageRandomizerAdmin = { load };
})();
