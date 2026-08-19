const attendanceRepository = require('../repositories/attendanceRepository');

async function markAttendance(studentId, code) {
  const now = Math.floor(Date.now() / 1000);
  const codeRow = await attendanceRepository.findActiveSession(code, now);
  if (!codeRow) {
    return { success: false, status: 410, message: 'Code expired or invalid' };
  }

  const enrolled = await attendanceRepository.isStudentEnrolled(studentId, codeRow.teacher_id);
  if (!enrolled) {
    return { success: false, status: 403, message: 'You are not enrolled in this class' };
  }

  const alreadyMarked = await attendanceRepository.hasAttendanceForStudent(studentId, code);
  if (alreadyMarked) {
    return { success: false, status: 409, message: 'Attendance already marked' };
  }

  await attendanceRepository.createAttendance(studentId, code);
  return { success: true };
}

module.exports = {
  markAttendance,
};
