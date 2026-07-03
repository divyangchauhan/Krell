// ============================================================
// KRELL client — bootstrap: menu, connection, game loop, events
// ============================================================

import { PHASE, TEAM, BOMB_NAME } from '/shared/const.js';
import { Net } from './net.js';
import { Input } from './input.js';
import { GameState } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { audio } from './audio.js';

const $ = (id) => document.getElementById(id);

const net = new Net();
const input = new Input();
const state = new GameState(net, input);
const renderer = new Renderer($('game'), state);
const ui = new UI(state, net);

let inGame = false;
let lastFrame = performance.now();
let lastUiAt = 0;
let hadBomb = false;
let killStreak = 0;
let lastKillAt = 0;
const MULTIKILL = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'OVERKILL', 5: 'RAMPAGE' };

// ------------------------------------------------------------ settings

const saved = {
  name: localStorage.getItem('krell.name') || '',
  volume: Number(localStorage.getItem('krell.volume') ?? 70),
};
$('name-input').value = saved.name;
$('volume').value = saved.volume;
audio.setVolume(saved.volume / 100);
$('volume').addEventListener('input', (e) => {
  const v = +e.target.value;
  audio.setVolume(v / 100);
  localStorage.setItem('krell.volume', v);
});

// ------------------------------------------------------------ menu flow

function setStatus(text) { $('menu-status').textContent = text; }

function play() {
  const name = $('name-input').value.trim() || 'OPERATIVE';
  localStorage.setItem('krell.name', name);
  audio.ensure();
  setStatus('ESTABLISHING UPLINK…');
  net.connect(name);
}

