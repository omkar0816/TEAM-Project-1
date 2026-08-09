const ExcelJS = require('exceljs');
const { db } = require('../models/database');

async function buildMonthlyReportWorkbook(teacherId) {
  const teacherResult = await db.execute({ sql: `SELECT name, subject FROM teachers WHERE id = ?`, args: [teacherId] });
  const teacher = teacherResult.rows[0] || {};
  const students = await db.execute({ sql: `SELECT id, name, email FROM students ORDER BY name`, args: [] });

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);

  const attendanceData = await db.execute({
    sql: `
      SELECT
        s.id AS student_id,
        s.name,
        s.email,
        qs.subject,
        qs.created_at AS session_date,
        CASE
          WHEN a.id IS NOT NULL THEN 'Present'
          ELSE 'Absent'
        END AS status,
        COALESCE(a.marked_at, NULL) AS marked_at
      FROM qr_codes qs
      LEFT JOIN students s ON 1 = 1
      LEFT JOIN attendance a ON a.student_id = s.id AND a.qr_id = qs.id
      WHERE qs.teacher_id = ?
        AND DATE(qs.created_at) BETWEEN ? AND ?
      ORDER BY qs.created_at DESC, s.name
    `,
    args: [teacherId, monthStart.toISOString().slice(0, 10), monthEnd.toISOString().slice(0, 10)]
  });

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Monthly Report');
  const [teacherFirst, ...teacherRest] = (teacher.name || 'Teacher').split(' ');
  const teacherLast = teacherRest.join(' ');
  sheet.addRow(['Teacher', `${teacherFirst} ${teacherLast}`.trim()]);
  sheet.addRow(['Subject', teacher.subject || 'N/A']);
  sheet.addRow(['Month', new Date().toLocaleString('default', { month: 'long', year: 'numeric' })]);
  sheet.addRow([]);

  const sessionLabels = [...new Map(attendanceData.rows.map(row => [row.session_date, `${new Date(row.session_date).toLocaleDateString()} (${row.subject || 'Lecture'})`])).values()].reverse();
  const headers = ['Name', 'Email', ...sessionLabels, 'Attendance %'];
  sheet.addRow(headers);
  sheet.getRow(5).font = { bold: true };

  const studentAttendance = new Map();
  for (const row of attendanceData.rows) {
    if (!studentAttendance.has(row.student_id)) {
      studentAttendance.set(row.student_id, {
        name: row.name,
        email: row.email,
        statuses: new Map(),
      });
    }

    const studentRecord = studentAttendance.get(row.student_id);
    if (row.session_date) {
      studentRecord.statuses.set(row.session_date, row.status === 'Present' ? '✅' : '❌');
    }
  }

  const allStudentRows = students.rows.length > 0 ? students.rows : [...studentAttendance.values()].map(student => ({ id: student.name, name: student.name, email: student.email }));
  for (const student of allStudentRows) {
    const record = studentAttendance.get(student.id) || { name: student.name, email: student.email, statuses: new Map() };
    const statuses = sessionLabels.map(label => {
      const sessionDate = attendanceData.rows.find(row => `${new Date(row.session_date).toLocaleDateString()} (${row.subject || 'Lecture'})` === label)?.session_date;
      return sessionDate ? (record.statuses.get(sessionDate) || '❌') : '❌';
    });
    const presentCount = statuses.filter(status => status === '✅').length;
    const pct = sessionLabels.length > 0 ? `${((presentCount / sessionLabels.length) * 100).toFixed(1)}%` : '0%';

    sheet.addRow([
      `${record.name || ''}`.trim(),
      record.email,
      ...statuses,
      pct,
    ]);
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
