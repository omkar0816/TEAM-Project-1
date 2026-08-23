// src/services/locationService.js
//
// Geolocation service: permission tracking, distance validation, and
// spoofing detection for the login-gated / proximity-based attendance flow.
//
// IMPORTANT: this project's DB layer (src/models/database.js) uses the
// async @libsql/client API (db.execute(sql, params) -> { rows, ... }).
// Every method here is async and uses that API - do not swap in
// better-sqlite3-style db.prepare(...).get()/.run() calls.

const { db } = require('../models/database');

class LocationService {
  /**
   * Students and teachers are stored in separate tables with their own
   * auto-increment ids, so a student #1 and a teacher #1 can both exist.
   * location_permissions.roll_no is UNIQUE, so we namespace the key by
   * role to avoid one user's row silently overwriting the other's.
   */
  static _key(userId, userType) {
    return `${userType}:${userId}`;
  }

  /**
   * CALCULATE DISTANCE BETWEEN TWO COORDINATES (Haversine formula)
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const toRad = (deg) => (deg * Math.PI) / 180;
    const φ1 = toRad(lat1);
    const φ2 = toRad(lat2);
    const Δφ = toRad(lat2 - lat1);
    const Δλ = toRad(lon2 - lon1);

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // meters
  }

  /**
   * CHECK IF USER ALREADY GRANTED LOCATION PERMISSION
   */
  static async checkLocationPermissionStatus(userId, userType) {
    try {
      const result = await db.execute(
        'SELECT permission_granted, permission_granted_at FROM location_permissions WHERE roll_no = ?',
        [this._key(userId, userType)]
      );
      const row = result.rows[0];
      return {
        permissionGranted: row ? !!row.permission_granted : false,
        grantedAt: row ? row.permission_granted_at : null,
      };
    } catch (error) {
      console.error('Error checking location permission:', error);
      return { permissionGranted: false, grantedAt: null };
    }
  }

