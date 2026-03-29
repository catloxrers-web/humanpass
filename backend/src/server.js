// src/server.js - VERSIÓN MÍNIMA PARA QUE LEVANTE
require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 3000;

app.use(require('cors')({ origin: '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

app.use('/auth', require('./routes/auth'));

// Ruta API muy básica (para evitar crash si api.js tiene problemas)
app.use('/api', (req, res) => {
  res.json({ message: 'API temporal - worker no disponible aún' });
});

app.get('/health', (_, res) => res.json({ ok: true, status: 'running' }));

// WebSocket desactivado temporalmente para diagnosticar
// const wss = new WebSocket.Server({ server, path: '/ws' });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 HumanPass MINIMAL corriendo en http://0.0.0.0:${PORT}`);
  console.log(`   Health: /health`);
});
