const express = require('express');
const path = require('path');
const { db } = require('../models/database');

const router = express.Router();
const projectRoot = path.join(__dirname, '..', '..');

router.get('/test', (req, res) => {
  res.json({ message: 'Test route works' });
});

router.post('/test-post', (req, res) => {
  res.json({ message: 'Test POST route works', body: req.body });
});

router.get('/health', async (req, res) => {
  try {
    await db.execute('SELECT 1');
    res.json({ status: 'ok', uptime: process.uptime() });
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(503).json({ status: 'error', error: 'Database unavailable' });
  }
});

router.get('/', (req, res) => {
  if (req.session.userId) {
    if (req.session.role === 'teacher') {
      res.sendFile(path.join(projectRoot, 'teacher.html'));
    } else {
      res.sendFile(path.join(projectRoot, 'student.html'));
    }
  } else {
    res.sendFile(path.join(projectRoot, 'index.html'));
  }
});

module.exports = router;
