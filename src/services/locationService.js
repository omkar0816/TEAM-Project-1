// ========== services/locationService.js ==========
// COPY THIS ENTIRE FILE TO: services/locationService.js

const db = require('../database');

class LocationService {
  
  /**
   * ✅ CALCULATE DISTANCE BETWEEN TWO COORDINATES
   * Uses Haversine formula (accurate to ~0.5%)
   */
  static calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (lat1 * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - lat1) * Math.PI) / 180;
    const Δλ = ((lon2 - lon1) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * ✅ CHECK IF USER ALREADY GRANTED LOCATION PERMISSION
   * Returns: { permissionGranted: boolean, grantedAt: timestamp }
   */
  static checkLocationPermissionStatus(rollNo) {
    try {
      const query = `
        SELECT permission_granted, permission_granted_at 
        FROM location_permissions 
        WHERE roll_no = ?
      `;
      const result = db.prepare(query).get(rollNo);
      
      return {
        permissionGranted: result ? result.permission_granted : false,
        grantedAt: result ? result.permission_granted_at : null,
      };
    } catch (error) {
      console.error('Error checking location permission:', error);
      return { permissionGranted: false, grantedAt: null };
    }
  }

  /**
   * ✅ STORE LOCATION PERMISSION (First time user grants permission)
   * Called when user allows location access
   */
  static storeLocationPermission(rollNo, userType, ipAddress, userAgent) {
    try {
      const query = `
        INSERT INTO location_permissions 
        (roll_no, user_type, permission_granted, permission_granted_at, ip_address, browser_user_agent)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?, ?)
        ON CONFLICT(roll_no) DO UPDATE SET 
          permission_granted = 1,
          permission_granted_at = CURRENT_TIMESTAMP,
          ip_address = excluded.ip_address,
          browser_user_agent = excluded.browser_user_agent
      `;
      
      db.prepare(query).run(rollNo, userType, 1, ipAddress, userAgent);
      return { success: true };
    } catch (error) {
      console.error('Error storing location permission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ DENY LOCATION PERMISSION
   * Called when user declines location access
   */
  static denyLocationPermission(rollNo, userType) {
    try {
      const query = `
        INSERT INTO location_permissions 
        (roll_no, user_type, permission_granted, permission_requested_at)
        VALUES (?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(roll_no) DO UPDATE SET 
          permission_granted = 0
      `;
      
      db.prepare(query).run(rollNo, userType);
      return { success: true };
    } catch (error) {
      console.error('Error denying location permission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ LOG LOCATION DATA FOR AUDIT TRAIL
   * Every location action is logged for compliance
   */
  static logLocationAction(rollNo, userType, latitude, longitude, accuracy, actionType, ipAddress, success, reason = null) {
    try {
      const query = `
        INSERT INTO location_tracking 
        (roll_no, user_type, latitude, longitude, accuracy_meters, action_type, ip_address, success, reason, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      db.prepare(query).run(
        rollNo,
        userType,
        latitude,
        longitude,
        accuracy,
        actionType,
        ipAddress,
        success ? 1 : 0,
        reason
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error logging location action:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ CAPTURE AND STORE TEACHER'S LOCATION AT SESSION CREATION
   * This location is IMMUTABLE - used for all student validations
   */
  static captureTeacherSessionLocation(sessionId, teacherRollNo, latitude, longitude, accuracy) {
    try {
      const query = `
        INSERT INTO session_locations 
        (session_id, teacher_roll_no, teacher_latitude, teacher_longitude, teacher_accuracy_meters, captured_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      db.prepare(query).run(sessionId, teacherRollNo, latitude, longitude, accuracy);
      return { success: true };
    } catch (error) {
      console.error('Error capturing teacher session location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ GET TEACHER'S LOCATION FOR A SESSION
   */
  static getSessionTeacherLocation(sessionId) {
    try {
      const query = `
        SELECT teacher_latitude, teacher_longitude, teacher_accuracy_meters, max_radius_meters
        FROM session_locations
        WHERE session_id = ?
      `;
      
      const result = db.prepare(query).get(sessionId);
      return result || null;
    } catch (error) {
      console.error('Error getting teacher session location:', error);
      return null;
    }
  }

  /**
   * ✅ VALIDATE STUDENT LOCATION AGAINST TEACHER LOCATION
   * Returns: { distanceMeters, isWithinRadius, maxRadiusMeters, message }
   */
  static validateStudentLocation(studentLatitude, studentLongitude, teacherLatitude, teacherLongitude, maxRadiusMeters = 500) {
    // Calculate distance
    const distanceMeters = this.calculateDistance(
      studentLatitude,
      studentLongitude,
      teacherLatitude,
      teacherLongitude
    );

    // Check if within radius
    const isWithinRadius = distanceMeters <= maxRadiusMeters;

    return {
      distanceMeters: Math.round(distanceMeters),
      isWithinRadius: isWithinRadius,
      maxRadiusMeters: maxRadiusMeters,
      message: isWithinRadius 
        ? `✅ Within range (${Math.round(distanceMeters)}m from teacher)` 
        : `❌ Outside range (${Math.round(distanceMeters)}m from teacher, max allowed: ${maxRadiusMeters}m)`
    };
  }

  /**
   * ✅ STORE ATTENDANCE LOCATION RECORD
   */
  static storeAttendanceLocation(attendanceId, studentRollNo, studentLat, studentLon, studentAccuracy, teacherLat, teacherLon, distanceMeters, withinRadius) {
    try {
      const query = `
        INSERT INTO attendance_locations 
        (attendance_id, student_roll_no, student_latitude, student_longitude, student_accuracy_meters, 
         teacher_latitude, teacher_longitude, distance_from_teacher_meters, within_radius, captured_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      `;
      
      db.prepare(query).run(
        attendanceId,
        studentRollNo,
        studentLat,
        studentLon,
        studentAccuracy,
        teacherLat,
        teacherLon,
        Math.round(distanceMeters),
        withinRadius ? 1 : 0
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error storing attendance location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ GET GEOLOCATION AUDIT TRAIL FOR A USER
   */
  static getLocationAuditTrail(rollNo, days = 30) {
    try {
      const query = `
        SELECT * FROM location_tracking
        WHERE roll_no = ? 
        AND timestamp >= datetime('now', '-' || ? || ' days')
        ORDER BY timestamp DESC
        LIMIT 100
      `;
      
      const results = db.prepare(query).all(rollNo, days);
      return results;
    } catch (error) {
      console.error('Error getting location audit trail:', error);
      return [];
    }
  }

  /**
   * ✅ VALIDATE GEOLOCATION ACCURACY
   * Reject if accuracy is too poor (e.g., > 100 meters error margin)
   */
  static isAccuracyAcceptable(accuracyMeters, maxAccuracy = 100) {
    return accuracyMeters <= maxAccuracy;
  }

  /**
   * ✅ CHECK FOR LOCATION SPOOFING PATTERNS
   * Detect impossible speeds (teleportation detection)
   * Returns: { isSuspicious: boolean, reason: string }
   */
  static detectSpooferPatterns(rollNo, currentLatitude, currentLongitude, actionType) {
    try {
      // Get last location for this user
      const lastLocationQuery = `
        SELECT latitude, longitude, timestamp
        FROM location_tracking
        WHERE roll_no = ? AND action_type = ?
        ORDER BY timestamp DESC
        LIMIT 1
      `;
      
      const lastLocation = db.prepare(lastLocationQuery).get(rollNo, actionType);
      
      if (!lastLocation) return { isSuspicious: false, reason: null };

      // Calculate distance and time between locations
      const distanceMeters = this.calculateDistance(
        lastLocation.latitude,
        lastLocation.longitude,
        currentLatitude,
        currentLongitude
      );

      // Parse timestamp and calculate time difference
      const lastTime = new Date(lastLocation.timestamp).getTime();
      const currentTime = new Date().getTime();
      const secondsElapsed = (currentTime - lastTime) / 1000;

      // Max realistic speed: 40 m/s (144 km/h - basically impossible in college building)
      const maxRealisticSpeed = 40; // meters per second
      const requiredSeconds = distanceMeters / maxRealisticSpeed;

      if (secondsElapsed < requiredSeconds && secondsElapsed > 0) {
        return {
          isSuspicious: true,
          reason: `Impossible speed detected: ${Math.round(distanceMeters)}m in ${Math.round(secondsElapsed)}s (speed: ${(distanceMeters / secondsElapsed).toFixed(1)} m/s)`,
          distanceMeters: Math.round(distanceMeters),
          timeSeconds: Math.round(secondsElapsed)
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
