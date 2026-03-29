// ── WebSocket: workers ────────────────────────────────────────────
wss.on('connection', (ws) => {
  let wid = null;
  console.log('[WS] Nueva conexión entrante');

  // Responder inmediatamente para evitar cierre por timeout
  ws.send(JSON.stringify({ type: 'PONG', message: 'connected' }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      console.log(`[WS] Mensaje recibido: ${msg.type}`);
    } catch (e) {
      console.error('[WS] Error parse JSON');
      return;
    }

    if (msg.type === 'AUTH') {
      try {
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion';
        const payload = jwt.verify(msg.token, secret);

        if (payload.role !== 'worker') throw new Error('Not worker');

        const user = db.prepare('SELECT id, name, role FROM users WHERE id = ? AND active = 1').get(payload.userId);
        if (!user) throw new Error('Worker not found');

        wid = user.id;
        queue.registerWorker(wid, ws);

        ws.send(JSON.stringify({ 
          type: 'AUTH_OK', 
          worker: { id: user.id, name: user.name } 
        }));

        console.log(`[WS] Worker #${wid} autenticado OK`);
      } catch (e) {
        console.error(`[WS] AUTH error: ${e.message}`);
        ws.send(JSON.stringify({ type: 'ERROR', error: e.message }));
        ws.close(4001, e.message);
      }
    } else if (msg.type === 'TASK_SOLVED' && wid) {
      queue.submitSolution(wid, msg.taskId, msg.token);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Cerrado - Código: ${code}`);
    if (wid) queue.unregisterWorker(wid);
  });

  ws.on('error', (err) => console.error('[WS] Error:', err.message));
});
