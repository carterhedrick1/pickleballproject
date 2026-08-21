// The Status tab: server, database, counts, Textbelt quota and the text-delivery metrics.
import { el, escapeHtml, timeAgo, formatUptime } from './shared.js';
import { signedOut } from './api.js';

export async function loadStatus() {
  let status;
  try {
    const res = await fetch('/api/dev/status');
    if (signedOut(res)) return;
    status = await res.json();
  } catch (err) {
    el('statGrid').innerHTML = '<p class="muted">Could not reach the server.</p>';
    return;
  }

  const badge = el('envBadge');
  badge.textContent = status.server.environment;
  badge.classList.toggle('production', status.server.environment === 'production');

  const counts = status.counts || {};
  const texts = status.textbelt || {};
  const cards = [];

  if (texts.error) {
    cards.push(`<div class="stat"><div class="label">Texts Left</div><div class="value small">—</div>
      <div class="note">${escapeHtml(texts.error)}</div></div>`);
  } else {
    const remaining = texts.quotaRemaining;
    const tone = remaining < 100 ? 'bad' : remaining < 500 ? 'warn' : 'good';
    cards.push(`<div class="stat ${tone}"><div class="label">Texts Left</div>
      <div class="value">${remaining}</div>
      <div class="note">checked ${timeAgo(texts.checkedAt)}${texts.cached ? ' (cached)' : ''}</div></div>`);
  }

  const dbOk = status.database && status.database.ok;
  cards.push(`<div class="stat ${dbOk ? 'good' : 'bad'}"><div class="label">Hosting</div>
    <div class="value small">${dbOk ? 'All good' : 'Database down'}</div>
    <div class="note">${escapeHtml(status.database ? status.database.type : 'unknown')} · up ${formatUptime(status.server.uptimeSeconds)}</div></div>`);

  cards.push(`<div class="stat"><div class="label">Games</div><div class="value">${counts.games != null ? counts.games : '—'}</div>
    <div class="note">${counts.photos != null ? counts.photos + ' photos' : ''}</div></div>`);

  const errorCount = counts.errorsLast7Days;
  cards.push(`<div class="stat ${errorCount ? 'warn' : 'good'}"><div class="label">Errors (7 Days)</div>
    <div class="value">${errorCount != null ? errorCount : '—'}</div>
    <div class="note">${errorCount ? 'see the Errors tab' : 'nothing reported'}</div></div>`);

  cards.push(`<div class="stat"><div class="label">Waiting To Deploy</div>
    <div class="value">${counts.doneNotDeployed != null ? counts.doneNotDeployed : '—'}</div>
    <div class="note">${counts.building != null ? counts.building + ' in progress' : ''}</div></div>`);

  el('statGrid').innerHTML = cards.join('');

  const started = status.server.startedAt ? new Date(status.server.startedAt) : null;
  el('serverFacts').innerHTML = `
    <dt>Last started</dt><dd>${started ? started.toLocaleString() + ' (' + timeAgo(status.server.startedAt) + ')' : '—'}</dd>
    <dt>Database</dt><dd>${escapeHtml(status.database ? status.database.type : '—')}${dbOk ? ' — answering' : ' — <strong>not answering</strong>'}</dd>
    <dt>Node</dt><dd>${escapeHtml(status.server.nodeVersion)}</dd>
    <dt>Screens page</dt><dd>${status.screens
      ? 'published ' + timeAgo(status.screens.publishedAt) + ' (' + (status.screens.sizeBytes / 1024 / 1024).toFixed(1) + ' MB)'
      : 'not published yet'}</dd>`;

  el('screensStamp').textContent = status.screens
    ? 'Published ' + new Date(status.screens.publishedAt).toLocaleString()
    : 'Not published yet — run npm run docs:publish';

  renderTextMetrics(status.textMetrics);
}

function renderTextMetrics(metrics) {
  const metricGrid = el('textMetricGrid');
  const eventGrid = el('textEventGrid');
  if (!metrics || metrics.error) {
    const message = escapeHtml(metrics?.error || 'Text metrics are unavailable.');
    metricGrid.innerHTML = `<p class="muted">${message}</p>`;
    eventGrid.innerHTML = `<p class="muted">${message}</p>`;
    return;
  }

  const totals = metrics.totals || {};
  const successRate = totals.successRate == null ? '—' : `${totals.successRate}%`;
  metricGrid.innerHTML = [
    ['Texts Tracked', totals.total, `${totals.last7Days || 0} in the last 7 days`],
    ['Accepted By Textbelt', totals.sent, `${successRate} success rate`],
    ['Failed', totals.failed, `${Math.max(0, (totals.attempts || 0) - (totals.total || 0))} retry attempts`],
    ['Last 24 Hours', totals.last24Hours, `${totals.simulated || 0} local simulations overall`],
    ['Unique Recipients', totals.uniqueRecipients, 'phone numbers are stored only as hashes']
  ].map(([label, value, note]) => `<div class="stat">
    <div class="label">${escapeHtml(label)}</div>
    <div class="value">${value ?? 0}</div>
    <div class="note">${escapeHtml(note)}</div>
  </div>`).join('');

  const sourceLabel = metrics.source === 'production' ? 'Production Data' : 'Local Data';
  const trackingNote = metrics.trackingStartedAt
    ? `Historical counts have been recorded since ${new Date(metrics.trackingStartedAt).toLocaleString()}.`
    : 'No text attempts have been recorded yet. Counts begin with this release.';
  el('textTrackingNote').textContent = metrics.sourceError
    ? `${sourceLabel} · ${metrics.sourceError}`
    : `${sourceLabel} · ${trackingNote}`;

  eventGrid.innerHTML = (metrics.events || []).map((event) => {
    const extraAttempts = Math.max(0, event.attempts - event.total);
    return `<article class="text-event">
      <div class="text-event-head">
        <div>
          <h3>${escapeHtml(event.title)}</h3>
          <div class="text-event-recipient">${escapeHtml(event.recipient)}</div>
        </div>
        <div class="text-event-total" title="Texts Tracked">${event.total}</div>
      </div>
      <p class="text-event-description">${escapeHtml(event.description)}</p>
      <div class="text-event-counts">
        <span class="text-event-count"><strong>${event.last24Hours}</strong> Last 24 Hours</span>
        <span class="text-event-count"><strong>${event.last7Days}</strong> Last 7 Days</span>
        <span class="text-event-count"><strong>${event.sent}</strong> Sent</span>
        <span class="text-event-count failed"><strong>${event.failed}</strong> Failed</span>
        <span class="text-event-count"><strong>${event.uniqueRecipients}</strong> Recipients</span>
        ${event.simulated ? `<span class="text-event-count"><strong>${event.simulated}</strong> Simulated</span>` : ''}
        ${extraAttempts ? `<span class="text-event-count"><strong>${extraAttempts}</strong> Retries</span>` : ''}
      </div>
      <div class="text-event-last">${event.lastTriggeredAt
        ? `Last Triggered ${escapeHtml(timeAgo(event.lastTriggeredAt))}`
        : 'Never Triggered'}</div>
    </article>`;
  }).join('');
}
