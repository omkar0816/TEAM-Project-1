const ExcelJS = require('exceljs');
const { db } = require('../models/database');

async function buildMonthlyReportWorkbook(teacherId) {
  const teacherResult = await db.execute({ sql: `SELECT name, subject FROM teachers WHERE id = ?`, args: [teacherId] });
  const teacher = teacherResult.rows[0] || {};
  const students = await db.execute({ sql: `SELECT id, name, email FROM students ORDER BY name`, args: [] });
  const sessionsResult = await db.execute({ sql: `SELECT id, subject, created_at FROM qr_codes WHERE teacher_id = ? AND strftime('%Y-%m', created_at) = strftime('%Y-%m','now','localtime') ORDER BY created_at`, args: [teacherId] });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Monthly Report');
  const [teacherFirst, ...teacherRest] = (teacher.name || 'Teacher').split(' ');
  const teacherLast = teacherRest.join(' ');
  sheet.addRow(['Teacher', `${teacherFirst} ${teacherLast}`.trim()]);
  sheet.addRow(['Subject', teacher.subject || 'N/A']);
  sheet.addRow(['Month', new Date().toLocaleString('default', { month: 'long', year: 'numeric' })]);
  sheet.addRow([]);
  const headers = ['Name', 'Email', ...sessionsResult.rows.map(s => `${new Date(s.created_at).toLocaleDateString()} (${s.subject || 'Lecture'})`), 'Attendance %'];
  sheet.addRow(headers);
  sheet.getRow(5).font = { bold: true };

  const sessionCodes = sessionsResult.rows.map(s => s.id);
  for (const student of students.rows) {
    const attendedCodes = new Set();
    if (sessionCodes.length > 0) {
      const attended = await db.execute({ sql: `SELECT qr_id FROM attendance WHERE student_id = ? AND qr_id IN (${sessionCodes.map(() => '?').join(',')})`, args: [student.id, ...sessionCodes] });
      attended.rows.forEach(row => attendedCodes.add(row.qr_id));
    }
    const row = [
      `${student.name || ''}`.trim(),
      student.email,
      ...sessionCodes.map(code => attendedCodes.has(code) ? '✅' : '❌'),
      sessionCodes.length > 0 ? ((attendedCodes.size / sessionCodes.length) * 100).toFixed(1) + '%' : '0%',
    ];
    sheet.addRow(row);
  }

  return workbook;
}

async function buildLectureReportWorkbook(teacherId, code) {
  const sessionResult = await db.execute({ sql: `SELECT id, subject, created_at FROM qr_codes WHERE id = ? AND teacher_id = ?`, args: [code, teacherId] });
  const session = sessionResult.rows[0];
  if (!session) {
    return null;
  }

  const attendedResult = await db.execute({ sql: `SELECT u.name, u.email FROM attendance a JOIN students u ON a.student_id = u.id WHERE a.qr_id = ?`, args: [code] });
  const allStudents = await db.execute({ sql: `SELECT name, email FROM students ORDER BY name`, args: [] });
  const teacherProfile = await db.execute({ sql: `SELECT name FROM teachers WHERE id = ?`, args: [teacherId] });
  const teacherName = teacherProfile.rows[0] ? `${teacherProfile.rows[0].name || ''}`.trim() : 'Teacher';
  const attendedEmails = new Set(attendedResult.rows.map(r => r.email));

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Lecture Attendance');
  sheet.addRow(['Teacher', teacherName]);
  sheet.addRow(['Subject', session.subject || 'Lecture']);
  sheet.addRow(['Date', new Date(session.created_at).toLocaleString()]);
  sheet.addRow([]);
  sheet.addRow(['Name', 'Email', 'Status']);
  sheet.getRow(5).font = { bold: true };

  for (const s of allStudents.rows) {
    const [firstName, ...rest] = (s.name || '').split(' ');
    const lastName = rest.join(' ');
    sheet.addRow([`${firstName} ${lastName}`.trim(), s.email, attendedEmails.has(s.email) ? 'Present' : 'Absent']);
  }

  return workbook;
}

module.exports = {
  buildMonthlyReportWorkbook,
  buildLectureReportWorkbook,
};
