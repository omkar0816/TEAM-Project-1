const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

// Connect to database
const db = new sqlite3.Database('./attendance.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
  }
});

// Function to import students from CSV
function importStudentsFromCSV(csvFilePath) {
  const csvData = fs.readFileSync(csvFilePath, 'utf8');
  const lines = csvData.split('\n').filter(line => line.trim());

  // Skip header row
  const dataLines = lines.slice(1);

  console.log(`Importing ${dataLines.length} students...`);

  let imported = 0;
  let skipped = 0;

  dataLines.forEach((line, index) => {
    if (!line.trim()) return;

    // Assuming CSV format: Name,Email,PRN,Year,Department
    // Adjust based on your actual CSV structure
    const [fullName, email, prn, year, department] = line.split(',').map(field => field.trim().replace(/"/g, ''));

    if (!fullName || !email || !prn) {
      console.log(`Skipping line ${index + 2}: Missing required fields`);
      skipped++;
      return;
    }

    // Split name into first and last
    const nameParts = fullName.split(' ');
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    // Generate a default password (students can change later)
    const defaultPassword = prn; // Using PRN as default password

    // Insert student
    db.run(`INSERT OR IGNORE INTO users (email, password, role, first_name, last_name, prn, year, department)
            VALUES (?, ?, 'student', ?, ?, ?, ?, ?)`,
      [email, defaultPassword, firstName, lastName, prn, year || 'FE', department || 'Computer Engineering'],
      function(err) {
        if (err) {
          console.error(`Error importing ${email}:`, err.message);
        } else if (this.changes > 0) {
          imported++;
          console.log(`✓ Imported: ${fullName} (${email})`);
        } else {
          skipped++;
          console.log(`⚠ Skipped (already exists): ${email}`);
        }
      });
  });

  // Close database after a delay to allow all inserts to complete
  setTimeout(() => {
    console.log(`\nImport complete!`); 
    console.log(`Imported: ${imported} students`);
    console.log(`Skipped: ${skipped} students`);
    db.close();
  }, 2000);
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

importStudentsFromCSV(csvPath);