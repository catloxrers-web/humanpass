// ── WebSocket: workers ────────────────────────────────────────────
wss.on('connection', (ws) => {
  let wid = null;
  console.log('[WS] ✅ Nueva conexión WebSocket entrante');

  // Enviar PONG inmediato para confirmar que el servidor está vivo
  ws.send(JSON.stringify({ type: 'PONG', message: 'Server alive' }));

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      console.log(`[WS] 📨 Mensaje recibido → type: ${msg.type}`);
    } catch (e) {
      console.error('[WS] ❌ JSON inválido:', e.message);
      return;
    }

    if (msg.type === 'AUTH') {
      console.log('[WS] Procesando AUTH...');
      try {
        const jwt = require('jsonwebtoken');
        const secret = process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion';
        const payload = jwt.verify(msg.token, secret);
        console.log(`[WS] JWT verificado → userId: ${payload.userId}, role: ${payload.role}`);

        if (payload.role !== 'worker') {
          throw new Error('Usuario no es worker');
        }

        const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(payload.userId);
        if (!user) throw new Error('Worker no encontrado o inactivo');

        wid = user.id;
        queue.registerWorker(wid, ws);

        ws.send(JSON.stringify({ 
          type: 'AUTH_OK', 
          worker: { id: user.id, name: user.name || 'Worker' } 
        }));

        console.log(`[WS] 🎉 WORKER #${wid} AUTENTICADO CORRECTAMENTE`);
      } catch (e) {
        console.error(`[WS] ❌ Error durante AUTH: ${e.message}`);
        ws.send(JSON.stringify({ type: 'ERROR', error: e.message }));
        setTimeout(() => ws.close(4001, e.message), 100);
      }
    } 
    else if (msg.type === 'TASK_SOLVED' && wid) {
      console.log(`[WS] Solución recibida para tarea ${msg.taskId}`);
      queue.submitSolution(wid, msg.taskId, msg.token);
    } 
    else if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] 🔌 Conexión cerrada - Código: ${code}, Razón: ${reason || 'sin razón'}`);
    if (wid) queue.unregisterWorker(wid);
  });

  ws.on('error', (err) => {
    console.error(`[WS] ❌ Error en socket:`, err.message || err);
  });
});
