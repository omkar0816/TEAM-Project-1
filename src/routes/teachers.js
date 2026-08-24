const express = require('express');
const router = express.Router();
const LocationService = require('../services/locationService');

router.get('/location/permission-status', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'teacher') {
      return res.status(401).json({ authenticated: false });
    }

    const status = await LocationService.checkLocationPermissionStatus(req.session.userId, 'teacher');
    res.json({
      permissionGranted: status.permissionGranted,
      grantedAt: status.grantedAt,
      needsPermission: !status.permissionGranted,
    });
  } catch (error) {
    console.error('Error checking teacher location permission:', error);
    res.status(500).json({ error: 'Failed to check permission status' });
  }
});

router.post('/location/grant-permission', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'teacher') {
      return res.status(401).json({ authenticated: false });
    }

    const { latitude, longitude, accuracy } = req.body;
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data' });
    }
    if (!LocationService.isAccuracyAcceptable(accuracy, 150)) {
      return res.status(400).json({ error: 'GPS accuracy too poor. Please try again outdoors.', accuracy });
    }

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    await LocationService.storeLocationPermission(req.session.userId, 'teacher', ipAddress, userAgent);
    await LocationService.logLocationAction(
      req.session.userId,
      'teacher',
      latitude,
      longitude,
      accuracy,
      'login',
      ipAddress,
      true,
      'Permission granted'
    );

    res.json({ success: true, message: 'Location permission granted' });
  } catch (error) {
    console.error('Error granting teacher location permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

router.post('/location/deny-permission', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'teacher') {
      return res.status(401).json({ authenticated: false });
    }

    const ipAddress = req.ip || req.connection.remoteAddress;
    await LocationService.denyLocationPermission(req.session.userId, 'teacher');
    await LocationService.logLocationAction(
      req.session.userId,
      'teacher',
      null,
      null,
      null,
      'login',
      ipAddress,
      false,
      'Permission denied'
    );

    req.session.destroy(() => {
      res.json({ success: true, message: 'Location permission required', redirectTo: '/' });
    });
  } catch (error) {
    console.error('Error denying teacher location permission:', error);
    res.status(500).json({ error: 'Failed to deny permission' });
  }
});

module.exports = router;
