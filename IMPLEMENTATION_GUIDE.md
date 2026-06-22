# 🛠️ STEP-BY-STEP IMPLEMENTATION GUIDE

## Priority Order

1. **Fix attendance table** (breaks entire system)
2. **Add student password** (security critical)
3. **Fix all queries** (data loss prevention)
4. **Add error handling** (stability)
5. **Performance improvements** (user experience)

---

## STEP 1: Fix Attendance Table Schema

### Current Problem
Your `attendance` table uses `PRN TEXT` but all queries expect `student_id INTEGER`

### SQL Migration

```sql
-- Step 1: Check current structure
PRAGMA table_info(attendance);
-- Should show: id, PRN, qr_id, marked_at

-- Step 2: Add student_id column
ALTER TABLE attendance ADD COLUMN student_id INTEGER;

-- Step 3: Populate student_id from PRN
UPDATE attendance
SET student_id = (
  SELECT id FROM students 
  WHERE students.prn = attendance.PRN 
  LIMIT 1
)
WHERE student_id IS NULL;

-- Step 4: Add foreign key
ALTER TABLE attendance 
  ADD FOREIGN KEY (student_id) REFERENCES students(id);

-- Step 5: Drop PRN column (after testing!)
-- ALTER TABLE attendance DROP COLUMN PRN;
```

### Update server.js - All Attendance Inserts

**Location 1: Line ~430 (mark-attendance GET)**
```javascript
// BEFORE:
await db.execute(
  'INSERT INTO attendance (PRN, qr_id) VALUES (?, ?)',
  [prn, code]
);

// AFTER:
const studentId = req.session.userId; // We already have this from session
await db.execute(
  'INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)',
  [studentId, code]
);
```

**Location 2: Line ~456 (mark-attendance-post)**
```javascript
// BEFORE:
await db.execute(
  'INSERT INTO attendance (PRN, qr_id) VALUES (?, ?)',
  [prn, code]
);

// AFTER:
const studentId = req.session.userId;
await db.execute(
  'INSERT INTO attendance (student_id, qr_id) VALUES (?, ?)',
  [studentId, code]
);
```

**Location 3: Line ~1000+ (add-attendance manual)**
```javascript
// BEFORE:
await db.execute(
  'INSERT OR IGNORE INTO attendance (student_id, qr_id) VALUES (?, ?)',
  [student.id, session_code]
);

// This one is ALREADY correct! Just make sure student.id exists
```

### Test the fix

```bash
# After making changes, test these endpoints:
curl http://localhost:3000/session-attendance?code=12345
curl http://localhost:3000/my-attendance
curl http://localhost:3000/my-sessions
```

---

## STEP 2: Add Student Password Authentication

### Database Migration

```sql
ALTER TABLE students ADD COLUMN password_hash TEXT;
```

### Update server.js - Signup

**Find line ~230 (in /signup endpoint)**

```javascript
// BEFORE:
if (role === 'student') {
  if (!prn) {
    return res.status(400).json({ success: false, message: 'PRN is required for students' });
  }
  if (!year) {
    return res.status(400).json({ success: false, message: 'Year is required for students' });
  }
  if (!department) {
    return res.status(400).json({ success: false, message: 'Department is required for students' });
  }

  const rollNo = /^\d+$/.test(prn) ? prn : null;
  const className = year;

  await db.execute(
    'INSERT INTO students (prn, roll_no, name, email, class, department, year) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [prn, rollNo, fullName || 'Unknown Student', email, className, department, year]
  );
}

// AFTER:
if (role === 'student') {
  if (!prn) {
    return res.status(400).json({ success: false, message: 'PRN is required for students' });
  }
  if (!year) {
    return res.status(400).json({ success: false, message: 'Year is required for students' });
  }
  if (!department) {
    return res.status(400).json({ success: false, message: 'Department is required for students' });
  }
  if (!password || password.length < 6) {
    return res.status(400).json({ success: false, message: 'Password is required (minimum 6 characters)' });
  }

  const rollNo = /^\d+$/.test(prn) ? prn : null;
  const className = year;
  const passwordHash = await bcrypt.hash(password, 10);

  await db.execute(
    'INSERT INTO students (prn, roll_no, name, email, class, department, year, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [prn, rollNo, fullName || 'Unknown Student', email, className, department, year, passwordHash]
  );
}
```

### Update server.js - Login

**Find line ~150 (in /login endpoint)**

