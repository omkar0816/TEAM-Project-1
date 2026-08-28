// src/routes/LocationRoutes.js
// SIMPLIFIED: Only role-agnostic routes go here
// Role-specific routes (students, teachers) handled in their own files

const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', async (req, res) => {
  try {
    const { db } = require('../models/database');
    await db.execute('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});

module.exports = router;