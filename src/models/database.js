const { createClient } = require('@libsql/client');
const bcrypt = require('bcrypt');
const { isProduction } = require('../config/env');

const db = createClient({
  url: process.env.TURSO_DB_URL || 'file:attendance.db',
  authToken: process.env.TURSO_AUTH_TOKEN
});

// Initialize database tables with clean schema
async function initDB() {
  try {
    // First, disable foreign key constraints temporarily for migration
    await db.execute(`PRAGMA foreign_keys = OFF`);

    // Migration: Drop and recreate tables with foreign keys to remove constraints
    try {
      // Check if tables exist with old foreign key constraints
      const sessionTableInfo = await db.execute(`PRAGMA table_info(attendance_sessions)`);
      
      // Drop tables with foreign keys and recreate them without constraints
      await db.execute(`DROP TABLE IF EXISTS attendance_sessions`);
      await db.execute(`DROP TABLE IF EXISTS qr_codes`);
      await db.execute(`DROP TABLE IF EXISTS attendance`);
      await db.execute(`DROP TABLE IF EXISTS assignments`);
      
      console.log('Migration: Recreating tables without foreign key constraints');
    } catch (dropErr) {
      console.warn('Migration check/drop tables:', dropErr.message);
    }

    // Re-enable foreign key constraints
    await db.execute(`PRAGMA foreign_keys = ON`);

    // 1. Teachers table (no foreign keys)
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

    // 2. Students table (no foreign keys)
    await db.execute(`CREATE TABLE IF NOT EXISTS students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prn TEXT UNIQUE NOT NULL,
      roll_no TEXT,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      class TEXT NOT NULL,
      department TEXT NOT NULL,
      year TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 3. Subjects table (no foreign keys)
    await db.execute(`CREATE TABLE IF NOT EXISTS subjects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      department TEXT NOT NULL,
      semester TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 4. QR Codes table (no foreign keys - allows teacher deletion)
    await db.execute(`CREATE TABLE IF NOT EXISTS qr_codes (
      id TEXT PRIMARY KEY,
      teacher_id INTEGER NOT NULL,
      subject TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at INTEGER NOT NULL
    )`);

    // 5. Attendance table (no foreign keys - allows student deletion)
    await db.execute(`CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      PRN TEXT NOT NULL,
      qr_id TEXT NOT NULL,
      marked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(PRN, qr_id)
    )`);

    // 6. Assignments table (no foreign keys - allows teacher/subject deletion)
    await db.execute(`CREATE TABLE IF NOT EXISTS assignments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      due_date TEXT,
      created_by INTEGER,
      subject_id INTEGER,
      created_at TEXT DEFAULT (datetime('now','localtime'))
    )`);

    // 7. Audit logs table (no foreign keys required)
    await db.execute(`CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      user_type TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 8. Attendance sessions table (no foreign keys - allows deletion)
    await db.execute(`CREATE TABLE IF NOT EXISTS attendance_sessions (
      id TEXT PRIMARY KEY,
      code INTEGER NOT NULL UNIQUE,
      created_by INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME NOT NULL
    )`);

    // Migration: Add created_at to qr_codes if missing
    try {
      const qrTableInfo = await db.execute(`PRAGMA table_info(qr_codes)`);
      const hasCreatedAt = qrTableInfo.rows.some(col => col.name === 'created_at');
      if (!hasCreatedAt) {
        await db.execute(`ALTER TABLE qr_codes ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP`);
        console.log('Migration: Added created_at column to qr_codes table');
      }
    } catch (migrationErr) {
      console.warn('Could not check/add created_at to qr_codes:', migrationErr.message);
    }

    // Migration: Add roll_no to students if missing
    try {
      const studentTableInfo = await db.execute(`PRAGMA table_info(students)`);
      const hasRollNo = studentTableInfo.rows.some(col => col.name === 'roll_no');
      if (!hasRollNo) {
        await db.execute(`ALTER TABLE students ADD COLUMN roll_no TEXT`);
        console.log('Migration: Added roll_no column to students table');
      }
    } catch (migrationErr) {
      console.warn('Could not check/add roll_no to students:', migrationErr.message);
    }

    // Migration: Add password_hash to students if missing
    try {
      const studentTableInfo = await db.execute(`PRAGMA table_info(students)`);
      const hasPassword = studentTableInfo.rows.some(col => col.name === 'password_hash');
      if (!hasPassword) {
        await db.execute(`ALTER TABLE students ADD COLUMN password_hash TEXT`);
        console.log('Migration: Added password_hash column to students table');
      }
    } catch (migrationErr) {
      console.warn('Could not check/add password_hash to students:', migrationErr.message);
    }

    // Migration: Add student_id to attendance if missing
    try {
      const attendanceTableInfo = await db.execute(`PRAGMA table_info(attendance)`);
      const hasStudentId = attendanceTableInfo.rows.some(col => col.name === 'student_id');
      if (!hasStudentId) {
        // Add student_id column
        await db.execute(`ALTER TABLE attendance ADD COLUMN student_id INTEGER`);
        
        // Migrate data from PRN to student_id
        const attendanceRecords = await db.execute(`SELECT DISTINCT PRN FROM attendance WHERE PRN IS NOT NULL`);
        for (const record of attendanceRecords.rows) {
          const studentLookup = await db.execute(`SELECT id FROM students WHERE prn = ? LIMIT 1`, [record.PRN]);
          if (studentLookup.rows[0]) {
            await db.execute(`UPDATE attendance SET student_id = ? WHERE PRN = ?`, [studentLookup.rows[0].id, record.PRN]);
          }
        }
        console.log('Migration: Added and populated student_id column in attendance table');
      }
    } catch (migrationErr) {
      console.warn('Could not check/add student_id to attendance:', migrationErr.message);
    }

    // Create indexes for performance
    try {
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_prn ON students(prn)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_email ON students(email)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_teachers_emp_id ON teachers(emp_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_qr_codes_teacher_id ON qr_codes(teacher_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes(expires_at)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_qr_id ON attendance(qr_id)`);
      await db.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_marked_at ON attendance(marked_at)`);
      console.log('Database indexes created successfully');
    } catch (indexErr) {
      console.warn('Some indexes may already exist:', indexErr.message);
    }

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
      const defaultPassword = process.env.DEFAULT_TEACHER_PASSWORD;
      if (!defaultPassword) {
        throw new Error('FATAL: DEFAULT_TEACHER_PASSWORD is not set.');
      }
      if (isProduction && defaultPassword === 'TempPass123!') {
        throw new Error('FATAL: DEFAULT_TEACHER_PASSWORD is still the example value. Set a real password.');
      }
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

module.exports = { db, initDB };
