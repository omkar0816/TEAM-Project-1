const { db } = require('../models/database');

async function findTeacherByEmail(email) {
  const result = await db.execute('SELECT * FROM teachers WHERE email = ?', [email]);
  return result.rows[0] || null;
}

async function findTeacherById(id) {
  const result = await db.execute('SELECT id, emp_id, name, email, department, subject, created_at, password_changed FROM teachers WHERE id = ?', [id]);
  return result.rows[0] || null;
}

async function createTeacher({ empId, fullName, email, department, passwordHash }) {
  await db.execute(
    'INSERT INTO teachers (emp_id, name, email, department, subject, password_hash, password_changed) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [empId, fullName || 'Teacher', email, department, '', passwordHash, false]
  );
}

async function getTeacherProfile(id) {
  const result = await db.execute('SELECT id, emp_id, name, email, department, subject, created_at FROM teachers WHERE id = ?', [id]);
  return result.rows[0] || null;
}

async function getTeacherSubject(id) {
  const result = await db.execute('SELECT subject FROM teachers WHERE id = ?', [id]);
  return result.rows[0] || null;
}

async function getTeacherStats(teacherId) {
  const lecturesResult = await db.execute('SELECT COUNT(DISTINCT id) as totalLectures FROM qr_codes WHERE teacher_id = ?', [teacherId]);
  const attendanceResult = await db.execute(`
    SELECT COUNT(*) as totalAttendance
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    WHERE q.teacher_id = ?
  `, [teacherId]);
  const studentsResult = await db.execute(`
    SELECT COUNT(DISTINCT a.student_id) as uniqueStudents
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    WHERE q.teacher_id = ?
  `, [teacherId]);

  return {
    totalLectures: lecturesResult.rows[0]?.totalLectures || 0,
    totalAttendance: attendanceResult.rows[0]?.totalAttendance || 0,
    uniqueStudents: studentsResult.rows[0]?.uniqueStudents || 0,
  };
}

module.exports = {
  findTeacherByEmail,
  findTeacherById,
  createTeacher,
  getTeacherProfile,
  getTeacherSubject,
  getTeacherStats,
};
