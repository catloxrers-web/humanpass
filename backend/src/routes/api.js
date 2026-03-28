// src/routes/api.js
const express = require('express');
const { v4: uuid } = require('uuid');
const db      = require('../models/db');
const queue   = require('../services/queue');
const { requireAuth, requireApiKey } = require('../middleware/auth');
const router  = express.Router();

// ── API Keys ──────────────────────────────────────────────────────
router.get('/keys', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT id,key,label,active,used,created_at FROM api_keys WHERE user_id=? ORDER BY created_at DESC').all(req.user.userId));
});

router.post('/keys', requireAuth, (req, res) => {
  const key = 'hp_' + uuid().replace(/-/g, '');
  db.prepare('INSERT INTO api_keys (user_id, key, label) VALUES (?,?,?)').run(req.user.userId, key, req.body.label || 'Default');
  res.json({ key });
});

// ── Enviar tarea ──────────────────────────────────────────────────
router.post('/task', requireApiKey, (req, res) => {
  const { sitekey, url } = req.body;
  if (!sitekey || !url) return res.status(400).json({ error: 'sitekey y url son requeridos' });

  const stats = queue.getStats();
  if (stats.workers_online === 0) return res.status(503).json({ error: 'No hay workers disponibles ahora.' });

  const id  = uuid();
  const exp = new Date(Date.now() + 180_000).toISOString().replace('T', ' ').slice(0, 19);
  db.prepare('INSERT INTO tasks (id,api_key_id,client_id,sitekey,url,expires_at) VALUES (?,?,?,?,?,?)').run(id, req.apiKey.id, req.clientId, sitekey, url, exp);
  db.prepare('UPDATE api_keys SET used=used+1 WHERE id=?').run(req.apiKey.id);

  queue.enqueueTask();
  res.json({ taskId: id, status: 'pending' });
});

// ── Consultar tarea ───────────────────────────────────────────────
router.get('/task/:id', requireApiKey, (req, res) => {
  const t = db.prepare('SELECT id,status,token,created_at,solved_at FROM tasks WHERE id=?').get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tarea no encontrada' });
  res.json(t);
});

// ── Long-poll: esperar token ──────────────────────────────────────
router.get('/task/:id/wait', requireApiKey, async (req, res) => {
  try {
    const token = await queue.waitForToken(req.params.id);
    res.json({ status: 'solved', token });
  } catch (e) {
    res.status(408).json({ status: e.message });
  }
});

// ── Stats ─────────────────────────────────────────────────────────
router.get('/stats', (req, res) => {
  const s = queue.getStats();
  const total = db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status='solved'`).get().c;
  res.json({ ...s, total_solved: total });
});

module.exports = router;
