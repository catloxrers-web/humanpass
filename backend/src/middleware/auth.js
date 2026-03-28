// src/middleware/auth.js
const jwt = require('jsonwebtoken');
const db  = require('../models/db');

function requireAuth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(t, process.env.JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token inválido' }); }
}

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.apikey;
  if (!key) return res.status(401).json({ error: 'API key requerida' });

  const k = db.prepare(`
    SELECT k.*, u.id as uid, u.active
    FROM api_keys k JOIN users u ON u.id = k.user_id
    WHERE k.key=? AND k.active=1
  `).get(key);

  if (!k)        return res.status(401).json({ error: 'API key inválida' });
  if (!k.active) return res.status(403).json({ error: 'Cuenta suspendida' });

  req.apiKey = k;
  req.clientId = k.uid;
  next();
}

module.exports = { requireAuth, requireApiKey };
