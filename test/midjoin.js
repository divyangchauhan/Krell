// Mid-round join: player should spectate a teammate, then deploy next round.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const anchor = await (await browser.newContext()).newPage();
await anchor.goto('http://localhost:3000/');
await anchor.fill('#name-input', 'ANCHOR');
await anchor.click('#btn-play');
await anchor.waitForSelector('#hud:not(.hidden)');
await anchor.waitForFunction(() => window.__krell.state.phase === 'live', { timeout: 45000 });
console.log('anchor in live round');

const page = await (await browser.newContext()).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
await page.goto('http://localhost:3000/');
await page.fill('#name-input', 'LATECOMER');
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)');
await page.waitForTimeout(1500);

const st = await page.evaluate(() => {
  const s = window.__krell.state;
  const f = s.focusPos();
  return {
    alive: s.me.alive, phase: s.phase, spectateId: s.spectateId,
    focus: { x: Math.round(f.x), y: Math.round(f.y) },
    specVisible: !document.getElementById('spectate').classList.contains('hidden'),
    specName: document.getElementById('spectate-name').textContent,
  };
});
console.log(JSON.stringify(st));
await page.screenshot({ path: '/tmp/krell-midjoin.png' });

// wait for next round — latecomer should spawn alive
await page.waitForFunction(() => window.__krell.state.me.alive, { timeout: 130000 });
console.log('latecomer deployed on round start');

console.log(errs.length ? 'ERRORS: ' + errs.join('|') : 'no page errors');
const ok = !st.alive && st.phase === 'live' && st.specVisible && st.specName !== '—';
console.log(ok ? 'MIDJOIN OK' : 'MIDJOIN FAIL');
await browser.close();
process.exit(ok && !errs.length ? 0 : 1);
