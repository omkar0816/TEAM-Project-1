const express = require('express');
const authController = require('../controllers/authController');
const { loginLimiter, signupLimiter } = require('../middleware/rateLimiters');

const router = express.Router();

router.post('/login', loginLimiter, authController.login);
router.post('/signup', signupLimiter, authController.signup);
router.post('/logout', authController.logout);
router.get('/check-session', authController.checkSession);

module.exports = router;
