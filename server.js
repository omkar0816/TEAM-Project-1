require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./database');
const TursoSessionStore = require('./sessionStore');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
const secureCookies = process.env.SESSION_COOKIE_SECURE === 'true';
const trustProxy = process.env.TRUST_PROXY === 'true';

// Utility functions
function validateInput(input, type, maxLength = 255) {
  if (!input) return '';
  
  let sanitized = String(input).trim();
  
  // Length validation
  if (sanitized.length > maxLength) {
    throw new Error(`${type} exceeds maximum length of ${maxLength} characters`);
  }
  
  // Type-specific validation
  switch (type) {
    case 'email':
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(sanitized)) {
        throw new Error('Invalid email format');
      }
      break;
    case 'prn':
      // PRN should be numeric, typically 10-12 digits
      if (!/^\d{10,12}$/.test(sanitized)) {
        throw new Error('PRN must be 10-12 digits');
      }
      break;
    case 'number-code':
      // For session codes, should be alphanumeric
      if (!/^[A-Za-z0-9]{6,}$/.test(sanitized)) {
        throw new Error('Invalid code format');
      }
      break;
  }
  
  return sanitized;
}

async function logAudit(userId, userType, action, details, req) {
  try {
    await db.execute(
      'INSERT INTO audit_logs (user_id, user_type, action, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [
        userId,
        userType,
        action,
        details,
        req.ip || req.connection.remoteAddress,
        req.get('User-Agent') || ''
      ]
    );
  } catch (error) {
    console.error('Failed to log audit event:', error);
    // Don't throw error to avoid breaking the main flow
  }
}

// If running behind a proxy (common in cloud deployments),
app.set('trust proxy', trustProxy ? 1 : 0);

// bich ka mamla
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  store: new TursoSessionStore(db),
  secret: process.env.SESSION_SECRET || 'wadia-secret-key', // Change in production
  resave: false,
  saveUninitialized: false,
  cookie: {
<<<<<<< HEAD
    secure: secureCookies,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));


app.use(express.static(path.join(__dirname)));

// Routes

// Test route
app.get('/test', (req, res) => {
  console.log('TEST ROUTE CALLED');
  res.json({ message: 'Test route works' });
});

app.post('/test-post', (req, res) => {
  console.log('TEST POST ROUTE CALLED', req.body);
  res.json({ message: 'Test POST route works', body: req.body });
});

