// The Media tab: the photos players add after a game, and the court image shown at the top of
// the game page.
import { gameId } from './state.js';
import { request, json } from './api.js';
import { clear } from './dom.js';
import { showStatus } from './game.js';

// ---------------------------------------------------------------------------
// Photos
//
// Uploads go up as raw image bytes rather than multipart, which is why the server needs no
// upload dependency. Phone cameras produce 3-6MB files, so each one is drawn into a canvas
// and re-encoded first - that takes a typical photo down to a few hundred KB, which matters
// because these are stored in the database.
// ---------------------------------------------------------------------------

const PHOTO_MAX_DIMENSION = 1600;
const PHOTO_JPEG_QUALITY = 0.85;

function setPhotoStatus(message, kind) {
    const el = document.getElementById('photoStatus');
    if (!el) return;
    el.textContent = message || '';
    el.className = 'photo-status' + (kind ? ' ' + kind : '');
}

/**
 * Shrinks an image file to something sensible to store.
 * Uses Image + object URL rather than createImageBitmap, which older iPhones do not have.
 * If anything goes wrong it falls back to uploading the original file untouched.
 */
function resizePhoto(file) {
    return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const img = new Image();

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            try {
                const scale = Math.min(1, PHOTO_MAX_DIMENSION / Math.max(img.width, img.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(
                    (blob) => resolve(blob || file),
                    'image/jpeg',
                    PHOTO_JPEG_QUALITY
                );
            } catch (err) {
                console.error('Could not resize the photo, sending it as-is:', err);
                resolve(file);
            }
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            resolve(file);
        };

        img.src = objectUrl;
    });
}

export async function loadPhotos() {
    const grid = document.getElementById('photoGrid');
    const empty = document.getElementById('photoEmpty');
    if (!grid || !gameId) return;

    try {
        const response = await request(`/api/games/${gameId}/photos`);
        const data = await response.json();
        const photos = data.photos || [];

        clear(grid);
        if (empty) empty.style.display = photos.length ? 'none' : 'block';

        photos.forEach((photo) => {
            const card = document.createElement('div');
            card.className = 'photo-card';

            const img = document.createElement('img');
            img.src = photo.url;
            img.alt = photo.caption || 'Game photo';
            img.loading = 'lazy';
            card.appendChild(img);

            if (photo.caption) {
                const caption = document.createElement('div');
                caption.className = 'photo-caption';
                caption.textContent = photo.caption;
                card.appendChild(caption);
            }

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'photo-remove';
            remove.textContent = 'Remove';
            remove.addEventListener('click', () => deletePhoto(photo.id));
            card.appendChild(remove);

            grid.appendChild(card);
        });
    } catch (error) {
        console.error('Error loading photos:', error);
        setPhotoStatus('Could not load the photos for this game.', 'error');
    }
}

