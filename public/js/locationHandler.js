// ========== public/js/locationHandler.js ==========
// COPY THIS ENTIRE FILE TO: public/js/locationHandler.js

/**
 * LOCATION HANDLER CLASS
 * Manages all geolocation operations for students and teachers
 * Handles: permission requests, location validation, error handling
 */

class LocationHandler {
  constructor() {
    this.isLocationSupported = navigator.geolocation !== undefined;
    console.log('LocationHandler initialized. Geolocation supported:', this.isLocationSupported);
  }

  async getCurrentRole() {
    const bodyRole = document.body && document.body.dataset && document.body.dataset.userType;
    if (bodyRole) return bodyRole;

    const path = window.location.pathname.toLowerCase();
    if (path.includes('teacher')) return 'teacher';
    if (path.includes('student')) return 'student';

    try {
      const response = await fetch('/check-session', { credentials: 'include' });
      if (!response.ok) return 'student';
      const data = await response.json();
      return data.role || 'student';
    } catch (error) {
      console.warn('Could not determine active role; defaulting to student.', error);
      return 'student';
    }
  }

  async getBaseApiPath() {
    return '/api';
  }

  /**
   * ✅ REQUEST LOCATION PERMISSION AFTER LOGIN
   * Shows popup, handles allow/deny
   * Returns: Promise<boolean> - true if permission granted, false if denied
   */
  async requestLocationPermission() {
    if (!this.isLocationSupported) {
      alert('⚠️ Your browser does not support geolocation.\nPlease use Chrome, Firefox, or Safari.');
      return false;
    }

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          // ✅ SUCCESS: User allowed location access
          const { latitude, longitude, accuracy } = position.coords;
          console.log('Location obtained:', { latitude, longitude, accuracy });

          this.storeLocationPermission(latitude, longitude, accuracy)
            .then((response) => {
              if (response.success) {
                console.log('✅ Location permission stored successfully');
                sessionStorage.removeItem('locationPermissionModalShown');
                resolve(true);
              } else {
                console.error('Failed to store location:', response.error);
                alert('Failed to save location. Your session may have expired or the request was rejected. Please refresh the page or log in again.');
                resolve(false);
              }
            })
            .catch((error) => {
              console.error('Error storing location:', error);
              resolve(false);
            });
        },
        (error) => {
          // ❌ FAILURE: User denied location access
          console.warn('Location permission denied:', error.message);
          
          // Get user's choice reason
          let denialReason = 'User denied access';
          if (error.code === 1) denialReason = 'User blocked location permission';
          if (error.code === 2) denialReason = 'Location service unavailable';
          if (error.code === 3) denialReason = 'Location request timeout';

          this.denyLocationPermission();
          resolve(false);
        },
        {
          enableHighAccuracy: true, // Use GPS for better accuracy
          timeout: 10000, // Wait max 10 seconds
          maximumAge: 0 // Don't use cached location - always get fresh
        }
      );
    });
  }

  /**
   * ✅ CHECK IF USER ALREADY HAS LOCATION PERMISSION STORED
   * Returns: Promise<{ permissionGranted, grantedAt, needsPermission }>
   */
  async checkPermissionStatus() {
    try {
      const basePath = await this.getBaseApiPath();
      const endpoint = `${basePath}/location/permission-status`;
      const response = await fetch(endpoint, {
        method: 'GET',
        credentials: 'include'
      });

      if (!response.ok) {
        console.error('Error checking permission status:', response.statusText);
        return { needsPermission: true };
      }

      const data = await response.json();
      console.log('Permission status:', data);
      return data;
    } catch (error) {
      console.error('Error checking permission status:', error);
      return { needsPermission: true };
    }
  }

  /**
   * ✅ STORE LOCATION PERMISSION ON BACKEND
   * Called after user approves location access
   */
  async storeLocationPermission(latitude, longitude, accuracy) {
    try {
      console.log('Storing location permission...');
      const basePath = await this.getBaseApiPath();
      const endpoint = `${basePath}/location/grant-permission`;
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          latitude: latitude,
          longitude: longitude,
          accuracy: accuracy
        })
      });

      const data = await response.json();
      
      if (!response.ok) {
        console.error('Error response:', data);
        return { success: false, error: data.error };
      }

      console.log('Location permission stored:', data);
      return { success: true, ...data };
    } catch (error) {
      console.error('Error storing location permission:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * ✅ DENY LOCATION PERMISSION - LOGOUT USER
   * Called when user declines location access
   * Backend will destroy session and prevent login
   */
  async denyLocationPermission() {
    try {
      console.log('Denying location permission and logging out...');
      const basePath = await this.getBaseApiPath();
      const endpoint = `${basePath}/location/deny-permission`;
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();
      console.log('Denial confirmed:', data);
      
      alert('Location access is required to use the attendance system.\nYou have been logged out.\n\nPlease login again and enable location to continue.');
      
      setTimeout(() => {
        window.location.href = '/';
      }, 1000);

      return data;
    } catch (error) {
      console.error('Error denying location:', error);
      window.location.href = '/';
    }
  }

  /**
   * ✅ GET CURRENT LOCATION
   * Used before marking attendance
   * Returns: Promise<{ latitude, longitude, accuracy }>
   */
  getCurrentLocation() {
    return new Promise((resolve, reject) => {
      if (!this.isLocationSupported) {
        reject(new Error('Geolocation not supported on this device'));
        return;
      }

      console.log('Getting current location...');
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const locationData = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy
          };
          console.log('Location obtained:', locationData);
          resolve(locationData);
        },
        (error) => {
          let errorMsg = 'Unknown error';
          if (error.code === 1) errorMsg = 'Location permission denied';
          if (error.code === 2) errorMsg = 'Location service unavailable';
          if (error.code === 3) errorMsg = 'Location request timeout';
          
          console.error('Error getting location:', errorMsg);
          reject(new Error(errorMsg));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        }
      );
    });
  }

  /**
   * ✅ VALIDATE LOCATION BEFORE MARKING ATTENDANCE
   * Checks if student is within radius of teacher
   * Returns: Promise<{ isValid, distanceMeters, maxRadiusMeters, message, error? }>
   */
  async validateAttendanceLocation(sessionId, latitude, longitude, accuracy) {
    try {
      console.log('Validating attendance location...', { sessionId, latitude, longitude, accuracy });
      
      const response = await fetch('/api/students/validate-attendance-location', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify({
          sessionId: sessionId,
          latitude: latitude,
          longitude: longitude,
          accuracy: accuracy
        })
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Location validation failed:', data);
        return {
          isValid: false,
          error: data.error,
          isSuspicious: data.suspicious || false
        };
      }

      console.log('Location validation result:', data);
      return data;
    } catch (error) {
      console.error('Error validating location:', error);
      return {
        isValid: false,
        error: 'Failed to validate location. Check internet connection.'
      };
    }
  }

  /**
   * ✅ SHOW LOCATION PERMISSION POPUP
   * Beautiful modal asking user to enable location
   */
  showLocationPermissionPopup() {
    if (sessionStorage.getItem('locationPermissionModalShown') === '1') {
      return;
    }
    sessionStorage.setItem('locationPermissionModalShown', '1');

    console.log('Showing location permission popup...');

    const modal = document.createElement('div');
    modal.id = 'locationPermissionModal';
    modal.className = 'location-permission-modal';
    modal.innerHTML = `
      <div class="location-permission-container">
        <div class="location-permission-icon">📍</div>
        <h2>Enable Location Access</h2>
        <p>We need your location to verify attendance. This ensures only students physically present in class can mark attendance.</p>
        
        <div class="location-benefits">
          <div class="benefit">
            <span class="benefit-icon">✓</span>
            <span class="benefit-text">Prevents fraudulent attendance from home</span>
          </div>
          <div class="benefit">
            <span class="benefit-icon">✓</span>
            <span class="benefit-text">Protects you from impersonation</span>
          </div>
          <div class="benefit">
            <span class="benefit-icon">✓</span>
            <span class="benefit-text">Only used during attendance marking</span>
          </div>
        </div>

        <div class="location-permission-buttons">
          <button class="btn-allow" onclick="locationHandler.handleAllowPermission()">
            ✅ Allow Location Access
          </button>
          <button class="btn-deny" onclick="locationHandler.handleDenyPermission()">
            ❌ Deny & Logout
          </button>
        </div>

        <p class="location-note">📌 <strong>Important:</strong> Your location will be requested <strong>only once</strong>. Future logins won't ask again.</p>
      </div>
    `;

    document.body.appendChild(modal);
    this.addLocationPermissionStyles();
    
    // Prevent closing modal by clicking outside
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        console.log('Attempted to close location modal by clicking outside - prevented');
      }
    });
  }

  /**
   * ✅ HANDLE USER CLICKING "ALLOW"
   * Requests location and stores permission
   */
  async handleAllowPermission() {
    console.log('User clicked Allow...');
    const btn = document.querySelector('.btn-allow');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '⏳ Getting your location...';
    }

    const allowed = await this.requestLocationPermission();
    
    if (allowed) {
      console.log('Location permission granted successfully');
      const modal = document.getElementById('locationPermissionModal');
      if (modal) {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.5s ease';
      }
      
      setTimeout(async () => {
        if (modal) modal.remove();
        const role = await this.getCurrentRole();
        const redirectTarget = role === 'teacher' ? '/teacher.html' : '/student.html';
        console.log('Redirecting to dashboard...');
        window.location.href = redirectTarget;
      }, 500);
    } else {
      console.log('Location permission failed');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '✅ Allow Location Access';
      }
      alert('❌ Failed to get location. Please check:\n- Browser location permission\n- GPS/Location services enabled\n- You have internet connection');
    }
  }

  /**
   * ✅ HANDLE USER CLICKING "DENY"
   * Confirm they want to logout
   */
  handleDenyPermission() {
    console.log('User clicked Deny...');
    const confirmed = confirm(
      '⚠️ Are you sure?\n\n' +
      'Location access is required to mark attendance.\n' +
      'You will NOT be able to use the system without it.\n\n' +
      'Click OK to logout, or Cancel to enable location.'
    );

    if (confirmed) {
      console.log('User confirmed denial. Logging out...');
      sessionStorage.removeItem('locationPermissionModalShown');
      this.denyLocationPermission();
    } else {
      console.log('User cancelled denial');
    }
  }

  /**
   * ✅ ADD CSS STYLES FOR LOCATION POPUP
   * All styling for the permission modal
   */
  addLocationPermissionStyles() {
    const style = document.createElement('style');
    style.innerHTML = `
      .location-permission-modal {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(10, 26, 46, 0.98);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 9999;
        animation: fadeIn 0.3s ease;
        backdrop-filter: blur(2px);
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      .location-permission-container {
        background: linear-gradient(135deg, #0f2344 0%, #1a3a52 100%);
        border-radius: 20px;
        padding: 50px 40px;
        max-width: 500px;
        width: 90%;
        border: 2px solid rgba(243, 156, 18, 0.3);
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.7);
        text-align: center;
        animation: slideUp 0.4s ease;
      }

      @keyframes slideUp {
        from { transform: translateY(50px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      .location-permission-icon {
        font-size: 60px;
        margin-bottom: 20px;
        animation: bounce 0.6s ease infinite;
      }

      @keyframes bounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-10px); }
      }

      .location-permission-container h2 {
        color: #ffffff;
        font-size: 1.8em;
        margin: 0 0 15px 0;
        font-weight: 700;
      }

      .location-permission-container p {
        color: rgba(255, 255, 255, 0.75);
        font-size: 0.95em;
        line-height: 1.6;
        margin: 0 0 25px 0;
      }

      .location-benefits {
        background: rgba(243, 156, 18, 0.08);
        border-radius: 12px;
        padding: 20px;
        margin-bottom: 30px;
        text-align: left;
        border: 1px solid rgba(243, 156, 18, 0.15);
      }

      .benefit {
        display: flex;
        align-items: flex-start;
        margin-bottom: 12px;
        color: rgba(255, 255, 255, 0.8);
        font-size: 0.9em;
      }

      .benefit:last-child {
        margin-bottom: 0;
      }

      .benefit-icon {
        color: #f39c12;
        font-weight: bold;
        margin-right: 12px;
        font-size: 1.1em;
      }

      .benefit-text {
        line-height: 1.5;
      }

      .location-permission-buttons {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin-bottom: 25px;
      }

      .btn-allow {
        background: linear-gradient(135deg, #f39c12 0%, #e67e22 100%);
        color: white;
        border: none;
        padding: 14px 28px;
        border-radius: 8px;
        font-size: 1em;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .btn-allow:hover:not(:disabled) {
        transform: translateY(-2px);
        box-shadow: 0 6px 20px rgba(243, 156, 18, 0.4);
      }

      .btn-allow:disabled {
        opacity: 0.7;
        cursor: not-allowed;
      }

      .btn-deny {
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        border: 2px solid rgba(255, 255, 255, 0.2);
        padding: 12px 28px;
        border-radius: 8px;
        font-size: 0.95em;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.3s ease;
      }

      .btn-deny:hover {
        border-color: rgba(255, 255, 255, 0.4);
        color: rgba(255, 255, 255, 0.8);
      }

      .location-note {
        color: rgba(243, 156, 18, 0.8);
        font-size: 0.85em !important;
        margin: 0 !important;
        background: rgba(243, 156, 18, 0.1);
        padding: 12px;
        border-radius: 8px;
        border-left: 3px solid #f39c12;
      }

      @media (max-width: 600px) {
        .location-permission-container {
          padding: 35px 25px;
        }

        .location-permission-container h2 {
          font-size: 1.5em;
        }

        .location-permission-icon {
          font-size: 45px;
        }

        .location-permission-buttons {
          gap: 10px;
        }

        .btn-allow, .btn-deny {
          padding: 12px 20px;
          font-size: 0.9em;
        }
      }
    `;
    document.head.appendChild(style);
  }
}

// ✅ INITIALIZE GLOBALLY - Available everywhere as: locationHandler.method()
const locationHandler = new LocationHandler();
console.log('✅ LocationHandler ready');
