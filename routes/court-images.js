// Court images: the picture shown at the top of a game page.
//
// Two things share this file because they share a table. The *library* is keyed by court name,
// so every game at that court draws from the same set of photos. The *selection* is keyed by
// game, so two games at one court can show different pictures. Getting those two mixed up is
// the easiest mistake to make here - verify/court-images.js checks the distinction directly.

const express = require('express');

const {
  saveCourtImage,
  getCourtImage,
  getAllCourtImages,
  saveCourtImageToLibrary,
  getCourtImagesLibrary,
  getCourtImageFromLibrary,
  deleteCourtImageFromLibrary,
  setGameCourtImage,
  getGameCourtImageId,
  getGame
} = require('../database');

const { routeFailed } = require('../utils/route-error');
const { isHost } = require('../utils/host-auth');
const { PHOTO_TYPES, sniffImageType } = require('../utils/image-type');
const { requireDevAuth } = require('./dev');

module.exports = function mountCourtImageRoutes(app) {
  // Court images (dev only). Uses the developer area's own sign-in rather than a second copy of
  // the password check: that one compared the password with !== instead of a timing-safe compare,
  // and took it from the query string, where it ends up in server logs and browser history.
  app.post(
    '/api/courts/:courtName/image',
    requireDevAuth,
    express.raw({ type: PHOTO_TYPES, limit: '5mb' }),
    async (req, res) => {
      try {
        const courtName = decodeURIComponent(req.params.courtName);
        const mimeType = sniffImageType(req.body);
        if (!mimeType) {
          return res.status(400).json({
            error: 'That does not look like a JPEG, PNG or WebP image. Please pick a photo.'
          });
        }

        await saveCourtImage(courtName, mimeType, req.body);
        res.status(201).json({ success: true, courtName });
      } catch (error) {
        routeFailed(req, res, error, 'Failed to save court image');
      }
    }
  );

  app.get('/api/courts/:courtName/image', async (req, res) => {
    try {
      const courtName = decodeURIComponent(req.params.courtName);
      const photo = await getCourtImage(courtName);
      if (!photo || !photo.image_data) {
        return res.status(404).json({ error: 'No image for this court' });
      }
      res.set('Content-Type', photo.image_mime_type);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(photo.image_data);
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load court image');
    }
  });

  app.get('/api/courts/images/list', async (req, res) => {
    try {
      const images = await getAllCourtImages();
      res.json({ courts: images });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load court images');
    }
  });

  app.get('/api/courts/:courtName/library', async (req, res) => {
    try {
      const courtName = decodeURIComponent(req.params.courtName);
      const images = await getCourtImagesLibrary(courtName);
      res.json({
        images: images.map((img) => ({
          id: img.id,
          mimeType: img.mime_type,
          createdAt: img.created_at
        }))
      });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load court images');
    }
  });

  app.get('/api/court-images/:imageId', async (req, res) => {
    try {
      const image = await getCourtImageFromLibrary(req.params.imageId);
      if (!image || !image.image_data) {
        return res.status(404).json({ error: 'Image not found' });
      }
      res.set('Content-Type', image.mime_type);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(image.image_data);
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load court image');
    }
  });

  // Court image library (host-managed images for a specific court)
  app.post(
    '/api/games/:id/court-images',
    express.raw({ type: PHOTO_TYPES, limit: '5mb' }),
    async (req, res) => {
      try {
        const gameId = req.params.id;
        const token = req.query.token;

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

        const imageId = await saveCourtImageToLibrary(game.location, mimeType, req.body);
        res.status(201).json({ success: true, imageId });
      } catch (error) {
        routeFailed(req, res, error, 'Failed to upload court image');
      }
    }
  );

  app.get('/api/games/:id/court-images', async (req, res) => {
    try {
      const gameId = req.params.id;
      const game = await getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }

      const images = await getCourtImagesLibrary(game.location);
      const selectedImageId = await getGameCourtImageId(gameId);

      res.json({
        images: images.map((img) => ({
          id: img.id,
          mimeType: img.mime_type,
          isSelected: img.id === selectedImageId,
          createdAt: img.created_at
        })),
        selectedImageId
      });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load court images');
    }
  });

  app.get('/api/games/:id/court-images/:imageId', async (req, res) => {
    try {
      const image = await getCourtImageFromLibrary(req.params.imageId);
      if (!image || !image.image_data) {
        return res.status(404).json({ error: 'Image not found' });
      }
      res.set('Content-Type', image.mime_type);
      res.set('Cache-Control', 'public, max-age=86400');
      res.send(image.image_data);
    } catch (error) {
      routeFailed(req, res, error, 'Failed to load court image');
    }
  });

  app.put('/api/games/:id/court-image/:imageId', async (req, res) => {
    try {
      const gameId = req.params.id;
      const imageId = req.params.imageId;
      const token = req.query.token;

      const game = await getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (!isHost(game, token)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await setGameCourtImage(gameId, imageId);
      res.json({ success: true });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to select court image');
    }
  });

  app.put('/api/games/:id/court-image-none', async (req, res) => {
    try {
      const gameId = req.params.id;
      const token = req.query.token;

      const game = await getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (!isHost(game, token)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await setGameCourtImage(gameId, null);
      res.json({ success: true });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to clear court image');
    }
  });

  app.delete('/api/games/:id/court-images/:imageId', async (req, res) => {
    try {
      const gameId = req.params.id;
      const imageId = req.params.imageId;
      const token = req.query.token;

      const game = await getGame(gameId);
      if (!game) {
        return res.status(404).json({ error: 'Game not found' });
      }
      if (!isHost(game, token)) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      await deleteCourtImageFromLibrary(imageId);
      res.json({ success: true });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to delete court image');
    }
  });
};
