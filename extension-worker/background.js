// extension-worker/background.js
const DASHBOARD = 'https://humanpass-production.up.railway.app'; // ← CAMBIAR
chrome.runtime.onInstalled.addListener(() => chrome.tabs.create({ url: DASHBOARD }));
