// src/routes/api.js
const express = require('express');
const router  = express.Router();

// ── Rutas de ejemplo (puedes agregar las tuyas aquí) ─────────────────

router.get('/health', (req, res) => {
  res.json({ ok: true, message: 'API funcionando' });
});

router.get('/stats', (req, res) => {
  try {
    const queue = require('../services/queue');
    res.json(queue.getStats ? queue.getStats() : { message: 'Stats no disponible' });
  } catch (e) {
    res.json({ error: 'No se pudieron obtener estadísticas' });
  }
});

// ← Aquí irán tus rutas reales (tasks, workers, etc.)
// Ejemplo:
// router.get('/tasks', getAllTasks);
// router.post('/tasks', createTask);
// etc.

module.exports = router;
