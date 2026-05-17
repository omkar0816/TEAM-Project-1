require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');
const { db } = require('./src/models/database');
const TursoSessionStore = require('./src/services/sessionStore');
const ExcelJS = require('exceljs');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';
// In production (Render, Railway, etc.) cookies must be secure and proxy must be trusted.
// Default secure to true in production so the session cookie is always sent over HTTPS.
const secureCookies = process.env.SESSION_COOKIE_SECURE
  ? process.env.SESSION_COOKIE_SECURE === 'true'
  : isProduction;
// Default trustProxy to true in production; cloud platforms always sit behind a reverse proxy.
const trustProxy = process.env.TRUST_PROXY
  ? process.env.TRUST_PROXY === 'true'
  : isProduction;

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
    secure: secureCookies,
    httpOnly: true,
    // 'lax' blocks cookies on QR code scans from a camera app (cross-site GET navigations
    // that are not top-level, or POST fetches). Use 'none' in production (requires secure:true)
    // so the session cookie is always included. Fall back to 'lax' in local dev (HTTP).
    sameSite: secureCookies ? 'none' : 'lax',
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
      if (!email) {
        return res.json({ success: false, message: 'Email is required for student login' });
      }
      if (!prn) {
        return res.json({ success: false, message: 'PRN is required for student login' });
      }

      const result = await db.execute('SELECT * FROM students WHERE email = ? AND prn = ?', [email, prn]);
      const student = result.rows[0];

      if (!student) {
        return res.json({ success: false, message: 'Student account not found with this email and PRN combination. Please sign up first.' });
      }

      req.session.userId = student.id;
      req.session.role = 'student';
      res.json({ success: true, role: 'student' });
    } else if (role === 'teacher') {
      if (!email || !password) {
        return res.json({ success: false, message: 'Email and password are required for teacher login' });
      }

      const result = await db.execute('SELECT * FROM teachers WHERE email = ?', [email]);
      const teacher = result.rows[0];

      if (!teacher) {
        return res.json({ success: false, message: 'Invalid email or password for teacher account' });
      }

      const passwordMatches = await bcrypt.compare(password, teacher.password_hash || '');
      if (!passwordMatches) {
        return res.json({ success: false, message: 'Invalid email or password for teacher account' });
      }

      req.session.userId = teacher.id;
      req.session.role = 'teacher';
      res.json({ success: true, role: 'teacher' });
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
  const password = req.body.password ? req.body.password.trim() : '';

  if (!role || !email) {
    return res.status(400).json({ success: false, message: 'Role and email are required' });
  }
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  try {
    const fullName = `${firstName} ${lastName}`.trim();

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

      const rollNo = /^\\d+$/.test(prn) ? parseInt(prn, 10) : Math.floor(Date.now() / 1000);
      const className = year;

      await db.execute(
        'INSERT INTO students (prn, roll_no, name, email, class, department, year) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [prn, rollNo, fullName || 'Unknown Student', email, className, department, year]
      );
    } else {
      if (!empId) {
        return res.status(400).json({ success: false, message: 'Employee ID is required for teachers' });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({ success: false, message: 'Password is required and must be at least 8 characters for teacher accounts' });
      }
      if (!department) {
        return res.status(400).json({ success: false, message: 'Department is required for teachers' });
      }

      const passwordHash = await bcrypt.hash(password, 10);
      await db.execute(
        'INSERT INTO teachers (emp_id, name, email, department, subject, password_hash) VALUES (?, ?, ?, ?, ?, ?)',
        [empId, fullName || 'Teacher', email, department, '', passwordHash]
      );
    }

    res.json({ success: true });
  } catch (err) {
    console.error('Signup error:', err.message);

    let message = 'Registration failed';
    if (err.message && err.message.includes('UNIQUE constraint failed: students.email')) {
      message = 'Email already registered. Please log in instead.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: students.prn')) {
      message = 'This PRN is already registered.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: teachers.email')) {
      message = 'Email already registered. Please log in instead.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: teachers.emp_id')) {
      message = 'This employee ID is already registered.';
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
  if (!req.session.userId || !req.session.role) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    let result;
    if (req.session.role === 'student') {
      result = await db.execute('SELECT id, prn, roll_no, name, email, class, department, year, created_at FROM students WHERE id = ?', [req.session.userId]);
    } else {
      result = await db.execute('SELECT id, emp_id, name, email, department, subject, created_at FROM teachers WHERE id = ?', [req.session.userId]);
    }

    const user = result.rows[0];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const [firstName, ...rest] = user.name ? user.name.split(' ') : ['', ''];
    const lastName = rest.join(' ');
    res.json({
      ...user,
      role: req.session.role,
      first_name: firstName,
      last_name: lastName,
      name: user.name
    });
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

// ─── GET /mark-attendance ────────────────────────────────────────────────────
app.get('/mark-attendance', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Invalid code');

  try {
    const now = Math.floor(Date.now() / 1000);
    const result = await db.execute(
      'SELECT * FROM qr_codes WHERE id = ? AND expires_at > ?',
      [code, now]
    );
    if (!result.rows[0]) return res.status(410).send('Code expired or invalid');

    // If already logged in, mark directly
    if (req.session?.userId) {
      // Confirm this userId actually exists in students table
      const studentCheck = await db.execute(
        'SELECT id FROM students WHERE id = ?',
        [req.session.userId]
      );
      if (studentCheck.rows[0]) {
        const studentId = req.session.userId;

        const existing = await db.execute(
          'SELECT id FROM attendance WHERE student_id = ? AND qr_id = ?',
          [studentId, code]
        );
        if (existing.rows[0]) return res.status(409).send('Attendance already marked');

        await db.execute(
          'INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)',
          [studentId, code]
        );
        return res.send('Attendance marked successfully!');
      }
    }

    // Not logged in — show button page
    const safeCode = encodeURIComponent(code);
    return res.send(`<!DOCTYPE html>
<html><body>
  <h1>Mark Attendance</h1>
  <p>You need to be logged in as a student.</p>
  <a href="/">Login</a><br><br>
  <button onclick="mark()">Mark Attendance</button>
  <script>
    function mark() {
      fetch('/mark-attendance-post', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: decodeURIComponent('${safeCode}') })
      }).then(r => r.text()).then(msg => alert(msg));
    }
  <\/script>
</body></html>`);
  } catch (err) {
    console.error('Mark attendance GET error:', err);
    res.status(500).send('Error marking attendance');
  }
});

