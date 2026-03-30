// src/server.js
require('dotenv').config();
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const { v4: uuid } = require('uuid');

const db    = require('./models/db');
const queue = require('./services/queue');

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

app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

// ── Auto-seed ─────────────────────────────────────────────────────
async function autoSeed() {
  try {
    // Crear worker si no existe
    if (!db.prepare('SELECT id FROM users WHERE email=?').get('worker@humanpass.test')) {
      const hash = await bcrypt.hash('worker123', 10);
      db.prepare(`INSERT INTO users (email, name, password_hash, role, active) 
                  VALUES (?,?,?,'worker',1)`).run('worker@humanpass.test', 'Worker Master', hash);
      console.log('[Seed] ✅ Worker creado: worker@humanpass.test');
    }

    // Crear admin si no existe
    if (!db.prepare('SELECT id FROM users WHERE email=?').get('admin@humanpass.test')) {
      const hash = await bcrypt.hash('admin123', 10);
      db.prepare(`INSERT INTO users (email, name, password_hash, role, active) 
                  VALUES (?,?,?,'client',1)`).run('admin@humanpass.test', 'Admin Master', hash);
      console.log('[Seed] ✅ Admin creado: admin@humanpass.test');
    }
  } catch (e) {
    console.error('[Seed] Error:', e.message);
  }
}

// ── WebSocket: workers ────────────────────────────────────────────
wss.on('connection', (ws) => {
  let wid = null;
  console.log('[WS] ✅ Nueva conexión WebSocket entrante');

  // Responder inmediatamente
  ws.send(JSON.stringify({ type: 'PONG', message: 'Server alive' }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      console.log(`[WS] 📨 Mensaje recibido: ${msg.type}`);
    } catch (e) {
      console.error('[WS] ❌ Error parseando JSON');
      return;
    }

    if (msg.type === 'AUTH') {
      try {
        const secret = process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion';
        const payload = jwt.verify(msg.token, secret);
        console.log(`[WS] JWT verificado → userId: ${payload.userId}, role: ${payload.role}`);

        if (payload.role !== 'worker') {
          throw new Error('El usuario no es un worker');
        }

        const user = db.prepare('SELECT id, name, role FROM users WHERE id=? AND active=1').get(payload.userId);
        if (!user) throw new Error('Worker no encontrado o inactivo');

        wid = user.id;
        queue.registerWorker(wid, ws);

        ws.send(JSON.stringify({ 
          type: 'AUTH_OK', 
          worker: { id: user.id, name: user.name } 
        }));

        console.log(`[WS] 🎉 Worker #${wid} autenticado correctamente`);
      } catch (e) {
        console.error(`[WS] ❌ Error en AUTH: ${e.message}`);
        ws.send(JSON.stringify({ type: 'ERROR', error: e.message }));
        ws.close(4001, e.message);
      }
    } 
    else if (msg.type === 'TASK_SOLVED' && wid) {
      console.log(`[WS] Solución recibida para tarea ${msg.taskId}`);
      const ok = queue.submitSolution(wid, msg.taskId, msg.token);
      ws.send(JSON.stringify({ type: ok ? 'TASK_ACK' : 'TASK_ERROR', taskId: msg.taskId }));
    } 
    else if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] 🔌 Conexión cerrada - Código: ${code}`);
    if (wid) queue.unregisterWorker(wid);
  });

  ws.on('error', (err) => {
    console.error(`[WS] ❌ Error en WebSocket:`, err.message || err);
  });
});

// Iniciar servidor
async function startServer() {
  await autoSeed();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 HumanPass corriendo en http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('❌ Error fatal al iniciar:', err.message);
  process.exit(1);
});
