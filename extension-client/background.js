// extension-client/background.js
'use strict';
const API = 'https://humanpass-production.up.railway.app'; // ← CAMBIAR

const active = new Map();

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (msg.type === 'CAPTCHA_FOUND') {
    if (active.has(tabId)) { sendResponse({ ok: false }); return true; }
    chrome.storage.local.get(['hp_api_key'], ({ hp_api_key }) => {
      if (!hp_api_key) { sendResponse({ ok: false, reason: 'no_key' }); return; }
      enviar(tabId, hp_api_key, msg.sitekey, msg.url)
        .then(id => sendResponse({ ok: true, taskId: id }))
        .catch(e => sendResponse({ ok: false, reason: e.message }));
    });
    return true;
  }
});

async function enviar(tabId, apiKey, sitekey, url) {
  setBadge('...', '#f59e0b', tabId);
  chrome.storage.local.set({ hp_status: 'active' });

  const r = await fetch(`${API}/api/task`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
    body: JSON.stringify({ sitekey, url })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Error del servidor');

  active.set(tabId, d.taskId);
  esperar(tabId, d.taskId, apiKey);
  return d.taskId;
}

async function esperar(tabId, taskId, apiKey) {
  try {
    const r = await fetch(`${API}/api/task/${taskId}/wait`, {
      headers: { 'x-api-key': apiKey }
    });
    const d = await r.json();

    if (d.status === 'solved' && d.token) {
      chrome.tabs.sendMessage(tabId, { type: 'INJECT', token: d.token });
      setBadge('✓', '#10b981', tabId);
      setTimeout(() => setBadge('', '', tabId), 4000);
      chrome.storage.local.get(['hp_solved'], s =>
        chrome.storage.local.set({ hp_solved: (s.hp_solved || 0) + 1, hp_status: 'idle' })
      );
    } else throw new Error(d.status || 'failed');

  } catch {
    setBadge('✗', '#ef4444', tabId);
    setTimeout(() => setBadge('', '', tabId), 3000);
    chrome.storage.local.get(['hp_failed'], s =>
      chrome.storage.local.set({ hp_failed: (s.hp_failed || 0) + 1, hp_status: 'error' })
    );
    setTimeout(() => chrome.storage.local.set({ hp_status: 'idle' }), 5000);
  }
  active.delete(tabId);
}

function setBadge(t, c, tid) {
  chrome.browserAction.setBadgeText({ text: t, ...(tid ? { tabId: tid } : {}) });
  if (c) chrome.browserAction.setBadgeBackgroundColor({ color: c, ...(tid ? { tabId: tid } : {}) });
}

chrome.tabs.onRemoved.addListener(tabId => active.delete(tabId));
