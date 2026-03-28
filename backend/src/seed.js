// src/seed.js — Crea usuarios de prueba
// Ejecutar: node src/seed.js
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { v4: uuid } = require('uuid');
const db = require('./models/db');

async function seed() {
  console.log('Creando usuarios de prueba...\n');

  // ── Usuario Maestro (cliente que envía captchas) ──────────────
  const clientPass  = await bcrypt.hash('admin123', 12);
  const clientEmail = 'admin@humanpass.test';

  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(clientEmail);
  if (!existing) {
    const r = db.prepare(`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (?, ?, ?, 'client')
    `).run(clientEmail, 'Admin Master', clientPass);

    // Crear API key para el cliente
    const apiKey = 'hp_' + uuid().replace(/-/g, '');
    db.prepare('INSERT INTO api_keys (user_id, key, label) VALUES (?,?,?)').run(r.lastInsertRowid, apiKey, 'Master Key');

    console.log('✓ CLIENTE MAESTRO creado:');
    console.log('  Email:    admin@humanpass.test');
    console.log('  Password: admin123');
    console.log('  API Key:  ' + apiKey);
    console.log('  Role:     client\n');
  } else {
    const key = db.prepare('SELECT key FROM api_keys WHERE user_id=?').get(existing.id);
    console.log('✓ CLIENTE MAESTRO ya existe:');
    console.log('  Email:    admin@humanpass.test');
    console.log('  Password: admin123');
    console.log('  API Key:  ' + (key?.key || 'ver en DB'));
    console.log('  Role:     client\n');
  }

  // ── Worker Maestro (resuelve captchas) ────────────────────────
  const workerPass  = await bcrypt.hash('worker123', 12);
  const workerEmail = 'worker@humanpass.test';

  const existingW = db.prepare('SELECT id FROM users WHERE email=?').get(workerEmail);
  if (!existingW) {
    db.prepare(`
      INSERT INTO users (email, name, password_hash, role)
      VALUES (?, ?, ?, 'worker')
    `).run(workerEmail, 'Worker Master', workerPass);

    console.log('✓ WORKER MAESTRO creado:');
    console.log('  Email:    worker@humanpass.test');
    console.log('  Password: worker123');
    console.log('  Role:     worker\n');
  } else {
    console.log('✓ WORKER MAESTRO ya existe:');
    console.log('  Email:    worker@humanpass.test');
    console.log('  Password: worker123');
    console.log('  Role:     worker\n');
  }

  console.log('Seed completado. Inicia el servidor con: npm start');
  process.exit(0);
}

seed().catch(e => { console.error(e); process.exit(1); });
