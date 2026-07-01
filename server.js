const { requireEnv, isProduction, PORT, SESSION_SECRET, SESSION_COOKIE_SECURE, TRUST_PROXY } = require('./src/config/env');
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const { db } = require('./src/models/database');
const TursoSessionStore = require('./src/services/sessionStore');
const routes = require('./src/routes');

const app = express();
const secureCookies = SESSION_COOKIE_SECURE
  ? SESSION_COOKIE_SECURE === 'true'
  : isProduction;
const trustProxy = TRUST_PROXY
  ? TRUST_PROXY === 'true'
  : isProduction;
const SESSION_SECRET_VALUE = requireEnv('SESSION_SECRET');

if (isProduction) {
  requireEnv('DEFAULT_TEACHER_PASSWORD');
  if (process.env.DEFAULT_TEACHER_PASSWORD === 'TempPass123!') {
    console.error('FATAL: DEFAULT_TEACHER_PASSWORD is still the example value. Set a real password.');
    process.exit(1);
  }
}

// If running behind a proxy (common in cloud deployments),
app.set('trust proxy', trustProxy ? 1 : 0);

// bich ka mamla
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(session({
  store: new TursoSessionStore(db),
  secret: SESSION_SECRET_VALUE,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: secureCookies,
    httpOnly: true,
    // 'lax' blocks cookies on QR code scans from a camera app (cross-site GET navigations
    // that are not top-level, or POST fetches). Use 'none' in production (requires secure:true)
    // so the session cookie is always included. Fall back to 'lax' in local dev (HTTP).
    sameSite: secureCookies ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000
  }
}));


app.use(express.static(path.join(__dirname)));

// Mount API routes
app.use(routes);


// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ success: false, message: 'Internal server error' });
});

(async () => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
})();
