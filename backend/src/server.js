// src/server.js
require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const db = require('./models/db');
const queue = require('./services/queue');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: '/ws' });

const PORT = process.env.PORT || 3000;

app.use(require('cors')({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', require('./routes/auth'));
app.use('/api', require('./routes/api'));

app.get('/health', (_, res) => res.json({ ok: true }));

// AutoSeed simple
async function autoSeed() {
  try {
    const workerExists = db.prepare('SELECT id FROM users WHERE email=?').get('worker@humanpass.test');
    if (!workerExists) {
      const bcrypt = require('bcryptjs');
      const hash = await bcrypt.hash('worker123', 10);
      db.prepare(`INSERT INTO users (email, name, password_hash, role, active) VALUES (?,?,?,'worker',1)`)
        .run('worker@humanpass.test', 'Worker Master', hash);
      console.log('[Seed] Worker creado');
    }
  } catch (e) {
    console.error('[Seed] Error:', e.message);
  }
}

// WebSocket - versión mínima sin errores fáciles de crash
wss.on('connection', (ws) => {
  console.log('[WS] Nueva conexión');
  let wid = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === 'AUTH') {
      try {
        const jwt = require('jsonwebtoken');
        const payload = jwt.verify(msg.token, process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion');
        
        const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(payload.userId);
        if (!user || user.role !== 'worker') throw new Error('Invalid worker');

        wid = user.id;
        queue.registerWorker(wid, ws);
        ws.send(JSON.stringify({ type: 'AUTH_OK', worker: { id: user.id, name: user.name } }));
        console.log(`[WS] Worker #${wid} conectado OK`);
      } catch (e) {
        console.error('[WS] AUTH failed:', e.message);
        ws.close(4001, e.message);
      }
    } else if (msg.type === 'TASK_SOLVED' && wid) {
      queue.submitSolution(wid, msg.taskId, msg.token);
    }
  });

  ws.on('close', () => {
    if (wid) queue.unregisterWorker(wid);
    console.log('[WS] Conexión cerrada');
  });
});

async function startServer() {
  await autoSeed();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
