// ========== COPY TO: routes/students.js ==========
// Add these routes to your existing student routes file

const LocationService = require('../services/locationService');
const express = require('express');
const router = express.Router();

/**
 * ✅ ROUTE 1: Check if student already granted location permission
 * GET /api/students/location/permission-status
 * 
 * Used AFTER login to decide whether to show permission popup
 * Returns: { permissionGranted: boolean, needsPermission: boolean, grantedAt: timestamp }
 */
router.get('/location/permission-status', (req, res) => {
  try {
    // Verify student is authenticated
    if (!req.session.studentId) {
      return res.status(401).json({ authenticated: false });
    }

    // Check database for existing permission
    const status = LocationService.checkLocationPermissionStatus(req.session.studentId);
    
    res.json({
      permissionGranted: status.permissionGranted,
      grantedAt: status.grantedAt,
      needsPermission: !status.permissionGranted // Frontend uses this to show popup
    });

  } catch (error) {
    console.error('Error checking location permission status:', error);
    res.status(500).json({ error: 'Failed to check permission status' });
  }
});

/**
 * ✅ ROUTE 2: Student grants location permission
 * POST /api/students/location/grant-permission
 * 
 * Body: { latitude, longitude, accuracy }
 * Called: When student allows location access in popup
 * Returns: { success: true, message: string }
 */
