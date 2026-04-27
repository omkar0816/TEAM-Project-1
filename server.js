const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// If running behind a proxy (common in cloud deployments), trust the first proxy.
app.set('trust proxy', 1);

// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'wadia-secret-key', // Change in production
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax'
  }
}));

// Serve static files (frontend)
app.use(express.static(path.join(__dirname)));

// Routes

// Serve the login page
app.get('/', (req, res) => {
  if (req.session.userId) {
    // If logged in, redirect to dashboard or appropriate page
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
app.post('/login', (req, res) => {
  const { email, password } = req.body;
  db.get('SELECT * FROM users WHERE email = ? AND password = ?', [email, password], (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (user) {
      req.session.userId = user.id;
      req.session.role = user.role;
      res.json({ success: true, role: user.role });
    } else {
      res.json({ success: false, message: 'Invalid credentials' });
    }
  });
});

// Signup
app.post('/signup', (req, res) => {
  const { role, firstName, lastName, email, password, prn, year, department, empId } = req.body;
  // Simple validation
  if (!role || !email || !password) {
    return res.status(400).json({ success: false, message: 'Role, email, and password are required' });
  }
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }
  db.run('INSERT INTO users (email, password, role, first_name, last_name, prn, year, department, emp_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [email, password, role, firstName, lastName, prn, year, department, empId], function(err) {
      if (err) {
        console.error('Signup error:', err.message);
        return res.status(500).json({ success: false, message: 'User already exists or error' });
      }
      res.json({ success: true });
    });
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

// Generate Code (for teachers)
app.post('/generate-code', (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { subject } = req.body;
  const expiresAt = new Date(Date.now() + 50 * 1000); // 50 seconds
  const tryInsertCode = (attempt = 0) => {
    if (attempt >= 5) {
      return res.status(500).json({ error: 'Unable to generate a unique code. Please try again.' });
    }

    const code = Math.floor(10000 + Math.random() * 90000).toString();
    db.run('INSERT INTO qr_codes (id, teacher_id, subject, expires_at) VALUES (?, ?, ?, ?)', [code, req.session.userId, subject || 'Lecture', expiresAt.toISOString()], (err) => {
      if (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
          return tryInsertCode(attempt + 1);
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ code });
    });
  };

  tryInsertCode();
});

// Mark attendance (for students)
app.get('/mark-attendance', (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).send('Invalid code');
  }
  // Check if code is valid
  db.get('SELECT * FROM qr_codes WHERE id = ? AND expires_at > datetime("now")', [code], (err, codeRow) => {
    if (err || !codeRow) {
      return res.send('Code expired or invalid');
    }
    // If student logged in, mark attendance
    if (req.session.userId && req.session.role === 'student') {
      db.run('INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)', [req.session.userId, code], (err) => {
        if (err) {
          return res.send('Error marking attendance');
        }
        res.send('Attendance marked successfully!');
      });
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
            fetch('/mark-attendance-post?code=${code}', { method: 'POST' })
              .then(res => res.text())
              .then(msg => alert(msg));
          }
        </script>
      `);
    }
  });
});

// POST version for AJAX
app.post('/mark-attendance-post', (req, res) => {
  const { code } = req.body;
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).send('Unauthorized');
  }
  db.get('SELECT * FROM qr_codes WHERE id = ? AND expires_at > datetime("now")', [code], (err, codeRow) => {
    if (err || !codeRow) {
      return res.send('Code expired');
    }
    db.run('INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)', [req.session.userId, code], (err) => {
      if (err) {
        return res.send('Error');
      }
      res.send('Marked!');
    });
  });
});

// Get all sessions/lectures for teacher
app.get('/sessions', (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  db.all(`
    SELECT id, subject, created_at, expires_at,
           (SELECT COUNT(*) FROM attendance WHERE qr_id = qr_codes.id) as attendance_count
    FROM qr_codes
    WHERE teacher_id = ?
    ORDER BY created_at DESC
  `, [req.session.userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get attendance for a specific session
app.get('/session-attendance', (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  // First verify the code belongs to this teacher
  db.get('SELECT * FROM qr_codes WHERE id = ? AND teacher_id = ?', [code, req.session.userId], (err, codeRow) => {
    if (err || !codeRow) {
      return res.status(404).json({ error: 'Session not found' });
    }

    // Get all attendance for this session
    db.all(`
      SELECT u.first_name, u.last_name, u.prn, u.email, a.marked_at
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      WHERE a.qr_id = ?
      ORDER BY a.marked_at ASC
    `, [code], (err, students) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({
        session: codeRow,
        students: students
      });
    });
  });
});

// Get live count and student list for active code
app.get('/live-count', (req, res) => {
  const { code } = req.query;
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }

  db.get('SELECT id FROM qr_codes WHERE id = ? AND expires_at > datetime("now")', [code], (err, codeRow) => {
    if (err || !codeRow) {
      return res.json({ count: 0, students: [] });
    }

    db.all(`
      SELECT u.first_name, u.last_name, u.prn, a.marked_at
      FROM attendance a
      JOIN users u ON a.student_id = u.id
      WHERE a.qr_id = ?
      ORDER BY a.marked_at ASC
    `, [code], (err, students) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ count: students.length, students });
    });
  });
});

// Get teacher statistics
app.get('/teacher-stats', (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const teacherId = req.session.userId;

  // Get total lectures (unique QR codes generated)
  db.get('SELECT COUNT(DISTINCT id) as totalLectures FROM qr_codes WHERE teacher_id = ?', [teacherId], (err, lectures) => {
    if (err) return res.status(500).json({ error: 'Database error' });

    // Get total attendance count
    db.get(`
      SELECT COUNT(*) as totalAttendance
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      WHERE q.teacher_id = ?
    `, [teacherId], (err, attendance) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      // Get unique students count
      db.get(`
        SELECT COUNT(DISTINCT a.student_id) as uniqueStudents
        FROM attendance a
        JOIN qr_codes q ON a.qr_id = q.id
        WHERE q.teacher_id = ?
      `, [teacherId], (err, students) => {
        if (err) return res.status(500).json({ error: 'Database error' });

        // Calculate average attendance percentage
        const totalLectures = lectures.totalLectures || 0;
        const totalAttendance = attendance.totalAttendance || 0;
        const uniqueStudents = students.uniqueStudents || 0;

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
      });
    });
  });
});

// Get attendance for teacher dashboard
app.get('/attendance', (req, res) => {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  const teacherId = req.session.userId;
  db.all(`
    SELECT a.marked_at, q.subject, q.id as session_id,
           u.first_name, u.last_name, u.prn, u.email
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    JOIN users u ON a.student_id = u.id
    WHERE q.teacher_id = ?
    ORDER BY a.marked_at DESC
  `, [teacherId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Get attendance for student
app.get('/my-attendance', (req, res) => {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  db.all(`
    SELECT a.marked_at, q.subject, t.first_name as teacher_fname, t.last_name as teacher_lname
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    JOIN users t ON q.teacher_id = t.id
    WHERE a.student_id = ?
    ORDER BY a.marked_at DESC
  `, [req.session.userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});