require('dotenv/config');

const { db } = require('./src/models/database');

async function seedEnrollments() {
  await db.execute(`CREATE TABLE IF NOT EXISTS class_enrollments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    teacher_id INTEGER NOT NULL,
    subject TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, teacher_id),
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (teacher_id) REFERENCES teachers(id)
  )`);

  const students = await db.execute('SELECT id, department FROM students');
  const teachers = await db.execute('SELECT id, department, subject FROM teachers');

  let inserted = 0;
  for (const student of students.rows) {
    for (const teacher of teachers.rows) {
      if (student.department !== teacher.department) continue;

      const result = await db.execute(
        `INSERT OR IGNORE INTO class_enrollments (student_id, teacher_id, subject)
         VALUES (?, ?, ?)`,
        [student.id, teacher.id, teacher.subject || null]
      );
      inserted += result.rowsAffected || 0;
    }
  }

  console.log(`Enrollments seeded: ${inserted} new records.`);
}

seedEnrollments().catch((err) => {
  console.error('Enrollment seeding failed:', err);
  process.exitCode = 1;
});