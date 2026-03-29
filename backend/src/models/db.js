// src/models/db.js — DB en memoria con JSON (sin compilación nativa)
const fs   = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, '../../data.json');

// Estructura inicial
let data = {
  users:    [],
  api_keys: [],
  tasks:    []
};

// Cargar desde archivo si existe
if (fs.existsSync(DB_FILE)) {
  try { data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); } catch (_) {}
}

function save() {
  try { fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2)); } catch (_) {}
}

// Auto-save cada 5 segundos
setInterval(save, 5000);

// ── Helpers SQL-like ──────────────────────────────────────────────
function now() { return new Date().toISOString().replace('T',' ').slice(0,19); }

function matchWhere(row, where) {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (row[k] !== v) return false;
  }
  return true;
}

// ── API compatible con better-sqlite3 ────────────────────────────
const db = {
  pragma: () => {},
  exec: () => {},

  prepare: (sql) => {
    return {
      // ── GET (SELECT ... LIMIT 1) ──
      get: (...params) => {
        const result = executeQuery(sql, params);
        return result[0] || null;
      },
      // ── ALL (SELECT) ──
      all: (...params) => {
        return executeQuery(sql, params);
      },
      // ── RUN (INSERT/UPDATE/DELETE) ──
      run: (...params) => {
        return executeRun(sql, params);
      }
    };
  }
};

function executeQuery(sql, params) {
  const s = sql.toLowerCase().trim();
  let p = [...params];

  // SELECT FROM users
  if (s.includes('from users')) {
    let rows = [...data.users];
    rows = applyWhere(rows, sql, p);
    rows = applyOrder(rows, sql);
    rows = applyLimit(rows, sql);
    return rows;
  }
  // SELECT FROM api_keys JOIN users
  if (s.includes('from api_keys')) {
    let rows = data.api_keys.map(k => {
      const u = data.users.find(u => u.id === k.user_id);
      return { ...k, uid: u?.id, active: k.active && u?.active ? 1 : 0, credits: u?.credits || 0 };
    });
    rows = applyWhere(rows, sql, p);
    return rows;
  }
  // SELECT FROM tasks
  if (s.includes('from tasks')) {
    let rows = [...data.tasks];
    rows = applyWhere(rows, sql, p);
    rows = applyOrder(rows, sql);
    rows = applyLimit(rows, sql);
    return rows;
  }
  // SELECT COUNT
  if (s.includes('count(*)')) {
    if (s.includes('from tasks')) {
      let rows = [...data.tasks];
      rows = applyWhere(rows, sql, p);
      return [{ c: rows.length }];
    }
  }
  return [];
}

function applyWhere(rows, sql, params) {
  const s = sql.toLowerCase();
  if (!s.includes('where')) return rows;
  
  let pi = 0;
  const conditions = [];
  
  // Parsear condiciones simples con ?
  const whereMatch = sql.match(/WHERE\s+(.+?)(?:ORDER|LIMIT|$)/is);
  if (!whereMatch) return rows;
  
  const wherePart = whereMatch[1];
  const parts = wherePart.split(/\s+AND\s+/i);
  
  for (const part of parts) {
    const eqMatch = part.match(/(\w+)\s*=\s*\?/i);
    const neqMatch = part.match(/status\s+IN\s+\(([^)]+)\)/i);
    const notEqMatch = part.match(/status\s*!=\s*'(\w+)'/i);
    const dateMatch = part.match(/expires_at\s*[><]\s*datetime/i);
    const dateMatch2 = part.match(/solved_at\s*\)\s*=\s*date/i);
    
    if (eqMatch && pi < params.length) {
      conditions.push({ field: eqMatch[1].toLowerCase(), value: params[pi++], op: 'eq' });
    } else if (neqMatch) {
      const vals = neqMatch[1].split(',').map(v => v.trim().replace(/'/g,''));
      conditions.push({ field: 'status', value: vals, op: 'in' });
    } else if (notEqMatch) {
      conditions.push({ field: 'status', value: notEqMatch[1], op: 'neq' });
    } else if (dateMatch) {
      conditions.push({ op: 'expires_gt_now' });
    } else if (dateMatch2) {
      conditions.push({ op: 'solved_today' });
    } else if (part.includes('?') && pi < params.length) {
      pi++;
    }
  }

  return rows.filter(row => {
    for (const c of conditions) {
      if (c.op === 'eq') {
        const rv = row[c.field];
        if (rv !== c.value && String(rv) !== String(c.value)) return false;
      } else if (c.op === 'in') {
        if (!c.value.includes(row[c.field])) return false;
      } else if (c.op === 'neq') {
        if (row[c.field] === c.value) return false;
      } else if (c.op === 'expires_gt_now') {
        if (row.expires_at && new Date(row.expires_at) < new Date()) return false;
      } else if (c.op === 'solved_today') {
        if (!row.solved_at) return false;
        const today = new Date().toISOString().slice(0,10);
        if (!row.solved_at.startsWith(today)) return false;
      }
    }
    return true;
  });
}

function applyOrder(rows, sql) {
  const m = sql.match(/ORDER BY\s+(\w+)\s*(ASC|DESC)?/i);
  if (!m) return rows;
  const field = m[1].toLowerCase();
  const desc  = (m[2] || '').toUpperCase() === 'DESC';
  return [...rows].sort((a, b) => {
    if (a[field] < b[field]) return desc ? 1 : -1;
    if (a[field] > b[field]) return desc ? -1 : 1;
    return 0;
  });
}