async function uploadPhoto() {
    const fileInput = document.getElementById('photoFile');
    const captionInput = document.getElementById('photoCaption');
    const button = document.getElementById('addPhotoBtn');
    const file = fileInput && fileInput.files && fileInput.files[0];

    if (!file) {
        setPhotoStatus('Choose a photo first.', 'error');
        return;
    }

    button.disabled = true;
    setPhotoStatus('Uploading photo...');

    try {
        const blob = await resizePhoto(file);
        const caption = (captionInput && captionInput.value.trim()) || '';
        const query = new URLSearchParams();
        if (caption) query.set('caption', caption);
        const queryString = query.toString();

        const response = await request(`/api/games/${gameId}/photos${queryString ? `?${queryString}` : ''}`, {
            method: 'POST',
            raw: true,
            headers: { 'Content-Type': blob.type || 'image/jpeg' },
            body: blob
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Upload failed (${response.status})`);
        }

        fileInput.value = '';
        if (captionInput) captionInput.value = '';
        setPhotoStatus('Photo added.', 'success');
        await loadPhotos();
    } catch (error) {
        console.error('Error uploading photo:', error);
        setPhotoStatus(error.message || 'Could not add that photo.', 'error');
    } finally {
        button.disabled = false;
    }
}

async function deletePhoto(photoId) {
    if (!confirm('Remove this photo?')) return;

    try {
        const response = await request(
            `/api/games/${gameId}/photos/${photoId}`, { method: 'DELETE' }
        );
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || `Delete failed (${response.status})`);
        }
        setPhotoStatus('Photo removed.', 'success');
        await loadPhotos();
    } catch (error) {
        console.error('Error deleting photo:', error);
        setPhotoStatus(error.message || 'Could not remove that photo.', 'error');
    }
}

export function setupPhotos() {
    const button = document.getElementById('addPhotoBtn');
    if (button) button.addEventListener('click', uploadPhoto);
    loadPhotos();
}

export async function loadCourtImages() {
    const list = document.getElementById('courtImageList');
    if (!list || !gameId) return;

    try {
        const response = await request(`/api/games/${gameId}/court-images`);
        const data = await response.json();
        const images = data.images || [];
        const selectedId = data.selectedImageId;

        clear(list);

        images.forEach((image) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'court-image-choice court-image-choice--photo';

            const img = document.createElement('img');
            img.src = `/api/games/${gameId}/court-images/${image.id}`;
            img.alt = 'Court image';

            const radioInput = document.createElement('input');
            radioInput.type = 'radio';
            radioInput.name = 'courtImageSelect';
            radioInput.value = image.id;
            radioInput.checked = image.isSelected;

            radioInput.addEventListener('change', () => selectCourtImage(image.id));

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'court-image-delete';
            deleteBtn.textContent = '✕';
            deleteBtn.setAttribute('aria-label', 'Delete court image');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteCourtImage(image.id);
            });

            wrapper.appendChild(img);
            wrapper.appendChild(radioInput);
            wrapper.appendChild(deleteBtn);
            list.appendChild(wrapper);
        });

        const noImageRadio = document.getElementById('noImageRadio');
        if (noImageRadio) {
            noImageRadio.checked = !selectedId;
            noImageRadio.onchange = selectNoCourtImage;
        }
    } catch (error) {
        console.error('Error loading court images:', error);
    }
}

async function uploadCourtImage() {
    const fileInput = document.getElementById('courtImageFile');
    const button = document.getElementById('uploadCourtImageBtn');
    const file = fileInput && fileInput.files && fileInput.files[0];

    if (!file) {
        setCourtImageStatus('Choose an image first.', 'error');
        return;
    }

    button.disabled = true;
    setCourtImageStatus('Uploading image...');

    try {
        const response = await request(`/api/games/${gameId}/court-images`, {
            method: 'POST',
            raw: true,
            headers: { 'Content-Type': file.type || 'image/jpeg' },
            body: file
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.error || `Upload failed (${response.status})`);
        }

        fileInput.value = '';
        setCourtImageStatus('Image added to library.', 'success');
        await loadCourtImages();
    } catch (error) {
        console.error('Error uploading court image:', error);
        setCourtImageStatus(error.message || 'Could not add that image.', 'error');
    } finally {
        button.disabled = false;
    }
}

async function selectCourtImage(imageId) {
    try {
        const response = await request(
            `/api/games/${gameId}/court-image/${imageId}`,
            { method: 'PUT' }
        );
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to select image');
        }
        setCourtImageStatus('Saved.', 'success');
        await loadCourtImages();
    } catch (error) {
        console.error('Error selecting court image:', error);
        setCourtImageStatus(error.message || 'Could not select that image.', 'error');
    }
}

async function selectNoCourtImage() {
    try {
        const response = await request(
            `/api/games/${gameId}/court-image-none`,
            { method: 'PUT' }
        );
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Failed to clear image');
        }
        setCourtImageStatus('Saved.', 'success');
        await loadCourtImages();
    } catch (error) {
        console.error('Error clearing court image:', error);
        setCourtImageStatus(error.message || 'Could not change image selection.', 'error');
    }
}

async function deleteCourtImage(imageId) {
    if (!confirm('Delete this image from the library?')) return;

    try {
        const response = await request(
            `/api/games/${gameId}/court-images/${imageId}`,
            { method: 'DELETE' }
        );
        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.error || 'Delete failed');
        }
        setCourtImageStatus('Image deleted.', 'success');
        await loadCourtImages();
    } catch (error) {
        console.error('Error deleting court image:', error);
        setCourtImageStatus(error.message || 'Could not delete that image.', 'error');
    }
}

function setCourtImageStatus(message, type) {
    const element = document.getElementById('courtImageStatus');
    if (element) {
        element.textContent = message;
        element.style.color = type === 'error' ? 'var(--danger)' : type === 'success' ? 'var(--brand)' : 'var(--text-muted)';
    }
}

export function setupCourtImages() {
    const button = document.getElementById('uploadCourtImageBtn');
    if (button) button.addEventListener('click', uploadCourtImage);
    loadCourtImages();
}

