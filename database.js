const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbPath = path.join(__dirname, 'attendance.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database at', dbPath);
  }
});

// Create tables
db.serialize(() => {
  // Users table for students and teachers
  db.run(`CREATE TABLE IF NOT EXISTS users (
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
  db.run(`CREATE TABLE IF NOT EXISTS qr_codes (
    id TEXT PRIMARY KEY,
    teacher_id INTEGER NOT NULL,
    subject TEXT, -- optional
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY (teacher_id) REFERENCES users(id)
  )`);

  // Attendance table
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    qr_id TEXT NOT NULL,
    marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES users(id),
    FOREIGN KEY (qr_id) REFERENCES qr_codes(id),
    UNIQUE(student_id, qr_id)
  )`);
});

module.exports = db;