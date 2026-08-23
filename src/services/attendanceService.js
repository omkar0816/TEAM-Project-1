const attendanceRepository = require('../repositories/attendanceRepository');
const LocationService = require('./locationService');

const MAX_ACCURACY_METERS = 150;

async function markAttendance(studentId, code, location) {
  const now = Math.floor(Date.now() / 1000);
  const codeRow = await attendanceRepository.findActiveSession(code, now);
  if (!codeRow) {
    return { success: false, status: 410, message: 'Code expired or invalid' };
  }

  const enrolled = await attendanceRepository.isStudentEnrolled(studentId, codeRow.teacher_id);
  if (!enrolled) {
    return { success: false, status: 403, message: 'You are not enrolled in this class' };
  }

  const alreadyMarked = await attendanceRepository.hasAttendanceForStudent(studentId, code);
  if (alreadyMarked) {
    return { success: false, status: 409, message: 'Attendance already marked' };
  }

  // ---- Geolocation gate: only students physically near the teacher can mark ----
  if (!location || location.latitude === undefined || location.longitude === undefined || location.accuracy === undefined) {
    return { success: false, status: 400, message: 'Location is required to mark attendance. Please enable location access and try again.' };
  }

  if (!LocationService.isAccuracyAcceptable(location.accuracy, MAX_ACCURACY_METERS)) {
    return { success: false, status: 400, message: 'Your GPS signal is too weak to verify your location. Move outdoors or near a window and try again.' };
  }

  const spoofCheck = await LocationService.detectSpooferPatterns(studentId, 'student', location.latitude, location.longitude, 'attendance_mark');
  if (spoofCheck.isSuspicious) {
    await LocationService.logLocationAction(
      studentId, 'student', location.latitude, location.longitude, location.accuracy,
      'attendance_mark', location.ipAddress, false, 'FRAUD: ' + spoofCheck.reason
    );
    return { success: false, status: 403, message: 'Suspicious location activity detected. This attempt has been logged.' };
  }

  const teacherLocation = await LocationService.getSessionTeacherLocation(code);
  if (!teacherLocation) {
    return { success: false, status: 500, message: 'This session has no recorded teacher location. Ask your teacher to regenerate the code.' };
  }

  const validation = LocationService.validateStudentLocation(
    location.latitude,
    location.longitude,
    teacherLocation.teacher_latitude,
    teacherLocation.teacher_longitude,
    teacherLocation.max_radius_meters || 500
  );

  await LocationService.logLocationAction(
    studentId, 'student', location.latitude, location.longitude, location.accuracy,
    'attendance_mark', location.ipAddress, validation.isWithinRadius, validation.message
  );

  if (!validation.isWithinRadius) {
    return {
      success: false,
      status: 403,
      message: `You're too far from the teacher to mark attendance. ${validation.message}`,
      distanceMeters: validation.distanceMeters,
      maxRadiusMeters: validation.maxRadiusMeters,
    };
  }

  const attendanceId = await attendanceRepository.createAttendance(studentId, code);

  await LocationService.storeAttendanceLocation(
    attendanceId,
    studentId,
    location.latitude,
    location.longitude,
    location.accuracy,
    teacherLocation.teacher_latitude,
    teacherLocation.teacher_longitude,
    validation.distanceMeters,
    true
  );

  return { success: true, distanceMeters: validation.distanceMeters };
}

module.exports = {
  markAttendance,
};