// src/routes/LocationRoutes.js
const express = require('express');
const LocationService = require('../services/locationService');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

// All routes here are role-agnostic: they act on whoever is logged in
// (req.session.userId + req.session.role), so the same client code path
// works for both students and teachers.

// Check if the logged-in user has already granted location permission.
router.get('/location/permission-status', requireAuth, async (req, res) => {
  try {
    const status = await LocationService.checkLocationPermissionStatus(req.session.userId, req.session.role);
    res.json({
      permissionGranted: status.permissionGranted,
      needsPermission: !status.permissionGranted,
      grantedAt: status.grantedAt,
    });
  } catch (error) {
    console.error('Error checking permission:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

// User allows the location prompt.
router.post('/location/grant-permission', requireAuth, async (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;

    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data' });
    }
    if (!LocationService.isAccuracyAcceptable(accuracy, 150)) {
      return res.status(400).json({ error: 'GPS accuracy too poor. Please try again outdoors or near a window.', accuracy });
    }

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    await LocationService.storeLocationPermission(req.session.userId, req.session.role, ipAddress, userAgent);
    await LocationService.logLocationAction(
      req.session.userId, req.session.role, latitude, longitude, accuracy,
      'login', ipAddress, true, 'Permission granted at login'
    );

    res.json({ success: true, message: 'Location permission stored' });
  } catch (error) {
    console.error('Error granting permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

// User declines the location prompt -> session is destroyed, login is refused.
router.post('/location/deny-permission', requireAuth, async (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userType = req.session.role;

    await LocationService.denyLocationPermission(req.session.userId, userType);
    await LocationService.logLocationAction(
      req.session.userId, userType, null, null, null,
      'login', ipAddress, false, 'Permission denied'
    );

    req.session.destroy((err) => {
      if (err) console.error('Error destroying session after location denial:', err);
      res.clearCookie('connect.sid');
      res.json({ success: true, message: 'Location permission denied', redirectTo: '/' });
    });
  } catch (error) {
    console.error('Error denying permission:', error);
    res.status(500).json({ error: 'Failed to deny permission' });
  }
});

module.exports = router;