  /**
   * STORE LOCATION PERMISSION (user allowed location access)
   */
  static async storeLocationPermission(userId, userType, ipAddress, userAgent) {
    try {
      await db.execute(
        `INSERT INTO location_permissions
           (roll_no, user_type, permission_granted, permission_granted_at, ip_address, browser_user_agent)
         VALUES (?, ?, 1, CURRENT_TIMESTAMP, ?, ?)
         ON CONFLICT(roll_no) DO UPDATE SET
           permission_granted = 1,
           permission_granted_at = CURRENT_TIMESTAMP,
           ip_address = excluded.ip_address,
           browser_user_agent = excluded.browser_user_agent`,
        [this._key(userId, userType), userType, ipAddress, userAgent]
      );
      return { success: true };
    } catch (error) {
      console.error('Error storing location permission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * DENY LOCATION PERMISSION (user declined location access)
   */
  static async denyLocationPermission(userId, userType) {
    try {
      await db.execute(
        `INSERT INTO location_permissions
           (roll_no, user_type, permission_granted, permission_requested_at)
         VALUES (?, ?, 0, CURRENT_TIMESTAMP)
         ON CONFLICT(roll_no) DO UPDATE SET
           permission_granted = 0`,
        [this._key(userId, userType), userType]
      );
      return { success: true };
    } catch (error) {
      console.error('Error denying location permission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * LOG LOCATION ACTION FOR AUDIT TRAIL
   */
  static async logLocationAction(userId, userType, latitude, longitude, accuracy, actionType, ipAddress, success, reason = null) {
    try {
      await db.execute(
        `INSERT INTO location_tracking
           (roll_no, user_type, latitude, longitude, accuracy_meters, action_type, ip_address, success, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [this._key(userId, userType), userType, latitude, longitude, accuracy, actionType, ipAddress, success ? 1 : 0, reason]
      );
      return { success: true };
    } catch (error) {
      console.error('Error logging location action:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * CAPTURE TEACHER'S LOCATION AT SESSION (code) CREATION.
   * This is the anchor point every student's location gets checked against.
   */
  static async captureTeacherSessionLocation(sessionId, teacherId, latitude, longitude, accuracy, maxRadiusMeters = 500) {
    try {
      await db.execute(
        `INSERT INTO session_locations
           (session_id, teacher_roll_no, teacher_latitude, teacher_longitude, teacher_accuracy_meters, max_radius_meters)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           teacher_latitude = excluded.teacher_latitude,
           teacher_longitude = excluded.teacher_longitude,
           teacher_accuracy_meters = excluded.teacher_accuracy_meters,
           max_radius_meters = excluded.max_radius_meters`,
        [sessionId, this._key(teacherId, 'teacher'), latitude, longitude, accuracy, maxRadiusMeters]
      );
      return { success: true };
    } catch (error) {
      console.error('Error capturing teacher session location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * GET TEACHER'S LOCATION FOR A SESSION (attendance code)
   */
  static async getSessionTeacherLocation(sessionId) {
    try {
      const result = await db.execute(
        `SELECT teacher_latitude, teacher_longitude, teacher_accuracy_meters, max_radius_meters
         FROM session_locations WHERE session_id = ?`,
        [sessionId]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('Error getting teacher session location:', error);
      return null;
    }
  }

  /**
   * VALIDATE STUDENT LOCATION AGAINST TEACHER LOCATION
   */
  static validateStudentLocation(studentLatitude, studentLongitude, teacherLatitude, teacherLongitude, maxRadiusMeters = 500) {
    const distanceMeters = this.calculateDistance(studentLatitude, studentLongitude, teacherLatitude, teacherLongitude);
    const isWithinRadius = distanceMeters <= maxRadiusMeters;

    return {
      distanceMeters: Math.round(distanceMeters),
      isWithinRadius,
      maxRadiusMeters,
      message: isWithinRadius
        ? `Within range (${Math.round(distanceMeters)}m from teacher)`
        : `Outside range (${Math.round(distanceMeters)}m from teacher, max allowed: ${maxRadiusMeters}m)`,
    };
  }

  /**
   * STORE ATTENDANCE LOCATION RECORD (audit trail per marked attendance row)
   */
  static async storeAttendanceLocation(attendanceId, studentId, studentLat, studentLon, studentAccuracy, teacherLat, teacherLon, distanceMeters, withinRadius) {
    try {
      await db.execute(
        `INSERT INTO attendance_locations
           (attendance_id, student_roll_no, student_latitude, student_longitude, student_accuracy_meters,
            teacher_latitude, teacher_longitude, distance_from_teacher_meters, within_radius)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          attendanceId,
          this._key(studentId, 'student'),
          studentLat,
          studentLon,
          studentAccuracy,
          teacherLat,
          teacherLon,
          Math.round(distanceMeters),
          withinRadius ? 1 : 0,
        ]
      );
      return { success: true };
    } catch (error) {
      console.error('Error storing attendance location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * GET GEOLOCATION AUDIT TRAIL FOR A USER
   */
  static async getLocationAuditTrail(userId, userType, days = 30) {
    try {
      const result = await db.execute(
        `SELECT * FROM location_tracking
         WHERE roll_no = ? AND timestamp >= datetime('now', '-' || ? || ' days')
         ORDER BY timestamp DESC LIMIT 100`,
        [this._key(userId, userType), days]
      );
      return result.rows;
    } catch (error) {
      console.error('Error getting location audit trail:', error);
      return [];
    }
  }

  /**
   * VALIDATE GEOLOCATION ACCURACY - reject overly imprecise readings
   */
  static isAccuracyAcceptable(accuracyMeters, maxAccuracy = 150) {
    return typeof accuracyMeters === 'number' && accuracyMeters <= maxAccuracy;
  }

  /**
   * CHECK FOR LOCATION SPOOFING PATTERNS (impossible-speed / teleport detection)
   */
  static async detectSpooferPatterns(userId, userType, currentLatitude, currentLongitude, actionType) {
    try {
      const result = await db.execute(
        `SELECT latitude, longitude, timestamp FROM location_tracking
         WHERE roll_no = ? AND action_type = ? AND latitude IS NOT NULL
         ORDER BY timestamp DESC LIMIT 1`,
        [this._key(userId, userType), actionType]
      );
      const lastLocation = result.rows[0];
      if (!lastLocation) return { isSuspicious: false, reason: null };

      const distanceMeters = this.calculateDistance(
        lastLocation.latitude,
        lastLocation.longitude,
        currentLatitude,
        currentLongitude
      );

      const lastTime = new Date(lastLocation.timestamp.replace(' ', 'T') + 'Z').getTime();
      const currentTime = Date.now();
      const secondsElapsed = (currentTime - lastTime) / 1000;

      const maxRealisticSpeed = 40; // m/s (~144 km/h) - implausible within/near a campus
      const requiredSeconds = distanceMeters / maxRealisticSpeed;

      if (secondsElapsed > 0 && secondsElapsed < requiredSeconds) {
        return {
          isSuspicious: true,
          reason: `Impossible speed detected: ${Math.round(distanceMeters)}m in ${Math.round(secondsElapsed)}s`,
          distanceMeters: Math.round(distanceMeters),
          timeSeconds: Math.round(secondsElapsed),
        };
      }

      return { isSuspicious: false, reason: null };
    } catch (error) {
      console.error('Error checking spoofing patterns:', error);
      return { isSuspicious: false, reason: null };
    }
  }
}

module.exports = LocationService;