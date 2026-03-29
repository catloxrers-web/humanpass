// ── WebSocket: workers ────────────────────────────────────────────
wss.on('connection', (ws) => {
  let wid = null;
  console.log('[WS] ✅ Nueva conexión WebSocket entrante desde cliente');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      console.log(`[WS] 📨 Mensaje recibido: ${msg.type}`, msg);
    } catch (e) {
      console.error('[WS] ❌ Error parseando JSON:', e.message);
      return;
    }

    if (msg.type === 'AUTH') {
      try {
        console.log('[WS] Intentando verificar token...');
        const payload = jwt.verify(
          msg.token, 
          process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion'
        );
        console.log('[WS] Token verificado. userId:', payload.userId, 'role:', payload.role);

        if (payload.role !== 'worker') {
          throw new Error('El usuario no es un worker');
        }

        const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(payload.userId);
        if (!user) throw new Error('Worker no encontrado o inactivo');

        wid = user.id;
        queue.registerWorker(wid, ws);

        ws.send(JSON.stringify({ 
          type: 'AUTH_OK', 
          worker: { id: user.id, name: user.name, solved: user.solved || 0 } 
        }));

        console.log(`[WS] 🎉 Worker #${wid} (${user.name}) autenticado correctamente`);
      } catch (e) {
        console.error(`[WS] ❌ Error en AUTH:`, e.message);
        ws.send(JSON.stringify({ type: 'ERROR', error: e.message }));
        ws.close(4001, e.message);
      }
    } 
    else if (msg.type === 'TASK_SOLVED' && wid) {
      console.log(`[WS] Worker #${wid} enviando solución para tarea ${msg.taskId}`);
      const ok = queue.submitSolution(wid, msg.taskId, msg.token);
      ws.send(JSON.stringify({ type: ok ? 'TASK_ACK' : 'TASK_ERROR', taskId: msg.taskId }));
    }
    else if (msg.type === 'PING') {
      ws.send(JSON.stringify({ type: 'PONG' }));
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] 🔌 Conexión cerrada. Código: ${code}, Razón: ${reason || 'ninguna'}`);
    if (wid) queue.unregisterWorker(wid);
  });

  ws.on('error', (err) => {
    console.error(`[WS] ❌ Error en WebSocket:`, err.message || err);
  });
});
