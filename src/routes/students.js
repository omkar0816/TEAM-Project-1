const express = require('express');
const router = express.Router();
const LocationService = require('../services/locationService');
const { db } = require('../models/database');

router.get('/location/permission-status', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'student') {
      return res.status(401).json({ authenticated: false });
    }

    const status = await LocationService.checkLocationPermissionStatus(req.session.userId, 'student');
    res.json({
      permissionGranted: status.permissionGranted,
      grantedAt: status.grantedAt,
      needsPermission: !status.permissionGranted,
    });
  } catch (error) {
    console.error('Error checking student location permission:', error);
    res.status(500).json({ error: 'Failed to check permission status' });
  }
});

router.post('/location/grant-permission', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'student') {
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

    await LocationService.storeLocationPermission(req.session.userId, 'student', ipAddress, userAgent);
    await LocationService.logLocationAction(
      req.session.userId,
      'student',
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
    console.error('Error granting student location permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

router.post('/location/deny-permission', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'student') {
      return res.status(401).json({ authenticated: false });
    }

    const ipAddress = req.ip || req.connection.remoteAddress;
    await LocationService.denyLocationPermission(req.session.userId, 'student');
    await LocationService.logLocationAction(
      req.session.userId, 'student', null, null, null,
      'login', ipAddress, false, 'Permission denied'
    );

    req.session.destroy(() => {
      res.json({ success: true, message: 'Location permission required', redirectTo: '/' });
    });
  } catch (error) {
    console.error('Error denying student location permission:', error);
    res.status(500).json({ error: 'Failed to deny permission' });
  }
});

router.post('/validate-attendance-location', async (req, res) => {
  try {
    if (!req.session.userId || req.session.role !== 'student') {
      return res.status(401).json({ authenticated: false });
    }

    const { sessionId, latitude, longitude, accuracy } = req.body;
    if (sessionId === undefined || latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing required location data' });
    }

    const permissionResult = await LocationService.checkLocationPermissionStatus(req.session.userId, 'student');
    if (!permissionResult.permissionGranted) {
      return res.status(403).json({ error: 'Location permission required before attendance validation.' });
    }

    if (!LocationService.isAccuracyAcceptable(accuracy, 150)) {
      return res.status(400).json({ error: 'GPS accuracy too poor. Move to an open area and try again.', accuracy });
    }

    const sessionResult = await db.execute(
      'SELECT teacher_latitude, teacher_longitude, max_radius_meters FROM session_locations WHERE session_id = ? LIMIT 1',
      [sessionId]
    );

    if (!sessionResult.rows[0]) {
      return res.status(404).json({ error: 'Session location data not found.' });
    }

    const teacher = sessionResult.rows[0];
    const validation = LocationService.validateStudentLocation(
      latitude,
      longitude,
      teacher.teacher_latitude,
      teacher.teacher_longitude,
      teacher.max_radius_meters || 500
    );

    const ipAddress = req.ip || req.connection.remoteAddress;
    await LocationService.logLocationAction(
      req.session.userId,
      'student',
      latitude,
      longitude,
      accuracy,
      'attendance',
      ipAddress,
      validation.isWithinRadius,
      validation.message
    );

    res.json({
      isValid: validation.isWithinRadius,
      distanceMeters: validation.distanceMeters,
      maxRadiusMeters: validation.maxRadiusMeters,
      message: validation.message,
    });
  } catch (error) {
    console.error('Error validating attendance location:', error);
    res.status(500).json({ error: 'Failed to validate location' });
  }
});

module.exports = router;