app.post('/mark-attendance-post', async (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).send('Invalid code');

  if (!req.session?.userId) {
    return res.status(403).send('Please log in first');
  }

  try {
    const studentId = req.session.userId;

    const studentCheck = await db.execute(
      'SELECT id FROM students WHERE id = ?',
      [studentId]
    );
    if (!studentCheck.rows[0]) {
      return res.status(403).send('Not a student account');
    }

    const now = Math.floor(Date.now() / 1000);

    const codeResult = await db.execute(
      'SELECT id FROM qr_codes WHERE id = ? AND expires_at > ?',
      [code, now]
    );
    if (!codeResult.rows[0]) return res.status(410).send('Code expired or invalid');

    const existing = await db.execute(
      'SELECT id FROM attendance WHERE student_id = ? AND qr_id = ?',
      [studentId, code]
    );
    if (existing.rows[0]) return res.status(409).send('Attendance already marked');

    await db.execute(
      'INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)',
      [studentId, code]
    );
    return res.send('Attendance marked successfully!');

  } catch (err) {
    // DETAILED error sent back so you can see what's wrong
    console.error('Mark attendance POST error:', err);
    return res.status(500).send(`Error: ${err.message}`);
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
             u.name as student_name, u.prn, u.email
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      JOIN students u ON a.student_id = u.id
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
      SELECT a.marked_at, q.subject, t.name as teacher_name
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      JOIN teachers t ON q.teacher_id = t.id
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
             t.name as teacher_name
      FROM qr_codes q
      LEFT JOIN attendance a ON q.id = a.qr_id AND a.student_id = ?
      LEFT JOIN teachers t ON q.teacher_id = t.id
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
      sql: `SELECT name, subject FROM teachers WHERE id = ?`,
      args: [req.session.userId]
    });
    const teacher = teacherResult.rows[0] || {};
    const students = await db.execute({
      sql: `SELECT id, name, email FROM students ORDER BY name`,
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
        `${student.name || ''}`.trim(),
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
      sql: `SELECT u.name, u.email FROM attendance a JOIN students u ON a.student_id = u.id WHERE a.qr_id = ?`,
      args: [code]
    });
    const allStudents = await db.execute({
      sql: `SELECT name, email FROM students ORDER BY name`,
      args: []
    });

    const teacherProfile = await db.execute({
      sql: `SELECT name FROM teachers WHERE id = ?`,
      args: [req.session.userId]
    });
    const teacherName = teacherProfile.rows[0] ? `${teacherProfile.rows[0].name || ''}`.trim() : 'Teacher';
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
      'SELECT id, name, email, prn FROM students WHERE email = ? OR prn = ?',
      [email || '', prn || '']
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
      'SELECT id FROM students WHERE email = ? OR prn = ?',
      [email || '', prn || '']
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
