// src/server.js
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db        = require('./models/db');
const queue     = require('./services/queue');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server, path: '/ws' });

const PORT   = process.env.PORT || 3000;

// Middlewares
app.use(require('cors')({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// Rutas
app.use('/auth', require('./routes/auth'));
app.use('/api',  require('./routes/api'));

// Health check (muy útil para Railway)
app.get('/health', (_, res) => res.json({ 
  ok: true, 
  ts: Date.now(),
  env: process.env.NODE_ENV || 'development'
}));

// ── Auto-seed: crear usuarios maestros si no existen ─────────────
async function autoSeed() {
  try {
    const workerExists = db.prepare('SELECT id FROM users WHERE email=?').get('worker@humanpass.test');
    if (!workerExists) {
      const wHash = await bcrypt.hash('worker123', 10);
      db.prepare(`INSERT INTO users (email, name, password_hash, role, verified, verify_token) VALUES (?,?,?,'worker',1,NULL)`)
        .run('worker@humanpass.test', 'Worker Master', wHash);
      console.log('[Seed] ✅ Worker creado: worker@humanpass.test / worker123');
    }

    const clientExists = db.prepare('SELECT id FROM users WHERE email=?').get('admin@humanpass.test');
    if (!clientExists) {
      const cHash = await bcrypt.hash('admin123', 10);
      const r = db.prepare(`INSERT INTO users (email, name, password_hash, role, verified, verify_token) VALUES (?,?,?,'client',1,NULL)`)
        .run('admin@humanpass.test', 'Admin Master', cHash);
      
      const apiKey = 'hp_' + uuid().replace(/-/g, '');
      db.prepare('INSERT INTO api_keys (user_id, key, label) VALUES (?,?,?)').run(r.lastInsertRowid, apiKey, 'Master Key');
      
      console.log('[Seed] ✅ Cliente creado: admin@humanpass.test / admin123');
      console.log('[Seed] API Key:', apiKey);
    }
  } catch(e) {
    console.error('[Seed] ❌ Error:', e.message);
    // No salimos del proceso, solo logueamos
  }
}

// ── WebSocket: workers ────────────────────────────────────────────
wss.on('connection', ws => {
  let wid = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    switch (msg.type) {
      case 'AUTH':
        try {
          const p = jwt.verify(msg.token, process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion');
          if (p.role !== 'worker') throw new Error('Not a worker');
          
          const u = db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(p.userId);
          if (!u || u.role !== 'worker') throw new Error('User not found');
          
          wid = u.id;
          queue.registerWorker(wid, ws);
          ws.send(JSON.stringify({ type: 'AUTH_OK', worker: { id: u.id, name: u.name, solved: u.solved } }));
        } catch (e) {
          ws.send(JSON.stringify({ type: 'ERROR', error: e.message }));
          ws.close();
        }
        break;

      case 'TASK_SOLVED':
        if (!wid) return;
        const ok = queue.submitSolution(wid, msg.taskId, msg.token);
        ws.send(JSON.stringify({ type: ok ? 'TASK_ACK' : 'TASK_ERROR', taskId: msg.taskId }));
        break;

      case 'TASK_SKIP':
        if (!wid) return;
        db.prepare(`UPDATE tasks SET status='pending', worker_id=NULL, assigned_at=NULL WHERE id=? AND worker_id=?`).run(msg.taskId, wid);
        const w = queue.workers.get(wid);
        if (w) { 
          w.status = 'idle'; 
          w.currentTaskId = null; 
        }
        setTimeout(() => queue.assignPending(), 300);
        break;

      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;
    }
  });

  ws.on('close', () => { if (wid) queue.unregisterWorker(wid); });
  ws.on('error', e => console.error('[WS]', e.message));
});

// Limpiar tareas expiradas
setInterval(() => {
  const r = db.prepare(`UPDATE tasks SET status='expired' WHERE status IN ('pending','assigned') AND expires_at < datetime('now')`).run();
  if (r.changes) console.log(`[Cleanup] ${r.changes} tareas expiradas`);
}, 300_000);

// ── Iniciar servidor de forma más segura ───────────────────────
async function startServer() {
  try {
    await autoSeed();
    
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 HumanPass corriendo en http://0.0.0.0:${PORT}`);
      console.log(`   Health check → /health`);
      console.log(`   WebSocket    → /ws`);
    });
  } catch (err) {
    console.error('❌ Error fatal al iniciar el servidor:', err.message);
    process.exit(1);
  }
}

startServer();
