const express = require('express');
const authRoutes = require('./authRoutes');
const attendanceRoutes = require('./attendanceRoutes');
const sessionRoutes = require('./sessionRoutes');
const passwordRoutes = require('./passwordRoutes');
const bootstrapRoutes = require('./bootstrapRoutes');
const locationRoutes = require('./LocationRoutes');

const router = express.Router();
router.use(bootstrapRoutes);
router.use(authRoutes);
router.use(attendanceRoutes);
router.use(sessionRoutes);
router.use(passwordRoutes);
router.use('/api', locationRoutes);
module.exports = router;
