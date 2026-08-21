// Event photos: the pictures players add to a game after it has been played.
//
// Photos live in the database because Render gives the app no persistent disk, so the bytes
// make a full round trip through Postgres (or SQLite locally) - verify/photos.js checks they
// come back identical. Photos never touch the game blob, so none of this takes the game lock.

const express = require('express');

const {
  savePhoto,
  getPhotosForGame,
  getPhoto,
  deletePhoto,
  countPhotosForGame
} = require('../database/locations-media');
const { getGame, getGameHostInfo } = require('../database/games');

const { routeFailed } = require('../utils/route-error');
const { isHost, requestHostToken } = require('../utils/host-auth');
const { PHOTO_TYPES, MAX_PHOTOS_PER_GAME, sniffImageType } = require('../utils/image-type');
const { optionalText } = require('../utils/request-validation');

// Matches the maxlength on the caption box in manage.html.
const PHOTO_CAPTION_MAX = 200;

module.exports = function mountPhotoRoutes(app) {
  // ---------------------------------------------------------------------------
  // Game photos
  //
  // Uploads arrive as a raw image body rather than multipart, which keeps this dependency-free:
  // express.raw is applied to the upload route only, and the global express.json above ignores
  // image/* bodies, so the two coexist. Photos never touch the game blob, so no game lock either.
  // ---------------------------------------------------------------------------

  app.post(
    '/api/games/:id/photos',
    express.raw({ type: PHOTO_TYPES, limit: '5mb' }),
    async (req, res) => {
      try {
        const gameId = req.params.id;
        const token = requestHostToken(req);

        const game = await getGame(gameId);
        if (!game) {
          return res.status(404).json({ error: 'Game not found' });
        }
        if (!isHost(game, token)) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        const mimeType = sniffImageType(req.body);
        if (!mimeType) {
          return res.status(400).json({
            error: 'That does not look like a JPEG, PNG or WebP image. Please pick a photo.'
          });
        }

        // The caption input is maxlength=200, so a longer one is a hand-made request. It used
        // to be silently cut in half instead of being told no. Checked before the count query
        // below, so a request that cannot succeed does not reach the database first.
        const caption = optionalText(req.query.caption, 'The caption', { max: PHOTO_CAPTION_MAX });

        // A 13th photo slipping through two simultaneous uploads is not worth a lock for.
        const existing = await countPhotosForGame(gameId);
        if (existing >= MAX_PHOTOS_PER_GAME) {
          return res.status(400).json({
            error: `This game already has ${MAX_PHOTOS_PER_GAME} photos. Remove one to add another.`
          });
        }

        const photoId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);

        await savePhoto(photoId, gameId, mimeType, req.body, caption, game.organizerName);

        res.status(201).json({
          id: photoId,
          caption,
          url: `/api/games/${gameId}/photos/${photoId}`
        });
      } catch (error) {
        routeFailed(req, res, error, 'Failed to save photo');
      }
    }
  );

  // Public, like the game page itself - anyone with the link can look at the photos.
  app.get('/api/games/:id/photos', async (req, res) => {
    try {
      const gameId = req.params.id;
      const photos = (await getPhotosForGame(gameId)).map((photo) => ({
        ...photo,
        url: `/api/games/${gameId}/photos/${photo.id}`
      }));
      res.json({ photos });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load photos');
    }
  });

  app.get('/api/games/:id/photos/:photoId', async (req, res) => {
    try {
      const photo = await getPhoto(req.params.id, req.params.photoId);
      if (!photo) {
        return res.status(404).json({ error: 'Photo not found' });
      }
      // Ids are unique and the bytes behind one never change, so this can be cached hard -
      // which also keeps the 30-requests-per-minute production limiter comfortable.
      res.set('Content-Type', photo.mimeType);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(photo.data);
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load photo');
    }
  });

  app.delete('/api/games/:id/photos/:photoId', async (req, res) => {
    try {
      const gameId = req.params.id;
      const token = requestHostToken(req);

      // getGameHostInfo rather than getGame: this only needs the token, not the whole blob.
      const hostInfo = await getGameHostInfo(gameId);
      if (!hostInfo) {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (!isHost(hostInfo, token)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const removed = await deletePhoto(gameId, req.params.photoId);
      if (!removed) {
        return res.status(404).json({ error: 'Photo not found' });
      }

      res.json({ success: true });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to delete photo');
    }
  });

};
