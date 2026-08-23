const attendanceService = require('../services/attendanceService');
const attendanceRepository = require('../repositories/attendanceRepository');
const LocationService = require('../services/locationService');

async function markAttendanceGet(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('Invalid code');

  try {
    if (req.session.userId && req.session.role === 'student') {
      // GET link flow (e.g. from a scanned/shared link) has no location payload;
      // route it through the same location-aware check as the POST flow.
      return res.status(400).send('Please open the attendance page and mark attendance from there so your location can be verified.');
    }

    const safeCode = encodeURIComponent(code);
    return res.send(`
      <h1>Mark Attendance</h1>
      <p>You need to be logged in as a student.</p>
      <a href="/">Login</a>
      <br><br>
      <button onclick="mark()">Mark Attendance</button>
      <script>
        function mark() {
          fetch('/mark-attendance-post', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: decodeURIComponent('${safeCode}') })
          })
            .then(res => res.text())
            .then(msg => alert(msg));
        }
      </script>
    `);
  } catch (err) {
    console.error('Mark attendance error:', err);
    return res.status(500).send('Error marking attendance');
  }
}

async function markAttendancePost(req, res) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized - Please login first'
    });
  }

  if (req.session.role !== 'student') {
    return res.status(403).json({
      success: false,
      message: 'Only students can mark attendance'
    });
  }

  const { code, latitude, longitude, accuracy } = req.body;
  if (!code) return res.status(400).send('Invalid code');

  const permission = await LocationService.checkLocationPermissionStatus(req.session.userId, 'student');
  if (!permission.permissionGranted) {
    return res.status(403).send('Location permission is required to mark attendance. Please log in again and allow location access.');
  }

  try {
    const location = {
      latitude,
      longitude,
      accuracy,
      ipAddress: req.ip || req.connection.remoteAddress,
    };
    const result = await attendanceService.markAttendance(req.session.userId, code, location);
    if (!result.success) {
      return res.status(result.status || 500).send(result.message);
    }
    return res.send(`Attendance marked successfully! (${result.distanceMeters}m from teacher)`);
  } catch (err) {
    console.error('Mark attendance POST error:', err);
    return res.status(500).send('Error marking attendance');
  }
}

async function sessions(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  try {
    const rows = await attendanceRepository.getTeacherSessions(req.session.userId);
    return res.json(rows);
  } catch (err) {
    console.error('Sessions error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function sessionAttendance(req, res) {
  if (!req.session.userId || req.session.role !== 'teacher') {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    const codeRow = await attendanceRepository.getSessionByCodeAndTeacher(code, req.session.userId);
    if (!codeRow) return res.status(404).json({ error: 'Session not found' });
    const students = await attendanceRepository.getSessionAttendance(code);
    return res.json({ session: codeRow, students });
  } catch (err) {
    console.error('Session attendance error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function liveCount(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).json({ error: 'Code required' });

  try {
    const students = await attendanceRepository.getLiveAttendance(code);
    return res.json({ count: students.length, students });
  } catch (err) {
    console.error('Live count error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

module.exports = {
  markAttendanceGet,
  markAttendancePost,
  sessions,
  sessionAttendance,
  liveCount,
};