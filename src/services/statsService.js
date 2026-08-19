const attendanceRepository = require('../repositories/attendanceRepository');
const studentRepository = require('../repositories/studentRepository');
const teacherRepository = require('../repositories/teacherRepository');
const { db } = require('../models/database');

async function getTeacherStats(teacherId) {
  const stats = await teacherRepository.getTeacherStats(teacherId);
  let avgAttendance = 0;
  if (stats.totalLectures > 0 && stats.uniqueStudents > 0) {
    avgAttendance = Math.round((stats.totalAttendance / (stats.totalLectures * stats.uniqueStudents)) * 100);
    avgAttendance = Math.min(avgAttendance, 100);
  }
  return {
    totalLectures: stats.totalLectures,
    totalAttendance: stats.totalAttendance,
    avgAttendance,
    uniqueStudents: stats.uniqueStudents,
  };
}

async function getTeacherAttendance(teacherId) {
  return attendanceRepository.getTeacherAttendance(teacherId);
}

async function getStudentAttendance(studentId) {
  return attendanceRepository.getAttendanceByStudent(studentId);
}

async function getStudentSessions(studentId) {
  return studentRepository.getStudentSessions(studentId);
}

async function getStudentStats(studentId) {
  const totalResult = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM qr_codes q
      JOIN class_enrollments ce ON ce.teacher_id = q.teacher_id
      WHERE ce.student_id = ?
        AND strftime('%Y-%m', q.created_at) = strftime('%Y-%m', 'now', 'localtime')
    `,
    args: [studentId],
  });
  const attendedResult = await db.execute({
    sql: `
      SELECT COUNT(*) AS attended
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      JOIN class_enrollments ce ON ce.teacher_id = q.teacher_id AND ce.student_id = a.student_id
      WHERE a.student_id = ?
        AND strftime('%Y-%m', q.created_at) = strftime('%Y-%m', 'now', 'localtime')
    `,
    args: [studentId],
  });
  const allTimeTotal = await db.execute({
    sql: `
      SELECT COUNT(*) AS total
      FROM qr_codes q
      JOIN class_enrollments ce ON ce.teacher_id = q.teacher_id
      WHERE ce.student_id = ?
    `,
    args: [studentId]
  });
  const allTimeAttended = await db.execute({
    sql: `
      SELECT COUNT(*) AS attended
      FROM attendance a
      JOIN qr_codes q ON a.qr_id = q.id
      JOIN class_enrollments ce ON ce.teacher_id = q.teacher_id AND ce.student_id = a.student_id
      WHERE a.student_id = ?
    `,
    args: [studentId]
  });

  const monthlyTotal = totalResult.rows[0]?.total || 0;
  const monthlyAttended = attendedResult.rows[0]?.attended || 0;
  const overallTotal = allTimeTotal.rows[0]?.total || 0;
  const overallAttended = allTimeAttended.rows[0]?.attended || 0;

  return {
    monthly: monthlyTotal > 0 ? ((monthlyAttended / monthlyTotal) * 100).toFixed(1) : '0.0',
    live: overallTotal > 0 ? ((overallAttended / overallTotal) * 100).toFixed(1) : '0.0',
    monthlyAttended,
    monthlyTotal,
    overallAttended,
    overallTotal,
  };
}

module.exports = {
  getTeacherStats,
  getTeacherAttendance,
  getStudentAttendance,
  getStudentSessions,
  getStudentStats,
};