function applyLimit(rows, sql) {
  const m = sql.match(/LIMIT\s+(\d+)/i);
  if (!m) return rows;
  return rows.slice(0, parseInt(m[1]));
}

function executeRun(sql, params) {
  const s = sql.trim();
  let changes = 0;
  let lastInsertRowid = 0;

  // INSERT INTO users
  if (/INSERT INTO users/i.test(s)) {
    const m = s.match(/VALUES\s*\(([^)]+)\)/i);
    if (m) {
      const id = (data.users.length > 0 ? Math.max(...data.users.map(u=>u.id)) : 0) + 1;
      const [name, email, password_hash, role, verified, verify_token] = params;
      const user = {
        id, name: name||'', email: email||'', password_hash: password_hash||'',
        role: role||'worker', verified: verified||0, verify_token: verify_token||null,
        active: 1, solved: 0, balance: 0, credits: 999999,
        created_at: now()
      };
      data.users.push(user);
      lastInsertRowid = id;
      changes = 1;
      save();
    }
  }
  // INSERT INTO api_keys
  else if (/INSERT INTO api_keys/i.test(s)) {
    const id = (data.api_keys.length > 0 ? Math.max(...data.api_keys.map(k=>k.id)) : 0) + 1;
    const [user_id, key, label] = params;
    data.api_keys.push({ id, user_id: Number(user_id), key, label: label||'Default', active: 1, used: 0, created_at: now() });
    lastInsertRowid = id;
    changes = 1;
    save();
  }
  // INSERT INTO tasks
  else if (/INSERT INTO tasks/i.test(s)) {
    const [id, api_key_id, client_id, sitekey, url, expires_at] = params;
    data.tasks.push({ id, api_key_id, client_id: Number(client_id), sitekey, url, status:'pending', token:null, worker_id:null, assigned_at:null, solved_at:null, created_at:now(), expires_at });
    changes = 1;
    save();
  }
  // UPDATE users SET verified
  else if (/UPDATE users SET verified/i.test(s)) {
    const id = params[0];
    const u = data.users.find(u => u.id == id || u.verify_token == id);
    if (u) { u.verified = 1; u.verify_token = null; changes = 1; save(); }
  }
  // UPDATE users SET solved
  else if (/UPDATE users SET solved/i.test(s)) {
    const id = params[0];
    const u = data.users.find(u => u.id == id);
    if (u) { u.solved = (u.solved||0) + 1; changes = 1; save(); }
  }
  // UPDATE users SET balance
  else if (/UPDATE users SET balance/i.test(s)) {
    const [amount, id] = params;
    const u = data.users.find(u => u.id == id);
    if (u) { u.balance = (u.balance||0) + Number(amount); changes = 1; save(); }
  }
  // UPDATE users SET credits
  else if (/UPDATE users SET credits/i.test(s)) {
    const [amount, id] = params;
    const u = data.users.find(u => u.id == id);
    if (u) { u.credits = (u.credits||0) - Number(amount); changes = 1; save(); }
  }
  // UPDATE api_keys SET used
  else if (/UPDATE api_keys SET used/i.test(s)) {
    const id = params[0];
    const k = data.api_keys.find(k => k.id == id);
    if (k) { k.used = (k.used||0) + 1; changes = 1; save(); }
  }
  // UPDATE tasks SET status='assigned'
  else if (/UPDATE tasks SET status='assigned'/i.test(s)) {
    const [worker_id, id] = params;
    const t = data.tasks.find(t => t.id == id && t.status === 'pending');
    if (t) { t.status='assigned'; t.worker_id=Number(worker_id); t.assigned_at=now(); changes = 1; save(); }
  }
  // UPDATE tasks SET status='solved'
  else if (/UPDATE tasks SET status='solved'/i.test(s)) {
    const [token, id] = params;
    const t = data.tasks.find(t => t.id == id);
    if (t) { t.status='solved'; t.token=token; t.solved_at=now(); changes = 1; save(); }
  }
  // UPDATE tasks SET status='pending' (devolver a cola)
  else if (/UPDATE tasks SET status='pending'/i.test(s)) {
    const id = params[0] || params[1];
    const t = data.tasks.find(t => t.id == id);
    if (t) { t.status='pending'; t.worker_id=null; t.assigned_at=null; changes = 1; save(); }
  }
  // UPDATE tasks SET status='expired'
  else if (/UPDATE tasks SET status='expired'/i.test(s)) {
    const expired = data.tasks.filter(t =>
      ['pending','assigned'].includes(t.status) && t.expires_at && new Date(t.expires_at) < new Date()
    );
    expired.forEach(t => { t.status='expired'; });
    changes = expired.length;
    if (changes) save();
  }
  // UPDATE api_keys SET active=0
  else if (/UPDATE api_keys SET active=0/i.test(s)) {
    const [id, user_id] = params;
    const k = data.api_keys.find(k => k.id == id && k.user_id == user_id);
    if (k) { k.active = 0; changes = 1; save(); }
  }

  return { changes, lastInsertRowid };
}

module.exports = db;
