const bcrypt = require('bcrypt');
const studentRepository = require('../repositories/studentRepository');
const teacherRepository = require('../repositories/teacherRepository');

async function loginStudent(email, prn, password) {
  if (!email) return { success: false, status: 400, message: 'Email is required for student login' };
  if (!prn) return { success: false, status: 400, message: 'PRN is required for student login' };
  if (!password) return { success: false, status: 400, message: 'Password is required for student login' };

  const student = await studentRepository.findStudentByEmailAndPrn(email, prn);
  if (!student) {
    return { success: false, status: 404, message: 'Student account not found. Please sign up first.' };
  }

  const passwordMatches = await bcrypt.compare(password, student.password_hash || '');
  if (!passwordMatches) {
    return { success: false, status: 401, message: 'Invalid password' };
  }

  return { success: true, data: { userId: student.id, role: 'student', user: student } };
}

async function loginTeacher(email, password) {
  if (!email || !password) {
    return { success: false, status: 400, message: 'Email and password are required for teacher login' };
  }

  const teacher = await teacherRepository.findTeacherByEmail(email);
  if (!teacher) {
    return { success: false, status: 401, message: 'Invalid email or password for teacher account' };
  }

  const passwordMatches = await bcrypt.compare(password, teacher.password_hash || '');
  if (!passwordMatches) {
    return { success: false, status: 401, message: 'Invalid email or password for teacher account' };
  }

  return {
    success: true,
    data: {
      userId: teacher.id,
      role: 'teacher',
      user: teacher,
      mustChangePassword: teacher.password_changed === 0 || teacher.password_changed === false,
    },
  };
}

async function signupStudent(payload) {
  const { prn, firstName, lastName, email, password, year, department } = payload;
  if (!prn) return { success: false, status: 400, message: 'PRN is required for students' };
  if (!year) return { success: false, status: 400, message: 'Year is required for students' };
  if (!department) return { success: false, status: 400, message: 'Department is required for students' };
  if (!password || password.length < 6) return { success: false, status: 400, message: 'Password is required and must be at least 6 characters' };

  const passwordHash = await bcrypt.hash(password, 10);
  await studentRepository.createStudent({
    prn,
    rollNo: /^\d+$/.test(prn) ? prn : null,
    fullName: `${firstName} ${lastName}`.trim() || 'Unknown Student',
    email,
    className: year,
    department,
    year,
    passwordHash,
  });

  return { success: true };
}

async function signupTeacher(payload) {
  const { empId, firstName, lastName, email, password, department } = payload;
  if (!empId) return { success: false, status: 400, message: 'Employee ID is required for teachers' };
  if (!password || password.length < 8) return { success: false, status: 400, message: 'Password is required and must be at least 8 characters for teacher accounts' };
  if (!department) return { success: false, status: 400, message: 'Department is required for teachers' };

  const passwordHash = await bcrypt.hash(password, 10);
  await teacherRepository.createTeacher({
    empId,
    fullName: `${firstName} ${lastName}`.trim() || 'Teacher',
    email,
    department,
    passwordHash,
  });

  return { success: true };
}

module.exports = {
  loginStudent,
  loginTeacher,
  signupStudent,
  signupTeacher,
};
