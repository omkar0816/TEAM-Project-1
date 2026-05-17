const { createClient } = require('@libsql/client');
const bcrypt = require('bcrypt');

const db = createClient({
  url: process.env.TURSO_DB_URL || 'file:attendance.db',
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Initialize database tables with clean schema
async function initDB() {
  try {
    // QR Codes table
    await db.execute(`CREATE TABLE IF NOT EXISTS qr_codes (
  id TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL,
  subject TEXT,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
)`);
// Attendance table
await db.execute(`CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  qr_id TEXT NOT NULL,
  marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, qr_id),
  FOREIGN KEY (student_id) REFERENCES students(id),
  FOREIGN KEY (qr_id) REFERENCES qr_codes(id)
)`);
    // Students table
    await db.execute(`CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prn TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      class TEXT NOT NULL,
      department TEXT NOT NULL,
      year TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Teachers table
    await db.execute(`CREATE TABLE IF NOT EXISTS teachers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      emp_id TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      department TEXT NOT NULL,
      subject TEXT,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_login DATETIME,
      password_changed BOOLEAN DEFAULT FALSE
    )`);

    // Subjects table
    await db.execute(`CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      semester TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Attendance sessions table
    await db.execute(`CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      code INTEGER NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL,
      FOREIGN KEY (code) REFERENCES qr_codes(id),
      FOREIGN KEY (created_by) REFERENCES teachers(id)
    )`);

    

    // Audit logs table
    await db.execute(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_type TEXT NOT NULL, -- 'student' or 'teacher'
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Assignments table (keeping for compatibility)
    await db.execute(`CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      created_by INTEGER,
      subject_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (created_by) REFERENCES teachers(id),
      FOREIGN KEY (subject_id) REFERENCES subjects(id)
    )`);

    // Create indexes for performance
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_prn ON students(prn)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_roll_no ON students(roll_no)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_email ON students(email)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_teachers_emp_id ON teachers(emp_id)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_sessions_teacher_id ON attendance_sessions(teacher_id)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_sessions_subject_id ON attendance_sessions(subject_id)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_records_student_id ON attendance_records(student_id)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_records_session_id ON attendance_records(session_id)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id)`);
    // await db.execute(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at)`);

    // Seed default subjects if none exist
    const subjectResult = await db.execute(`SELECT COUNT(*) AS count FROM subjects`);
    const subjectCount = subjectResult.rows[0]?.count || 0;
    if (subjectCount === 0) {
      const defaultSubjects = [
        ['CS101', 'Computer Programming', 'Computer Science', '1'],
        ['CS102', 'Data Structures', 'Computer Science', '2'],
        ['CS201', 'Database Management', 'Computer Science', '3'],
        ['CS202', 'Web Development', 'Computer Science', '4'],
        ['ME101', 'Engineering Mechanics', 'Mechanical', '1'],
        ['ME102', 'Thermodynamics', 'Mechanical', '2'],
        ['EE101', 'Circuit Analysis', 'Electrical', '1'],
        ['EE102', 'Power Systems', 'Electrical', '2']
      ];

      for (const [code, name, dept, sem] of defaultSubjects) {
        await db.execute(
          `INSERT OR IGNORE INTO subjects (code, name, department, semester) VALUES (?, ?, ?, ?)`,
          [code, name, dept, sem]
        );
      }
      console.log('Seeded default subjects.');
    }

    // Seed default teacher if no teacher exists
    const teacherResult = await db.execute(`SELECT COUNT(*) AS count FROM teachers`);
    const teacherCount = teacherResult.rows[0]?.count || 0;
    if (teacherCount === 0) {
      const defaultEmail = process.env.DEFAULT_TEACHER_EMAIL || 'admin@wadia.ac.in';
      const defaultPassword = process.env.DEFAULT_TEACHER_PASSWORD || 'TempPass123!';
      const hashedPassword = await bcrypt.hash(defaultPassword, 10);
      await db.execute(
        `INSERT INTO teachers (emp_id, name, email, department, password_hash, password_changed)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['T001', 'Default Admin', defaultEmail, 'Administration', hashedPassword, false]
      );
      console.log(`Seeded default teacher account: ${defaultEmail} (password change required)`);
    }

    console.log('Database initialized successfully with clean schema.');
  } catch (err) {
    console.error('Error initializing database:', err.message);
    throw err;
  }
}

 (async () => {
  await initDB();
 })().catch(console.error);

module.exports = { db, initDB };
