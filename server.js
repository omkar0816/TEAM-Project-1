require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const { db } = require('./src/models/database');
const TursoSessionStore = require('./src/services/sessionStore');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;

// If running behind a proxy (common in cloud deployments),
app.set('trust proxy', 1);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  store: new TursoSessionStore(db),
  secret: process.env.SESSION_SECRET || 'wadia-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // true in production with HTTPS
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 30 * 60 * 1000 // 30 minutes inactivity
  }
}));


app.use(express.static(path.join(__dirname)));

// Rate limiting middleware
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per IP
  message: { success: false, message: 'Too many login attempts. Please try again later.' },
  standardHeaders: false,
  legacyHeaders: false,
});

const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 attempts per minute per session
  keyGenerator: (req) => req.session.userId || req.ip,
  message: { success: false, message: 'Too many attendance attempts. Please try again later.' },
  standardHeaders: false,
  legacyHeaders: false,
});

// Utility function to calculate distance between two coordinates
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Routes

// login page
app.get('/', (req, res) => {
  if (req.session.userId) {
    // If logged in, redirect to dashboard or refresh 
    if (req.session.role === 'teacher') {
      res.sendFile(path.join(__dirname, 'teacher.html')); // We'll create this
    } else {
      res.sendFile(path.join(__dirname, 'student.html')); // We'll create this
    }
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// Login
app.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = validateInput(req.body.email, 'email', 100);
    const password = String(req.body.password || '').trim();
    const prn = req.body.prn ? validateInput(req.body.prn, 'prn') : '';

    if (!email || !password || password.length < 6) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    // Check teachers table first
    let user = null;
    let userType = null;

    const teacherResult = await db.execute('SELECT * FROM teachers WHERE email = ?', [email]);
    if (teacherResult.rows.length > 0) {
      user = teacherResult.rows[0];
      userType = 'teacher';
    } else {
      // Check students table
      const studentResult = await db.execute('SELECT * FROM students WHERE email = ?', [email]);
      if (studentResult.rows.length > 0) {
        user = studentResult.rows[0];
        userType = 'student';

        // For students, verify PRN if provided
        if (prn && user.prn !== prn) {
          return res.json({ success: false, message: 'PRN does not match your account.' });
        }
      }
    }

    if (!user) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    // Verify password
    let passwordMatch = false;
    if (userType === 'teacher') {
      passwordMatch = await bcrypt.compare(password, user.password_hash);
    } else {
      // Students don't have passwords in new schema - they use PRN for verification
      // This is a temporary measure - in production, students should have separate auth
      passwordMatch = true; // Allow login for now
    }

    if (!passwordMatch) {
      return res.json({ success: false, message: 'Invalid credentials' });
    }

    // Set session
    req.session.userId = user.id;
    req.session.userType = userType;
    req.session.email = user.email;

    // Update last login for teachers
    if (userType === 'teacher') {
      await db.execute('UPDATE teachers SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);

      // Force password change if not changed yet
      if (!user.password_changed) {
        return res.json({
          success: true,
          redirect: '/change-password',
          message: 'Please change your default password.'
        });
      }
    }

    // Log audit event
    await logAudit(user.id, userType, 'LOGIN', `User logged in from ${req.ip}`, req);

    res.json({
      success: true,
      userType: userType,
      redirect: userType === 'teacher' ? '/teacher' : '/student'
    });

  } catch (error) {
    console.error('Login error:', error);
    res.json({ success: false, message: 'Login failed. Please try again.' });
  }
});

// Signup
app.post('/signup', async (req, res) => {
  const role = req.body.role;
  const firstName = req.body.firstName ? req.body.firstName.trim() : '';
  const lastName = req.body.lastName ? req.body.lastName.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password ? req.body.password.trim() : '';
  const prn = req.body.prn ? req.body.prn.trim() : '';
  const year = req.body.year ? req.body.year.trim() : '';
  const department = req.body.department ? req.body.department.trim() : '';
  const empId = req.body.empId ? req.body.empId.trim() : '';
  const subject = '';

  if (!role || !email || !password) {
    return res.status(400).json({ success: false, message: 'Role, email, and password are required' });
  }
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    if (role === 'student') {
      if (!prn) {
        return res.status(400).json({ success: false, message: 'PRN is required for students' });
      }
      if (!year) {
        return res.status(400).json({ success: false, message: 'Year is required for students' });
      }
      if (!department) {
        return res.status(400).json({ success: false, message: 'Department is required for students' });
      }
      await db.execute('INSERT INTO users (email, password, role, first_name, last_name, prn, year, department) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [email, hashedPassword, role, firstName, lastName, prn, year, department]);
    } else {
      await db.execute('INSERT INTO users (email, password, role, first_name, last_name, emp_id, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [email, hashedPassword, role, firstName, lastName, empId, subject]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Signup error:', err.message);
    
    let message = 'Registration failed';
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      message = 'Email already registered. Please log in instead.';
    } else if (err.message && (err.message.includes('UNIQUE constraint failed: users.prn') || err.message.includes('UNIQUE constraint failed: users.PRN'))) {
      message = 'This PRN is already registered.';
    } else if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
      message = 'Invalid PRN or Roll Number. Please enter a valid PRN from your enrollment records.';
    }
    
    res.status(400).json({ success: false, message });
  }
});

