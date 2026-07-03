// Verify polish features: sniper scope zoom + overlay, floating combat text.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto('http://localhost:3000/');
await page.fill('#name-input', 'POLISH');
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
await page.waitForFunction(() => window.__krell?.state.phase === 'live', { timeout: 40000 });
await page.keyboard.press('Escape');
await page.waitForTimeout(150);
const eo = await page.evaluate(() => !document.getElementById('escmenu').classList.contains('hidden'));
if (eo) await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// --- floating text: emit a few near the camera, confirm they live + screenshot
await page.evaluate(() => {
  const r = window.__krell.renderer;
  const f = window.__krell.state.selfPos();
  r.floatText(f.x + 30, f.y - 30, '24', '#ffe27a', 20);
  r.floatText(f.x - 40, f.y - 10, '+$300', '#ffd166', 24);
});
const floatCount = await page.evaluate(() => window.__krell.renderer.floaters.length);
console.log('floaters active:', floatCount);
await page.waitForTimeout(150);
await page.screenshot({ path: '/tmp/krell-floaters.png' });

// --- scope: freeze incoming snapshots, force the LANCE locally, hold R-mouse,
// and confirm the render scope-zoom ramps and the overlay path runs.
const scopeResult = await page.evaluate(async () => {
  const { state, input, renderer, net } = window.__krell;
  net.handlers.s = null;                 // stop snapshots overwriting me.wid
  state.me.alive = true;
  state.me.wid = 'sniper';
  state.me.primary = 'sniper';
  state.me.slot = 1;
  input.aimHeld = true;                   // hold right mouse
  const z0 = renderer.scope;
  await new Promise((res) => setTimeout(res, 500));
  const zMax = renderer.scope;
  const scopedFlag = renderer.scoped;
  input.aimHeld = false;
  await new Promise((res) => setTimeout(res, 500));
  const zBack = renderer.scope;
  return { z0: +z0.toFixed(2), zMax: +zMax.toFixed(2), scopedFlag, zBack: +zBack.toFixed(2) };
});
console.log('scope:', JSON.stringify(scopeResult));

// screenshot mid-scope for visual confirmation of overlay
await page.evaluate(() => { window.__krell.input.aimHeld = true; window.__krell.state.me.wid = 'sniper'; });
await page.waitForTimeout(450);
await page.screenshot({ path: '/tmp/krell-scope.png' });

const scopeOk = scopeResult.z0 < 1.2 && scopeResult.zMax > 1.6 && scopeResult.scopedFlag === true && scopeResult.zBack < 1.2;
console.log(errs.length ? 'ERRORS:\n' + errs.slice(0, 8).join('\n') : 'no page errors');
console.log(scopeOk && floatCount >= 2 ? 'POLISH OK' : 'POLISH FAIL');
await browser.close();
process.exit(scopeOk && floatCount >= 2 && !errs.length ? 0 : 1);
