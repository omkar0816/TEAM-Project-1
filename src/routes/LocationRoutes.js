// src/routes/locationRoutes.js
const express = require('express');
const LocationService = require('../services/locationService');
const { requireAuth, requireRole } = require('../middleware/requireAuth');

const router = express.Router();

// ===== STUDENT ROUTES =====

// Check if student has granted location permission
router.get('/students/permission-status', requireAuth, requireRole('student'), (req, res) => {
  try {
    const status = LocationService.checkLocationPermissionStatus(req.session.userId);
    res.json({
      permissionGranted: status.permissionGranted,
      needsPermission: !status.permissionGranted,
      grantedAt: status.grantedAt
    });
  } catch (error) {
    console.error('Error checking permission:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

// Student grants location permission
router.post('/students/grant-permission', requireAuth, requireRole('student'), (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data' });
    }
    
    if (accuracy > 150) {
      return res.status(400).json({ error: 'GPS accuracy too poor', accuracy });
    }
    
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    LocationService.storeLocationPermission(req.session.userId, 'student', ipAddress, userAgent);
    LocationService.logLocationAction(req.session.userId, 'student', latitude, longitude, accuracy, 'login', ipAddress, true, 'Permission granted at login');
    
    res.json({ success: true, message: 'Location permission stored' });
  } catch (error) {
    console.error('Error granting permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

// Student denies location permission
router.post('/students/deny-permission', requireAuth, requireRole('student'), (req, res) => {
  try {
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    LocationService.denyLocationPermission(req.session.userId, 'student');
    LocationService.logLocationAction(req.session.userId, 'student', null, null, null, 'login', ipAddress, false, 'Permission denied');
    
    req.session.destroy();
    res.json({ success: true, message: 'Location permission denied', redirectTo: '/login' });
  } catch (error) {
    console.error('Error denying permission:', error);
    res.status(500).json({ error: 'Failed to deny permission' });
  }
});

// Validate student location before marking attendance
router.post('/validate-attendance-location', requireAuth, requireRole('student'), (req, res) => {
  try {
    const { sessionId, latitude, longitude, accuracy } = req.body;
    
    if (!sessionId || latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data' });
    }
    
    if (!LocationService.isAccuracyAcceptable(accuracy, 150)) {
      return res.status(400).json({ error: 'GPS accuracy too poor', accuracy });
    }
    
    const ipAddress = req.ip || req.connection.remoteAddress;
    
    // Check for spoofing
    const spoofCheck = LocationService.detectSpooferPatterns(req.session.userId, latitude, longitude, 'attendance_mark');
    if (spoofCheck.isSuspicious) {
      LocationService.logLocationAction(req.session.userId, 'student', latitude, longitude, accuracy, 'attendance_mark', ipAddress, false, 'FRAUD: ' + spoofCheck.reason);
      return res.status(403).json({ error: 'Suspicious activity detected', suspicious: true });
    }
    
    // Get teacher location from session
    const sessionLocation = LocationService.getSessionTeacherLocation(sessionId);
    if (!sessionLocation) {
      return res.status(404).json({ error: 'Session location not found' });
    }
    
    // Validate distance
    const validation = LocationService.validateStudentLocation(
      latitude, longitude,
      sessionLocation.teacher_latitude, sessionLocation.teacher_longitude,
      sessionLocation.max_radius_meters || 500
    );
    
    LocationService.logLocationAction(req.session.userId, 'student', latitude, longitude, accuracy, 'attendance_mark', ipAddress, validation.isWithinRadius, validation.message);
    
    res.json({
      isValid: validation.isWithinRadius,
      distanceMeters: validation.distanceMeters,
      maxRadiusMeters: validation.maxRadiusMeters,
      message: validation.message
    });
  } catch (error) {
    console.error('Error validating location:', error);
    res.status(500).json({ error: 'Failed to validate location' });
  }
});

// ===== TEACHER ROUTES =====

// Check if teacher has granted location permission
router.get('/teachers/permission-status', requireAuth, requireRole('teacher'), (req, res) => {
  try {
    const status = LocationService.checkLocationPermissionStatus(req.session.userId);
    res.json({
      permissionGranted: status.permissionGranted,
      needsPermission: !status.permissionGranted,
      grantedAt: status.grantedAt
    });
  } catch (error) {
    console.error('Error checking teacher permission:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

// Teacher grants location permission
router.post('/teachers/grant-permission', requireAuth, requireRole('teacher'), (req, res) => {
  try {
    const { latitude, longitude, accuracy } = req.body;
    
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data' });
    }
    
    if (accuracy > 150) {
      return res.status(400).json({ error: 'GPS accuracy too poor', accuracy });
    }
    
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];
    
    LocationService.storeLocationPermission(req.session.userId, 'teacher', ipAddress, userAgent);
    LocationService.logLocationAction(req.session.userId, 'teacher', latitude, longitude, accuracy, 'login', ipAddress, true, 'Teacher location permission granted');
    
    res.json({ success: true, message: 'Location permission granted' });
  } catch (error) {
    console.error('Error granting teacher permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

module.exports = router;