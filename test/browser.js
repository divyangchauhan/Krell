// Browser verification: load the game, join, play a bit, screenshot.
// Usage: node test/browser.js
import { chromium } from 'playwright';

const shot = (page, name) => page.screenshot({ path: `/tmp/krell-${name}.png` });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto('http://localhost:3000/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
await shot(page, 'menu');

await page.fill('#name-input', 'BROWSER-T');
await page.click('#btn-play');
await page.waitForSelector('#hud:not(.hidden)', { timeout: 8000 });
console.log('joined: HUD visible');
await page.waitForTimeout(2500);
await shot(page, 'joined');

// open buy menu, buy a rifle
await page.keyboard.press('b');
await page.waitForTimeout(400);
await shot(page, 'buymenu');
await page.keyboard.press('3'); // rifle
await page.waitForTimeout(300);
await page.keyboard.press('b');
console.log('buy menu exercised');

// move around + shoot for a few seconds
await page.mouse.move(900, 300);
await page.keyboard.down('w');
await page.waitForTimeout(1400);
await page.mouse.down();
await page.waitForTimeout(700);
await page.mouse.up();
await page.keyboard.up('w');
await page.keyboard.down('a');
await page.waitForTimeout(900);
await page.keyboard.up('a');
await page.waitForTimeout(600);
await shot(page, 'combat');

// scoreboard
await page.keyboard.down('Tab');
await page.waitForTimeout(400);
await shot(page, 'scoreboard');
await page.keyboard.up('Tab');

// chat
await page.keyboard.press('Enter');
await page.keyboard.type('gl hf');
await page.keyboard.press('Enter');
await page.waitForTimeout(400);

// esc menu
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot(page, 'escmenu');
await page.keyboard.press('Escape');

// let a round play out a bit
await page.waitForTimeout(8000);
await shot(page, 'late');

const hudText = await page.evaluate(() => ({
  timer: document.getElementById('timer').textContent,
  money: document.getElementById('money').textContent,
  hp: document.getElementById('hp-num').textContent,
  weapon: document.getElementById('weapon-name').textContent,
  roundLabel: document.getElementById('round-label').textContent,
  chatRows: document.querySelectorAll('.chat-row').length,
}));
console.log('HUD state:', JSON.stringify(hudText));

console.log(errors.length ? 'CONSOLE ERRORS:\n' + errors.slice(0, 12).join('\n') : 'no console errors');
await browser.close();
process.exit(errors.length ? 1 : 0);
