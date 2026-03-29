// src/services/queue.js
const db = require('../models/db');

const workers = new Map(); // workerId → { ws, status, currentTaskId }
const waiters = new Map(); // taskId  → { resolve, timer }
const TIMEOUT = 120_000;

function registerWorker(workerId, ws) {
  workers.set(workerId, { ws, status: 'idle', currentTaskId: null });
  console.log(`[Queue] Worker #${workerId} conectado. Total: ${workers.size}`);
  assignToWorker(workerId);
}

function unregisterWorker(workerId) {
  const w = workers.get(workerId);
  if (w?.currentTaskId) {
    db.prepare(`UPDATE tasks SET status='pending', worker_id=NULL, assigned_at=NULL WHERE id=? AND status='assigned'`).run(w.currentTaskId);
    setTimeout(assignPending, 500);
  }
  workers.delete(workerId);
  console.log(`[Queue] Worker #${workerId} desconectado. Total: ${workers.size}`);
}

function enqueueTask() { assignPending(); }

function assignPending() {
  for (const [wid, w] of workers) {
    if (w.status === 'idle') assignToWorker(wid);
  }
}

function assignToWorker(workerId) {
  const w = workers.get(workerId);
  if (!w || w.status !== 'idle') return false;

  const task = db.prepare(`
    SELECT * FROM tasks
    WHERE status='pending' AND expires_at > datetime('now')
    ORDER BY created_at ASC LIMIT 1
  `).get();
  if (!task) return false;

  const upd = db.prepare(`
    UPDATE tasks SET status='assigned', worker_id=?, assigned_at=datetime('now')
    WHERE id=? AND status='pending'
  `).run(workerId, task.id);
  if (!upd.changes) return false;

  w.status = 'busy';
  w.currentTaskId = task.id;
  w.ws.send(JSON.stringify({
    type: 'NEW_TASK',
    task: { id: task.id, sitekey: task.sitekey, url: task.url }
  }));
  console.log(`[Queue] Tarea ${task.id} → Worker #${workerId}`);

  // Timer de expiración de asignación
  setTimeout(() => {
    const t = db.prepare('SELECT status FROM tasks WHERE id=?').get(task.id);
    if (t?.status === 'assigned') {
      db.prepare(`UPDATE tasks SET status='pending', worker_id=NULL, assigned_at=NULL WHERE id=?`).run(task.id);
      if (w.currentTaskId === task.id) { w.status = 'idle'; w.currentTaskId = null; }
      assignPending();
    }
  }, TIMEOUT);

  return true;
}

function submitSolution(workerId, taskId, token) {
  const w    = workers.get(workerId);
  const task = db.prepare(`SELECT * FROM tasks WHERE id=? AND worker_id=? AND status='assigned'`).get(taskId, workerId);
  if (!task) return false;

  db.prepare(`UPDATE tasks SET status='solved', token=?, solved_at=datetime('now') WHERE id=?`).run(token, taskId);
  db.prepare(`UPDATE users SET solved=solved+1 WHERE id=?`).run(workerId);

  if (w) { w.status = 'idle'; w.currentTaskId = null; }

  const waiter = waiters.get(taskId);
  if (waiter) { clearTimeout(waiter.timer); waiter.resolve(token); waiters.delete(taskId); }

  console.log(`[Queue] Tarea ${taskId} resuelta por Worker #${workerId}`);
  setTimeout(() => assignToWorker(workerId), 300);
  return true;
}

function waitForToken(taskId) {
  return new Promise((resolve, reject) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
    if (task?.status === 'solved' && task.token) return resolve(task.token);
    if (task?.status === 'expired' || task?.status === 'failed') return reject(new Error(task.status));

    const timer = setTimeout(() => {
      waiters.delete(taskId);
      db.prepare(`UPDATE tasks SET status='expired' WHERE id=? AND status!='solved'`).run(taskId);
      reject(new Error('timeout'));
    }, TIMEOUT);

    waiters.set(taskId, { resolve, timer });
  });
}

function getStats() {
  return {
    workers_online: workers.size,
    workers_idle:   [...workers.values()].filter(w => w.status === 'idle').length,
    workers_busy:   [...workers.values()].filter(w => w.status === 'busy').length,
    queue_pending:  (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status='pending'`).get() || {c:0}).c,
    solved_today:   (db.prepare(`SELECT COUNT(*) as c FROM tasks WHERE status='solved' AND date(solved_at)=date('now')`).get() || {c:0}).c
  };
}

module.exports = { registerWorker, unregisterWorker, enqueueTask, submitSolution, waitForToken, getStats, workers, assignPending };