```javascript
// BEFORE:
if (role === 'student') {
  if (!email) {
    return res.json({ success: false, message: 'Email is required for student login' });
  }
  if (!prn) {
    return res.json({ success: false, message: 'PRN is required for student login' });
  }

  const result = await db.execute('SELECT * FROM students WHERE email = ? AND prn = ?', [email, prn]);
  const student = result.rows[0];

  if (!student) {
    return res.json({ success: false, message: 'Student account not found with this email and PRN combination. Please sign up first.' });
  }

  req.session.userId = student.id;
  req.session.role = 'student';
  res.json({ success: true, role: 'student' });
}

// AFTER:
if (role === 'student') {
  if (!email) {
    return res.json({ success: false, message: 'Email is required for student login' });
  }
  if (!prn) {
    return res.json({ success: false, message: 'PRN is required for student login' });
  }
  if (!password) {
    return res.json({ success: false, message: 'Password is required for student login' });
  }

  const result = await db.execute('SELECT * FROM students WHERE email = ? AND prn = ?', [email, prn]);
  const student = result.rows[0];

  if (!student) {
    return res.json({ success: false, message: 'Student account not found. Please sign up first.' });
  }

  const passwordMatches = await bcrypt.compare(password, student.password_hash || '');
  if (!passwordMatches) {
    return res.json({ success: false, message: 'Invalid password' });
  }

  req.session.userId = student.id;
  req.session.role = 'student';
  res.json({ success: true, role: 'student' });
}
```

### Update index.html - Student Signup Form

**Add password field after PRN field:**

```html
<!-- Find the student signup form and add: -->
<div class="form-group">
  <label for="studentPassword">Password</label>
  <input 
    id="studentPassword" 
    type="password" 
    placeholder="Min. 6 characters" 
    required
  />
</div>

<!-- In JavaScript that collects form data: -->
const password = document.getElementById('studentPassword').value;
// Add password to fetch body:
body: JSON.stringify({
  role: 'student',
  firstName,
  lastName,
  email,
  prn,
  year,
  department,
  password  // Add this
})
```

### Update index.html - Student Login Form

**Add password field:**

```html
<!-- In student login form: -->
<div class="form-group">
  <label for="studentPassword">Password</label>
  <input 
    id="studentPassword" 
    type="password" 
    placeholder="Your password" 
    required
  />
</div>

<!-- In JavaScript that submits login: -->
const password = document.getElementById('studentPassword').value;
// Add password to fetch body:
body: JSON.stringify({
  role: 'student',
  email,
  prn,
  password  // Add this
})
```

---

## STEP 3: Fix All Query Issues

### Issue 1: `/session-attendance` endpoint (Line ~500)

```javascript
// BEFORE:
const attendanceResult = await db.execute(`
  SELECT u.name as student_name, u.prn, u.email, a.marked_at
  FROM attendance a
  JOIN students u ON a.student_id = u.id
  WHERE a.qr_id = ?
  ORDER BY a.marked_at ASC
`, [code]);

// AFTER: (This one is actually correct, but make sure student_id column exists!)
const attendanceResult = await db.execute(`
  SELECT u.name as student_name, u.prn, u.email, a.marked_at, u.roll_no
  FROM attendance a
  JOIN students u ON a.student_id = u.id
  WHERE a.qr_id = ?
  ORDER BY a.marked_at ASC
`, [code]);
res.json({
  session: codeRow,
  students: attendanceResult.rows
});
```

### Issue 2: `/my-attendance` endpoint (Line ~635)

```javascript
// BEFORE:
const result = await db.execute(`
  SELECT a.marked_at, q.subject, t.name as teacher_name
  FROM attendance a
  JOIN qr_codes q ON a.qr_id = q.id
  JOIN teachers t ON q.teacher_id = t.id
  WHERE a.student_id = ?
  ORDER BY a.marked_at DESC
`, [req.session.userId]);

// AFTER: (Also correct, just ensure student_id exists)
// This query is fine!
```

### Issue 3: `/my-sessions` endpoint (Line ~655)

```javascript
// BEFORE:
const result = await db.execute(`
  SELECT q.id as code, q.subject, q.created_at, q.expires_at,
         CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END as present,
         t.name as teacher_name
  FROM qr_codes q
  LEFT JOIN attendance a ON q.id = a.qr_id AND a.student_id = ?
  LEFT JOIN teachers t ON q.teacher_id = t.id
  ORDER BY q.created_at DESC
`, [req.session.userId]);

// AFTER: (Already correct!)
```

### Issue 4: Excel Download - Monthly Report (Line ~800)

```javascript
// BEFORE: Multiple problems
const attended = await db.execute({
  sql: `SELECT qr_id FROM attendance WHERE student_id = ? AND qr_id IN (${sessionCodes.map(() => '?').join(',')})`,
  args: [student.id, ...sessionCodes]
});

sheet.addRow(['Teacher', `${teacher.first_name || ''} ${teacher.last_name || ''}`.trim()]);

// AFTER:
const attended = await db.execute({
  sql: `SELECT DISTINCT qr_id FROM attendance 
        WHERE student_id = ? AND qr_id IN (${sessionCodes.map(() => '?').join(',')})`,
  args: [student.id, ...sessionCodes]
});

// Parse teacher name properly:
const [teacherFirst, ...teacherRest] = (teacher.name || 'Teacher').split(' ');
const teacherLast = teacherRest.join(' ');
sheet.addRow(['Teacher', `${teacherFirst} ${teacherLast}`.trim()]);
```

### Issue 5: Excel Download - Lecture Report (Line ~865)

