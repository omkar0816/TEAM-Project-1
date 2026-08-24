# Production Deployment Checklist

> This document ensures your Wadia Attendance System works correctly when deployed to production.

## ✅ Pre-Deployment Verification

All changes have been tested and are **100% production-safe**:

- ✓ Rate limiters automatically adjust for production (strict limits)
- ✓ Login handler works on both localhost and production domains
- ✓ Session persistence works across environments
- ✓ Security settings enforced in production mode
- ✓ HTTPS enforcement enabled
- ✓ Reverse proxy support configured

## 🔧 Production Environment Setup

### Step 1: Environment Variables
Create or update your production `.env` file:

```bash
# ===== DATABASE (PRODUCTION) =====
NODE_ENV=production
TURSO_DB_URL=libsql://your-actual-turso-url.aws-ap-south-1.turso.io
TURSO_AUTH_TOKEN=your_turso_auth_token_here

# ===== SECURITY (PRODUCTION) =====
SESSION_SECRET=your-random-64-character-hex-string
SESSION_COOKIE_SECURE=true
TRUST_PROXY=true

# ===== TEACHER ACCOUNT =====
DEFAULT_TEACHER_EMAIL=admin@wadia.ac.in
DEFAULT_TEACHER_PASSWORD=YourStrongPassword123!  # NOT the temporary password

# ===== PORT =====
PORT=3000
```

### Step 2: Generate Strong SESSION_SECRET

Run this command locally and copy the output:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Paste the output into `SESSION_SECRET` in your production `.env`.

### Step 3: Configure Turso Database

1. Get your Turso credentials from your cloud dashboard
2. Replace `TURSO_DB_URL` with your actual database URL
3. Replace `TURSO_AUTH_TOKEN` with your auth token

### Step 4: Set Strong Teacher Password

Change `DEFAULT_TEACHER_PASSWORD` to a secure password (min 8 characters):
- Mix uppercase, lowercase, numbers, symbols
- Example: `W@dia2024!Secure`

### Step 5: HTTPS Configuration

Ensure your production domain has:
- ✓ Valid SSL/TLS certificate
- ✓ HTTPS enforced (HTTP → HTTPS redirect)
- ✓ Session cookies marked secure

If behind reverse proxy (nginx, CloudFlare):
- ✓ `TRUST_PROXY=true` is set in `.env`

## 📊 Production Rate Limits

Once deployed with `NODE_ENV=production`, these limits apply:

| Operation | Limit | Window |
|-----------|-------|--------|
| Login attempts | 5 | 15 minutes |
| Sign-ups | 10 | 15 minutes |
| Attendance marking | 10 | 1 minute |
| Code generation | 5 | 1 minute |

**Note:** These are automatically applied. No configuration needed.

## 🧪 Post-Deployment Testing

After deploying to production, verify:

### Test 1: Server is Running
```bash
curl https://your-domain.com/check-session
# Should return: {"loggedIn":false,"mustChangePassword":false}
```

### Test 2: Teacher Can Login
1. Open https://your-domain.com
2. Click "Teacher" button
3. Enter: `admin@wadia.ac.in` / `[YOUR_PASSWORD]`
4. Should redirect to teacher dashboard
5. Must change password on first login

### Test 3: Student Can Login
1. Create a test student account via Sign Up
2. Fill in all required fields
3. Should redirect to student dashboard
4. Should ask for location permission

### Test 4: HTTPS Enforcement
```bash
# Should redirect to HTTPS
curl -i http://your-domain.com/
# Should see: 307 Temporary Redirect to https://...
```

### Test 5: Rate Limiter Works
```bash
# Attempt 5+ logins rapidly
for i in {1..10}; do
  curl -X POST https://your-domain.com/login \
    -H "Content-Type: application/json" \
    -d '{"role":"student","email":"test@test.com","prn":"F25211","password":"test"}'
done
# After 5 attempts, should return: "Too many login attempts..."
```

## 🔐 Security Checklist

Before going live:

- [ ] `SESSION_SECRET` is NOT the default `CHANGE_ME_MIN_32_CHARS`
- [ ] `SESSION_SECRET` is a random 64-character hex string
- [ ] `DEFAULT_TEACHER_PASSWORD` is NOT `TempPass123!`
- [ ] `DEFAULT_TEACHER_PASSWORD` is 8+ characters with mixed case/numbers
- [ ] `NODE_ENV=production` is set in production `.env`
- [ ] `SESSION_COOKIE_SECURE=true` is set
- [ ] `TRUST_PROXY=true` is set (if behind reverse proxy)
- [ ] HTTPS certificate is valid and enforced
- [ ] Turso database URL is configured correctly
- [ ] Turso auth token is valid and not shared publicly
- [ ] `.env` file is NOT committed to Git
- [ ] `.env` is added to `.gitignore`

## 🚀 Deployment Commands

```bash
# Pull latest code
git pull origin main

# Install dependencies
npm install

# Start server with production environment
NODE_ENV=production npm start

# Or use PM2 for process management
npm install -g pm2
NODE_ENV=production pm2 start server.js --name wadia-attendance
```

## 🆘 Troubleshooting

### "Too many login attempts" error appears immediately
**Problem:** Rate limiter blocking legitimate requests  
**Solution:** Make sure `NODE_ENV=production` is set correctly

### Login shows "Invalid password" for correct credentials
**Problem:** `DEFAULT_TEACHER_PASSWORD` doesn't match Turso database  
**Solution:** Check the password was set correctly during initial deployment

### "Session not found" after login
**Problem:** Session store not connected to Turso  
**Solution:** Verify `TURSO_DB_URL` and `TURSO_AUTH_TOKEN` are correct

### HTTPS not enforcing
**Problem:** Server not detecting HTTPS  
**Solution:** Ensure `TRUST_PROXY=true` if behind reverse proxy

### Students can't see location permission popup
**Problem:** Frontend expects specific environment setup  
**Solution:** This is domain-specific; check browser console for errors

## 📝 Monitoring

Recommended logging to monitor in production:

1. **Login attempts**: Track failed login patterns
2. **Rate limiter triggers**: Monitor abuse patterns
3. **Session errors**: Database connection issues
4. **Location tracking**: Geolocation API errors
5. **Attendance submissions**: Grade these requests

Set up alerts for:
- Server downtime
- Database connection failures
- Unusual rate limiter activity
- HTTPS certificate expiration

## 🔄 Updates & Maintenance

When updating production:

1. Pull latest code
2. Review `.env` file (don't overwrite with code changes)
3. Verify environment variables are still correct
4. Restart application: `pm2 restart wadia-attendance`
5. Run post-deployment tests
6. Monitor logs for errors

## 📞 Support

If you encounter issues:

1. Check server logs: `pm2 logs wadia-attendance`
2. Verify `.env` configuration
3. Test database connection with: `curl https://your-domain.com/check-session`
4. Review this checklist for missed steps

---

**Last Updated:** 2026-08-24  
**Status:** ✅ Production Ready
