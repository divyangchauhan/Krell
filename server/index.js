// ============================================================
// KRELL — entrypoint: static file server + websocket gateway
// ============================================================

import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Game } from './game.js';

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = normalize(join(PUBLIC_DIR, path));
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403); res.end('forbidden'); return;
    }
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});

const game = new Game();
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let player = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (!player) {
      if (msg.t === 'join') {
        const name = sanitizeName(msg.name);
        player = game.addHuman(ws, name);
      }
      return;
    }

    switch (msg.t) {
      case 'in':
        if (Array.isArray(msg.i)) game.queueInput(player, msg.i);
        break;
      case 'buy':
        if (typeof msg.id === 'string') game.tryBuy(player, msg.id);
        break;
      case 'slot':
        game.setSlot(player, msg.s | 0);
        break;
      case 'chat': {
        const text = String(msg.text || '').slice(0, 120).trim();
        if (text) game.broadcast({ t: 'chat', from: player.name, team: player.team, text });
        break;
      }
      case 'ping':
        player.send({ t: 'pong', id: msg.id });
        if (typeof msg.rtt === 'number') player.ping = Math.min(999, Math.max(0, msg.rtt | 0));
        break;
    }
  });
  ws.on('close', () => { if (player) game.removePlayer(player.id); });
  ws.on('error', () => {});
});

function sanitizeName(raw) {
  const name = String(raw || '').replace(/[^\w \-\[\]\.]/g, '').trim().slice(0, 16);
  return name || 'OPERATIVE';
}

server.listen(PORT, () => {
  console.log(`\n  ▲ KRELL server online — http://localhost:${PORT}\n`);
});
