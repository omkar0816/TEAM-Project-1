const express = require('express');
const sessionController = require('../controllers/sessionController');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');

const router = express.Router();

router.get('/profile', requireAuth, sessionController.profile);
router.get('/teacher-stats', requireAuth, requireRole('teacher'), sessionController.teacherStats);
router.get('/attendance', requireAuth, requireRole('teacher'), sessionController.teacherAttendance);
router.get('/my-attendance', requireAuth, requireRole('student'), sessionController.myAttendance);
router.get('/my-sessions', requireAuth, requireRole('student'), sessionController.mySessions);
router.get('/my-stats', requireAuth, requireRole('student'), sessionController.myStats);
router.post('/assignments', requireAuth, requireRole('teacher'), sessionController.createAssignment);
router.get('/assignments', requireAuth, sessionController.listAssignments);
router.delete('/assignments/:id', requireAuth, requireRole('teacher'), sessionController.deleteAssignment);
router.get('/download/monthly-report', requireAuth, requireRole('teacher'), sessionController.downloadMonthlyReport);
router.get('/download/lecture/:code', requireAuth, requireRole('teacher'), sessionController.downloadLectureReport);
router.get('/student-attendance', requireAuth, requireRole('teacher'), sessionController.studentAttendance);
router.post('/add-attendance', requireAuth, requireRole('teacher'), sessionController.addAttendance);
router.post('/delete-attendance', requireAuth, requireRole('teacher'), sessionController.deleteAttendance);

module.exports = router;
