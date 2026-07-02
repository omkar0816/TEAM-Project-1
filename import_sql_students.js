require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@libsql/client');

const db = createClient({ url: process.env.TURSO_DB_URL || 'file:attendance.db', authToken: process.env.TURSO_AUTH_TOKEN });

function unquote(value) {
  if (value === null || value === undefined) return null;
  let trimmed = value.trim();
  if (trimmed === 'NULL') return null;
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
      (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    trimmed = trimmed.slice(1, -1);
  }
  return trimmed.replace(/\\'/g, "'").replace(/\\"/g, '"');
}

function splitValues(valueString) {
  const values = [];
  let current = '';
  let inString = false;
  let quoteChar = null;
  let escape = false;
  for (let i = 0; i < valueString.length; i++) {
    const ch = valueString[i];
    if (escape) {
      current += ch;
      escape = false;
      continue;
    }
    if (ch === '\\') {
      current += ch;
      escape = true;
      continue;
    }
    if (inString) {
      current += ch;
      if (ch === quoteChar) {
        inString = false;
        quoteChar = null;
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      inString = true;
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (ch === ',') {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') {
    values.push(current.trim());
  }
  return values.map(unquote);
}

function parseInsertStatements(sql) {
  const inserts = [];
  const normalized = sql.replace(/\r\n/g, '\n');
  const insertRegex = /INSERT\s+INTO\s+([`'"]?\w+[`'"]?)\s*\(([^)]+)\)\s*VALUES\s*([^;]+);/gsi;
  let match;
  while ((match = insertRegex.exec(normalized)) !== null) {
    const table = match[1].replace(/[`'"]+/g, '');
    const columns = match[2].split(',').map(col => col.trim().replace(/[`'"\s]+/g, ''));
    let rawValues = match[3].trim();

    // Gather full values block that may contain nested parentheses and commas.
    if (!rawValues.endsWith(')')) {
      let nextIndex = insertRegex.lastIndex;
      while (nextIndex < normalized.length && !normalized[nextIndex - 1].endsWith(')')) {
        rawValues += normalized[nextIndex];
        nextIndex += 1;
      }
    }

    const rows = [];
    let current = '';
    let depth = 0;
    let inString2 = false;
    let quoteChar2 = null;
    for (let i = 0; i < rawValues.length; i++) {
      const ch = rawValues[i];
      if (inString2) {
        current += ch;
        if (ch === quoteChar2) {
          inString2 = false;
          quoteChar2 = null;
        }
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString2 = true;
        quoteChar2 = ch;
        current += ch;
        continue;
      }
      if (ch === '(') {
        depth += 1;
        current += ch;
        continue;
      }
      if (ch === ')') {
        depth -= 1;
        current += ch;
        if (depth === 0) {
          rows.push(current.trim());
          current = '';
        }
        continue;
      }
      if (depth === 0) continue;
      current += ch;
    }

    rows.forEach(row => {
      const rowText = row.trim();
      const inner = rowText.replace(/^\(+|\)+$/g, '').trim();
      const values = splitValues(inner);
      if (values.length === columns.length) {
        inserts.push({ table, columns, values });
      }
    });
  }
  return inserts;
}

function parseStudentRow(columns, values) {
  const row = {};
  columns.forEach((col, idx) => {
    row[col.toUpperCase()] = values[idx] || '';
  });
  return row;
}

async function importSqlFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const sql = fs.readFileSync(filePath, 'utf8');
  const inserts = parseInsertStatements(sql);

  if (inserts.length === 0) {
    console.log('No INSERT statements found in the SQL file.');
    console.log('If your file only defines CREATE TABLE statements, there are no student rows to import.');
    return;
  }

  let imported = 0;
  let skipped = 0;

  for (const insert of inserts) {
    if (insert.table.toUpperCase() === 'PERSONAL_INFO') {
      const row = parseStudentRow(insert.columns, insert.values);
      const fullName = row.NAME_STD || `${row.FIRST_NAME || ''} ${row.LAST_NAME || ''}`.trim();
      const email = (row.EMAIL || '').trim();
      const prn = (row.STUDENT_PRN || row.PRN || '').trim();
      const year = (row.YEAR || '').trim() || 'FE';
      const department = (row.DEPARTMENT || row.DEPT || '').trim() || 'Computer Engineering';
      const className = (row.CLASS || row.YEAR || '').trim() || year;

      if (!email || !prn || !fullName) {
        skipped += 1;
        continue;
      }

      const passwordHash = await bcrypt.hash(prn, 10);

      try {
        await db.execute(
          'INSERT OR IGNORE INTO students (prn, roll_no, name, email, class, department, year, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [prn, null, fullName, email.toLowerCase(), className, department, year, passwordHash]
        );
        imported += 1;
        console.log(`Imported student: ${fullName} <${email}>`);
      } catch (err) {
        skipped += 1;
        console.error(`Error importing ${email}:`, err.message || err);
      }
    }
  }

  console.log(`\nImport complete: ${imported} imported, ${skipped} skipped.`);
}

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.log('Usage: node import_sql_students.js <path-to-sql-file>');
  process.exit(1);
}

const sqlFilePath = path.resolve(process.cwd(), args[0]);
importSqlFile(sqlFilePath)
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Import failed:', err);
    process.exit(1);
  });
