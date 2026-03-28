// extension-worker/background.js
const DASHBOARD = 'https://TU_SERVIDOR.com'; // ← CAMBIAR
chrome.runtime.onInstalled.addListener(() => chrome.tabs.create({ url: DASHBOARD }));
