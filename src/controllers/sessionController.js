const studentRepository = require('../repositories/studentRepository');
const attendanceRepository = require('../repositories/attendanceRepository');
const statsService = require('../services/statsService');
const assignmentService = require('../services/assignmentService');
const excelExportService = require('../services/excelExportService');
const { db } = require('../models/database');

async function profile(req, res) {
  if (!req.session.userId || !req.session.role) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  try {
    let user;
    if (req.session.role === 'student') {
      user = await studentRepository.findStudentById(req.session.userId);
    } else {
      user = await require('../repositories/teacherRepository').findTeacherById(req.session.userId);
    }

    if (!user) return res.status(404).json({ error: 'User not found' });
    const [firstName, ...rest] = user.name ? user.name.split(' ') : ['', ''];
    const lastName = rest.join(' ');
    return res.json({ ...user, role: req.session.role, first_name: firstName, last_name: lastName, name: user.name });
  } catch (err) {
    console.error('Profile error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function teacherStats(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const data = await statsService.getTeacherStats(req.session.userId);
    return res.json(data);
  } catch (err) {
    console.error('Teacher stats error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function teacherAttendance(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const rows = await statsService.getTeacherAttendance(req.session.userId);
    return res.json(rows);
  } catch (err) {
    console.error('Attendance error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function myAttendance(req, res) {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const rows = await statsService.getStudentAttendance(req.session.userId);
    return res.json(rows);
  } catch (err) {
    console.error('My attendance error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function mySessions(req, res) {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const rows = await statsService.getStudentSessions(req.session.userId);
    return res.json(rows);
  } catch (err) {
    console.error('My sessions error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function myStats(req, res) {
  if (!req.session.userId || req.session.role !== 'student') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const data = await statsService.getStudentStats(req.session.userId);
    return res.json(data);
  } catch (err) {
    console.error('My stats error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function createAssignment(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { title, description, due_date } = req.body;
  try {
    const result = await assignmentService.createAssignment({ title, description, dueDate: due_date, createdBy: req.session.userId });
    if (!result.success) return res.status(result.status || 400).json({ error: result.message });
    return res.json({ success: true });
  } catch (err) {
    console.error('Add assignment error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function listAssignments(req, res) {
  if (!req.session.userId) return res.status(403).json({ error: 'Unauthorized' });
  try {
    const result = await assignmentService.listAssignments(req.session.userId);
    return res.json(result.data);
  } catch (err) {
    console.error('Get assignments error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function deleteAssignment(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    await assignmentService.deleteAssignment(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    console.error('Delete assignment error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function downloadMonthlyReport(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const workbook = await excelExportService.buildMonthlyReportWorkbook(req.session.userId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=monthly-report.xlsx');
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Monthly report error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function downloadLectureReport(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  try {
    const code = req.params.code;
    const workbook = await excelExportService.buildLectureReportWorkbook(req.session.userId, code);
    if (!workbook) return res.status(404).json({ error: 'Session not found' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=lecture-${code}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Lecture download error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function studentAttendance(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { email, prn } = req.query;
  if (!email && !prn) return res.status(400).json({ error: 'Email or PRN required' });
  try {
    const user = await studentRepository.findStudentByEmailOrPrn(email, prn);
    if (!user) return res.status(404).json({ error: 'Student not found' });
    const attendanceResult = await attendanceRepository.getAttendanceByStudent(user.id);
    return res.json({ student: user, attendance: attendanceResult, total: attendanceResult.length });
  } catch (err) {
    console.error('Student attendance error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function addAttendance(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { email, prn, session_code } = req.body;
  if (!session_code) return res.status(400).json({ error: 'Session code required' });
  if (!email && !prn) return res.status(400).json({ error: 'Email or PRN required' });
  try {
    const student = await studentRepository.findStudentByEmailOrPrn(email, prn);
    if (!student) return res.status(404).json({ error: 'Student not found' });
    const session = await attendanceRepository.getSessionByCodeAndTeacher(session_code, req.session.userId);
    if (!session) return res.status(403).json({ error: 'Session not found or does not belong to you' });
    await attendanceRepository.addManualAttendance(student.id, session_code);
    return res.json({ success: true, message: 'Attendance added for student' });
  } catch (err) {
    console.error('Add attendance error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function deleteAttendance(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { attendance_id } = req.body;
  if (!attendance_id) return res.status(400).json({ error: 'Attendance ID required' });
  try {
    const allowed = await attendanceRepository.verifyAttendanceBelongsToTeacher(attendance_id, req.session.userId);
    if (!allowed) return res.status(403).json({ error: 'Attendance record not found or unauthorized' });
    await attendanceRepository.deleteAttendance(attendance_id);
    return res.json({ success: true, message: 'Attendance record deleted' });
  } catch (err) {
    console.error('Delete attendance error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = {
  profile,
  teacherStats,
  teacherAttendance,
  myAttendance,
  mySessions,
  myStats,
  createAssignment,
  listAssignments,
  deleteAssignment,
  downloadMonthlyReport,
  downloadLectureReport,
  studentAttendance,
  addAttendance,
  deleteAttendance,
};
