// worker.js — HumanPass Simple
'use strict';
const API = window.location.origin;
const WSU = `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws`;
const $   = id => document.getElementById(id);

let tok=null, me=null, ws=null, wsOk=false;
let curTask=null, wId=null, pingT=null;

// ── Login ─────────────────────────────────────────────────────────
$('btnLogin').onclick = async () => {
  const email=$('lEmail').value.trim(), pass=$('lPass').value;
  if (!email||!pass) return err('Email y contraseña requeridos');
  $('btnLogin').disabled=true;
  try {
    const r=await fetch(`${API}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pass})});
    const d=await r.json();
    if (!r.ok) throw new Error(d.error);
    if (d.user.role !== 'worker') throw new Error('Esta pantalla es solo para workers');
    tok=d.token; me=d.user;
    localStorage.setItem('hp_tok', tok);
    localStorage.setItem('hp_me', JSON.stringify(me));
    startApp();
  } catch(e){err(e.message);}
  $('btnLogin').disabled=false;
};

// Enter en el form
[$('lEmail'),$('lPass')].forEach(el => el.onkeydown = e => { if(e.key==='Enter') $('btnLogin').click(); });

function err(msg){ $('lMsg').textContent=msg; }

// ── Session ───────────────────────────────────────────────────────
tok=localStorage.getItem('hp_tok');
me=JSON.parse(localStorage.getItem('hp_me')||'null');
if (tok && me && me.role==='worker') startApp();

// ── App ───────────────────────────────────────────────────────────
function startApp(){
  $('auth').style.display='none';
  $('app').style.display='block';
  $('tbName').textContent=me.name;
  updateSolved(me.solved||0);

  document.querySelectorAll('.ni[data-p]').forEach(n => n.onclick=()=>{
    document.querySelectorAll('.ni').forEach(x=>x.classList.remove('on'));
    document.querySelectorAll('.page').forEach(x=>x.classList.remove('on'));
    n.classList.add('on');
    $(`p-${n.dataset.p}`).classList.add('on');
    if (n.dataset.p==='stats') loadStats();
  });

  $('btnOut').onclick=()=>{
    localStorage.removeItem('hp_tok');localStorage.removeItem('hp_me');
    tok=null;me=null;if(ws)ws.close();location.reload();
  };

  $('btnSkip').onclick=skipTask;
  connectWS();
}

function updateSolved(n){
  $('tbSolved').textContent=n;
  $('sbSolved').textContent=n;
  $('stTotal').textContent=n;
}

// ── WebSocket ─────────────────────────────────────────────────────
function connectWS(){
  if(ws) ws.close();
  ws=new WebSocket(WSU);

  ws.onopen=()=>{
    wsOk=true;
    $('wdot').className='wdot on';
    $('idleMsg').textContent='Conectado — esperando captchas';
    ws.send(JSON.stringify({type:'AUTH',token:tok}));
    pingT=setInterval(()=>ws.readyState===1&&ws.send(JSON.stringify({type:'PING'})),25000);
  };

  ws.onmessage=e=>{
    let m;try{m=JSON.parse(e.data);}catch{return;}
    if(m.type==='AUTH_OK'){
      me={...me,...m.worker};
      updateSolved(m.worker.solved||0);
      $('idleMsg').textContent=`Listo — esperando captchas, ${me.name}`;
    }
    else if(m.type==='NEW_TASK') receiveTask(m.task);
    else if(m.type==='TASK_ACK'){
      me.solved=(me.solved||0)+1;
      updateSolved(me.solved);
      toast('✓ Captcha resuelto correctamente');
      curTask=null; showIdle();
    }
    else if(m.type==='TASK_ERROR'){toast('Error al enviar solución',true);showIdle();}
    else if(m.type==='ERROR'){
      toast(m.error,true);
      if(m.error.includes('worker')||m.error.includes('User')){localStorage.clear();location.reload();}
    }
  };

  ws.onclose=()=>{
    wsOk=false;$('wdot').className='wdot';
    $('idleMsg').textContent='Desconectado. Reconectando...';
    clearInterval(pingT);setTimeout(connectWS,3000);
  };
  ws.onerror=()=>ws.close();
}

// ── Task ──────────────────────────────────────────────────────────
function receiveTask(task){
  curTask=task;
  $('tUrl').textContent=task.url;
  $('tSk').textContent=`sitekey: ${task.sitekey}`;
  $('idleWrap').style.display='none';
  $('taskWrap').style.display='block';
  $('tBadge').className='badge';$('tBadge').textContent='Resolviendo';
  destroyW(); renderW(task.sitekey);
}

function renderW(sk){
  const try_=(n=0)=>{
    if(typeof hcaptcha==='undefined'){if(n>25)return;setTimeout(()=>try_(n+1),400);return;}
    try{
      $('captchaWrap').innerHTML='';
      wId=hcaptcha.render('captchaWrap',{
        sitekey:sk, theme:'dark',
        callback:t=>{
          $('tBadge').className='badge send';$('tBadge').textContent='Enviando...';
          ws.send(JSON.stringify({type:'TASK_SOLVED',taskId:curTask.id,token:t}));
          destroyW();
        },
        'error-callback':()=>{toast('Error en captcha',true);setTimeout(()=>renderW(sk),1500);},
        'expired-callback':()=>toast('Token expirado, resuelve de nuevo',true)
      });
    }catch(e){toast('Error cargando captcha',true);}
  };
  try_();
}

function destroyW(){
  if(wId!==null&&typeof hcaptcha!=='undefined'){
    try{hcaptcha.reset(wId);}catch(_){}try{hcaptcha.remove(wId);}catch(_){}
  }
  $('captchaWrap').innerHTML='';wId=null;
}

function skipTask(){
  if(!curTask)return;
  ws.send(JSON.stringify({type:'TASK_SKIP',taskId:curTask.id}));
  curTask=null;destroyW();showIdle();
}

function showIdle(){
  $('taskWrap').style.display='none';
  $('idleWrap').style.display='block';
  $('idleMsg').textContent=wsOk?'Conectado — esperando captchas':'Reconectando...';
  curTask=null;
}

// ── Stats ─────────────────────────────────────────────────────────
async function loadStats(){
  try{
    const r=await fetch(`${API}/api/stats`);
    const d=await r.json();
    $('stWorkers').textContent=d.workers_online||0;
    $('stQueue').textContent=d.queue_pending||0;
    $('stToday').textContent=d.solved_today||0;
    $('stTotal').textContent=d.total_solved||0;
  }catch(_){}
}

// ── Helpers ───────────────────────────────────────────────────────
function toast(msg,err=false){
  $('toast').textContent=msg;
  $('toast').className=`on${err?' err':''}`;
  clearTimeout($('toast')._t);
  $('toast')._t=setTimeout(()=>$('toast').className='',3500);
}
