const rateLimit = require('express-rate-limit');

// In development (localhost), use much higher limits or skip rate limiting
const isDevelopment = process.env.NODE_ENV !== 'production';

const loginLimiter = isDevelopment 
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000, // Very high for local testing
      standardHeaders: true,
      legacyHeaders: false,
    })
  : rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 5,
      message: 'Too many login attempts. Try again in 15 minutes.',
      standardHeaders: true,
      legacyHeaders: false,
    });

const attendanceLimiter = isDevelopment
  ? rateLimit({
      windowMs: 60 * 1000,
      max: 1000,
    })
  : rateLimit({
      windowMs: 60 * 1000,
      max: 10,
      message: 'Too many attendance attempts. Try again in a minute.',
    });

const codeGenerationLimiter = isDevelopment
  ? rateLimit({
      windowMs: 60 * 1000,
      max: 1000,
    })
  : rateLimit({
      windowMs: 60 * 1000,
      max: 5,
      message: 'Too many codes generated. Try again in a minute.',
    });

const signupLimiter = isDevelopment
  ? rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 1000,
    })
  : rateLimit({
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
