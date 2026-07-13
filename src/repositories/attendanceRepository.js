const { db } = require('../models/database');

async function findActiveSession(code, now) {
  const result = await db.execute('SELECT * FROM qr_codes WHERE id = ? AND expires_at > ?', [code, now]);
  return result.rows[0] || null;
}

async function createAttendance(studentId, code) {
  await db.execute('INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)', [studentId, code]);
}

async function hasAttendanceForStudent(studentId, code) {
  const result = await db.execute('SELECT id FROM attendance WHERE student_id = ? AND qr_id = ?', [studentId, code]);
  return !!result.rows[0];
}

async function getSessionAttendance(code) {
  const result = await db.execute(`
    SELECT u.name as student_name,
           u.name as first_name,
           u.name as last_name,
           u.prn,
           u.email,
           a.marked_at
    FROM attendance a
    JOIN students u ON a.student_id = u.id
    WHERE a.qr_id = ?
    ORDER BY a.marked_at ASC
  `, [code]);
  return result.rows;
}

async function getLiveAttendance(code) {
  const result = await db.execute(`
    SELECT u.name as name, u.prn, a.marked_at
    FROM attendance a
    JOIN students u ON a.student_id = u.id
    WHERE a.qr_id = ?
    ORDER BY a.marked_at ASC
  `, [code]);
  return result.rows;
}

async function getTeacherAttendance(teacherId) {
  const result = await db.execute(`
    SELECT a.marked_at,
           q.subject,
           q.id as session_id,
           u.name as student_name,
           u.name as first_name,
           u.name as last_name,
           u.prn,
           u.email
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    JOIN students u ON a.student_id = u.id
    WHERE q.teacher_id = ?
    ORDER BY a.marked_at DESC
  `, [teacherId]);
  return result.rows;
}

async function getTeacherSessions(teacherId) {
  const result = await db.execute(`
    SELECT id, subject, created_at, expires_at,
           (SELECT COUNT(*) FROM attendance WHERE qr_id = qr_codes.id) as attendance_count
    FROM qr_codes
    WHERE teacher_id = ?
    ORDER BY created_at DESC
  `, [teacherId]);
  return result.rows;
}

async function getSessionByCodeAndTeacher(code, teacherId) {
  const result = await db.execute('SELECT id, subject, created_at, expires_at FROM qr_codes WHERE id = ? AND teacher_id = ?', [code, teacherId]);
  return result.rows[0] || null;
}

async function getAttendanceByStudent(studentId) {
  const result = await db.execute(`
    SELECT a.id, a.marked_at, q.subject, q.id as session_code
    FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    WHERE a.student_id = ?
    ORDER BY a.marked_at DESC
  `, [studentId]);
  return result.rows;
}

async function addManualAttendance(studentId, sessionCode) {
  await db.execute('INSERT OR IGNORE INTO attendance (student_id, qr_id) VALUES (?, ?)', [studentId, sessionCode]);
}

async function deleteAttendance(attendanceId) {
  await db.execute('DELETE FROM attendance WHERE id = ?', [attendanceId]);
}

async function verifyAttendanceBelongsToTeacher(attendanceId, teacherId) {
  const result = await db.execute(`
    SELECT a.id FROM attendance a
    JOIN qr_codes q ON a.qr_id = q.id
    WHERE a.id = ? AND q.teacher_id = ?
  `, [attendanceId, teacherId]);
  return !!result.rows[0];
}

module.exports = {
  findActiveSession,
  createAttendance,
  hasAttendanceForStudent,
  getSessionAttendance,
  getLiveAttendance,
  getTeacherAttendance,
  getTeacherSessions,
  getSessionByCodeAndTeacher,
  getAttendanceByStudent,
  addManualAttendance,
  deleteAttendance,
  verifyAttendanceBelongsToTeacher,
};