$('btn-play').addEventListener('click', play);
$('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); e.stopPropagation(); });
$('btn-reconnect').addEventListener('click', () => {
  $('disconnected').classList.add('hidden');
  $('mainmenu').classList.remove('hidden');
  startMenuBg();
});
$('btn-resume').addEventListener('click', () => toggleEsc(false));
$('btn-leave').addEventListener('click', () => location.reload());

// ------------------------------------------------------------ net handlers

net.on('open', () => setStatus('UPLINK OPEN — JOINING…'));

net.on('hello', (m) => {
  state.handleHello(m);
  inGame = true;
  stopMenuBg();
  $('mainmenu').classList.add('hidden');
  $('hud').classList.remove('hidden');
  ui.lastPhase = '';
  ui.onPhase(m.phase);
  const tn = m.team === TEAM.KRELL ? 'KRELL' : 'WARDENS';
  ui.toast(`Deployed as ${tn}. ${m.team === TEAM.KRELL ? 'Deliver the charge.' : 'Hold the sites.'}`);
});

net.on('full', () => setStatus('SITE-9 IS AT CAPACITY — TRY AGAIN SOON'));

net.on('roster', (m) => state.handleRoster(m));
net.on('s', (m) => {
  state.handleSnap(m);
  ui.onPhase(state.phase);
});
net.on('chat', (m) => ui.addChat(m.from, m.team, m.text));
net.on('bought', () => ui.onBought());
net.on('buyfail', (m) => { ui.onBuyFail(m.why); });

net.on('close', (was) => {
  if (!inGame) { setStatus('UPLINK FAILED — IS THE SERVER RUNNING?'); return; }
  inGame = false;
  $('hud').classList.add('hidden');
  $('disconnected').classList.remove('hidden');
  input.blocked = true;
});

// ------------------------------------------------------------ server events

state.onEvent = (ev) => {
  const [type, ...a] = ev;
  const players = state.interpPlayers();
  const myId = state.id;

  switch (type) {
    case 'shot': {
      const [pid, wid, x, y, tx, ty, hit] = a;
      const mine = pid === myId;
      audio.shot(wid, x, y, mine);
      renderer.tracer(x, y, tx, ty);
      renderer.muzzle(x, y, Math.atan2(ty - y, tx - x));
      if (mine) {
        const kick = { sniper: 9, shotgun: 7, rifle: 3, smg: 1.6, pistol: 2.2 }[wid] || 2;
        renderer.addShake(kick);
        if (hit) { renderer.hitmarker(); audio.hitmarker(); }
      }
      break;
    }
    case 'swing': {
      const [pid, x, y] = a;
      audio.swing(x, y, pid === myId);
      break;
    }
    case 'dry':
      if (a[0] === myId) audio.dryfire();
      break;
    case 'impact': {
      const [x, y, nx, ny] = a;
      renderer.impactDust(x, y, nx, ny);
      audio.impact(x, y);
      break;
    }
    case 'hurt': {
      const [vid, dmg, aid, ax, ay] = a;
      if (vid === myId) {
        audio.hurt();
        renderer.damageFrom(ax, ay);
        $('hud').classList.add('hurt');
        setTimeout(() => $('hud').classList.remove('hurt'), 120);
      } else {
        const p = players.get(vid);
        if (p) {
          renderer.blood(p.x, p.y);
          // show damage I dealt floating off the target
          if (aid === myId) renderer.floatText(p.x, p.y - 18, String(dmg), '#ffe27a', 20);
        }
      }
      break;
    }
    case 'die': {
      const [vid, kid, wid, x, y, reward] = a;
      const v = state.roster.get(vid);
      const k = state.roster.get(kid);
      if (v) renderer.corpse(x, y, v.team);
      renderer.blood(x, y);
      ui.killfeed(k ? k.name : '', k ? k.team : 0, v ? v.name : '???', v ? v.team : 0, wid, kid === myId || vid === myId);
      if (kid === myId) {
        audio.kill();
        if (reward > 0) renderer.floatText(x, y, `+$${reward}`, '#ffd166', 24);
        // multi-kill tracking (resets after 3.5s gap)
        const t = performance.now();
        killStreak = (t - lastKillAt < 3500) ? killStreak + 1 : 1;
        lastKillAt = t;
        if (MULTIKILL[killStreak]) {
          ui.msg(MULTIKILL[killStreak], '#b36bff', '', 1600);
          audio.multikill?.(killStreak);
        }
      }
      if (vid === myId) {
        audio.death();
        renderer.addShake(12);
        killStreak = 0;
        if (k) ui.msg('ELIMINATED', '#ff4757', `by ${k.name}`, 2600);
        else ui.msg('ELIMINATED', '#ff4757', '', 2000);
      }
      break;
    }
    case 'reload': {
      const [pid] = a;
      const p = players.get(pid);
      audio.reload(p ? p.x : null, p ? p.y : 0, pid === myId);
      break;
    }
    case 'boom': {
      const [x, y, big] = a;
      renderer.explosion(x, y, !!big);
      audio.explosion(x, y, !!big);
      break;
    }
    case 'tink':
      audio.tink(a[0], a[1]);
      break;
    case 'planted': {
      const [site] = a;
      ui.msg('CHARGE ARMED', '#ff4757', `rift site ${site} — ${state.team === TEAM.WARDEN ? 'neutralize it' : 'defend it'}`, 3000);
      audio.planted();
      break;
    }
    case 'defused':
      audio.defused();
      break;
    case 'plant_start': {
      const p = players.get(a[0]);
      if (p) audio.plantTick(p.x, p.y);
      break;
    }
    case 'defuse_start':
      if (a[0] === myId) audio.defuseTick();
      break;
    case 'bomb_pickup':
      if (a[0] === myId) ui.toast(`You carry the ${BOMB_NAME}. Arm it at a rift site (hold E).`);
      break;
    case 'round_end':
      ui.onRoundEnd(a[0], a[1]);
      break;
    case 'game_over':
      ui.onGameOver(a[0]);
      break;
    case 'join': {
      const r = state.roster.get(a[0]);
      if (r && !r.bot) ui.toast(`${r.name} joined the operation`);
      break;
    }
    // local synthesized events
    case 'ownstep':
      audio.footstep(null, 0, true);
      break;
    case 'beep':
      audio.bombBeep(a[0], a[1], a[2]);
      break;
  }
};

// ------------------------------------------------------------ input wiring

function updateBlocked() {
  input.blocked = !inGame || ui.buyOpen || ui.escOpen || ui.chatOpen;
}

input.onSlot = (slot) => {
  if (!inGame) return;
  net.send({ t: 'slot', s: slot });
  if ((slot === 1 && state.me.primary) || slot === 2 || slot === 3) {
    state.me.slot = slot; // optimistic; server echoes
    audio.click();
  }
};

input.onWheel = (dir) => {
  if (!inGame || !state.me.alive) return;
  const slots = state.me.primary ? [1, 2, 3] : [2, 3];
  const i = slots.indexOf(state.me.slot);
  const next = slots[(i + dir + slots.length) % slots.length];
  input.onSlot(next);
};

function toggleEsc(open) {
  ui.escOpen = open ?? !ui.escOpen;
  $('escmenu').classList.toggle('hidden', !ui.escOpen);
  updateBlocked();
}

input.onToggle = (which, down) => {
  if (!inGame) return;
  switch (which) {
    case 'score':
      ui.showScoreboard(down);
      break;
    case 'buy':
      if (ui.chatOpen || ui.escOpen) return;
      ui.buyOpen ? ui.closeBuy() : ui.openBuy();
      updateBlocked();
      break;
    case 'esc':
      if (ui.buyOpen) { ui.closeBuy(); updateBlocked(); return; }
      if (ui.chatOpen) { ui.closeChat(); updateBlocked(); return; }
      toggleEsc();
      break;
    case 'chat':
      if (ui.buyOpen || ui.escOpen) return;
      ui.openChat();
      updateBlocked();
      break;
  }
};

input.onMenuKey = (e) => {
  if (ui.buyOpen && /^Digit[1-7]$/.test(e.code)) ui.buyHotkey(e.code.slice(5));
};

// click to cycle spectate target
addEventListener('mousedown', (e) => {
  if (inGame && !state.me.alive && !input.blocked && e.target.tagName === 'CANVAS') {
    state.cycleSpectate();
    audio.click();
  }
});

// ------------------------------------------------------------ game loop

function frame(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (inGame) {
    updateBlocked();
    state.update(dt, renderer.camera);
    audio.listener = state.focusPos();
    renderer.draw(dt);
    if (now - lastUiAt > 50) {
      lastUiAt = now;
      ui.update();
      // bomb-carrier notification edge
      if (state.me.hasBomb !== hadBomb) {
        hadBomb = state.me.hasBomb;
        if (hadBomb) ui.msg('CHARGE ASSIGNED', '#ffd166', 'arm it at a rift site — hold E', 2600);
      }
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ------------------------------------------------------------ menu background

let menuBgRunning = false;
const stars = [];

function startMenuBg() {
  if (menuBgRunning) return;
  menuBgRunning = true;
  const c = $('menu-bg');
  const x = c.getContext('2d');
  if (!stars.length) {
    for (let i = 0; i < 130; i++) {
      stars.push({
        x: Math.random(), y: Math.random(),
        z: 0.2 + Math.random() * 0.8,
        hue: Math.random() < 0.7 ? 260 : Math.random() < 0.5 ? 190 : 330,
      });
    }
  }
  const tick = () => {
    if (!menuBgRunning) return;
    c.width = innerWidth; c.height = innerHeight;
    x.fillStyle = '#05060d';
    x.fillRect(0, 0, c.width, c.height);
    const t = performance.now() / 1000;
    // void nebula
    const g = x.createRadialGradient(c.width / 2, c.height * 0.45, 40, c.width / 2, c.height * 0.45, c.height * 0.8);
    g.addColorStop(0, 'rgba(80, 40, 140, 0.16)');
    g.addColorStop(0.6, 'rgba(30, 20, 70, 0.10)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    x.fillStyle = g;
    x.fillRect(0, 0, c.width, c.height);
    for (const s of stars) {
      s.y -= s.z * 0.00022;
      if (s.y < 0) { s.y = 1; s.x = Math.random(); }
      const tw = 0.55 + 0.45 * Math.sin(t * 2 + s.x * 40);
      x.fillStyle = `hsla(${s.hue}, 90%, 75%, ${0.25 + s.z * 0.5 * tw})`;
      const sz = s.z * 2.2;
      x.fillRect(s.x * c.width, s.y * c.height, sz, sz);
    }
    requestAnimationFrame(tick);
  };
  tick();
}

function stopMenuBg() { menuBgRunning = false; }

startMenuBg();
$('name-input').focus();

// debug/testing hook
window.__krell = { state, net, renderer, ui, input };
