require('dotenv').config();
const { db, initDB } = require('./src/models/database');
const bcrypt = require('bcrypt');

async function createTestData() {
  try {
    console.log('Creating test data...');

    // Initialize database first
    await initDB();

    // Create a test teacher
    const teacherPassword = await bcrypt.hash('teacher123', 10);
    await db.execute(
      'INSERT OR REPLACE INTO teachers (emp_id, name, email, department, subject, password_hash, password_changed) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ['T001', 'Dr. Smith', 'teacher@wadia.ac.in', 'Computer Engineering', 'Data Structures', teacherPassword, true]
    );
    console.log('Test teacher created: teacher@wadia.ac.in / teacher123');

    // Import students from CSV
    const fs = require('fs');
    const csvData = fs.readFileSync('./sample_students.csv', 'utf8');
    const lines = csvData.split('\n').filter(line => line.trim()).slice(1); // Skip header

    for (const line of lines) {
      try {
        const [fullName, email, prn, year, department] = line.split(',').map(field => field.trim().replace(/"/g, ''));

        // Get next roll number
        const rollResult = await db.execute('SELECT MAX(roll_no) as max_roll FROM students');
        const nextRollNo = (rollResult.rows[0]?.max_roll || 0) + 1;

        await db.execute(
          'INSERT OR REPLACE INTO students (prn, roll_no, name, email, class, department, year) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [prn, nextRollNo, fullName, email, year, department, year]
        );
        console.log(`Inserted student: ${email}`);
      } catch (err) {
        console.error(`Error inserting student from line: ${line}`, err);
      }
    }

    console.log(`Imported ${lines.length} students`);
    console.log('Test student: ravi.sharma@wadia.ac.in / 72123456789 (PRN as password)');

  } catch (error) {
    console.error('Error creating test data:', error);
  } finally {
    process.exit(0);
  }
}

createTestData();