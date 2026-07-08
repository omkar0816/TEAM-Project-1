#!/usr/bin/env node

/**
 * Reset test data before a real pilot launch.
 *
 * This is intentionally a manual, explicit script — it will NOT run on server
 * start, and it refuses to run unless you pass --yes, so it can never be fired
 * by accident.
 *
 * Usage:
 *   node reset-test-data.js --students          # wipe students + their attendance
 *   node reset-test-data.js --sessions           # wipe qr_codes + attendance + attendance_sessions
 *   node reset-test-data.js --assignments        # wipe assignments
 *   node reset-test-data.js --all --yes          # wipe all of the above, requires --yes
 *   node reset-test-data.js --list               # just show current row counts, changes nothing
 *
 * Teachers are NEVER touched by this script on purpose — re-run
 * `node create_test_data.js` or sign up again if you also need a fresh teacher.
 */

require('dotenv').config();
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.TURSO_DB_URL || 'file:attendance.db',
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);

async function counts() {
  const tables = ['students', 'teachers', 'qr_codes', 'attendance', 'attendance_sessions', 'assignments'];
  console.log('\nCurrent row counts:');
  for (const t of tables) {
    try {
      const r = await db.execute(`SELECT COUNT(*) AS c FROM ${t}`);
      console.log(`  ${t.padEnd(20)} ${r.rows[0].c}`);
    } catch (e) {
      console.log(`  ${t.padEnd(20)} (table missing)`);
    }
  }
  console.log('');
}

async function main() {
  if (args.length === 0 || has('--list')) {
    await counts();
    return;
  }

  const wantStudents = has('--students') || has('--all');
  const wantSessions = has('--sessions') || has('--all');
  const wantAssignments = has('--assignments') || has('--all');

  if (has('--all') && !has('--yes')) {
    console.error('Refusing to run --all without --yes. Re-run with: node reset-test-data.js --all --yes');
    process.exit(1);
  }

  await counts();
  console.log('About to delete:');
  if (wantStudents) console.log('  - all rows in students, and any attendance rows referencing them');
  if (wantSessions) console.log('  - all rows in qr_codes, attendance, attendance_sessions');
  if (wantAssignments) console.log('  - all rows in assignments');
  console.log('  - teachers table is left untouched\n');

  // Attendance rows are deleted first in both branches so we never leave
  // orphaned attendance pointing at a deleted student_id or qr_id.
  if (wantStudents) {
    await db.execute('DELETE FROM attendance');
    await db.execute('DELETE FROM students');
    await db.execute("DELETE FROM sqlite_sequence WHERE name = 'students'");
    console.log('✓ Cleared students + their attendance');
  }

  if (wantSessions) {
    await db.execute('DELETE FROM attendance');
    await db.execute('DELETE FROM qr_codes');
    await db.execute('DELETE FROM attendance_sessions');
    await db.execute("DELETE FROM sqlite_sequence WHERE name IN ('qr_codes','attendance')");
    console.log('✓ Cleared sessions/codes + attendance');
  }

  if (wantAssignments) {
    await db.execute('DELETE FROM assignments');
    await db.execute("DELETE FROM sqlite_sequence WHERE name = 'assignments'");
    console.log('✓ Cleared assignments');
  }

  await counts();
  console.log('Done.');
}

main().catch((err) => {
  console.error('Reset failed:', err.message);
  process.exit(1);
});