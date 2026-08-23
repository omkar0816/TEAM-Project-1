const express = require('express');
const attendanceController = require('../controllers/attendanceController');
const { attendanceLimiter, codeGenerationLimiter } = require('../middleware/rateLimiters');
const requireLocationPermission = require('../middleware/requireLocationPermission');
const LocationService = require('../services/locationService');

const MAX_ATTENDANCE_RADIUS_METERS = 500;

const router = express.Router();

router.get('/health', async (req, res) => {
  try {
    const { db } = require('../models/database');
    await db.execute('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});

router.post('/generate-code', codeGenerationLimiter, requireLocationPermission, async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { subject, latitude, longitude, accuracy } = req.body;

  if (latitude === undefined || longitude === undefined || accuracy === undefined) {
    return res.status(400).json({ error: 'Location is required to generate a code. Please enable location access and try again.' });
  }
  if (!LocationService.isAccuracyAcceptable(accuracy, 150)) {
    return res.status(400).json({ error: 'GPS accuracy too poor to start a session. Please try again outdoors or near a window.', accuracy });
  }

  const SESSION_DURATION_SECONDS = 300;
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const { db } = require('../models/database');
  const teacherResult = await db.execute('SELECT subject FROM teachers WHERE id = ?', [req.session.userId]);
  const teacherInfo = teacherResult.rows[0] || {};
  const sessionSubject = subject || teacherInfo.subject || 'Lecture';
  const ipAddress = req.ip || req.connection.remoteAddress;

  const tryInsertCode = async (attempt = 0) => {
    if (attempt >= 5) {
      return res.status(500).json({ error: 'Unable to generate a unique code. Please try again.' });
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    try {
      await db.execute('INSERT INTO qr_codes (id, teacher_id, subject, expires_at) VALUES (?, ?, ?, ?)', [code, req.session.userId, sessionSubject, expiresAt]);

      // Anchor this session to the teacher's current location - every
      // student's proximity is checked against this snapshot.
      await LocationService.captureTeacherSessionLocation(
        code, req.session.userId, latitude, longitude, accuracy, MAX_ATTENDANCE_RADIUS_METERS
      );
      await LocationService.logLocationAction(
        req.session.userId, 'teacher', latitude, longitude, accuracy,
        'generate_code', ipAddress, true, `Session ${code} started`
      );

      res.json({ code, subject: sessionSubject, radiusMeters: MAX_ATTENDANCE_RADIUS_METERS });
    } catch (err) {
      if (err.message && err.message.includes('UNIQUE constraint failed')) {
        return tryInsertCode(attempt + 1);
      }
      console.error('Generate code DB error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  };

  tryInsertCode();
});

router.get('/mark-attendance', attendanceController.markAttendanceGet);
router.post('/mark-attendance-post', attendanceLimiter, attendanceController.markAttendancePost);
router.get('/sessions', attendanceController.sessions);
router.get('/session-attendance', attendanceController.sessionAttendance);
router.get('/live-count', attendanceController.liveCount);

module.exports = router;