const { createClient } = require('@libsql/client');
const bcrypt = require('bcrypt');

const db = createClient({
  url: process.env.TURSO_DB_URL || 'file:attendance.db',  // fallback to local SQLite file if env not set
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Initialize database tables
async function initDB() {
  try {
    // Personal Info table for student details
    await db.execute(`CREATE TABLE IF NOT EXISTS personal_info (
      PRN TEXT PRIMARY KEY,
      NAME_STD TEXT,
      EMAIL TEXT,
      Roll_No INTEGER UNIQUE NOT NULL
    )`);

    // Users table for students and teachers
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL, -- 'student' or 'teacher'
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      prn TEXT UNIQUE, -- for students
      roll_no INTEGER, -- for students
      year TEXT, -- for students
      department TEXT,
      subject TEXT, -- for teachers
      emp_id TEXT, -- for teachers
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Ensure older databases also get a subject column for teachers
    try {
      await db.execute(`ALTER TABLE users ADD COLUMN subject TEXT`);
    } catch (err) {
      if (!/duplicate column|duplicate name|already has column/i.test(err.message)) {
        throw err;
      }
    }

    // QR codes table
    await db.execute(`CREATE TABLE IF NOT EXISTS qr_codes (
      id TEXT PRIMARY KEY,
      teacher_id INTEGER NOT NULL,
      subject TEXT, -- optional
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (teacher_id) REFERENCES users(id)
    )`);

    // Attendance table with integrity constraints
    await db.execute(`CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      qr_id TEXT NOT NULL,
      marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE RESTRICT,
      FOREIGN KEY (qr_id) REFERENCES qr_codes(id) ON DELETE RESTRICT,
      UNIQUE(student_id, qr_id)
    )`);

    // Assignments table
    await db.execute(`CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      created_by INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    // Seed default teacher if no teacher exists
    const result = await db.execute(`SELECT COUNT(*) AS count FROM users WHERE role = 'teacher'`);
    const count = result.rows[0]?.count || 0;
    if (count === 0) {
      const defaultEmail = process.env.DEFAULT_TEACHER_EMAIL || 'teacher@wadia.ac.in';
      const defaultPassword = process.env.DEFAULT_TEACHER_PASSWORD || 'password123';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await db.execute(
        `INSERT OR IGNORE INTO users (email, password, role, first_name, last_name, emp_id) VALUES (?, ?, 'teacher', ?, ?, ?)`,
        [defaultEmail, hashedPassword, 'Default', 'Teacher', 'T001']
      );
      console.log(`Seeded default teacher account: ${defaultEmail}`);
    }

    // Migrate any legacy plaintext passwords to bcrypt hashes
    try {
      const users = await db.execute('SELECT id, password FROM users');
      for (const user of users.rows) {
        const pw = user.password || '';
        if (pw && !pw.startsWith('$2a$') && !pw.startsWith('$2b$') && !pw.startsWith('$2y$')) {
          const hash = await bcrypt.hash(pw, 10);
          await db.execute('UPDATE users SET password = ? WHERE id = ?', [hash, user.id]);
        }
      }
    } catch (migrateErr) {
      console.error('Password migration error:', migrateErr.message);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err.message);
  }
}

initDB();

module.exports = { db, initDB };