// High-DPI aim regression: at deviceScaleFactor=2, the mouse->world aim must
// account for dpr. Freeze the camera at a known offset from the player and
// compare the game's derived angle to the correct formula (and to the old
// dpr-less formula, which must NOT match for this geometry).
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 2 });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto('http://localhost:3000/');
await page.fill('#name-input', 'DPR-TEST');
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
await page.waitForTimeout(1500);

const res = await page.evaluate(() => new Promise((resolve) => {
  const { state, renderer, input } = window.__krell;
  // freeze the camera: draw() is what lerps/mutates it, so no-op it for a moment
  const origDraw = renderer.draw;
  renderer.draw = () => {};
  const cam = renderer.camera;
  cam.x = state.predicted.x + 240;
  cam.y = state.predicted.y - 180;
  input.mouse.x = innerWidth / 2 + 300;
  input.mouse.y = innerHeight / 2 + 120;
  // let two update() frames run with this exact camera, then sample
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const px = state.predicted.x + state.smooth.x;
    const py = state.predicted.y + state.smooth.y;
    const z = cam.zoom;
    const dpr = devicePixelRatio;
    const right = Math.atan2(
      cam.y + 120 * dpr / z - py,
      cam.x + 300 * dpr / z - px,
    );
    const wrong = Math.atan2(
      cam.y + 120 / z - py,
      cam.x + 300 / z - px,
    );
    const actual = state.me.angle;
    renderer.draw = origDraw;
    resolve({ dpr, zoom: +z.toFixed(4), actual: +actual.toFixed(4), right: +right.toFixed(4), wrong: +wrong.toFixed(4) });
  }));
}));

console.log(JSON.stringify(res));
const matchesRight = Math.abs(res.actual - res.right) < 0.003;
const differsFromWrong = Math.abs(res.right - res.wrong) > 0.05; // geometry chosen so they differ
console.log(`dpr=${res.dpr} matchesCorrect=${matchesRight} formulasDistinct=${differsFromWrong}`);
console.log(errs.length ? 'ERRORS: ' + errs.join('|') : 'no page errors');
console.log(matchesRight && differsFromWrong && res.dpr === 2 ? 'AIM-DPR OK' : 'AIM-DPR FAIL');
await browser.close();
process.exit(matchesRight && differsFromWrong && !errs.length ? 0 : 1);
