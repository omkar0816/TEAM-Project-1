const attendanceService = require('../services/attendanceService');
const attendanceRepository = require('../repositories/attendanceRepository');

async function markAttendanceGet(req, res) {
  const { code } = req.query;
  if (!code) return res.status(400).send('Invalid code');

  try {
    if (req.session.userId && req.session.role === 'student') {
      const result = await attendanceService.markAttendance(req.session.userId, code);
      if (!result.success) {
        return res.status(result.status || 500).send(result.message);
      }
      return res.send('Attendance marked successfully!');
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

// Add these constants and helper function at the top of your file (below the requires)
const COLLEGE_LAT = 18.53472; // Wadia Coordinates
const COLLEGE_LON = 73.88094;     
const MAX_DISTANCE_METERS = 500;

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const rad = Math.PI / 180;
    const dLat = (lat2 - lat1) * rad;
    const dLon = (lon2 - lon1) * rad;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * rad) * Math.cos(lat2 * rad) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
// Add to your attendanceController.js
async function getActiveStudentSessions(req, res) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        // You'll need to create this repository function to query your DB for open sessions
        // It should SELECT code, subject_name, teacher_name FROM sessions WHERE status = 'active'
        const activeSessions = await attendanceRepository.getAllActiveSessions(); 
        return res.json(activeSessions);
    } catch (err) {
        console.error('Fetch active sessions error:', err);
        return res.status(500).json({ error: 'Database error' });
    }
}

// Don't forget to export it at the bottom!
module.exports = {
  // ... existing exports
  getActiveStudentSessions
};

// Replace your existing markAttendancePost with this:
async function markAttendancePost(req, res) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ success: false, message: 'Unauthorized - Please login first' });
  }

  if (req.session.role !== 'student') {
    return res.status(403).json({ success: false, message: 'Only students can mark attendance' });
  }

  // Now we expect latitude, longitude, and the session code from the frontend
  const { code, latitude, longitude } = req.body; 
  
  if (!latitude || !longitude) {
      return res.status(400).json({ success: false, message: 'Location data is required.' });
  }

  // 1. Verify Location on the Backend
  const distance = calculateDistance(latitude, longitude, COLLEGE_LAT, COLLEGE_LON);
  if (distance > MAX_DISTANCE_METERS) {
      return res.status(403).json({ 
          success: false, 
          message: `Location spoofing detected. You are ${Math.round(distance)}m away from campus.` 
      });
  }

  // 2. Mark the Attendance (Face match was already verified on the frontend)
  try {
    const result = await attendanceService.markAttendance(req.session.userId, code);
    if (!result.success) {
      return res.status(result.status || 500).json({ success: false, message: result.message });
    }
    return res.json({ success: true, message: 'Attendance marked successfully!' });
  } catch (err) {
    console.error('Mark attendance POST error:', err);
    return res.status(500).json({ success: false, message: 'Error marking attendance' });
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
// Add these functions below your liveCount function

async function registerFace(req, res) {
    if (!req.session || !req.session.userId || req.session.role !== 'student') {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { faceData } = req.body;
    if (!faceData) return res.status(400).json({ success: false, message: 'Face data required' });

    try {
        // Assuming you have access to a database pool or ORM here. 
        // You will need to update your studentRepository to include an 'updateFaceData' function.
        // Example: await studentRepository.updateFaceData(req.session.userId, faceData);
        
        return res.json({ success: true, message: 'Face registered successfully!' });
    } catch (err) {
        console.error('Face registration error:', err);
        return res.status(500).json({ success: false, message: 'Database error while saving face' });
    }
}

async function getFaceData(req, res) {
    if (!req.session || !req.session.userId || req.session.role !== 'student') {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    try {
        // You will need a function in your repository to fetch the user's face_descriptor
        // Example: const student = await studentRepository.findById(req.session.userId);
        
        // Mock response for structure:
        // if (!student || !student.face_descriptor) return res.json({ face_descriptor: null });
        // return res.json({ face_descriptor: student.face_descriptor });

        return res.json({ face_descriptor: "YOUR_DB_DATA_HERE" }); 
    } catch (err) {
        console.error('Fetch face data error:', err);
        return res.status(500).json({ success: false, message: 'Database error' });
    }
}

module.exports = {
  markAttendanceGet,
  markAttendancePost,
  sessions,
  sessionAttendance,
  liveCount,
  registerFace, // NEW
  getFaceData   // NEW
};
