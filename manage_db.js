#!/usr/bin/env node

/**
 * Database Management Utility
 * Use this to remove students or manually add attendance records
 * 
 * Commands:
 *   node manage_db.js list-students              - List all students
 *   node manage_db.js remove-student <email>     - Remove a student by email
 *   node manage_db.js add-attendance <student_email> <code>  - Manually mark attendance
 *   node manage_db.js remove-attendance <student_email> <code> - Remove attendance record
 *   node manage_db.js list-attendance <code>     - List students present for a code
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DB_URL || 'file:attendance.db',
  authToken: process.env.TURSO_AUTH_TOKEN
});

const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

async function run() {
  try {
    if (command === 'list-students') {
      await listStudents();
    } else if (command === 'remove-student') {
      if (!arg1) {
        console.log('Usage: node manage_db.js remove-student <email>');
        process.exit(1);
      }
      await removeStudent(arg1);
    } else if (command === 'add-attendance') {
      if (!arg1 || !arg2) {
        console.log('Usage: node manage_db.js add-attendance <student_email> <code>');
        process.exit(1);
      }
      await addAttendance(arg1, arg2);
    } else if (command === 'remove-attendance') {
      if (!arg1 || !arg2) {
        console.log('Usage: node manage_db.js remove-attendance <student_email> <code>');
        process.exit(1);
      }
      await removeAttendance(arg1, arg2);
    } else if (command === 'list-attendance') {
      if (!arg1) {
        console.log('Usage: node manage_db.js list-attendance <code>');
        process.exit(1);
      }
      await listAttendanceForCode(arg1);
    } else {
      console.log(`
Database Management Utility

Commands:
  list-students                              List all students
  remove-student <email>                     Remove a student by email
  add-attendance <student_email> <code>      Manually mark attendance for a code
  remove-attendance <student_email> <code>   Remove attendance record
  list-attendance <code>                     List students present for a code

Examples:
  node manage_db.js list-students
  node manage_db.js remove-student jane@example.com
  node manage_db.js add-attendance john@example.com 12345
  node manage_db.js remove-attendance john@example.com 12345
  node manage_db.js list-attendance 12345
      `);
    }
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

async function listStudents() {
  console.log('\n📋 All Students:\n');
  const result = await db.execute(`
    SELECT id, prn, first_name, last_name, email, department, year, created_at
    FROM users
    WHERE role = 'student'
    ORDER BY first_name, last_name
  `);

  if (result.rows.length === 0) {
    console.log('No students found.');
    return;
  }

  console.log(`Total: ${result.rows.length} students\n`);
  result.rows.forEach(row => {
    console.log(`ID: ${row.id}`);
    console.log(`  Name: ${row.first_name} ${row.last_name}`);
    console.log(`  Email: ${row.email}`);
    console.log(`  PRN: ${row.prn || 'N/A'}`);
    console.log(`  Department: ${row.department || 'N/A'} | Year: ${row.year || 'N/A'}`);
    console.log(`  Created: ${row.created_at}\n`);
  });
}

async function removeStudent(email) {
  // First find the student
  const findResult = await db.execute(
    'SELECT id, first_name, last_name, email FROM users WHERE email = ? AND role = ?',
    [email, 'student']
  );

  if (findResult.rows.length === 0) {
    console.log(`❌ Student with email "${email}" not found.`);
    return;
  }

  const student = findResult.rows[0];
  console.log(`\n⚠️  Found student: ${student.first_name} ${student.last_name} (${student.email})`);
  console.log(`\nThis will:`);
  console.log(`  1. Delete the student record`);
  console.log(`  2. Delete all their attendance records (PERMANENT)`);

  // Delete attendance records first (foreign key constraint)
  await db.execute('DELETE FROM attendance WHERE student_id = ?', [student.id]);
  console.log(`✓ Deleted attendance records`);

  // Delete the student
  await db.execute('DELETE FROM users WHERE id = ? AND role = ?', [student.id, 'student']);
  console.log(`✓ Deleted student account`);
  console.log(`\n✅ Student removed successfully!\n`);
}

async function addAttendance(studentEmail, code) {
  // Find student
  const studentResult = await db.execute(
    'SELECT id, first_name, last_name FROM users WHERE email = ? AND role = ?',
    [studentEmail, 'student']
  );

  if (studentResult.rows.length === 0) {
    console.log(`❌ Student with email "${studentEmail}" not found.`);
    return;
  }

  const student = studentResult.rows[0];

  // Check if code exists
  const codeResult = await db.execute(
    'SELECT id, subject, teacher_id, expires_at FROM qr_codes WHERE id = ?',
    [code]
  );

  if (codeResult.rows.length === 0) {
    console.log(`❌ Code "${code}" not found.`);
    return;
  }

  const qrCode = codeResult.rows[0];
  
  // Check if already marked
  const attendanceResult = await db.execute(
    'SELECT id FROM attendance WHERE student_id = ? AND qr_id = ?',
    [student.id, code]
  );

  if (attendanceResult.rows.length > 0) {
    console.log(`⚠️  Student ${student.first_name} ${student.last_name} already has attendance for code ${code}.`);
    return;
  }

  // Add attendance
  try {
    await db.execute(
      'INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)',
      [student.id, code]
    );
    console.log(`\n✅ Attendance added successfully!`);
    console.log(`   Student: ${student.first_name} ${student.last_name}`);
    console.log(`   Code: ${code}`);
    console.log(`   Subject: ${qrCode.subject || 'Lecture'}\n`);
  } catch (err) {
    console.log(`❌ Error adding attendance: ${err.message}`);
  }
}

async function removeAttendance(studentEmail, code) {
  // Find student
  const studentResult = await db.execute(
    'SELECT id, first_name, last_name FROM users WHERE email = ? AND role = ?',
    [studentEmail, 'student']
  );

  if (studentResult.rows.length === 0) {
    console.log(`❌ Student with email "${studentEmail}" not found.`);
    return;
  }

  const student = studentResult.rows[0];

  // Check if attendance exists
  const attendanceResult = await db.execute(
    'SELECT id FROM attendance WHERE student_id = ? AND qr_id = ?',
    [student.id, code]
  );

  if (attendanceResult.rows.length === 0) {
    console.log(`⚠️  No attendance record found for ${student.first_name} ${student.last_name} with code ${code}.`);
    return;
  }

  // Remove attendance
  await db.execute(
    'DELETE FROM attendance WHERE student_id = ? AND qr_id = ?',
    [student.id, code]
  );

  console.log(`\n✅ Attendance record removed!`);
  console.log(`   Student: ${student.first_name} ${student.last_name}`);
  console.log(`   Code: ${code}\n`);
}

async function listAttendanceForCode(code) {
  // Check if code exists
  const codeResult = await db.execute(
    'SELECT id, subject, created_at FROM qr_codes WHERE id = ?',
    [code]
  );

  if (codeResult.rows.length === 0) {
    console.log(`❌ Code "${code}" not found.`);
    return;
  }

  const qrCode = codeResult.rows[0];
  
  console.log(`\n📋 Attendance for Code: ${code}`);
  console.log(`   Subject: ${qrCode.subject || 'Lecture'}`);
  console.log(`   Created: ${qrCode.created_at}\n`);

  const attendanceResult = await db.execute(`
    SELECT u.id, u.first_name, u.last_name, u.email, u.prn, a.marked_at
    FROM attendance a
    JOIN users u ON a.student_id = u.id
    WHERE a.qr_id = ?
    ORDER BY a.marked_at ASC
  `, [code]);

  if (attendanceResult.rows.length === 0) {
    console.log('No attendance records for this code.');
    return;
  }

  console.log(`Total: ${attendanceResult.rows.length} students present\n`);
  attendanceResult.rows.forEach((row, idx) => {
    console.log(`${idx + 1}. ${row.first_name} ${row.last_name}`);
    console.log(`   Email: ${row.email}`);
    console.log(`   PRN: ${row.prn || 'N/A'}`);
    console.log(`   Marked at: ${row.marked_at}\n`);
  });
}

run();
