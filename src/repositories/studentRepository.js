const { db } = require('../models/database');

async function findStudentByEmailAndPrn(email, prn) {
  const result = await db.execute('SELECT * FROM students WHERE email = ? AND prn = ?', [email, prn]);
  return result.rows[0] || null;
}

async function findStudentById(id) {
  const result = await db.execute('SELECT id, prn, roll_no, name, email, class, department, year, created_at FROM students WHERE id = ?', [id]);
  return result.rows[0] || null;
}

async function createStudent({ prn, rollNo, fullName, email, className, department, year, passwordHash }) {
  await db.execute(
    'INSERT INTO students (prn, roll_no, name, email, class, department, year, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [prn, rollNo, fullName || 'Unknown Student', email, className, department, year, passwordHash]
  );
}

async function findStudentByEmailOrPrn(email, prn) {
  const result = await db.execute('SELECT id, name, email, prn FROM students WHERE email = ? OR prn = ?', [email || '', prn || '']);
  return result.rows[0] || null;
}

async function getStudentAttendance(studentId) {
  const result = await db.execute(`
    SELECT a.marked_at, q.subject, t.name as teacher_name
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    JOIN teachers t ON q.teacher_id = t.id
    WHERE a.student_id = ?
    ORDER BY a.marked_at DESC
  `, [studentId]);
  return result.rows;
}

async function getStudentSessions(studentId) {
  const result = await db.execute(`
    SELECT q.id as code, q.subject, q.created_at, q.expires_at,
           CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as present,
           t.name as teacher_name
    FROM qr_codes q
    LEFT JOIN attendance a ON q.id = a.qr_id AND a.student_id = ?
    LEFT JOIN teachers t ON q.teacher_id = t.id
    ORDER BY q.created_at DESC
  `, [studentId]);
  return result.rows;
}

module.exports = {
  findStudentByEmailAndPrn,
  findStudentById,
  createStudent,
  findStudentByEmailOrPrn,
  getStudentAttendance,
  getStudentSessions,
};