app.get('/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});
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
app.post('/login', async (req, res) => {
  const role = req.body.role ? req.body.role.trim().toLowerCase() : 'student';
  const prn = req.body.prn ? req.body.prn.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password ? req.body.password.trim() : '';
 
  
  try {
    if (role === 'student') {
      // Student login: email + PRN (no password)
      if (!email) {
        return res.json({ success: false, message: 'Email is required for student login' });
      }
      if (!prn) {
        return res.json({ success: false, message: 'PRN is required for student login' });
      }
      
      // Validate PRN exists in personal_info table and email matches
      const prnCheck = await db.execute('SELECT EMAIL FROM personal_info WHERE PRN = ?', [prn]);
      
      if (prnCheck.rows.length === 0) {
        return res.json({ success: false, message: 'Invalid PRN. Please enter a valid PRN from your enrollment records.' });
      }
      
      if (prnCheck.rows[0].EMAIL.toLowerCase() !== email) {
        return res.json({ success: false, message: 'PRN and email do not match our records.' });
      }
      
      // Find user by email and PRN
      const result = await db.execute('SELECT * FROM users WHERE email = ? AND PRN = ? AND role = ?', [email, prn, 'student']);
      const user = result.rows[0];
      
      if (!user) {
        return res.json({ success: false, message: 'Student account not found with this email and PRN combination. Please sign up first.' });
      }
      
      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({ success: true, role: user.role });
    } else if (role === 'teacher') {
      // Teacher login: email + password
      if (!email || !password) {
        return res.json({ success: false, message: 'Email and password are required for teacher login' });
      }
      
      const result = await db.execute('SELECT * FROM users WHERE email = ? AND password = ? AND role = ?', [email, password, 'teacher']);
      const user = result.rows[0];
      
      if (user) {
        req.session.userId = user.id;
        req.session.role = user.role;
        res.json({ success: true, role: user.role });
      } else {
        res.json({ success: false, message: 'Invalid email or password for teacher account' });
      }
    } else {
      res.json({ success: false, message: 'Invalid role specified' });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Signup
app.post('/signup', async (req, res) => {
  const role = req.body.role;
  const firstName = req.body.firstName ? req.body.firstName.trim() : '';
  const lastName = req.body.lastName ? req.body.lastName.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const prn = req.body.prn ? req.body.prn.trim() : '';
  const year = req.body.year ? req.body.year.trim() : '';
  const department = req.body.department ? req.body.department.trim() : '';
  const empId = req.body.empId ? req.body.empId.trim() : '';
  const subject = '';
  const password = req.body.password ? req.body.password.trim() : '';

  if (!role || !email) {
    return res.status(400).json({ success: false, message: 'Role, email are required' });
  }
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  try {
    // For students, validate PRN exists in personal_info table and email matches
    if (role === 'student') {
      if (!prn) {
        return res.status(400).json({ success: false, message: 'PRN is required for students' });
      }
      
      // Check if PRN exists in personal_info table and email matches
      const prnCheck = await db.execute('SELECT EMAIL FROM personal_info WHERE PRN = ?', [prn]);
      
      if (prnCheck.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Invalid PRN. Please enter a valid PRN from your enrollment records.' });
      }
      
      if (prnCheck.rows[0].EMAIL.toLowerCase() !== email.toLowerCase()) {
        return res.status(400).json({ success: false, message: 'PRN and email do not match our records.' });
      }
      
      // Insert with foreign key references to personal_info
      await db.execute('INSERT INTO users ( first_name, last_name, PRN, email, role, year, department) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [firstName, lastName, prn, email, role, year, department]);
    } else {
      // For teachers, no PRN required
      await db.execute('INSERT INTO users ( first_name, last_name,role,email,password ,emp_id, subject) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [firstName, lastName, role, email, password, empId, subject]);
    }
    
    res.json({ success: true });
  } catch (err) {
    console.error('Signup error:', err.message);
    
    let message = 'Registration failed';
    if (err.message && err.message.includes('UNIQUE constraint failed: users.email')) {
      message = 'Email already registered. Please log in instead.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: users.PRN')) {
      message = 'This PRN is already registered.';
    } else if (err.message && err.message.includes('FOREIGN KEY constraint failed')) {
      message = 'Invalid PRN. Please enter a valid PRN from your enrollment records.';
    }
    
    res.status(400).json({ success: false, message });
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

// Generate Code (for teachers)
app.post('/generate-code', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { subject } = req.body;
  const expiresAt = Math.floor(Date.now() / 1000) + 50; // 50 seconds in epoch seconds
  const teacherResult = await db.execute('SELECT subject FROM users WHERE id = ?', [req.session.userId]);
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

// Mark attendance (for students)
app.get('/mark-attendance', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Invalid code');
  }
  try {
    const now = Math.floor(Date.now() / 1000);
    // Check if code is valid
    const result = await db.execute('SELECT * FROM qr_codes WHERE id = ? AND expires_at > ?', [code, now]);
    const codeRow = result.rows[0];
    if (!codeRow) {
      return res.send('Code expired or invalid');
    }
    // If student logged in, mark attendance
    if (req.session.userId && req.session.role === 'student') {
      await db.execute('INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)', [req.session.userId, code]);
      res.send('Attendance marked successfully!');
    } else {
      // If not logged in, redirect to login or show button
      res.send(`
        <h1>Mark Attendance</h1>
        <p>You need to be logged in as a student.</p>
        <a href="/">Login</a>
        <br><br>
        <button onclick="mark()">Mark Attendance</button>
        <script>
          function mark() {
            fetch('/mark-attendance-post', {
              method: 'POST',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ code: '${code}' })
            })
              .then(res => res.text())
              .then(msg => alert(msg));
          }
        </script>
      `);
    }
  } catch (err) {
    console.error('Mark attendance error:', err);
    res.status(500).send('Error marking attendance');
  }
});

// POST version for AJAX
app.post('/mark-attendance-post', async (req, res) => {
  const { code } = req.body;
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).send('Unauthorized');
  }
  try {
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
    console.error('Mark attendance post error:', err);
    res.status(500).send('Error: ' + (err.message || 'unknown'));
  }
});

// Get all sessions/lectures for teacher
app.get('/sessions', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    const result = await db.execute(`
      SELECT id, subject, created_at, expires_at,
             (SELECT COUNT(*) FROM attendance WHERE qr_id = qr_codes.id) as attendance_count
      FROM qr_codes
      WHERE teacher_id = ?
      ORDER BY created_at DESC
    `, [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Sessions error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get attendance for a specific session
app.get('/session-attendance', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  try {
    // First verify the code belongs to this teacher
    const codeResult = await db.execute('SELECT id, subject, created_at, expires_at FROM qr_codes WHERE id = ? AND teacher_id = ?', [code, req.session.userId]);
    const codeRow = codeResult.rows[0];
    if (!codeRow) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get all attendance for this session
    const attendanceResult = await db.execute(`
      SELECT u.first_name, u.last_name, u.prn, u.email, a.marked_at
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      WHERE a.qr_id = ?
      ORDER BY a.marked_at ASC
    `, [code]);
    res.json({
      session: codeRow,
      students: attendanceResult.rows
    });
  } catch (err) {
    console.error('Session attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get live count and student list for active code
app.get('/live-count', async (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  try {
    const now = Math.floor(Date.now() / 1000);
    const codeResult = await db.execute('SELECT id FROM qr_codes WHERE id = ? AND expires_at > ?', [code, now]);
    const codeRow = codeResult.rows[0];
    if (!codeRow) {
      return res.json({ count: 0, students: [] });
    }

    const attendanceResult = await db.execute(`
      SELECT u.first_name, u.last_name, u.prn, a.marked_at
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      WHERE a.qr_id = ?
      ORDER BY a.marked_at ASC
    `, [code]);
    res.json({ count: attendanceResult.rows.length, students: attendanceResult.rows });
  } catch (err) {
    console.error('Live count error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get teacher statistics
app.get('/teacher-stats', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const teacherId = req.session.userId;

  try {
    // Get total lectures (unique QR codes generated)
    const lecturesResult = await db.execute('SELECT COUNT(DISTINCT id) as totalLectures FROM qr_codes WHERE teacher_id = ?', [teacherId]);
    const totalLectures = lecturesResult.rows[0]?.totalLectures || 0;

    // Get total attendance count
    const attendanceResult = await db.execute(`
      SELECT COUNT(*) as totalAttendance
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      WHERE q.teacher_id = ?
    `, [teacherId]);
    const totalAttendance = attendanceResult.rows[0]?.totalAttendance || 0;

    // Get unique students count
    const studentsResult = await db.execute(`
      SELECT COUNT(DISTINCT a.student_id) as uniqueStudents
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      WHERE q.teacher_id = ?
    `, [teacherId]);
    const uniqueStudents = studentsResult.rows[0]?.uniqueStudents || 0;

    // Calculate average attendance percentage
    let avgAttendance = 0;
    if (totalLectures > 0 && uniqueStudents > 0) {
      // This is a simplified calculation - in reality you'd need class size per lecture
      // For now, we'll assume each lecture has the same number of potential students
      avgAttendance = Math.round((totalAttendance / (totalLectures * uniqueStudents)) * 100);
      avgAttendance = Math.min(avgAttendance, 100); // Cap at 100%
    }

    res.json({
      totalLectures: totalLectures,
      totalAttendance: totalAttendance,
      avgAttendance: avgAttendance,
      uniqueStudents: uniqueStudents
    });
  } catch (err) {
    console.error('Teacher stats error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get attendance for teacher dashboard
app.get('/attendance', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const teacherId = req.session.userId;
  try {
    const result = await db.execute(`
      SELECT a.marked_at, q.subject, q.id as session_id,
             u.first_name, u.last_name, u.prn, u.email
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      JOIN users u ON a.student_id = u.id
      WHERE q.teacher_id = ?
      ORDER BY a.marked_at DESC
    `, [teacherId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Get attendance for student
app.get('/my-attendance', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await db.execute(`
      SELECT a.marked_at, q.subject, t.first_name as teacher_fname, t.last_name as teacher_lname
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      JOIN users t ON q.teacher_id = t.id
      WHERE a.student_id = ?
      ORDER BY a.marked_at DESC
    `, [req.session.userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('My attendance error:', err);
    res.status(500).json({ error: 'Database error' });
  }
});

// Student session history and attendance details
app.get('/my-sessions', async (req, res) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const result = await db.execute(`
      SELECT q.id as code, q.subject, q.created_at, q.expires_at,
             CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as present,
             u.first_name as teacher_fname, u.last_name as teacher_lname
      FROM qr_codes q
      LEFT JOIN attendance a ON q.id = a.qr_id AND a.student_id = ?
      LEFT JOIN users u ON q.teacher_id = u.id
      ORDER BY q.created_at DESC
    `, [req.session.userId]);
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