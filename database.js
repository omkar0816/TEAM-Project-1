const { createClient } = require('@libsql/client');
const db = createClient({
  url: process.env.TURSO_DB_URL || 'file:attendance.db',  // fallback to local SQLite file if env not set
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Initialize database tables
async function initDB() {
  try {
    // Users table for students and teachers
    await db.execute(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL, -- 'student' or 'teacher'
      first_name TEXT,
      last_name TEXT,
      prn TEXT, -- for students
      year TEXT, -- for students
      department TEXT,
      emp_id TEXT, -- for teachers
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // QR codes table
    await db.execute(`CREATE TABLE IF NOT EXISTS qr_codes (
      id TEXT PRIMARY KEY,
      teacher_id INTEGER NOT NULL,
      subject TEXT, -- optional
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (teacher_id) REFERENCES users(id)
    )`);

    // Sessions table: tracks each generated attendance session
    await db.execute(`CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      created_by INTEGER,
      subject TEXT,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      expires_at TEXT,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )`);

    // Attendance table
    await db.execute(`CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL,
      qr_id TEXT NOT NULL,
      marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (student_id) REFERENCES users(id),
      FOREIGN KEY (qr_id) REFERENCES qr_codes(id),
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
      await db.execute(
        `INSERT OR IGNORE INTO users (email, password, role, first_name, last_name, emp_id) VALUES (?, ?, 'teacher', ?, ?, ?)`,
        [defaultEmail, defaultPassword, 'Default', 'Teacher', 'T001']
      );
      console.log(`Seeded default teacher account: ${defaultEmail}`);
    }

    console.log('Database initialized successfully.');
  } catch (err) {
    console.error('Error initializing database:', err.message);
  }
}

initDB();

module.exports = { db, initDB };