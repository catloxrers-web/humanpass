// src/server.js (versión ultra segura)
require('dotenv').config();
const express = require('express');
const http    = require('http');
const path    = require('path');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(require('cors')({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', require('./routes/auth'));

// ← Cargamos api.js de forma segura
try {
  app.use('/api', require('./routes/api'));
} catch (err) {
  console.error('⚠️ Error cargando rutas /api:', err.message);
  app.use('/api', (req, res) => res.status(503).json({ error: 'API routes no disponibles temporalmente' }));
}

app.get('/health', (_, res) => res.json({ ok: true, ts: Date.now() }));

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 HumanPass corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   Health check: /health`);
});
