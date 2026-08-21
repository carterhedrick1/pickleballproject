// The courts anyone in the group has played at, for the create-game picker.
//
// Courts are remembered as a side effect of creating or editing a game rather than managed
// directly, so this is only the read side - the writes live with the game routes.

const { getLocations } = require('../database/locations-media');
const { routeFailed } = require('../utils/route-error');

module.exports = function mountLocationRoutes(app) {
  app.get('/api/locations', async (req, res) => {
    try {
      const locations = await getLocations();
      res.json({ locations });
    } catch (error) {
      routeFailed(req, res, error, 'Failed to fetch locations');
    }
  });
};
