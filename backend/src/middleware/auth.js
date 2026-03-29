// src/routes/auth.js
const express = require('express');
const bcrypt  = require('bcryptjs');
const jwt     = require('jsonwebtoken');
const db      = require('../models/db');
const router  = express.Router();

// Usuarios hardcodeados para pruebas
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
  if (!email) return null;
  const normalizedEmail = email.toLowerCase().trim();
  
  const hardcoded = USERS_PRUEBA.find(u => u.email === normalizedEmail);
  if (hardcoded) return hardcoded;

  try {
    return db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(normalizedEmail);
  } catch (e) {
    console.error('[Auth] DB error in findUser:', e.message);
    return null;
  }
}

function sign(user) {
  return jwt.sign(
    { userId: user.id, role: user.role }, 
    process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion', 
    { expiresIn: '7d' }
  );
}

function pub(u) {
  return { 
    id: u.id, 
    name: u.name, 
    email: u.email, 
    role: u.role, 
    solved: u.solved || 0, 
    credits: u.credits || 0 
  };
}

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña requeridos' });
  }

  const user = findUser(email);
  if (!user) return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  if (!user.active) return res.status(403).json({ error: 'Cuenta suspendida' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Email o contraseña incorrectos' });

  res.json({ 
    token: sign(user), 
    user: pub(user) 
  });
});

// GET /auth/me
router.get('/me', (req, res) => {
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (!token) return res.status(401).json({ error: 'No token provided' });

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion');
    
    const user = USERS_PRUEBA.find(u => u.id === payload.userId) ||
                 db.prepare('SELECT * FROM users WHERE id=?').get(payload.userId);

    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json(pub(user));
  } catch (err) {
    res.status(401).json({ error: 'Unauthorized' });
  }
});

module.exports = router;
