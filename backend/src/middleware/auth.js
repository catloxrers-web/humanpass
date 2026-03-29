// src/routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../models/db');
const router  = express.Router();

// Usuarios hardcodeados para pruebas (hashes precalculados)
const USERS_PRUEBA = [
  {
    id: 1,
    email: 'worker@humanpass.test',
    name: 'Worker Master',
    password_hash: '$2a$10$55LLe1hjlxGtUN0L0z1LI.4g5IEqzSTI6fT93xR9t7am2we4RP68u',
    role: 'worker',
    active: 1,
    solved: 0
  },
  {
    id: 2,
    email: 'admin@humanpass.test',
    name: 'Admin Master',
    password_hash: '$2a$10$ec4FQHE9yQ20Ft825Zd6MuZRX1pXBddR.pAeVWs.xUkDtIMUpn8yK',
    role: 'client',
    active: 1,
    solved: 0,
    credits: 999999
  }
];

function findUser(email) {
  // Buscar primero en usuarios hardcodeados
  const hardcoded = USERS_PRUEBA.find(u => u.email === email.toLowerCase().trim());
  if (hardcoded) return hardcoded;
  // Luego en la DB
  try { return db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email.toLowerCase().trim()); }
  catch(_) { return null; }
}

function sign(user) {
  return jwt.sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET || 'humanpass_secret', { expiresIn: '7d' });
}

function pub(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, solved: u.solved || 0, credits: u.credits || 0 };
}

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email y contraseña requeridos' });

  const user = findUser(email);
  if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  if (!user.active) return res.status(403).json({ error: 'Cuenta suspendida' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  res.json({ token: sign(user), user: pub(user) });
});

// GET /auth/me
router.get('/me', (req, res) => {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  try {
    const p   = jwt.verify(t, process.env.JWT_SECRET || 'humanpass_secret');
    // Buscar en hardcodeados primero
    const u   = USERS_PRUEBA.find(u => u.id === p.userId) ||
                db.prepare('SELECT * FROM users WHERE id=?').get(p.userId);
    if (!u) return res.status(404).json({ error: 'Not found' });
    res.json(pub(u));
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

module.exports = router;
