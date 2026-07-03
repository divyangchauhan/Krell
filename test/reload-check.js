// Focused check: reload with realistic key hold + enemy visibility sanity.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));

await page.goto('http://localhost:3000/');
await page.fill('#name-input', 'RL-TEST');
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });

// wait for LIVE phase precisely
await page.waitForFunction(() => window.__krell?.state.phase === 'live', { timeout: 40000 });
await page.keyboard.press('Escape'); // close auto-buy if open
await page.waitForTimeout(300);
const escOpen = await page.evaluate(() => !document.getElementById('escmenu').classList.contains('hidden'));
if (escOpen) await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// fire 3 shots (tap, semi-auto)
for (let i = 0; i < 3; i++) {
  await page.mouse.move(900 + i * 30, 250);
  await page.mouse.down(); await page.waitForTimeout(60); await page.mouse.up();
  await page.waitForTimeout(260);
}
const magAfterFire = await page.evaluate(() => window.__krell.state.me.mag);

// reload with realistic hold
await page.keyboard.down('r');
await page.waitForTimeout(120);
await page.keyboard.up('r');
await page.waitForTimeout(2300);
const magAfterReload = await page.evaluate(() => window.__krell.state.me.mag);
const alive = await page.evaluate(() => window.__krell.state.me.alive);
console.log(`alive=${alive} mag after 3 shots=${magAfterFire} after reload=${magAfterReload}`);

// enemy visibility sanity: all rendered enemies must be in roster + LOS plausible
const visInfo = await page.evaluate(() => {
  const st = window.__krell.state;
  const out = [];
  for (const [id, p] of st.interpPlayers()) {
    const r = st.roster.get(id);
    out.push({ id, name: r?.name, team: r?.team, myTeam: st.team, x: Math.round(p.x), y: Math.round(p.y), dead: p.dead });
  }
  return { me: { ...st.selfPos(), team: st.team }, players: out, phase: st.phase };
});
console.log(JSON.stringify(visInfo, null, 1));

console.log(errors.length ? 'ERRORS: ' + errors.join(' | ') : 'no page errors');
const ok = magAfterFire <= 10 && magAfterReload === 13;
console.log(ok ? 'RELOAD OK' : 'RELOAD FAIL');
await browser.close();
process.exit(ok && !errors.length ? 0 : 1);
