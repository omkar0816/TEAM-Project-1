# Wadia Attendance System

A production-ready attendance management system for educational institutions, featuring advanced anti-proxy measures, comprehensive analytics, and enterprise-grade security.

## 🚀 Key Features

### Anti-Proxy Attendance System
- **Device Lock**: One attendance per device per session
- **Location Validation**: GPS-based campus boundary checking
- **Browser Fingerprinting**: Advanced device identification
- **50-Second Time Windows**: Prevents code sharing

### Advanced Analytics Dashboard
- **Teacher Dashboard**: Session stats, subject-wise breakdown, low-attendance alerts
- **Real-time Monitoring**: Live attendance counters during active sessions
- **Excel Export**: Download attendance reports by date, subject, or class
- **Audit Logs**: Complete accountability with who-did-what tracking

### Enterprise Security
- **Clean Database Schema**: Normalized tables (students, teachers, subjects, sessions, records)
- **Session Security**: HTTPOnly, Secure, SameSite cookies with 30-minute expiry
- **Password Policies**: Forced password changes for default accounts
- **Role-based Access**: Separate student/teacher authentication

### Production Ready
- **Docker Deployment**: Containerized with health checks
- **Database Backup**: Automated daily backups with API endpoints
- **Connection Pooling**: Handles 100+ concurrent students
- **Health Monitoring**: `/health` endpoint for load balancers

## 🏗️ Architecture

```
src/
├── models/          # Database schemas and queries
├── services/        # Business logic (session store, etc.)
├── controllers/     # Route handlers
├── middleware/      # Authentication, validation
├── utils/          # Helper functions
└── routes/         # API route definitions

public/             # Static assets
backups/            # Database backups
```

## 🛠️ Tech Stack

- **Backend**: Node.js, Express.js
- **Database**: Turso (SQLite-compatible) with connection pooling
- **Authentication**: Session-based with bcrypt hashing
- **Export**: ExcelJS for attendance reports
- **Deployment**: Docker + docker-compose
- **Security**: Rate limiting, input validation, audit logging

## 📊 Database Schema

- `students` - Student information
- `teachers` - Teacher accounts with password policies
- `subjects` - Course catalog
- `attendance_sessions` - QR code sessions with expiry
- `attendance_records` - Individual attendance marks with device/location data
- `audit_logs` - Complete activity tracking

## 🚀 Quick Start

### Local Development
```bash
git clone https://github.com/omkar0816/TEAM-Project-1.git
cd TEAM-Project-1
npm install
cp .env.example .env
npm start
```

### Docker Deployment
```bash
docker-compose up -d
```

### Environment Variables
```env
TURSO_DB_URL=file:attendance.db
SESSION_SECRET=your-secure-session-secret
DEFAULT_TEACHER_EMAIL=admin@college.edu
DEFAULT_TEACHER_PASSWORD=TempPass123!
```

## 📈 API Endpoints

### Authentication
- `POST /login` - User authentication
- `POST /change-password` - Force password change

### Teacher Operations
- `POST /generate-session` - Create attendance session
- `GET /sessions` - List all sessions
- `GET /session-attendance` - View session details
- `GET /teacher-analytics` - Dashboard analytics
- `GET /export-attendance` - Excel export

### Student Operations
- `POST /mark-attendance` - Mark attendance with anti-proxy checks

### System
- `GET /health` - Health check
- `POST /backup-database` - Manual backup
- `POST /auto-backup` - Automated backup

## 🔒 Security Features

- **Device Fingerprinting**: Prevents multiple attendance from same device
- **Location Validation**: Campus GPS boundary checking
- **Session Expiry**: 30-minute inactivity timeout
- **Rate Limiting**: Prevents brute force attacks
- **Audit Logging**: Complete activity tracking
- **Input Validation**: Sanitized user inputs
- **Password Hashing**: bcrypt with salt rounds

## 📊 Analytics

- **Real-time Attendance**: Live counters during sessions
- **Subject-wise Reports**: Performance by course
- **Low Attendance Alerts**: Students below 75%
- **Historical Trends**: Session-by-session analysis
- **Excel Exports**: Professional reports for administration

## 🔄 Deployment

### Docker
```bash
docker build -t attendance-system .
docker run -p 3000:3000 attendance-system
```

### docker-compose
```bash
docker-compose up -d
```

### Health Checks
```bash
curl http://localhost:3000/health
# Returns: {"status":"ok","uptime":123.45}
```

## 📋 Production Checklist

- [x] Clean database schema with proper normalization
- [x] Session security with HTTPOnly/Secure/SameSite
- [x] Password change enforcement
- [x] Device lock and location validation
- [x] Audit logging system
- [x] Excel export functionality
- [x] Analytics dashboard
- [x] Docker containerization
- [x] Health check endpoints
- [x] Database backup system
- [x] Professional folder structure
- [x] Connection pooling for 100+ users
- [ ] API documentation (Swagger/Postman)
- [ ] Admin panel (future enhancement)

## 🤝 Contributing

This system is designed for college deployment with enterprise-grade reliability and anti-proxy measures that make attendance tracking trustworthy and administration effortless.
   ```

4. Fill in your Turso connection values in `.env` if you want to use a remote database:
   ```env
   TURSO_DB_URL=libsql://your-database-url
   TURSO_AUTH_TOKEN=your-turso-auth-token
   SESSION_SECRET=some-strong-secret
   ```

5. Start the server:
   ```bash
   npm start
   # or
   node server.js
   ```

6. Open your browser and navigate to `http://localhost:3000`

## Student Data Import

To pre-populate the system with your class student data:

1. **Prepare CSV File**: Create a CSV file with student information in this format:
   ```
   Name,Email,PRN,Year,Department
   "John Doe",john.doe@wadia.ac.in,72123456789,FE,Computer Engineering 1
   "Jane Smith",jane.smith@wadia.ac.in,72123456790,FE,Electronics & Telecom 1
   ```

2. **Import Students from CSV**:
   ```bash
   node import_students.js your_students.csv
   ```

3. **Import Students from SQL** (if your file contains `INSERT` rows into `PERSONAL_INFO`):
   ```bash
   node import_sql_students.js collegeattendance.sql
   ```

4. **Default Login**: Students can login with:
   - **Email**: Their college email
   - **Password**: Their PRN number (can be changed later)

### Sample Data
A sample CSV file (`sample_students.csv`) is included for testing.

**Note**: The import script will skip duplicate emails and provide a summary of imported/skipped students.

## Database Schema

- **Users**: Stores student and teacher information
- **QR Codes**: Temporary codes generated by teachers
- **Attendance**: Records of marked attendance

## Security Features

- Session-based authentication
- Role-based access control
- Time-limited codes to prevent proxy attendance
- Input validation and sanitization

## Future Enhancements

- Monthly attendance reports
- Subject-wise attendance tracking
- Mobile app integration
- Email notifications
- Advanced analytics dashboard

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is developed for educational purposes at Wadia College of Engineering.

---

**Note**: The database file (`attendance.db`) is excluded from version control. It will be created automatically when you run the application.