```javascript
// BEFORE:
for (const s of allStudents.rows) {
  sheet.addRow([`${s.first_name || ''} ${s.last_name || ''}`.trim(), s.email, attendedEmails.has(s.email) ? 'Present' : 'Absent']);
}

// AFTER:
for (const s of allStudents.rows) {
  const [firstName, ...rest] = (s.name || '').split(' ');
  const lastName = rest.join(' ');
  sheet.addRow([`${firstName} ${lastName}`.trim(), s.email, attendedEmails.has(s.email) ? 'Present' : 'Absent']);
}
```

---

## STEP 4: Add Database Indexes

### Update database.js

Add after all table creation (around line 100-110):

```javascript
// Create indexes for performance
const createIndexes = async () => {
  try {
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_email ON students(email)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_students_prn ON students(prn)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_teachers_email ON teachers(email)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_teachers_emp_id ON teachers(emp_id)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_qr_codes_teacher_id ON qr_codes(teacher_id)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_qr_codes_expires_at ON qr_codes(expires_at)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_student_id ON attendance(student_id)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_qr_id ON attendance(qr_id)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_attendance_created_at ON attendance(created_at)`);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_qr_codes_display_code ON qr_codes(display_code)`);
    console.log('All indexes created successfully');
  } catch (err) {
    console.warn('Some indexes may already exist:', err.message);
  }
};

// Call in initDB:
async function initDB() {
  try {
    // ... all table creation ...
    
    // Create indexes
    await createIndexes();
    
    // ... seeding ...
  }
}
```

---

## STEP 5: Add Rate Limiting

### server.js - Add at top with other imports

```javascript
const rateLimit = require('express-rate-limit');

// Limit login attempts
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts. Try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip, // Use IP address
});

// Limit attendance attempts
const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 attempts per minute
  message: 'Too many attempts. Try again in a minute.',
});

// Limit code generation
const codeGenerationLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 codes per minute per teacher
  message: 'You can generate max 5 codes per minute.',
});
```

### server.js - Apply limiters to routes

```javascript
// Update these routes:
app.post('/login', loginLimiter, async (req, res) => { ... });
app.post('/mark-attendance-post', attendanceLimiter, async (req, res) => { ... });
app.post('/generate-code', codeGenerationLimiter, async (req, res) => { ... });
```

---

## STEP 6: Improve Error Handling

### Create middleware/errorHandler.js

```javascript
class AppError extends Error {
  constructor(message, statusCode, code) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  const code = err.code || 'INTERNAL_ERROR';
  
  console.error(`[${code}] ${message}`);
  
  res.status(statusCode).json({
    success: false,
    error: message,
    code: code,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
};

module.exports = { AppError, errorHandler };
```

### Use in routes

```javascript
const { AppError, errorHandler } = require('./middleware/errorHandler');

app.post('/mark-attendance-post', attendanceLimiter, async (req, res, next) => {
  try {
    const { code } = req.body;
    if (!code) {
      throw new AppError('Code is required', 400, 'MISSING_CODE');
    }
    
    const now = Math.floor(Date.now() / 1000);
    const codeResult = await db.execute(
      'SELECT id FROM qr_codes WHERE id = ? AND expires_at > ?',
      [code, now]
    );
    
    if (!codeResult.rows[0]) {
      throw new AppError('Code expired or invalid', 410, 'CODE_EXPIRED');
    }
    
    // ... rest of code ...
  } catch (err) {
    next(err); // Pass to error handler
  }
});

// Add error handler middleware at the END:
app.use(errorHandler);
```

---

## Testing Checklist

After making changes, test these scenarios:

```bash
# 1. Test student signup with password
curl -X POST http://localhost:3000/signup \
  -H "Content-Type: application/json" \
  -d '{
    "role": "student",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "prn": "12345678901",
    "year": "2",
    "department": "CSE",
    "password": "SecurePass123"
  }'

# 2. Test student login with password
curl -X POST http://localhost:3000/login \
  -H "Content-Type: application/json" \
  -d '{
    "role": "student",
    "email": "john@example.com",
    "prn": "12345678901",
    "password": "SecurePass123"
  }'

# 3. Test attendance marking
curl -X POST http://localhost:3000/mark-attendance-post \
  -H "Content-Type: application/json" \
  -b "connect.sid=YOUR_SESSION_ID" \
  -d '{"code": "12345"}'

# 4. Test session-attendance (should show student names)
curl http://localhost:3000/session-attendance?code=12345

# 5. Test my-attendance
curl http://localhost:3000/my-attendance \
  -b "connect.sid=YOUR_SESSION_ID"

# 6. Test Excel download
curl http://localhost:3000/download/monthly-report \
  -b "connect.sid=YOUR_SESSION_ID" \
  -o report.xlsx
```

---

## Deployment Steps

1. Backup database
2. Apply SQL migrations
3. Update server.js code
4. Update HTML forms
5. Test all endpoints
6. Deploy to production
7. Monitor logs for errors
8. Update documentation

