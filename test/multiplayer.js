// Two real browser clients: roster sync, chat, combat, death/spectate UX.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const ctx1 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const p1 = await ctx1.newPage();
const p2 = await ctx2.newPage();
const errs = [];
for (const [pg, n] of [[p1, 'P1'], [p2, 'P2']]) {
  pg.on('pageerror', (e) => errs.push(`${n}: ${e.message}`));
}

async function join(pg, name) {
  await pg.goto('http://localhost:3000/');
  await pg.fill('#name-input', name);
  await pg.click('#btn-play');
  await pg.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
}
await join(p1, 'HUMAN-ONE');
await join(p2, 'HUMAN-TWO');
console.log('both joined');

await p1.waitForTimeout(1500);
const teams = await Promise.all([p1, p2].map((pg) => pg.evaluate(() => window.__krell.state.team)));
console.log('teams:', teams, teams[0] !== teams[1] ? '(opposite — good)' : '(same team)');

// roster cross-visibility
const roster2 = await p2.evaluate(() => [...window.__krell.state.roster.values()].map((r) => r.name));
console.log('P2 roster:', roster2.join(', '));
const rosterOk = roster2.includes('HUMAN-ONE') && roster2.includes('HUMAN-TWO');

// chat cross-client
await p1.keyboard.press('Escape'); // close any auto buy
await p1.waitForTimeout(150);
const esc1 = await p1.evaluate(() => !document.getElementById('escmenu').classList.contains('hidden'));
if (esc1) await p1.keyboard.press('Escape');
await p1.keyboard.press('Enter');
await p1.keyboard.type('contact mid');
await p1.keyboard.press('Enter');
await p2.waitForTimeout(700);
const chatOk = await p2.evaluate(() => [...document.querySelectorAll('#chatlog .chat-row')].some((r) => r.textContent.includes('contact mid')));
console.log('chat sync:', chatOk ? 'OK' : 'FAIL');

// wait for live, then drive P1 toward enemy territory (up mid lane)
await p1.waitForFunction(() => window.__krell.state.phase === 'live', { timeout: 45000 });
for (const pg of [p1, p2]) {
  await pg.keyboard.press('Escape');
  await pg.waitForTimeout(150);
  const eo = await pg.evaluate(() => !document.getElementById('escmenu').classList.contains('hidden'));
  if (eo) await pg.keyboard.press('Escape');
}
console.log('round live — driving P1 into combat');

// steer: first center x on the mid gap (x≈1500), then push up
await p1.evaluate(() => { window.__steer = true; });
const deadline = Date.now() + 40000;
let died = false, sawEnemy = false, kills0 = await p1.evaluate(() => [...window.__krell.state.roster.values()].reduce((s, r) => s + r.kills, 0));
await p1.keyboard.down('w');
while (Date.now() < deadline) {
  const st = await p1.evaluate(() => {
    const s = window.__krell.state;
    const pos = s.selfPos();
    const enemies = [...s.interpPlayers().entries()].filter(([id, p]) => {
      const r = s.roster.get(id);
      return r && r.team !== s.team && !p.dead;
    }).length;
    return { x: pos.x, y: pos.y, alive: s.me.alive, enemies, phase: s.phase };
  });
  if (st.enemies > 0) sawEnemy = true;
  if (!st.alive) { died = true; break; }
  // steer toward mid gap x=1500 while pushing up
  if (st.x < 1430) { await p1.keyboard.down('d'); await p1.keyboard.up('a'); }
  else if (st.x > 1570) { await p1.keyboard.down('a'); await p1.keyboard.up('d'); }
  else { await p1.keyboard.up('a'); await p1.keyboard.up('d'); }
  // shoot toward the top half occasionally
  await p1.mouse.move(640, 200);
  if (st.enemies > 0) { await p1.mouse.down(); await p1.waitForTimeout(80); await p1.mouse.up(); }
  await p1.waitForTimeout(220);
}
await p1.keyboard.up('w');
console.log(`combat run: died=${died} sawEnemy=${sawEnemy}`);

if (died) {
  await p1.waitForTimeout(800);
  const spec = await p1.evaluate(() => ({
    specVisible: !document.getElementById('spectate').classList.contains('hidden'),
    specName: document.getElementById('spectate-name').textContent,
  }));
  console.log('spectate UI:', JSON.stringify(spec));
  await p1.screenshot({ path: '/tmp/krell-spectate.png' });
}
const killsNow = await p1.evaluate(() => [...window.__krell.state.roster.values()].reduce((s, r) => s + r.kills, 0));
console.log(`total kills across match: ${kills0} -> ${killsNow}`);
await p2.screenshot({ path: '/tmp/krell-p2.png' });
await p1.screenshot({ path: '/tmp/krell-p1.png' });

console.log(errs.length ? 'PAGE ERRORS:\n' + errs.join('\n') : 'no page errors');
console.log(rosterOk && chatOk && !errs.length ? 'MULTI OK' : 'MULTI PARTIAL');
await browser.close();
process.exit(errs.length ? 1 : 0);
