// Long-run observer: one passive client, log round flow events.
// Usage: node test/rounds.js [duration-seconds]
import WebSocket from 'ws';

const DURATION = (Number(process.argv[2]) || 240) * 1000;
const ws = new WebSocket('ws://localhost:3000/ws');
const seen = new Map(); // event -> count
let phase = '', kills = 0, plants = 0, roundEnds = [];

ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: 'OBSERVER' })));
ws.on('message', (raw) => {
  const m = JSON.parse(raw.toString());
  if (m.t !== 's') return;
  if (m.ph !== phase) { phase = m.ph; console.log('phase ->', phase, 'round', m.rn, 'score', m.sc); }
  for (const ev of m.ev) {
    seen.set(ev[0], (seen.get(ev[0]) || 0) + 1);
    if (ev[0] === 'die') kills++;
    if (ev[0] === 'planted') { plants++; console.log('  PLANTED at', ev[1]); }
    if (ev[0] === 'defused') console.log('  DEFUSED');
    if (ev[0] === 'round_end') { roundEnds.push(ev); console.log('  round_end winner', ev[1], 'reason', ev[2], 'score', ev[3] + '-' + ev[4]); }
  }
});
ws.on('error', (e) => console.error('WS ERROR', e.message));

setTimeout(() => {
  console.log('\nevents:', Object.fromEntries(seen));
  console.log('kills', kills, 'plants', plants, 'roundEnds', roundEnds.length);
  const ok = roundEnds.length >= 1 && kills >= 2;
  console.log(ok ? 'ROUNDS OK' : 'ROUNDS FAIL');
  process.exit(ok ? 0 : 1);
}, DURATION);