// Change password route
app.post('/change-password', async (req, res) => {
  try {
    if (!req.session.userId || req.session.userType !== 'teacher') {
      return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const { currentPassword, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.json({ success: false, message: 'New password must be at least 8 characters long' });
    }

    // Get current teacher
    const result = await db.execute('SELECT password_hash FROM teachers WHERE id = ?', [req.session.userId]);
    const teacher = result.rows[0];

    if (!teacher) {
      return res.json({ success: false, message: 'Teacher not found' });
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, teacher.password_hash);
    if (!isValid) {
      return res.json({ success: false, message: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and mark as changed
    await db.execute(
      'UPDATE teachers SET password_hash = ?, password_changed = ? WHERE id = ?',
      [hashedPassword, true, req.session.userId]
    );

    // Log audit event
    await logAudit(req.session.userId, 'teacher', 'PASSWORD_CHANGE', 'Password changed successfully', req);

    res.json({ success: true, message: 'Password changed successfully' });

  } catch (error) {
    console.error('Password change error:', error);
    res.json({ success: false, message: 'Failed to change password' });
  }
});

// Logout
app.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// Check session
app.get('/check-session', (req, res) => {
  res.json({ loggedIn: !!req.session.userId, role: req.session.role });
});

app.get('/profile', async (req, res) => {
  if (!req.session.userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await db.execute('SELECT id, email, role, first_name, last_name, department, subject, emp_id FROM users WHERE id = ?', [req.session.userId]);
    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    res.json(user);
  } catch (err) {
    console.error('Profile error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Generate attendance session (for teachers)
app.post('/generate-session', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const { subject, class: className, department, semester } = req.body;

    if (!subject || !className || !department || !semester) {
      return res.json({ success: false, message: 'All fields are required' });
    }

    // Get teacher info
    const teacherResult = await db.execute('SELECT name, department FROM teachers WHERE id = ?', [req.session.userId]);
    const teacher = teacherResult.rows[0];

    if (!teacher) {
      return res.json({ success: false, message: 'Teacher not found' });
    }

    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + 50 * 1000).toISOString(); // 50 seconds from now

    // Create attendance session
    await db.execute(`
      INSERT INTO attendance_sessions (id, teacher_id, subject_id, class, department, semester, expires_at)
      VALUES (?, ?, (SELECT id FROM subjects WHERE name = ? LIMIT 1), ?, ?, ?, ?)
    `, [sessionId, req.session.userId, subject, className, department, semester, expiresAt]);

    // Log audit event
    await logAudit(req.session.userId, 'teacher', 'CREATE_SESSION',
      `Created attendance session for ${subject} - ${className}`, req);

    res.json({
      success: true,
      sessionId,
      subject,
      class: className,
      expiresAt
    });

  } catch (error) {
    console.error('Generate session error:', error);
    res.json({ success: false, message: 'Failed to create attendance session' });
  }
});

// Mark attendance (for students)
app.post('/mark-attendance', async (req, res) => {
  const { sessionId, deviceFingerprint, latitude, longitude } = req.body;

  if (!sessionId) {
    return res.json({ success: false, message: 'Invalid session ID' });
  }

  if (!req.session.userId || req.session.userType !== 'student') {
    return res.json({ success: false, message: 'Please log in as a student first' });
  }

  try {
    // Check if session is valid and not expired
    const sessionResult = await db.execute(`
      SELECT * FROM attendance_sessions
      WHERE id = ? AND expires_at > CURRENT_TIMESTAMP
    `, [sessionId]);

    const session = sessionResult.rows[0];
    if (!session) {
      return res.json({ success: false, message: 'Session expired or invalid' });
    }

    // Device lock: Check if this device has already marked attendance for this session
    if (deviceFingerprint) {
      const deviceCheck = await db.execute(`
        SELECT id FROM attendance_records
        WHERE session_id = ? AND device_fingerprint = ?
      `, [sessionId, deviceFingerprint]);

      if (deviceCheck.rows.length > 0) {
        await logAudit(req.session.userId, 'student', 'ATTENDANCE_BLOCKED',
          `Blocked duplicate attendance from same device for session ${sessionId}`, req);
        return res.json({ success: false, message: 'Attendance already marked from this device' });
      }
    }

    // Location check (basic campus boundary check - example coordinates)
    // Wadia College approximate coordinates: 19.0178° N, 72.8562° E
    const CAMPUS_LAT = 19.0178;
    const CAMPUS_LNG = 72.8562;
    const MAX_DISTANCE_KM = 0.5; // 500 meters radius

    if (latitude && longitude) {
      const distance = calculateDistance(latitude, longitude, CAMPUS_LAT, CAMPUS_LNG);
      if (distance > MAX_DISTANCE_KM) {
        await logAudit(req.session.userId, 'student', 'LOCATION_BLOCKED',
          `Blocked attendance from outside campus (distance: ${distance.toFixed(2)}km)`, req);
        return res.json({ success: false, message: 'Attendance must be marked within campus premises' });
      }
    }

    // Check if student already marked attendance for this session
    const existingResult = await db.execute(`
      SELECT id FROM attendance_records
      WHERE student_id = ? AND session_id = ?
    `, [req.session.userId, sessionId]);

    if (existingResult.rows.length > 0) {
      return res.json({ success: false, message: 'Attendance already marked for this session' });
    }

    // Insert attendance record
    await db.execute(`
      INSERT INTO attendance_records
      (student_id, session_id, device_fingerprint, ip_address, user_agent, location_lat, location_lng)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [
      req.session.userId,
      sessionId,
      deviceFingerprint || req.get('User-Agent'),
      req.ip,
      req.get('User-Agent'),
      latitude || null,
      longitude || null
    ]);

    // Log audit event
    await logAudit(req.session.userId, 'student', 'MARK_ATTENDANCE',
      `Marked attendance for session ${sessionId}`, req);

    res.json({ success: true, message: 'Attendance marked successfully!' });

  } catch (error) {
    console.error('Mark attendance error:', error);
    res.json({ success: false, message: 'Failed to mark attendance' });
  }
});

// POST version for AJAX
app.post('/mark-attendance-post', attendanceLimiter, async (req, res) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).send('Unauthorized');
  }
  try {
    const code = validateInput(req.body.code, 'number-code');
    const studentId = req.session.userId;
    const now = Math.floor(Date.now() / 1000);
    
    // Validate code exists and is not expired
    const codeResult = await db.execute('SELECT id, teacher_id FROM qr_codes WHERE id = ? AND expires_at > ?', [code, now]);
    if (!codeResult.rows[0]) {
      return res.send('Code expired or invalid');
    }
    
    // Validate student exists and is not already marked for this code
    const studentResult = await db.execute('SELECT id FROM users WHERE id = ? AND role = \'student\'', [studentId]);
    if (!studentResult.rows[0]) {
      return res.status(403).send('Unauthorized or student not found');
    }
    
    // Insert attendance with proper error handling
    try {
      await db.execute('INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)', [studentId, code]);
      res.send('Marked!');
    } catch (insertErr) {
      if (insertErr.message && insertErr.message.includes('UNIQUE constraint failed')) {
        return res.send('Already marked attendance for this code.');
      }
      throw insertErr;
    }
  } catch (err) {
    console.error('Mark attendance post error:', err.message);
    res.status(400).send('Invalid code format or error: ' + err.message);
  }
});

// Get all sessions for teacher
app.get('/sessions', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const result = await db.execute(`
      SELECT s.id, s.class, s.department, s.semester, s.created_at, s.expires_at,
             sub.name as subject,
             (SELECT COUNT(*) FROM attendance_records WHERE session_id = s.id) as attendance_count
      FROM attendance_sessions s
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE s.teacher_id = ?
      ORDER BY s.created_at DESC
    `, [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Sessions error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get attendance for a specific session
app.get('/session-attendance', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  try {
    // First verify the session belongs to this teacher
    const sessionResult = await db.execute(`
      SELECT s.*, sub.name as subject_name
      FROM attendance_sessions s
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE s.id = ? AND s.teacher_id = ?
    `, [sessionId, req.session.userId]);

    const session = sessionResult.rows[0];
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get all attendance for this session
    const attendanceResult = await db.execute(`
      SELECT st.name, st.prn, st.roll_no, st.email, ar.marked_at
      FROM attendance_records ar
      JOIN students st ON ar.student_id = st.id
      WHERE ar.session_id = ?
      ORDER BY ar.marked_at ASC
    `, [sessionId]);

    res.json({
      session: session,
      students: attendanceResult.rows
    });
  } catch (err) {
    console.error('Session attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get live count and student list for active session
app.get('/live-count', async (req, res) => {
  const { sessionId } = req.query;
  if (!sessionId) {
    return res.status(400).json({ error: 'Session ID required' });
  }

  try {
    const sessionResult = await db.execute(`
      SELECT id FROM attendance_sessions
      WHERE id = ? AND expires_at > CURRENT_TIMESTAMP
    `, [sessionId]);

    const session = sessionResult.rows[0];
    if (!session) {
      return res.json({ count: 0, students: [] });
    }

    const attendanceResult = await db.execute(`
      SELECT st.name, st.prn, ar.marked_at
      FROM attendance_records ar
      JOIN students st ON ar.student_id = st.id
      WHERE ar.session_id = ?
      ORDER BY ar.marked_at ASC
    `, [sessionId]);

    res.json({ count: attendanceResult.rows.length, students: attendanceResult.rows });
  } catch (err) {
    console.error('Live count error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Teacher dashboard analytics
app.get('/teacher-analytics', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const teacherId = req.session.userId;

    // Total sessions created
    const sessionsResult = await db.execute(
      'SELECT COUNT(*) as total FROM attendance_sessions WHERE teacher_id = ?',
      [teacherId]
    );
    const totalSessions = sessionsResult.rows[0]?.total || 0;

    // Total attendance marked
    const attendanceResult = await db.execute(`
      SELECT COUNT(*) as total FROM attendance_records ar
      JOIN attendance_sessions s ON ar.session_id = s.id
      WHERE s.teacher_id = ?
    `, [teacherId]);
    const totalAttendance = attendanceResult.rows[0]?.total || 0;

    // Unique students reached
    const studentsResult = await db.execute(`
      SELECT COUNT(DISTINCT ar.student_id) as total FROM attendance_records ar
      JOIN attendance_sessions s ON ar.session_id = s.id
      WHERE s.teacher_id = ?
    `, [teacherId]);
    const uniqueStudents = studentsResult.rows[0]?.total || 0;

    // Subject-wise breakdown
    const subjectBreakdown = await db.execute(`
      SELECT sub.name as subject, COUNT(ar.id) as attendance_count,
             COUNT(DISTINCT ar.student_id) as student_count
      FROM attendance_records ar
      JOIN attendance_sessions s ON ar.session_id = s.id
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      WHERE s.teacher_id = ?
      GROUP BY sub.name
      ORDER BY attendance_count DESC
    `, [teacherId]);

    // Recent sessions with attendance counts
    const recentSessions = await db.execute(`
      SELECT s.id, s.class, s.created_at, sub.name as subject,
             COUNT(ar.id) as attendance_count
      FROM attendance_sessions s
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      LEFT JOIN attendance_records ar ON s.id = ar.session_id
      WHERE s.teacher_id = ?
      GROUP BY s.id, s.class, s.created_at, sub.name
      ORDER BY s.created_at DESC
      LIMIT 10
    `, [teacherId]);

    // Low attendance students (less than 75% of sessions)
    const lowAttendanceStudents = await db.execute(`
      SELECT st.name, st.prn, st.roll_no,
             COUNT(ar.id) as attended_sessions,
             ROUND(CAST(COUNT(ar.id) AS FLOAT) / NULLIF((
               SELECT COUNT(*) FROM attendance_sessions
               WHERE teacher_id = ? AND class = st.class
             ), 0) * 100, 1) as attendance_percentage
      FROM students st
      LEFT JOIN attendance_records ar ON st.id = ar.student_id
      LEFT JOIN attendance_sessions s ON ar.session_id = s.id AND s.teacher_id = ?
      GROUP BY st.id, st.name, st.prn, st.roll_no, st.class
      HAVING attendance_percentage < 75 OR attendance_percentage IS NULL
      ORDER BY attendance_percentage ASC
      LIMIT 20
    `, [teacherId, teacherId]);

    res.json({
      overview: {
        totalSessions,
        totalAttendance,
        uniqueStudents,
        averageAttendance: totalSessions > 0 ? Math.round((totalAttendance / totalSessions) * 100) / 100 : 0
      },
      subjectBreakdown: subjectBreakdown.rows,
      recentSessions: recentSessions.rows,
      lowAttendanceStudents: lowAttendanceStudents.rows
    });

  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to load analytics' });
  }
});

// Get attendance for teacher dashboard
app.get('/attendance', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const teacherId = req.session.userId;
  try {
    const result = await db.execute(`
      SELECT ar.marked_at, s.class, s.department, sub.name as subject,
             st.name as student_name, st.prn, st.roll_no, st.email
      FROM attendance_records ar
      JOIN attendance_sessions s ON ar.session_id = s.id
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      JOIN students st ON ar.student_id = st.id
      WHERE s.teacher_id = ?
      ORDER BY ar.marked_at DESC
      LIMIT 100
    `, [teacherId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get attendance for student
app.get('/my-attendance', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await db.execute(`
      SELECT ar.marked_at, s.class, s.department, sub.name as subject,
             t.name as teacher_name
      FROM attendance_records ar
      JOIN attendance_sessions s ON ar.session_id = s.id
      LEFT JOIN subjects sub ON s.subject_id = sub.id
      JOIN teachers t ON s.teacher_id = t.id
      WHERE ar.student_id = ?
      ORDER BY ar.marked_at DESC
    `, [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('My attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Student session history and attendance details - ONLY show sessions from classes the student is enrolled in
app.get('/my-sessions', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    // SECURITY FIX: Only show sessions from classes where the student has attended at least one lecture
    // Without a proper class enrollment system, this prevents exposing all college schedules
    const result = await db.execute(`
      SELECT DISTINCT q.id as code, q.subject, q.created_at, q.expires_at,
             CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as present,
             u.first_name as teacher_fname, u.last_name as teacher_lname
      FROM qr_codes q
      INNER JOIN users u ON q.teacher_id = u.id
      LEFT JOIN attendance a ON q.id = a.qr_id AND a.student_id = ?
      WHERE q.teacher_id IN (
        SELECT DISTINCT q2.teacher_id FROM qr_codes q2
        INNER JOIN attendance a2 ON q2.id = a2.qr_id
        WHERE a2.student_id = ?
      )
      ORDER BY q.created_at DESC
    `, [req.session.userId, req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('My sessions error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Student stats for monthly and overall attendance
app.get('/my-stats', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const totalResult = await db.execute({
      sql: `SELECT COUNT(*) AS total FROM qr_codes
            WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')`,
      args: []
    });

    const attendedResult = await db.execute({
      sql: `SELECT COUNT(*) AS attended FROM attendance a
            JOIN qr_codes q ON a.qr_id = q.id
            WHERE a.student_id = ?
              AND strftime('%Y-%m', q.created_at) = strftime('%Y-%m', 'now', 'localtime')`,
      args: [req.session.userId]
    });

    const allTimeTotal = await db.execute({
      sql: `SELECT COUNT(*) AS total FROM qr_codes`,
      args: []
    });

    const allTimeAttended = await db.execute({
      sql: `SELECT COUNT(*) AS attended FROM attendance WHERE student_id = ?`,
      args: [req.session.userId]
    });

    const monthlyTotal = totalResult.rows[0]?.total || 0;
    const monthlyAttended = attendedResult.rows[0]?.attended || 0;
    const overallTotal = allTimeTotal.rows[0]?.total || 0;
    const overallAttended = allTimeAttended.rows[0]?.attended || 0;

    const monthly = monthlyTotal > 0 ? ((monthlyAttended / monthlyTotal) * 100).toFixed(1) : '0.0';
    const live = overallTotal > 0 ? ((overallAttended / overallTotal) * 100).toFixed(1) : '0.0';

    res.json({
      monthly,
      live,
      monthlyAttended,
      monthlyTotal,
      overallAttended,
      overallTotal
    });
  } catch (err) {
    console.error('My stats error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Assignments
app.post('/assignments', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { title, description, due_date } = req.body;
  if (!title) {
    return res.status(400).json({ error: 'Title is required' });
  }
  try {
    await db.execute({
      sql: `INSERT INTO assignments (title, description, due_date, created_by) VALUES (?, ?, ?, ?)`,
      args: [title, description || '', due_date || null, req.session.userId]
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Add assignment error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/assignments', async (req, res) => {
  if (!req.session.userId) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await db.execute({
      sql: `SELECT id, title, description, due_date, created_by FROM assignments WHERE created_by = ? ORDER BY due_date ASC`,
      args: [req.session.userId]
    });
    res.json(result.rows);
  } catch (err) {
    console.error('Get assignments error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.delete('/assignments/:id', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    await db.execute({
      sql: `DELETE FROM assignments WHERE id = ?`,
      args: [req.params.id]
    });
    res.json({ success: true });
  } catch (err) {
    console.error('Delete assignment error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Excel downloads for teacher
app.get('/download/monthly-report', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const teacherResult = await db.execute({
      sql: `SELECT first_name, last_name, subject FROM users WHERE id = ?`,
      args: [req.session.userId]
    });
    const teacher = teacherResult.rows[0] || {};
    const students = await db.execute({
      sql: `SELECT id, first_name, last_name, email FROM users WHERE role = 'student' ORDER BY first_name, last_name`,
      args: []
    });
    const sessionsResult = await db.execute({
      sql: `SELECT id, subject, created_at FROM qr_codes WHERE teacher_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now','localtime') ORDER BY created_at`,
      args: [req.session.userId]
    });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Monthly Report');
    sheet.addRow(['Teacher', `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim()]);
    sheet.addRow(['Subject', teacher.subject || 'N/A']);
    sheet.addRow(['Month', new Date().toLocaleString('default', { month: 'long', year: 'numeric' })]);
    sheet.addRow([]);
    const headers = ['Name', 'Email', ...sessionsResult.rows.map(s => `${new Date(s.created_at).toLocaleDateString()} (${s.subject || 'Lecture'})`), 'Attendance %'];
    sheet.addRow(headers);
    sheet.getRow(5).font = { bold: true };

    const sessionCodes = sessionsResult.rows.map(s => s.id);
    for (const student of students.rows) {
      const attendedCodes = new Set();
      if (sessionCodes.length > 0) {
        const attended = await db.execute({
          sql: `SELECT qr_id FROM attendance WHERE student_id = ? AND qr_id IN (${sessionCodes.map(() => '?').join(',')})`,
          args: [student.id, ...sessionCodes]
        });
        attended.rows.forEach(row => attendedCodes.add(row.qr_id));
      }
      const row = [
        `${student.first_name || ''} ${student.last_name || ''}`.trim(),
        student.email,
        ...sessionCodes.map(code => attendedCodes.has(code) ? '✅' : '❌'),
        sessionCodes.length > 0 ? ((attendedCodes.size / sessionCodes.length) * 100).toFixed(1) + '%' : '0%'
      ];
      sheet.addRow(row);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=monthly-report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Monthly report error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

app.get('/download/lecture/:code', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const code = req.params.code;
    const sessionResult = await db.execute({
      sql: `SELECT id, subject, created_at FROM qr_codes WHERE id = ? AND teacher_id = ?`,
      args: [code, req.session.userId]
    });
    const session = sessionResult.rows[0];
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const attendedResult = await db.execute({
      sql: `SELECT u.first_name, u.last_name, u.email FROM attendance a JOIN users u ON a.student_id = u.id WHERE a.qr_id = ?`,
      args: [code]
    });
    const allStudents = await db.execute({
      sql: `SELECT first_name, last_name, email FROM users WHERE role = 'student' ORDER BY first_name, last_name`,
      args: []
    });

    const teacherProfile = await db.execute({
      sql: `SELECT first_name, last_name FROM users WHERE id = ?`,
      args: [req.session.userId]
    });
    const teacherName = teacherProfile.rows[0] ? `${teacherProfile.rows[0].first_name || ''} ${teacherProfile.rows[0].last_name || ''}`.trim() : 'Teacher';
    const attendedEmails = new Set(attendedResult.rows.map(r => r.email));
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Lecture Attendance');
    sheet.addRow(['Teacher', teacherName]);
    sheet.addRow(['Subject', session.subject || 'Lecture']);
    sheet.addRow(['Date', new Date(session.created_at).toLocaleString()]);
    sheet.addRow([]);
    sheet.addRow(['Name', 'Email', 'Status']);
    sheet.getRow(5).font = { bold: true };

    for (const s of allStudents.rows) {
      sheet.addRow([`${s.first_name || ''} ${s.last_name || ''}`.trim(), s.email, attendedEmails.has(s.email) ? 'Present' : 'Absent']);
    }

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=lecture-${code}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Lecture download error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get specific student attendance history (by PRN or email)
app.get('/student-attendance', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { email, prn } = req.query;
  if (!email && !prn) {
    return res.status(400).json({ error: 'Email or PRN required' });
  }
  try {
    const userResult = await db.execute(
      'SELECT id, first_name, last_name, email, prn FROM users WHERE role = ? AND (email = ? OR prn = ?)',
      ['student', email || '', prn || '']
    );
    const user = userResult.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'Student not found' });
    }
    const attendanceResult = await db.execute(`
      SELECT a.id, a.marked_at, q.subject, q.id as session_code
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      WHERE a.student_id = ?
      ORDER BY a.marked_at DESC
    `, [user.id]);
    res.json({
      student: user,
      attendance: attendanceResult.rows,
      total: attendanceResult.rows.length
    });
  } catch (err) {
    console.error('Student attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Add manual attendance for a student
app.post('/add-attendance', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { email, prn, session_code } = req.body;
  if (!session_code) {
    return res.status(400).json({ error: 'Session code required' });
  }
  if (!email && !prn) {
    return res.status(400).json({ error: 'Email or PRN required' });
  }
  try {
    // Find student
    const userResult = await db.execute(
      'SELECT id FROM users WHERE role = ? AND (email = ? OR prn = ?)',
      ['student', email || '', prn || '']
    );
    const student = userResult.rows[0];
    if (!student) {
      return res.status(404).json({ error: 'Student not found' });
    }
    // Verify session belongs to this teacher
    const sessionResult = await db.execute(
      'SELECT id FROM qr_codes WHERE id = ? AND teacher_id = ?',
      [session_code, req.session.userId]
    );
    if (!sessionResult.rows[0]) {
      return res.status(403).json({ error: 'Session not found or does not belong to you' });
    }
    // Add attendance (ignore if already exists)
    await db.execute(
      'INSERT OR IGNORE INTO attendance (student_id, qr_id) VALUES (?, ?)',
      [student.id, session_code]
    );
    res.json({ success: true, message: 'Attendance added for student' });
  } catch (err) {
    console.error('Add attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Delete attendance record
app.post('/delete-attendance', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { attendance_id } = req.body;
  if (!attendance_id) {
    return res.status(400).json({ error: 'Attendance ID required' });
  }
  try {
    // Verify attendance belongs to this teacher's session
    const checkResult = await db.execute(`
      SELECT a.id FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      WHERE a.id = ? AND q.teacher_id = ?
    `, [attendance_id, req.session.userId]);
    if (!checkResult.rows[0]) {
      return res.status(403).json({ error: 'Attendance record not found or unauthorized' });
    }
    // Delete attendance
    await db.execute('DELETE FROM attendance WHERE id = ?', [attendance_id]);
    res.json({ success: true, message: 'Attendance record deleted' });
  } catch (err) {
    console.error('Delete attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Database backup endpoint
app.post('/backup-database', async (req, res) => {
  if (!req.session.userId || req.session.userType !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const backupFileName = `attendance_backup_${timestamp}.sql`;

    // Export all tables data
    const tables = ['students', 'teachers', 'subjects', 'attendance_sessions', 'attendance_records', 'audit_logs'];
    let backupSQL = `-- Attendance System Database Backup\n-- Generated on ${new Date().toISOString()}\n\n`;

    for (const table of tables) {
      const result = await db.execute(`SELECT * FROM ${table}`);
      if (result.rows.length > 0) {
        backupSQL += `-- Table: ${table}\n`;
        result.rows.forEach(row => {
          const columns = Object.keys(row).join(', ');
          const values = Object.values(row).map(val =>
            val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`
          ).join(', ');
          backupSQL += `INSERT INTO ${table} (${columns}) VALUES (${values});\n`;
        });
        backupSQL += '\n';
      }
    }

    // Log backup creation
    await logAudit(req.session.userId, 'teacher', 'DATABASE_BACKUP',
      `Created database backup: ${backupFileName}`, req);

    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${backupFileName}"`);
    res.send(backupSQL);

  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ error: 'Failed to create backup' });
  }
});

// Automated daily backup (can be called by cron)
app.post('/auto-backup', async (req, res) => {
  // This endpoint can be secured with API key for automated backups
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.BACKUP_API_KEY) {
    return res.status(403).json({ error: 'Invalid API key' });
  }

  try {
    const fs = require('fs').promises;
    const path = require('path');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
    const backupFileName = `attendance_backup_${timestamp}.sql`;
    const backupDir = path.join(__dirname, 'backups');

    // Ensure backup directory exists
    await fs.mkdir(backupDir, { recursive: true });

    // Create backup SQL
    const tables = ['students', 'teachers', 'subjects', 'attendance_sessions', 'attendance_records', 'audit_logs'];
    let backupSQL = `-- Attendance System Database Backup\n-- Generated on ${new Date().toISOString()}\n\n`;

    for (const table of tables) {
      const result = await db.execute(`SELECT * FROM ${table}`);
      if (result.rows.length > 0) {
        backupSQL += `-- Table: ${table}\n`;
        result.rows.forEach(row => {
          const columns = Object.keys(row).join(', ');
          const values = Object.values(row).map(val =>
            val === null ? 'NULL' : `'${String(val).replace(/'/g, "''")}'`
          ).join(', ');
          backupSQL += `INSERT INTO ${table} (${columns}) VALUES (${values});\n`;
        });
        backupSQL += '\n';
      }
    }

    // Save to file
    const backupPath = path.join(backupDir, backupFileName);
    await fs.writeFile(backupPath, backupSQL);

    console.log(`Automated backup created: ${backupPath}`);
    res.json({ success: true, backupFile: backupFileName });

  } catch (error) {
    console.error('Auto backup error:', error);
    res.status(500).json({ error: 'Failed to create automated backup' });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

(async () => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();