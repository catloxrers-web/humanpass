// src/routes/api.js
const express = require('express');
const router = express.Router();
const queue = require('../services/queue');
const db = require('../models/db');

// Middleware simple de autenticación para clientes (puedes mejorarlo después)
function clientAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  if (!apiKey) {
    return res.status(401).json({ error: 'API Key requerida' });
  }
  // Aquí puedes validar la api_key contra la tabla api_keys si quieres
  req.apiKey = apiKey;
  next();
}

// 1. Cliente envía una nueva tarea hCaptcha
router.post('/tasks', clientAuth, async (req, res) => {
  const { sitekey, url, action, rqdata } = req.body;

  if (!sitekey || !url) {
    return res.status(400).json({ error: 'sitekey y url son requeridos' });
  }

  try {
    // Crear tarea en la base de datos
    const task = db.prepare(`
      INSERT INTO tasks (sitekey, url, action, rqdata, status, created_at)
      VALUES (?, ?, ?, ?, 'pending', datetime('now'))
    `).run(sitekey, url, action || null, rqdata || null);

    const taskId = task.lastInsertRowid;

    // Encolar
    queue.enqueueTask();

    res.json({
      success: true,
      taskId: taskId,
      message: 'Tarea encolada. Esperando worker...'
    });
  } catch (e) {
    console.error('[API] Error creando tarea:', e.message);
    res.status(500).json({ error: 'Error interno al crear tarea' });
  }
});

// 2. Cliente consulta el resultado de una tarea
router.get('/tasks/:id', clientAuth, (req, res) => {
  const taskId = req.params.id;

  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

    if (!task) {
      return res.status(404).json({ error: 'Tarea no encontrada' });
    }

    res.json({
      taskId: task.id,
      status: task.status,
      token: task.status === 'solved' ? task.token : null,
      message: task.status === 'solved' ? 'Captcha resuelto' : 'En proceso...'
    });
  } catch (e) {
    res.status(500).json({ error: 'Error al consultar tarea' });
  }
});

// 3. Endpoint para workers (opcional, si la extensión del worker también usa API REST)
router.get('/stats', (req, res) => {
  try {
    res.json(queue.getStats());
  } catch (e) {
    res.json({ workers_online: 0, queue_pending: 0 });
  }
});

module.exports = router;
