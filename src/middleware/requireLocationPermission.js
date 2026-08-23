// src/middleware/requireLocationPermission.js
//
// Server-side gate: even if a client skips/bypasses the popup, protected
// actions (generating a code, marking attendance) refuse to run until this
// account has granted location permission. Mirrors the client-side check
// used to decide whether to show the permission popup.

const LocationService = require('../services/locationService');

function requireLocationPermission(req, res, next) {
  if (!req.session.userId || !req.session.role) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  LocationService.checkLocationPermissionStatus(req.session.userId, req.session.role)
    .then((status) => {
      if (!status.permissionGranted) {
        return res.status(403).json({
          error: 'Location permission is required to use the attendance system.',
          needsLocationPermission: true,
        });
      }
      next();
    })
    .catch((error) => {
      console.error('Error checking location permission:', error);
      res.status(500).json({ error: 'Failed to verify location permission' });
    });
}

module.exports = requireLocationPermission;