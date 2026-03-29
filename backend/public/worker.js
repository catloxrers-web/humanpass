// worker.js — HumanPass Simple (sin pantalla de login, auto-conecta)
'use strict';
const API = window.location.origin;
const WSU = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
const $   = id => document.getElementById(id);

// Credenciales fijas para pruebas
const WORKER_EMAIL = 'worker@humanpass.test';
const WORKER_PASS  = 'worker123';

let tok=null, me=null, ws=null, wsOk=false;
let curTask=null, wId=null, pingT=null;

// ── Auto-login al cargar ──────────────────────────────────────────
async function autoLogin() {
  try {
    const r = await fetch(`${API}/auth/login`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ email: WORKER_EMAIL, password: WORKER_PASS })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    tok = d.token;
    me  = d.user;
    showApp();
  } catch(e) {
    $('lMsg').textContent = 'Error conectando: ' + e.message;
    $('lMsg').style.color = '#ef4444';
    // Reintentar en 3 segundos
    setTimeout(autoLogin, 3000);
  }
}

function showApp() {
  $('auth').style.display = 'none';
  $('app').style.display  = 'block';
  $('tbName').textContent = me.name;
  updateSolved(me.solved || 0);

  document.querySelectorAll('.ni[data-p]').forEach(n => n.onclick = () => {
    document.querySelectorAll('.ni').forEach(x => x.classList.remove('on'));
    document.querySelectorAll('.page').forEach(x => x.classList.remove('on'));
    n.classList.add('on');
    $(`p-${n.dataset.p}`).classList.add('on');
    if (n.dataset.p === 'stats') loadStats();
  });

  $('btnOut').onclick = () => { location.reload(); };
  $('btnSkip').onclick = skipTask;
  connectWS();
}

function updateSolved(n) {
  $('tbSolved').textContent = n;
  $('sbSolved').textContent = n;
  $('stTotal').textContent  = n;
}

// ── WebSocket ─────────────────────────────────────────────────────
function connectWS() {
  if (ws) ws.close();
  ws = new WebSocket(WSU);

  ws.onopen = () => {
    wsOk = true;
    $('wdot').className = 'wdot on';
    $('idleMsg').textContent = 'Conectado — esperando captchas';
    ws.send(JSON.stringify({ type: 'AUTH', token: tok }));
    pingT = setInterval(() => ws.readyState === 1 && ws.send(JSON.stringify({ type: 'PING' })), 25000);
  };

  ws.onmessage = e => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'AUTH_OK') {
      me = { ...me, ...m.worker };
      updateSolved(m.worker.solved || 0);
      $('idleMsg').textContent = `Listo — esperando captchas`;
    }
    else if (m.type === 'NEW_TASK') receiveTask(m.task);
    else if (m.type === 'TASK_ACK') {
      me.solved = (me.solved || 0) + 1;
      updateSolved(me.solved);
      toast('✓ Captcha resuelto correctamente');
      curTask = null; showIdle();
    }
    else if (m.type === 'TASK_ERROR') { toast('Error al enviar solución', true); showIdle(); }
    else if (m.type === 'ERROR') {
      toast(m.error, true);
      // Si es error de auth, reconectar
      if (m.error.includes('worker') || m.error.includes('key')) {
        setTimeout(autoLogin, 2000);
      }
    }
  };

  ws.onclose = () => {
    wsOk = false;
    $('wdot').className = 'wdot';
    $('idleMsg').textContent = 'Desconectado. Reconectando...';
    clearInterval(pingT);
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => ws.close();
}

// ── Task ──────────────────────────────────────────────────────────
function receiveTask(task) {
  curTask = task;
  $('tUrl').textContent = task.url;
  $('tSk').textContent  = `sitekey: ${task.sitekey}`;
  $('idleWrap').style.display  = 'none';
  $('taskWrap').style.display  = 'block';
  $('tBadge').className = 'badge';
  $('tBadge').textContent = 'Resolviendo';
  destroyW(); renderW(task.sitekey);
}

function renderW(sk) {
  const try_ = (n = 0) => {
    if (typeof hcaptcha === 'undefined') { if (n > 25) return; setTimeout(() => try_(n+1), 400); return; }
    try {
      $('captchaWrap').innerHTML = '';
      wId = hcaptcha.render('captchaWrap', {
        sitekey: sk, theme: 'dark',
        callback: t => {
          $('tBadge').className = 'badge send';
          $('tBadge').textContent = 'Enviando...';
          ws.send(JSON.stringify({ type: 'TASK_SOLVED', taskId: curTask.id, token: t }));
          destroyW();
        },
        'error-callback':   () => { toast('Error en captcha', true); setTimeout(() => renderW(sk), 1500); },
        'expired-callback': () => toast('Token expirado, resuelve de nuevo', true)
      });
    } catch(e) { toast('Error cargando captcha', true); }
  };
  try_();
}

function destroyW() {
  if (wId !== null && typeof hcaptcha !== 'undefined') {
    try { hcaptcha.reset(wId); }  catch(_) {}
    try { hcaptcha.remove(wId); } catch(_) {}
  }
  $('captchaWrap').innerHTML = '';
  wId = null;
}

function skipTask() {
  if (!curTask) return;
  ws.send(JSON.stringify({ type: 'TASK_SKIP', taskId: curTask.id }));
  curTask = null; destroyW(); showIdle();
}

function showIdle() {
  $('taskWrap').style.display = 'none';
  $('idleWrap').style.display = 'block';
  $('idleMsg').textContent = wsOk ? 'Conectado — esperando captchas' : 'Reconectando...';
  curTask = null;
}

// ── Stats ─────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const r = await fetch(`${API}/api/stats`);
    const d = await r.json();
    $('stWorkers').textContent = d.workers_online || 0;
    $('stQueue').textContent   = d.queue_pending  || 0;
    $('stToday').textContent   = d.solved_today   || 0;
    $('stTotal').textContent   = d.total_solved   || 0;
  } catch(_) {}
}

function toast(msg, err = false) {
  $('toast').textContent = msg;
  $('toast').className   = `on${err?' err':''}`;
  clearTimeout($('toast')._t);
  $('toast')._t = setTimeout(() => $('toast').className = '', 3500);
}

// ── Arrancar ──────────────────────────────────────────────────────
// Mostrar pantalla de "conectando" mientras hace login automático
$('lMsg').textContent = 'Conectando automáticamente...';
$('lMsg').style.color = '#94a3b8';
autoLogin();
