// Smoke test: connect fake clients, drive inputs, watch a round play out.
// Usage: node test/smoke.js [duration-seconds]
import WebSocket from 'ws';

const URL = 'ws://localhost:3000/ws';
const DURATION = (Number(process.argv[2]) || 25) * 1000;
const log = (...a) => console.log(new Date().toISOString().slice(14, 23), ...a);

function makeClient(name) {
  const ws = new WebSocket(URL);
  const state = { name, id: null, seq: 0, snaps: 0, phases: new Set(), events: new Set(), errors: [] };
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name })));
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'hello') { state.id = m.id; log(name, 'joined as', m.id, 'team', m.team); }
    if (m.t === 's') {
      state.snaps++;
      state.phases.add(m.ph);
      for (const ev of m.ev) state.events.add(ev[0]);
      if (state.snaps === 1) log(name, 'first snapshot: phase', m.ph, 'players visible', m.pl.length);
    }
    if (m.t === 'roster' && state.snaps === 0) log(name, 'roster size', m.players.length);
  });
  ws.on('error', (e) => state.errors.push(e.message));
  // send inputs at ~20Hz: hold W + fire bursts, wiggle aim
  const timer = setInterval(() => {
    if (ws.readyState !== 1 || !state.id) return;
    const batch = [];
    for (let k = 0; k < 3; k++) {
      state.seq++;
      const keys = 1 | (Math.random() < 0.3 ? 4 : 8); // up + left/right
      const buttons = Math.random() < 0.25 ? 1 : 0;   // fire sometimes
      batch.push([state.seq, 16, keys, Math.random() * 6.28, buttons]);
    }
    ws.send(JSON.stringify({ t: 'in', i: batch }));
  }, 50);
  return { ws, state, timer };
}

const a = makeClient('TEST-ALPHA');
const b = makeClient('TEST-BRAVO');

setTimeout(() => {
  for (const c of [a, b]) {
    clearInterval(c.timer);
    c.ws.close();
    const s = c.state;
    log(s.name, `snaps=${s.snaps}`, 'phases=[' + [...s.phases].join(',') + ']',
      'events=[' + [...s.events].join(',') + ']', s.errors.length ? 'ERRORS: ' + s.errors : 'no errors');
  }
  const ok =
    a.state.snaps > 100 && b.state.snaps > 100 &&
    a.state.phases.has('live') &&
    a.state.events.has('shot');
  console.log(ok ? '\nSMOKE OK' : '\nSMOKE FAIL');
  process.exit(ok ? 0 : 1);
}, DURATION);
