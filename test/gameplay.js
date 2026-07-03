// Gameplay verification: join, wait for LIVE, move, shoot, verify prediction.
// Usage: node test/gameplay.js
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:3000/');
await page.fill('#name-input', 'GP-TEST');
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });

// wait until LIVE phase (round label shows ROUND and buy menu can be closed)
await page.waitForFunction(() => {
  const el = document.getElementById('round-label');
  return el && el.textContent.startsWith('ROUND');
}, { timeout: 30000 });
// close auto-opened buy menu if present
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
// make sure esc menu isn't open (Escape may have opened it if buy was closed)
const escOpen = await page.evaluate(() => !document.getElementById('escmenu').classList.contains('hidden'));
if (escOpen) await page.keyboard.press('Escape');

// wait for live (timer counts from 1:40)
await page.waitForTimeout(7000);

const posOf = () => page.evaluate(() => {
  // reach into module state via canvas debug hook
  return window.__krell ? { ...window.__krell.state.predicted } : null;
});

// hold W for 1.5s and verify smooth movement
const p0 = await page.evaluate(() => window.__krell?.state.selfPos());
await page.keyboard.down('w');
await page.waitForTimeout(1500);
await page.keyboard.up('w');
const p1 = await page.evaluate(() => window.__krell?.state.selfPos());
console.log('pos before', p0, 'after', p1);
if (p0 && p1) {
  const d = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  console.log('moved', d.toFixed(0), 'units', d > 150 ? '(movement OK)' : '(MOVEMENT BROKEN?)');
}

// fire a few shots
await page.mouse.move(900, 200);
await page.mouse.down();
await page.waitForTimeout(900);
await page.mouse.up();
const ammo = await page.evaluate(() => document.getElementById('ammo-mag').textContent);
console.log('ammo after firing:', ammo, '(started 13)');

// reload
await page.keyboard.press('r');
await page.waitForTimeout(2200);
const ammo2 = await page.evaluate(() => document.getElementById('ammo-mag').textContent);
console.log('ammo after reload:', ammo2);

await page.screenshot({ path: '/tmp/krell-gameplay.png' });

// scoreboard above everything now
await page.keyboard.press('b');
await page.waitForTimeout(200);
await page.keyboard.down('Tab');
await page.waitForTimeout(300);
await page.screenshot({ path: '/tmp/krell-sb2.png' });
await page.keyboard.up('Tab');

// chat
await page.keyboard.press('b'); // close buy
await page.waitForTimeout(150);
await page.keyboard.press('Enter');
await page.keyboard.type('gl hf');
await page.keyboard.press('Enter');
await page.waitForTimeout(500);
const chatRows = await page.evaluate(() => document.querySelectorAll('#chatlog .chat-row').length);
console.log('chat rows:', chatRows);

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 10).join('\n') : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
