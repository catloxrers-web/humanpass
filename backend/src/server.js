// ── WebSocket: workers ────────────────────────────────────────────
wss.on('connection', (ws) => {
  let wid = null;
  console.log('[WS] Nueva conexión entrante');

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
      console.log(`[WS] Mensaje recibido:`, msg.type);
    } catch (e) {
      console.error('[WS] Error parseando mensaje:', e.message);
      return;
    }

    switch (msg.type) {
      case 'AUTH':
        try {
          const p = jwt.verify(msg.token, process.env.JWT_SECRET || 'humanpass_secret_cambia_esto_en_produccion');
          if (p.role !== 'worker') throw new Error('Not a worker');

          const u = db.prepare(`SELECT * FROM users WHERE id=? AND active=1`).get(p.userId);
          if (!u || u.role !== 'worker') throw new Error('User not found or inactive');

          wid = u.id;
          queue.registerWorker(wid, ws);

          ws.send(JSON.stringify({ 
            type: 'AUTH_OK', 
            worker: { id: u.id, name: u.name, solved: u.solved || 0 } 
          }));

          console.log(`[WS] ✅ Worker #${wid} autenticado correctamente`);
        } catch (e) {
          console.error(`[WS] ❌ Error en AUTH:`, e.message);
          ws.send(JSON.stringify({ type: 'ERROR', error: e.message }));
          ws.close(4001, e.message);
        }
        break;

      case 'TASK_SOLVED':
        if (!wid) return;
        console.log(`[WS] Worker #${wid} enviando solución para tarea ${msg.taskId}`);
        const ok = queue.submitSolution(wid, msg.taskId, msg.token);
        ws.send(JSON.stringify({ type: ok ? 'TASK_ACK' : 'TASK_ERROR', taskId: msg.taskId }));
        break;

      case 'TASK_SKIP':
        if (!wid) return;
        db.prepare(`UPDATE tasks SET status='pending', worker_id=NULL, assigned_at=NULL WHERE id=? AND worker_id=?`).run(msg.taskId, wid);
        const w = queue.workers.get(wid);
        if (w) { w.status = 'idle'; w.currentTaskId = null; }
        setTimeout(() => queue.assignPending(), 300);
        break;

      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;

      default:
        console.log(`[WS] Tipo desconocido:`, msg.type);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS] Conexión cerrada. Código: ${code}, Razón: ${reason || 'ninguna'}`);
    if (wid) queue.unregisterWorker(wid);
  });

  ws.on('error', (e) => {
    console.error(`[WS] Error en WebSocket:`, e.message);
  });
});
