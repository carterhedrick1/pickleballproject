// The Images tab: every uploaded court image and game photo, and where each came from.
import { el, escapeHtml } from './shared.js';
import { signedOut } from './api.js';

function formatImageBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return 'Size Not Available';
  if (value < 1024) return value + ' B';
  if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10240 ? 1 : 0) + ' KB';
  return (value / (1024 * 1024)).toFixed(1) + ' MB';
}

function imageTypeLabel(type) {
  return type === 'game' ? 'Game Photo' : 'Court Image';
}

export async function loadImages() {
  let images;
  let source;
  el('imageStatus').textContent = '';
  try {
    const res = await fetch('/api/dev/images');
    if (signedOut(res)) return;
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not load images.');
    images = data.images || [];
    source = data.source || 'production';
    const sourceNotice = el('imageSourceNotice');
    sourceNotice.classList.toggle('hidden', !data.showSourceNotice);
    sourceNotice.classList.toggle('local', source === 'local');
    el('imageSourceTitle').textContent = source === 'local'
      ? 'Showing Local Test Images'
      : 'Showing Live Production Images';
    el('imageSourceDetail').textContent = source === 'local'
      ? 'Uploads and deletions stay in the automated local fixture database.'
      : 'Uploads and deletions here apply to the images users see on inorout.club.';
  } catch (err) {
    el('imageCount').textContent = 'Unavailable';
    el('imageList').innerHTML = `<p class="muted">${escapeHtml(err.message || 'Could not load images.')}</p>`;
    return;
  }

  el('imageCount').textContent = `${images.length} Image${images.length === 1 ? '' : 's'}`;
  if (!images.length) {
    el('imageList').innerHTML = '<p class="muted">No images have been uploaded yet.</p>';
  } else {
    el('imageList').innerHTML = `<div class="image-grid">${images.map((image) => `
      <article class="image-card" data-image-type="${escapeHtml(image.type)}" data-image-id="${escapeHtml(image.id)}">
        <a class="image-card-preview" href="${escapeHtml(image.url)}" target="_blank"
          aria-label="Open full-size ${escapeHtml(imageTypeLabel(image.type).toLowerCase())}">
          <img src="${escapeHtml(image.url)}" alt="${escapeHtml(
            imageTypeLabel(image.type) + ' at ' + (image.location || 'Unknown Location')
          )}" loading="lazy">
        </a>
        <div class="image-card-body">
          <div>
            <div class="image-card-kind">${escapeHtml(imageTypeLabel(image.type))}</div>
            <div class="image-card-title">${escapeHtml(image.location || 'Location Not Available')}</div>
          </div>
          ${image.caption ? `<p class="image-card-caption">${escapeHtml(image.caption)}</p>` : ''}
          <dl class="image-card-details">
            <div><dt>Uploaded By</dt><dd>${escapeHtml(image.uploaderName)}</dd></div>
            <div><dt>Uploaded</dt><dd>${escapeHtml(
              image.createdAt ? new Date(image.createdAt).toLocaleString() : 'Date Not Available'
            )}</dd></div>
            <div><dt>File</dt><dd>${escapeHtml(image.mimeType)} · ${escapeHtml(formatImageBytes(image.bytes))}</dd></div>
          </dl>
          <button type="button" class="danger-button" data-action="delete-image">Delete Image</button>
        </div>
      </article>`).join('')}</div>`;
  }

  try {
    const res = await fetch('/api/dev/image-locations');
    const data = await res.json();
    const courts = data.locations || [];
    el('courtSelect').innerHTML = courts.map((court) =>
      `<option value="${escapeHtml(court)}">${escapeHtml(court)}</option>`
    ).join('');
  } catch (err) {
    el('courtSelect').innerHTML = '<option>Could not load courts</option>';
  }
}

el('imageList').addEventListener('click', async (event) => {
  const button = event.target.closest('[data-action="delete-image"]');
  if (!button) return;
  const card = button.closest('[data-image-type][data-image-id]');
  const type = card.dataset.imageType;
  const imageId = card.dataset.imageId;
  if (!confirm('Delete this image permanently? It will be removed everywhere it appears.')) return;

  button.disabled = true;
  button.textContent = 'Deleting…';
  try {
    const res = await fetch(
      `/api/dev/images/${encodeURIComponent(type)}/${encodeURIComponent(imageId)}`,
      { method: 'DELETE' }
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not delete the image.');
    await loadImages();
    el('imageStatus').textContent = 'Image deleted.';
    el('imageStatus').style.color = 'var(--brand)';
  } catch (err) {
    button.disabled = false;
    button.textContent = 'Delete Image';
    el('imageStatus').textContent = err.message || 'Could not delete the image.';
    el('imageStatus').style.color = 'var(--danger)';
  }
});

el('courtImageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const court = el('courtSelect').value;
  const file = el('courtImageFile').files[0];
  const status = el('courtStatus');

  if (!court || !file) {
    status.textContent = 'Please select a court and a file.';
    status.style.color = 'var(--danger)';
    return;
  }

  status.textContent = 'Uploading…';
  status.style.color = 'var(--muted)';

  try {
    const buffer = await file.arrayBuffer();
    // The sign-in cookie authenticates this, same as every other /api/dev call. It used to
    // put a `devPassword` variable in the query string - a variable that was never defined
    // anywhere on this page, so this upload threw before it sent anything.
    const res = await fetch(`/api/dev/courts/${encodeURIComponent(court)}/image`, {
      method: 'POST',
      body: buffer,
      headers: { 'Content-Type': file.type }
    });

    if (res.ok) {
      status.textContent = `✓ Image uploaded for ${escapeHtml(court)}`;
      status.style.color = 'var(--brand)';
      el('courtImageFile').value = '';
      await loadImages();
    } else {
      const error = await res.json();
      status.textContent = error.error || 'Upload failed';
      status.style.color = 'var(--danger)';
    }
  } catch (err) {
    status.textContent = 'Upload failed: ' + err.message;
    status.style.color = 'var(--danger)';
  }
});
