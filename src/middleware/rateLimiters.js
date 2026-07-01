const rateLimit = require('express-rate-limit');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts. Try again in 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
});

const attendanceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: 'Too many attendance attempts. Try again in a minute.',
});

const codeGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: 'Too many codes generated. Try again in a minute.',
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-up attempts. Try again in 15 minutes.',
});

module.exports = {
  loginLimiter,
  attendanceLimiter,
  codeGenerationLimiter,
  signupLimiter,
};
