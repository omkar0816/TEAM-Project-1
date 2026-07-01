const authService = require('../services/authService');

async function login(req, res) {
  const role = req.body.role ? req.body.role.trim().toLowerCase() : 'student';
  const prn = req.body.prn ? req.body.prn.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const password = req.body.password ? req.body.password.trim() : '';

  try {
    let result;
    if (role === 'student') {
      result = await authService.loginStudent(email, prn, password);
    } else if (role === 'teacher') {
      result = await authService.loginTeacher(email, password);
    } else {
      result = { success: false, status: 400, message: 'Invalid role specified' };
    }

    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }

    req.session.userId = result.data.userId;
    req.session.role = result.data.role;
    if (result.data.mustChangePassword) {
      req.session.mustChangePassword = true;
    } else {
      delete req.session.mustChangePassword;
    }

    return res.json({ success: true, role: result.data.role, mustChangePassword: !!result.data.mustChangePassword });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ error: 'Database error' });
  }
}

async function signup(req, res) {
  const role = req.body.role;
  const firstName = req.body.firstName ? req.body.firstName.trim() : '';
  const lastName = req.body.lastName ? req.body.lastName.trim() : '';
  const email = req.body.email ? req.body.email.trim().toLowerCase() : '';
  const prn = req.body.prn ? req.body.prn.trim() : '';
  const year = req.body.year ? req.body.year.trim() : '';
  const department = req.body.department ? req.body.department.trim() : '';
  const empId = req.body.empId ? req.body.empId.trim() : '';
  const password = req.body.password ? req.body.password.trim() : '';

  if (!role || !email) {
    return res.status(400).json({ success: false, message: 'Role and email are required' });
  }
  if (!['student', 'teacher'].includes(role)) {
    return res.status(400).json({ success: false, message: 'Invalid role' });
  }

  try {
    let result;
    if (role === 'student') {
      result = await authService.signupStudent({ prn, firstName, lastName, email, password, year, department });
    } else {
      result = await authService.signupTeacher({ empId, firstName, lastName, email, password, department });
    }

    if (!result.success) {
      return res.status(result.status || 400).json({ success: false, message: result.message });
    }

    return res.json({ success: true });
  } catch (err) {
    console.error('Signup error:', err.message);
    let message = 'Registration failed';
    if (err.message && err.message.includes('UNIQUE constraint failed: students.email')) {
      message = 'Email already registered. Please log in instead.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: students.prn')) {
      message = 'This PRN is already registered.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: teachers.email')) {
      message = 'Email already registered. Please log in instead.';
    } else if (err.message && err.message.includes('UNIQUE constraint failed: teachers.emp_id')) {
      message = 'This employee ID is already registered.';
    }
    return res.status(400).json({ success: false, message });
  }
}

function logout(req, res) {
  req.session.destroy();
  res.json({ success: true });
}

async function checkSession(req, res) {
  res.json({ loggedIn: !!req.session.userId, role: req.session.role, mustChangePassword: !!req.session.mustChangePassword });
}

module.exports = {
  login,
  signup,
  logout,
  checkSession,
};