router.post('/location/grant-permission', (req, res) => {
  try {
    // Verify student is authenticated
    if (!req.session.studentId) {
      return res.status(401).json({ authenticated: false });
    }

    const { latitude, longitude, accuracy } = req.body;

    // VALIDATION: Check required fields
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data: latitude, longitude, or accuracy' });
    }

    // VALIDATION: Check accuracy is acceptable (< 150 meters error)
    if (accuracy > 150) {
      return res.status(400).json({ 
        error: 'GPS accuracy too poor. Please try again in an open area (away from buildings).',
        currentAccuracy: Math.round(accuracy),
        acceptableAccuracy: 150
      });
    }

    // Get request metadata
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    // Store permission in database
    const storeResult = LocationService.storeLocationPermission(
      req.session.studentId,
      'student',
      ipAddress,
      userAgent
    );

    if (!storeResult.success) {
      return res.status(500).json({ error: 'Failed to store permission' });
    }

    // Log the action for audit trail
    LocationService.logLocationAction(
      req.session.studentId,
      'student',
      latitude,
      longitude,
      accuracy,
      'login',
      ipAddress,
      true,
      'Location permission granted at login'
    );

    res.json({ 
      success: true, 
      message: '✅ Location permission stored. Welcome to the system!'
    });

  } catch (error) {
    console.error('Error granting location permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

/**
 * ✅ ROUTE 3: Student denies location permission
 * POST /api/students/location/deny-permission
 * 
 * Called: When student declines location - they cannot login
 * Returns: { success: true, message: string, redirectTo: '/login' }
 */
router.post('/location/deny-permission', (req, res) => {
  try {
    // Verify student is authenticated (from current session)
    if (!req.session.studentId) {
      return res.status(401).json({ authenticated: false });
    }

    const studentId = req.session.studentId;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // Record denial in database
    LocationService.denyLocationPermission(studentId, 'student');

    // Log the denial for audit trail
    LocationService.logLocationAction(
      studentId,
      'student',
      null,
      null,
      null,
      'login',
      ipAddress,
      false,
      'Location permission denied - access blocked'
    );

    // Destroy session - student must login again and enable location
    req.session.destroy((err) => {
      if (err) console.error('Session destruction error:', err);
      
      res.json({ 
        success: true, 
        message: '❌ Location permission is required to use the system. Please login again and enable location.',
        redirectTo: '/login'
      });
    });

  } catch (error) {
    console.error('Error denying location permission:', error);
    res.status(500).json({ error: 'Failed to deny permission' });
  }
});

/**
 * ✅ ROUTE 4: VALIDATE STUDENT LOCATION BEFORE MARKING ATTENDANCE
 * POST /api/students/validate-attendance-location
 * 
 * Body: { sessionId, latitude, longitude, accuracy }
 * Called: Before marking attendance to check if student is close to teacher
 * Returns: { isValid: boolean, distanceMeters: number, maxRadiusMeters: number, message: string }
 * 
 * This is the CRITICAL security check that prevents:
 * - Students marking attendance from home
 * - Students teleporting between locations (spoofing)
 * - Poor GPS accuracy being accepted
 */
router.post('/validate-attendance-location', (req, res) => {
  try {
    // Verify student is authenticated
    if (!req.session.studentId) {
      return res.status(401).json({ authenticated: false });
    }

    const { sessionId, latitude, longitude, accuracy } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;

    // VALIDATION 1: Check required fields
    if (!sessionId || latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing required fields: sessionId, latitude, longitude, accuracy' });
    }

    // VALIDATION 2: Check GPS accuracy acceptable
    if (!LocationService.isAccuracyAcceptable(accuracy, 150)) {
      LocationService.logLocationAction(
        req.session.studentId,
        'student',
        latitude,
        longitude,
        accuracy,
        'attendance_mark',
        ipAddress,
        false,
        `GPS accuracy too poor: ${Math.round(accuracy)}m`
      );

      return res.status(400).json({ 
        error: '📍 GPS accuracy too poor. Move to an open area (away from buildings) and try again.',
        accuracy: Math.round(accuracy),
        maxAcceptable: 150
      });
    }

    // VALIDATION 3: Check for spoofing (teleportation detection)
    const spoofCheck = LocationService.detectSpooferPatterns(
      req.session.studentId,
      latitude,
      longitude,
      'attendance_mark'
    );

    if (spoofCheck.isSuspicious) {
      // LOG FRAUD ALERT
      LocationService.logLocationAction(
        req.session.studentId,
        'student',
        latitude,
        longitude,
        accuracy,
        'attendance_mark',
        ipAddress,
        false,
        `🚨 FRAUD DETECTED: ${spoofCheck.reason}`
      );

      console.error(`🚨 SPOOFING DETECTED for ${req.session.studentId}: ${spoofCheck.reason}`);

      return res.status(403).json({ 
        error: '⚠️ Suspicious activity detected. Your location changed too fast. This might indicate GPS spoofing.',
        suspicious: true,
        details: spoofCheck
      });
    }

    // VALIDATION 4: Get teacher's location from session
    const sessionLocation = LocationService.getSessionTeacherLocation(sessionId);
    
    if (!sessionLocation) {
      return res.status(404).json({ error: 'Session location data not found. Session may have expired.' });
    }

    // VALIDATION 5: Validate student is within radius of teacher
    const validation = LocationService.validateStudentLocation(
      latitude,
      longitude,
      sessionLocation.teacher_latitude,
      sessionLocation.teacher_longitude,
      sessionLocation.max_radius_meters || 500
    );

    // Log the validation attempt (success or failure)
    LocationService.logLocationAction(
      req.session.studentId,
      'student',
      latitude,
      longitude,
      accuracy,
      'attendance_mark',
      ipAddress,
      validation.isWithinRadius,
      validation.message
    );

    // Return validation result
    res.json({
      isValid: validation.isWithinRadius,
      distanceMeters: validation.distanceMeters,
      maxRadiusMeters: validation.maxRadiusMeters,
      message: validation.message,
      teacherLocation: {
        latitude: sessionLocation.teacher_latitude,
        longitude: sessionLocation.teacher_longitude
      }
    });

  } catch (error) {
    console.error('Error validating attendance location:', error);
    res.status(500).json({ error: 'Failed to validate location. Please try again.' });
  }
});

module.exports = router;


// ========== COPY TO: routes/teachers.js ==========
// Add these routes to your existing teacher routes file

/**
 * ✅ ROUTE 5: Check if teacher already granted location permission
 * GET /api/teachers/location/permission-status
 */
router.get('/location/permission-status', (req, res) => {
  try {
    if (!req.session.teacherId) {
      return res.status(401).json({ authenticated: false });
    }

    const status = LocationService.checkLocationPermissionStatus(req.session.teacherId);
    
    res.json({
      permissionGranted: status.permissionGranted,
      grantedAt: status.grantedAt,
      needsPermission: !status.permissionGranted
    });
  } catch (error) {
    console.error('Error checking teacher location permission:', error);
    res.status(500).json({ error: 'Failed to check permission status' });
  }
});

/**
 * ✅ ROUTE 6: Teacher grants location permission
 * POST /api/teachers/location/grant-permission
 */
router.post('/location/grant-permission', (req, res) => {
  try {
    if (!req.session.teacherId) {
      return res.status(401).json({ authenticated: false });
    }

    const { latitude, longitude, accuracy } = req.body;

    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ error: 'Missing location data' });
    }

    if (accuracy > 150) {
      return res.status(400).json({ 
        error: 'Location accuracy too poor. Please try again in an open area.',
        accuracy: accuracy
      });
    }

    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'];

    LocationService.storeLocationPermission(
      req.session.teacherId,
      'teacher',
      ipAddress,
      userAgent
    );

    LocationService.logLocationAction(
      req.session.teacherId,
      'teacher',
      latitude,
      longitude,
      accuracy,
      'login',
      ipAddress,
      true,
      'Location permission granted'
    );

    res.json({ success: true, message: '✅ Location permission stored.' });

  } catch (error) {
    console.error('Error granting teacher location permission:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

/**
 * ✅ ROUTE 7: Teacher creates session - CAPTURE LOCATION
 * POST /api/teachers/generate-code
 * 
 * IMPORTANT: Modify your EXISTING generate-code endpoint to include location capture
 * Add location parameters: { latitude, longitude, accuracy }
 * 
 * This captures teacher's location when session is created.
 * This location is IMMUTABLE - used to validate all students for this session.
 */
// MODIFY YOUR EXISTING generate-code endpoint like this:
router.post('/generate-code', (req, res) => {
  try {
    if (!req.session.teacherId) {
      return res.status(401).json({ authenticated: false });
    }

    // NEW: Get location from request
    const { latitude, longitude, accuracy } = req.body;

    // VALIDATION: Check location provided
    if (latitude === undefined || longitude === undefined || accuracy === undefined) {
      return res.status(400).json({ 
        error: 'Location data required. Please enable location before generating code.' 
      });
    }

    // VALIDATION: Check accuracy
    if (accuracy > 150) {
      return res.status(400).json({ 
        error: 'Location accuracy too poor. Please try again.',
        accuracy: accuracy
      });
    }

    // [YOUR EXISTING CODE FOR GENERATING SESSION/CODE HERE]
    // After you create the session, add this:
    
    const sessionId = session.id; // From your existing code
    
    // Capture teacher's location for this session (IMMUTABLE)
    const locationResult = LocationService.captureTeacherSessionLocation(
      sessionId,
      req.session.teacherId,
      latitude,
      longitude,
      accuracy
    );

    if (!locationResult.success) {
      return res.status(500).json({ error: 'Failed to capture location' });
    }

    // Log the action
    const ipAddress = req.ip || req.connection.remoteAddress;
    LocationService.logLocationAction(
      req.session.teacherId,
      'teacher',
      latitude,
      longitude,
      accuracy,
      'session_create',
      ipAddress,
      true,
      `Session created with location. Code: ${session.code}`
    );

    // Return existing response + location info
    res.json({
      success: true,
      code: session.code,
      locationCaptured: true,
      location: {
        latitude: latitude,
        longitude: longitude,
        accuracy: accuracy
      },
      message: '✅ Code generated. Your location captured for student validation.',
      validityWindow: '5 minutes',
      studentRadiusLimit: '500 meters'
    });

  } catch (error) {
    console.error('Error generating code:', error);
    res.status(500).json({ error: 'Failed to generate code' });
  }
});

module.exports = router;
