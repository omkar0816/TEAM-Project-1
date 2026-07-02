const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');
const { promisify } = require('util');

// Connect to database
const db = new sqlite3.Database('./attendance.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

const dbGet = promisify(db.get.bind(db));
const dbRun = promisify(db.run.bind(db));

// Function to import students from CSV
async function importStudentsFromCSV(csvFilePath) {
  const csvData = fs.readFileSync(csvFilePath, 'utf8');
  const lines = csvData.split('\n').filter(line => line.trim());

  // Skip header row
  const dataLines = lines.slice(1);

  console.log(`Importing ${dataLines.length} students...`);

  let imported = 0;
  let skipped = 0;

  for (const [index, line] of dataLines.entries()) {
    if (!line.trim()) continue;

    const [fullName, email, prn, year, department] = line.split(',').map(field => field.trim().replace(/"/g, ''));

    if (!fullName || !email || !prn) {
      console.log(`Skipping line ${index + 2}: Missing required fields`);
      skipped++;
      continue;
    }

    const defaultPassword = prn; // Using PRN as default password
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    const rollResult = await dbGet('SELECT MAX(CAST(roll_no AS INTEGER)) AS max_roll FROM students');
    const nextRollNo = (rollResult?.max_roll || 0) + 1;

    try {
      await dbRun(
        `INSERT OR IGNORE INTO students (prn, roll_no, name, email, class, department, year, password_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [prn, String(nextRollNo), fullName, email, year || 'FE', department || 'Computer Engineering', year || 'FE', passwordHash]
      );

      imported++;
      console.log(`✓ Imported: ${fullName} (${email})`);
    } catch (err) {
      skipped++;
      console.error(`Error importing ${email}:`, err.message || err);
    }
  }

  console.log(`\nImport complete!`);
  console.log(`Imported: ${imported} students`);
  console.log(`Skipped: ${skipped} students`);
  db.close();
}

// Usage: node import_students.js path/to/your/students.csv
if (process.argv.length < 3) {
  console.log('Usage: node import_students.js <csv_file_path>');
  console.log('Expected CSV format: Name,Email,PRN,Year,Department');
  console.log('Example: "John Doe",john.doe@wadia.ac.in,72123456789,FE,Computer Engineering');
  process.exit(1);
}

const csvPath = process.argv[2];
if (!fs.existsSync(csvPath)) {
  console.error(`File not found: ${csvPath}`);
  process.exit(1);
}

importStudentsFromCSV(csvPath).catch(err => {
  console.error('Import failed:', err);
  db.close();
});
