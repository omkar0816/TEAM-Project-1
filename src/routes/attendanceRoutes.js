const express = require('express');
const attendanceController = require('../controllers/attendanceController');
const { attendanceLimiter, codeGenerationLimiter } = require('../middleware/rateLimiters');

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

router.post('/generate-code', codeGenerationLimiter, async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { subject } = req.body;
  const SESSION_DURATION_SECONDS = 300;
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_DURATION_SECONDS;
  const { db } = require('../models/database');
  const teacherResult = await db.execute('SELECT subject FROM teachers WHERE id = ?', [req.session.userId]);
  const teacherInfo = teacherResult.rows[0] || {};
  const sessionSubject = subject || teacherInfo.subject || 'Lecture';
  const tryInsertCode = async (attempt = 0) => {
    if (attempt >= 5) {
      return res.status(500).json({ error: 'Unable to generate a unique code. Please try again.' });
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    try {
      await db.execute('INSERT INTO qr_codes (id, teacher_id, subject, expires_at) VALUES (?, ?, ?, ?)', [code, req.session.userId, sessionSubject, expiresAt]);
      res.json({ code, subject: sessionSubject });
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
