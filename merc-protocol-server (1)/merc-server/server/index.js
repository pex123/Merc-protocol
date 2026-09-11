require('dotenv').config();
const path = require('path');
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const db = require('./db');
const { registerRoutes } = require('./auth');
const { createArena } = require('./arena');

const PORT = process.env.PORT || 3000;

async function main() {
  await db.init();

  const app = express();
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'public')));
  registerRoutes(app);
  app.get('/api/health', (req, res) => res.json({ ok: true }));

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const arena = createArena(wss);

  app.get('/api/online', (req, res) => res.json({ count: arena.players.size }));

  server.listen(PORT, () => {
    console.log('Merc Protocol server listening on :' + PORT);
  });
}

main().catch((e) => {
  console.error('fatal startup error', e);
  process.exit(1);
});
