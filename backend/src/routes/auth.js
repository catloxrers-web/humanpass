// src/routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../models/db');
const router  = express.Router();

function sign(user) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: '7d' });
}

function pub(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, solved: u.solved };
}

// POST /auth/login  { email, password }
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email.toLowerCase().trim());
  if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  res.json({ token: sign(user), user: pub(user) });
});

// GET /auth/me
router.get('/me', (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const p = jwt.verify(t, process.env.JWT_SECRET);
    const u = db.prepare('SELECT * FROM users WHERE id=?').get(p.userId);
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json(pub(u));
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

module.exports = router;
