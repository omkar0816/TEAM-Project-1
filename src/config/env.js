const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`FATAL: required environment variable ${name} is not set.`);
  }
  return value;
}

function getEnv(name, fallback) {
  const value = process.env[name];
  return value ?? fallback;
}

const isProduction = process.env.NODE_ENV === 'production';

module.exports = {
  requireEnv,
  getEnv,
  isProduction,
  PORT: getEnv('PORT', '3000'),
  SESSION_SECRET: process.env.SESSION_SECRET,
  SESSION_COOKIE_SECURE: process.env.SESSION_COOKIE_SECURE,
  TRUST_PROXY: process.env.TRUST_PROXY,
  TURSO_DB_URL: getEnv('TURSO_DB_URL', 'file:attendance.db'),
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  DEFAULT_TEACHER_EMAIL: getEnv('DEFAULT_TEACHER_EMAIL', 'admin@wadia.ac.in'),
  DEFAULT_TEACHER_PASSWORD: process.env.DEFAULT_TEACHER_PASSWORD,
};
