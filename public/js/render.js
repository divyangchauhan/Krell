// ============================================================
// KRELL client — canvas renderer
// layers: floor → decals → bomb/nades → players → particles →
//         tracers → fog/visibility → lights → crosshair/hud-fx
// ============================================================

import { TEAM, TEAM_INFO, PHASE, PLAYER_RADIUS, INTERP_MS, TIMING } from '/shared/const.js';
import { clamp, lerp, seededRng, raycastWalls } from '/shared/util.js';
import {
  WALLS, CRATES, MAP_W, MAP_H, TILE, GRID, COLS, ROWS, SITES, SPAWNS, BUY_ZONES, tileChar,
} from '/shared/map.js';

const FOG = 'rgba(4, 6, 14, 0.94)';
const VIEW_RADIUS = 950;

export class Renderer {
  constructor(canvas, state) {
    this.cv = canvas;
    this.cx = canvas.getContext('2d');
    this.state = state;
    this.camera = { x: MAP_W / 2, y: MAP_H / 2, zoom: 1 };
    this.baseZoom = 1;
    this.scope = 1;            // smoothed scope-zoom factor (1 = hip)
    this.scoped = false;       // fully scoped this frame (for overlay/aim)
    this.shake = { x: 0, y: 0, mag: 0 };
    this.particles = [];
    this.tracers = [];
    this.hitmarkerAt = 0;
    this.damageDirs = [];      // {angle, at}
    this.bodies = [];          // corpse markers {x, y, team, at}
    this.floaters = [];        // floating combat text {x, y, text, color, born, life, vy, size}
    this.bombGlowPhase = 0;
    this.lastBeepAt = 0;
    this.fogCanvas = document.createElement('canvas');
    this.minimap = document.getElementById('minimap');
    this.mctx = this.minimap.getContext('2d');
    this._buildFloor();
    this._buildMinimapBase();
    this._resize();
    addEventListener('resize', () => this._resize());
  }

  _resize() {
    this.cv.width = innerWidth * devicePixelRatio;
    this.cv.height = innerHeight * devicePixelRatio;
    this.fogCanvas.width = this.cv.width;
    this.fogCanvas.height = this.cv.height;
    // zoom scales with viewport so different screens see similar area
    this.baseZoom = Math.max(innerWidth / 1750, innerHeight / 1100) * devicePixelRatio;
    this.camera.zoom = this.baseZoom * this.scope;
  }

  // ---------------------------------------------------------- prerender

  _buildFloor() {
    const c = document.createElement('canvas');
    c.width = MAP_W; c.height = MAP_H;
    const x = c.getContext('2d');
    const rng = seededRng(90909);

    x.fillStyle = '#0a0d1a';
    x.fillRect(0, 0, MAP_W, MAP_H);

    // tile variation + faint grid
    for (let r = 0; r < ROWS; r++) {
      for (let cl = 0; cl < COLS; cl++) {
        const ch = tileChar(cl, r);
        if (ch === '#') continue;
        const v = rng();
        x.fillStyle = `rgba(${28 + v * 11}, ${33 + v * 12}, ${58 + v * 16}, 1)`;
        x.fillRect(cl * TILE, r * TILE, TILE, TILE);
        if (rng() < 0.06) { // scattered panel lights
          x.fillStyle = 'rgba(120, 160, 255, 0.05)';
          x.fillRect(cl * TILE + 8, r * TILE + 8, TILE - 16, TILE - 16);
        }
      }
    }
    x.strokeStyle = 'rgba(110, 140, 220, 0.05)';
    x.lineWidth = 1;
    for (let i = 0; i <= COLS; i++) { x.beginPath(); x.moveTo(i * TILE, 0); x.lineTo(i * TILE, MAP_H); x.stroke(); }
    for (let i = 0; i <= ROWS; i++) { x.beginPath(); x.moveTo(0, i * TILE); x.lineTo(MAP_W, i * TILE); x.stroke(); }

    // site zones
    for (const key of ['A', 'B']) {
      const s = SITES[key];
      x.fillStyle = 'rgba(179, 107, 255, 0.06)';
      x.fillRect(s.x, s.y, s.w, s.h);
      x.strokeStyle = 'rgba(179, 107, 255, 0.35)';
      x.lineWidth = 3;
      x.setLineDash([18, 12]);
      x.strokeRect(s.x + 6, s.y + 6, s.w - 12, s.h - 12);
      x.setLineDash([]);
      x.font = `700 ${TILE * 1.8}px Rajdhani, sans-serif`;
      x.fillStyle = 'rgba(179, 107, 255, 0.13)';
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(key, s.cx, s.cy);
      x.font = `600 ${TILE * 0.34}px Rajdhani, sans-serif`;
      x.fillStyle = 'rgba(179, 107, 255, 0.4)';
      x.fillText(`◤ ${s.name} ◥`, s.cx, s.y + 36);
    }

    // spawn tints
    for (const t of [TEAM.KRELL, TEAM.WARDEN]) {
      const z = SPAWNS[t];
      x.fillStyle = t === TEAM.KRELL ? 'rgba(255, 95, 143, 0.045)' : 'rgba(63, 217, 255, 0.045)';
      x.fillRect(z.x, z.y, z.w, z.h);
    }

    // walls — dark slabs with neon rim
    for (const w of WALLS) {
      x.fillStyle = '#131830';
      x.fillRect(w.x, w.y, w.w, w.h);
      x.fillStyle = '#1c2342';
      x.fillRect(w.x, w.y, w.w, 6);
      x.strokeStyle = 'rgba(122, 140, 255, 0.25)';
      x.lineWidth = 2;
      x.strokeRect(w.x + 1, w.y + 1, w.w - 2, w.h - 2);
    }
    // crates restyled on top
    for (const cr of CRATES) {
      x.fillStyle = '#2a2440';
      x.fillRect(cr.x + 6, cr.y + 6, cr.w - 12, cr.h - 12);
      x.strokeStyle = 'rgba(255, 209, 102, 0.35)';
      x.lineWidth = 2;
      x.strokeRect(cr.x + 10, cr.y + 10, cr.w - 20, cr.h - 20);
      x.beginPath();
      x.moveTo(cr.x + 10, cr.y + 10); x.lineTo(cr.x + cr.w - 10, cr.y + cr.h - 10);
      x.moveTo(cr.x + cr.w - 10, cr.y + 10); x.lineTo(cr.x + 10, cr.y + cr.h - 10);
      x.stroke();
    }
    this.floor = c;

    // decal layer (scorch marks, ichor) — drawn into over time
    const d = document.createElement('canvas');
    d.width = MAP_W; d.height = MAP_H;
    this.decals = d.getContext('2d');
  }

  _buildMinimapBase() {
    const c = document.createElement('canvas');
    c.width = 200; c.height = Math.round(200 * MAP_H / MAP_W);
    this.minimap.width = c.width; this.minimap.height = c.height;
    const x = c.getContext('2d');
    const s = c.width / MAP_W;
    x.fillStyle = 'rgba(8, 11, 24, 1)';
    x.fillRect(0, 0, c.width, c.height);
    x.fillStyle = 'rgba(96, 120, 200, 0.5)';
    for (const w of WALLS) x.fillRect(w.x * s, w.y * s, Math.max(1, w.w * s), Math.max(1, w.h * s));
    x.font = '700 13px Rajdhani, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillStyle = 'rgba(179, 107, 255, 0.9)';
    for (const k of ['A', 'B']) x.fillText(k, SITES[k].cx * s, SITES[k].cy * s);
    this.minimapBase = c;
    this.minimapScale = s;
  }

  // ---------------------------------------------------------- effects API

  addShake(mag) { this.shake.mag = Math.min(this.shake.mag + mag, 26); }

  tracer(x1, y1, x2, y2, color = 'rgba(255, 230, 160, 0.9)') {
    this.tracers.push({ x1, y1, x2, y2, at: performance.now(), color });
  }

  spark(x, y, n, color, speed = 220, life = 350) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        born: performance.now(), life: life * (0.5 + Math.random() * 0.8),
        size: 1.5 + Math.random() * 2.5, color, drag: 4,
      });
    }
  }

  impactDust(x, y, nx, ny) {
    for (let i = 0; i < 6; i++) {
      const a = Math.atan2(ny, nx) + (Math.random() - 0.5) * 1.6;
      const v = 90 + Math.random() * 160;
      this.particles.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        born: performance.now(), life: 300 + Math.random() * 250,
        size: 2 + Math.random() * 2, color: 'rgba(170, 190, 255, 0.7)', drag: 6,
      });
    }
  }

  blood(x, y) {
    this.spark(x, y, 9, 'rgba(120, 255, 190, 0.8)', 190, 420);
    const d = this.decals;
    d.fillStyle = 'rgba(60, 190, 140, 0.25)';
    for (let i = 0; i < 4; i++) {
      d.beginPath();
      d.arc(x + (Math.random() - 0.5) * 36, y + (Math.random() - 0.5) * 36, 3 + Math.random() * 7, 0, 7);
      d.fill();
    }
  }

  explosion(x, y, big) {
    const n = big ? 70 : 36;
    this.spark(x, y, n, big ? 'rgba(255, 140, 60, 0.95)' : 'rgba(255, 190, 90, 0.9)', big ? 600 : 420, big ? 900 : 600);
    this.spark(x, y, n / 2, 'rgba(255, 240, 200, 0.9)', big ? 320 : 220, 500);
    this.particles.push({
      x, y, vx: 0, vy: 0, born: performance.now(), life: big ? 700 : 450,
      size: big ? 360 : 200, color: 'ring', drag: 0,
    });
    const d = this.decals;
    const g = d.createRadialGradient(x, y, 4, x, y, big ? 240 : 120);
    g.addColorStop(0, 'rgba(0, 0, 0, 0.6)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    d.fillStyle = g;
    d.beginPath(); d.arc(x, y, big ? 240 : 120, 0, 7); d.fill();
    this.addShake(big ? 24 : 10);
  }

  corpse(x, y, team) {
    this.bodies.push({ x, y, team, at: performance.now() });
    if (this.bodies.length > 24) this.bodies.shift();
  }

  hitmarker() { this.hitmarkerAt = performance.now(); }

  floatText(x, y, text, color = '#ffffff', size = 22) {
    this.floaters.push({
      x: x + (Math.random() - 0.5) * 14, y: y - 8,
      text, color, born: performance.now(), life: 1000, vy: -42, size,
    });
    if (this.floaters.length > 30) this.floaters.shift();
  }

  damageFrom(x, y) {
    const me = this.state.selfPos();
    this.damageDirs.push({ angle: Math.atan2(y - me.y, x - me.x), at: performance.now() });
  }

  muzzle(x, y, angle) {
    this.particles.push({
      x: x + Math.cos(angle) * 26, y: y + Math.sin(angle) * 26,
      vx: 0, vy: 0, born: performance.now(), life: 70, size: 16, color: 'flash', drag: 0,
    });
  }

  // ---------------------------------------------------------- frame

  draw(dt) {
    const st = this.state;
    const cx = this.cx;
    const now = performance.now();
    const W = this.cv.width, H = this.cv.height;

    // scope zoom — only the LONGLANCE can scope, only while alive
    const canScope = st.me.alive && st.me.wid === 'sniper' && st.input.aimHeld && !st.input.blocked;
    const targetScope = canScope ? 1.95 : 1;
    this.scope = lerp(this.scope, targetScope, 1 - Math.exp(-13 * dt));
    this.scoped = canScope && this.scope > 1.5;
    this.camera.zoom = this.baseZoom * this.scope;

    // camera — centered on focus (zoom alone gives the scoped feel; leading
    // toward the aim point would feed back into the mouse->world aim calc)
    const focus = st.focusPos();
    this.camera.x = lerp(this.camera.x, focus.x, 1 - Math.exp(-10 * dt));
    this.camera.y = lerp(this.camera.y, focus.y, 1 - Math.exp(-10 * dt));
    this.shake.mag *= Math.exp(-7 * dt);
    this.shake.x = (Math.random() - 0.5) * this.shake.mag;
    this.shake.y = (Math.random() - 0.5) * this.shake.mag;
    const z = this.camera.zoom;
    const camX = this.camera.x + this.shake.x;
    const camY = this.camera.y + this.shake.y;

    cx.fillStyle = '#04060e';
    cx.fillRect(0, 0, W, H);
    cx.save();
    cx.translate(W / 2, H / 2);
    cx.scale(z, z);
    cx.translate(-camX, -camY);

    // floor + decals (clipped to view)
    const vw = W / z, vh = H / z;
    const vx0 = camX - vw / 2 - 50, vy0 = camY - vh / 2 - 50;
    cx.drawImage(this.floor, vx0, vy0, vw + 100, vh + 100, vx0, vy0, vw + 100, vh + 100);
    cx.drawImage(this.decals.canvas, vx0, vy0, vw + 100, vh + 100, vx0, vy0, vw + 100, vh + 100);

    // buy zone outline during buy time
    if ((st.phase === PHASE.FREEZE || st.phase === PHASE.WARMUP) && st.me.alive) {
      const bz = BUY_ZONES[st.team];
      cx.strokeStyle = 'rgba(255, 209, 102, 0.4)';
      cx.setLineDash([14, 10]);
      cx.lineWidth = 2;
      cx.strokeRect(bz.x, bz.y, bz.w, bz.h);
      cx.setLineDash([]);
    }

    this._drawBodies(cx, now);
    this._drawBomb(cx, now);
    this._drawNades(cx);
    this._drawPlayers(cx, now, dt);
    this._drawParticles(cx, now, dt);
    this._drawTracers(cx, now);

    cx.restore();

    // fog of war + vignette
    this._drawFog(camX, camY, z, W, H);
    this._drawFloaters(cx, now, dt, camX, camY, z, W, H);
    this._drawHudFx(cx, now, W, H);
    if (this.scope > 1.02) this._drawScope(cx, now, W, H);
    this._drawCrosshair(cx, now, W, H);
    this._drawMinimap(now);

    // bomb beep cadence
    if (st.bomb.st === 'planted') {
      const elapsed = st.svNow() - st.bomb.pa;
      const frac = clamp(elapsed / TIMING.bomb, 0, 1);
      const interval = lerp(1000, 130, frac * frac);
      if (now - this.lastBeepAt > interval) {
        this.lastBeepAt = now;
        st.onEvent?.(['beep', st.bomb.x, st.bomb.y, frac]);
      }
    }
  }

  // ---------------------------------------------------------- world bits

  _drawBodies(cx, now) {
    for (const b of this.bodies) {
      const age = (now - b.at) / 1000;
      const alpha = clamp(1 - age / 18, 0, 0.6);
      if (alpha <= 0) continue;
      cx.save();
      cx.translate(b.x, b.y);
      cx.globalAlpha = alpha;
      cx.strokeStyle = TEAM_INFO[b.team].dim;
      cx.lineWidth = 5;
      cx.beginPath();
      cx.arc(0, 0, PLAYER_RADIUS * 0.85, 0, 7);
      cx.stroke();
      cx.beginPath();
      cx.moveTo(-9, -9); cx.lineTo(9, 9); cx.moveTo(9, -9); cx.lineTo(-9, 9);
      cx.stroke();
      cx.restore();
    }
    cx.globalAlpha = 1;
  }

  _drawBomb(cx, now) {
    const b = this.state.bomb;
    if (b.st !== 'dropped' && b.st !== 'planted') return;
    const pulse = b.st === 'planted' ? 0.5 + 0.5 * Math.sin(now / 120) : 0.5 + 0.5 * Math.sin(now / 500);
    cx.save();
    cx.translate(b.x, b.y);
    const color = b.st === 'planted' ? '255, 70, 90' : '255, 209, 102';
    const g = cx.createRadialGradient(0, 0, 2, 0, 0, 60 + pulse * 30);
    g.addColorStop(0, `rgba(${color}, ${0.5 + pulse * 0.3})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(0, 0, 60 + pulse * 30, 0, 7); cx.fill();
    cx.rotate(Math.PI / 4);
    cx.fillStyle = `rgba(${color}, 0.95)`;
    cx.fillRect(-9, -9, 18, 18);
    cx.fillStyle = '#0a0c18';
    cx.fillRect(-5, -5, 10, 10);
    cx.restore();
  }

  _drawNades(cx) {
    for (const [x, y] of this.state.nadesLive) {
      cx.fillStyle = '#9bf0c6';
      cx.beginPath(); cx.arc(x, y, 6, 0, 7); cx.fill();
      cx.strokeStyle = 'rgba(155, 240, 198, 0.4)';
      cx.lineWidth = 2;
      cx.beginPath(); cx.arc(x, y, 10, 0, 7); cx.stroke();
    }
  }

  _drawPlayers(cx, now, dt) {
    const st = this.state;
    const players = st.interpPlayers();

    // remote players
    for (const [id, p] of players) {
      if (p.dead) continue;
      const r = st.roster.get(id);
      const team = r ? r.team : TEAM.WARDEN;
      this._drawOperative(cx, p.x, p.y, p.a, team, {
        name: team === st.team ? r?.name : null, hp: team === st.team ? p.hp : 0,
        reloading: p.reloading, planting: p.planting, defusing: p.defusing,
        hasBomb: p.hasBomb, wid: p.wid, isSelf: false, now,
      });
    }

    // self
    if (st.me.alive) {
      const sp = st.selfPos();
      this._drawOperative(cx, sp.x, sp.y, st.me.angle, st.team, {
        hp: 0, reloading: st.me.reloadLeft > 0, planting: st.me.plant > 0,
        defusing: st.me.defuse > 0, hasBomb: st.me.hasBomb, wid: st.me.wid, isSelf: true, now,
      });
      if (st.me.plant > 0) this._progressRing(cx, sp.x, sp.y, st.me.plant, '#ffd166');
      if (st.me.defuse > 0) this._progressRing(cx, sp.x, sp.y, st.me.defuse, '#3fd9ff');
    }

    // progress rings for others
    for (const [id, p] of players) {
      if (!p.dead && (p.planting || p.defusing)) {
        // server doesn't send numeric progress for others; pulse instead
        const t = (now % 1000) / 1000;
        this._progressRing(cx, p.x, p.y, t, p.planting ? '#ffd166' : '#3fd9ff', true);
      }
    }
  }

  _drawOperative(cx, x, y, angle, team, o) {
    const info = TEAM_INFO[team];
    cx.save();
    cx.translate(x, y);

    // soft shadow + team glow
    const g = cx.createRadialGradient(0, 0, 4, 0, 0, 34);
    g.addColorStop(0, team === TEAM.KRELL ? 'rgba(255, 95, 143, 0.25)' : 'rgba(63, 217, 255, 0.25)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    cx.fillStyle = g;
    cx.beginPath(); cx.arc(0, 0, 34, 0, 7); cx.fill();

    cx.rotate(angle);
    // weapon
    cx.fillStyle = '#0d1020';
    cx.strokeStyle = 'rgba(200, 220, 255, 0.5)';
    cx.lineWidth = 1.5;
    const wlen = o.wid === 'knife' ? 16 : o.wid === 'sniper' ? 36 : o.wid === 'pistol' ? 20 : 30;
    cx.beginPath();
    cx.roundRect(8, -3.4, wlen, 6.8, 2);
    cx.fill(); cx.stroke();

    // body
    const body = cx.createRadialGradient(-4, -4, 2, 0, 0, PLAYER_RADIUS);
    body.addColorStop(0, lightenColor(info.color));
    body.addColorStop(1, info.color);
    cx.fillStyle = body;
    cx.beginPath(); cx.arc(0, 0, PLAYER_RADIUS, 0, 7); cx.fill();
    cx.lineWidth = o.isSelf ? 3 : 2;
    cx.strokeStyle = o.isSelf ? '#ffffff' : 'rgba(10, 12, 24, 0.8)';
    cx.stroke();
    // visor
    cx.fillStyle = 'rgba(10, 14, 28, 0.9)';
    cx.beginPath();
    cx.arc(7, 0, 6, -1.1, 1.1);
    cx.lineTo(7, 0);
    cx.fill();
    cx.rotate(-angle);

    // bomb carrier marker
    if (o.hasBomb) {
      const pulse = 0.6 + 0.4 * Math.sin(o.now / 200);
      cx.fillStyle = `rgba(255, 209, 102, ${pulse})`;
      cx.save();
      cx.translate(0, -PLAYER_RADIUS - 14);
      cx.rotate(Math.PI / 4);
      cx.fillRect(-5, -5, 10, 10);
      cx.restore();
    }
    // reload spinner
    if (o.reloading) {
      cx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
      cx.lineWidth = 2.5;
      const a0 = (o.now / 150) % (Math.PI * 2);
      cx.beginPath();
      cx.arc(0, 0, PLAYER_RADIUS + 7, a0, a0 + 1.6);
      cx.stroke();
    }
    // name + hp for teammates
    if (o.name) {
      cx.font = '600 13px Rajdhani, sans-serif';
      cx.textAlign = 'center';
      cx.fillStyle = 'rgba(220, 230, 255, 0.85)';
      cx.fillText(o.name, 0, -PLAYER_RADIUS - (o.hp ? 16 : 8));
      if (o.hp) {
        cx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        cx.fillRect(-17, -PLAYER_RADIUS - 12, 34, 4);
        cx.fillStyle = o.hp > 40 ? '#41e596' : '#ff4757';
        cx.fillRect(-17, -PLAYER_RADIUS - 12, 34 * (o.hp / 100), 4);
      }
    }
    cx.restore();
  }

  _progressRing(cx, x, y, t, color, pulse = false) {
    cx.save();
    cx.strokeStyle = color;
    cx.lineWidth = 4;
    cx.globalAlpha = pulse ? 0.5 : 0.9;
    cx.beginPath();
    cx.arc(x, y, PLAYER_RADIUS + 13, -Math.PI / 2, -Math.PI / 2 + t * Math.PI * 2);
    cx.stroke();
    cx.restore();
  }

  _drawParticles(cx, now, dt) {
    const drag = (d) => Math.exp(-d * dt);
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const age = now - p.born;
      if (age > p.life) { this.particles.splice(i, 1); continue; }
      const t = age / p.life;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.drag) { const f = drag(p.drag); p.vx *= f; p.vy *= f; }
      if (p.color === 'ring') {
        cx.strokeStyle = `rgba(255, 200, 120, ${0.8 * (1 - t)})`;
        cx.lineWidth = 6 * (1 - t) + 1;
        cx.beginPath(); cx.arc(p.x, p.y, p.size * t + 8, 0, 7); cx.stroke();
      } else if (p.color === 'flash') {
        const g = cx.createRadialGradient(p.x, p.y, 1, p.x, p.y, p.size * (1 - t * 0.5));
        g.addColorStop(0, `rgba(255, 240, 180, ${0.9 * (1 - t)})`);
        g.addColorStop(1, 'rgba(255, 200, 100, 0)');
        cx.fillStyle = g;
        cx.beginPath(); cx.arc(p.x, p.y, p.size * (1 - t * 0.5), 0, 7); cx.fill();
      } else {
        cx.globalAlpha = 1 - t;
        cx.fillStyle = p.color;
        cx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
        cx.globalAlpha = 1;
      }
    }
  }

  _drawTracers(cx, now) {
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      const age = now - t.at;
      if (age > 90) { this.tracers.splice(i, 1); continue; }
      const a = 1 - age / 90;
      cx.strokeStyle = t.color.replace(/[\d.]+\)$/, `${0.75 * a})`);
      cx.lineWidth = 2;
      cx.beginPath();
      cx.moveTo(t.x1, t.y1);
      cx.lineTo(t.x2, t.y2);
      cx.stroke();
    }
  }

  // floating combat text — world-anchored, screen-space font (above fog)
  _drawFloaters(cx, now, dt, camX, camY, z, W, H) {
    if (!this.floaters.length) return;
    cx.save();
    cx.textAlign = 'center';
    cx.textBaseline = 'middle';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      const age = now - f.born;
      if (age > f.life) { this.floaters.splice(i, 1); continue; }
      const t = age / f.life;
      f.y += f.vy * dt;
      f.vy *= Math.exp(-2.5 * dt);
      const sx = W / 2 + (f.x - camX) * z;
      const sy = H / 2 + (f.y - camY) * z;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const pop = t < 0.12 ? 0.7 + 0.3 * (t / 0.12) : 1;
      cx.globalAlpha = clamp(alpha, 0, 1);
      cx.font = `700 ${f.size * pop * devicePixelRatio}px Rajdhani, sans-serif`;
      cx.lineWidth = 3 * devicePixelRatio;
      cx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
      cx.strokeText(f.text, sx, sy);
      cx.fillStyle = f.color;
      cx.fillText(f.text, sx, sy);
    }
    cx.restore();
    cx.globalAlpha = 1;
  }

  // ---------------------------------------------------------- fog / visibility

  _drawFog(camX, camY, z, W, H) {
    const st = this.state;
    const eye = st.focusPos();
    const fc = this.fogCanvas.getContext('2d');
    fc.clearRect(0, 0, W, H);
    fc.fillStyle = FOG;
    fc.fillRect(0, 0, W, H);

    // visibility polygon from eye, world space
    const poly = visibilityPolygon(eye.x, eye.y);
    fc.save();
    fc.translate(W / 2, H / 2);
    fc.scale(z, z);
    fc.translate(-camX, -camY);
    fc.globalCompositeOperation = 'destination-out';

    // soft radial light bounded by the LOS polygon
    fc.beginPath();
    fc.moveTo(poly[0].x, poly[0].y);
    for (let i = 1; i < poly.length; i++) fc.lineTo(poly[i].x, poly[i].y);
    fc.closePath();
    const g = fc.createRadialGradient(eye.x, eye.y, 60, eye.x, eye.y, VIEW_RADIUS);
    g.addColorStop(0, 'rgba(0, 0, 0, 1)');
    g.addColorStop(0.75, 'rgba(0, 0, 0, 0.9)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    fc.fillStyle = g;
    fc.fill();
    fc.restore();
    this.cx.drawImage(this.fogCanvas, 0, 0);
  }

  // ---------------------------------------------------------- screen-space fx

  _drawHudFx(cx, now, W, H) {
    const st = this.state;
    // low-hp pulse
    if (st.me.alive && st.me.hp <= 30) {
      const pulse = 0.5 + 0.5 * Math.sin(now / 280);
      const g = cx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.72);
      g.addColorStop(0, 'rgba(255, 30, 50, 0)');
      g.addColorStop(1, `rgba(255, 30, 50, ${0.12 + 0.12 * pulse * (1 - st.me.hp / 30)})`);
      cx.fillStyle = g;
      cx.fillRect(0, 0, W, H);
    }
    // damage direction arcs
    for (let i = this.damageDirs.length - 1; i >= 0; i--) {
      const d = this.damageDirs[i];
      const age = now - d.at;
      if (age > 900) { this.damageDirs.splice(i, 1); continue; }
      const a = 1 - age / 900;
      cx.save();
      cx.translate(W / 2, H / 2);
      cx.rotate(d.angle);
      cx.strokeStyle = `rgba(255, 60, 70, ${0.7 * a})`;
      cx.lineWidth = 7 * devicePixelRatio;
      cx.beginPath();
      cx.arc(0, 0, H * 0.21, -0.45, 0.45);
      cx.stroke();
      cx.restore();
    }
  }

  // sniper scope overlay — corner vignette + reticle lines toward the aim point
  _drawScope(cx, now, W, H) {
    const st = this.state;
    const k = clamp((this.scope - 1) / 0.95, 0, 1);   // 0..1 scoped-ness
    const mx = st.input.mouse.x * devicePixelRatio;
    const my = st.input.mouse.y * devicePixelRatio;
    cx.save();
    // darken outside a soft circle around the aim point
    const g = cx.createRadialGradient(mx, my, H * 0.18, mx, my, H * 0.62);
    g.addColorStop(0, 'rgba(2, 4, 10, 0)');
    g.addColorStop(1, `rgba(2, 4, 10, ${0.6 * k})`);
    cx.fillStyle = g;
    cx.fillRect(0, 0, W, H);
    // faint reticle ring + ranging ticks
    cx.globalAlpha = k * 0.5;
    cx.strokeStyle = 'rgba(120, 255, 170, 0.7)';
    cx.lineWidth = 1.2 * devicePixelRatio;
    cx.beginPath();
    cx.arc(mx, my, 26 * devicePixelRatio, 0, 7);
    cx.stroke();
    cx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      cx.moveTo(mx + dx * 26 * devicePixelRatio, my + dy * 26 * devicePixelRatio);
      cx.lineTo(mx + dx * H * 0.6, my + dy * H * 0.6);
    }
    cx.stroke();
    cx.restore();
    cx.globalAlpha = 1;
  }

  _drawCrosshair(cx, now, W, H) {
    const st = this.state;
    const mx = st.input.mouse.x * devicePixelRatio;
    const my = st.input.mouse.y * devicePixelRatio;
    if (!st.me.alive) return;

    const spread = st.crosshairSpread();
    // project angular spread to a representative pixel gap
    const gap = (5 + spread * 580) * devicePixelRatio;
    const len = 8 * devicePixelRatio;
    cx.strokeStyle = 'rgba(120, 255, 170, 0.95)';
    cx.lineWidth = 1.6 * devicePixelRatio;
    cx.beginPath();
    cx.moveTo(mx + gap, my); cx.lineTo(mx + gap + len, my);
    cx.moveTo(mx - gap, my); cx.lineTo(mx - gap - len, my);
    cx.moveTo(mx, my + gap); cx.lineTo(mx, my + gap + len);
    cx.moveTo(mx, my - gap); cx.lineTo(mx, my - gap - len);
    cx.stroke();
    cx.fillStyle = 'rgba(120, 255, 170, 0.95)';
    cx.fillRect(mx - 1, my - 1, 2, 2);

    // hitmarker
    const hm = now - this.hitmarkerAt;
    if (hm < 160) {
      const a = 1 - hm / 160;
      const o = (7 + hm / 14) * devicePixelRatio;
      const l = 6 * devicePixelRatio;
      cx.strokeStyle = `rgba(255, 255, 255, ${a})`;
      cx.lineWidth = 2 * devicePixelRatio;
      cx.beginPath();
      for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        cx.moveTo(mx + sx * o, my + sy * o);
        cx.lineTo(mx + sx * (o + l), my + sy * (o + l));
      }
      cx.stroke();
    }
  }

  // ---------------------------------------------------------- minimap

  _drawMinimap(now) {
    const m = this.mctx;
    const s = this.minimapScale;
    const st = this.state;
    m.drawImage(this.minimapBase, 0, 0);

    const players = st.interpPlayers();
    for (const [id, p] of players) {
      if (p.dead) continue;
      const r = st.roster.get(id);
      if (!r) continue;
      m.fillStyle = r.team === st.team
        ? (st.team === TEAM.KRELL ? '#ff5f8f' : '#3fd9ff')
        : '#ff4040';
      if (r.team !== st.team) {
        const blink = Math.sin(now / 180) > -0.3;
        if (!blink) continue;
      }
      m.beginPath(); m.arc(p.x * s, p.y * s, 2.4, 0, 7); m.fill();
    }
    // self: triangle showing facing
    if (st.me.alive || st.spectateId) {
      const f = st.focusPos();
      const a = st.me.alive ? st.me.angle : 0;
      m.save();
      m.translate(f.x * s, f.y * s);
      m.rotate(a);
      m.fillStyle = '#ffffff';
      m.beginPath();
      m.moveTo(5, 0); m.lineTo(-3, -3.4); m.lineTo(-3, 3.4);
      m.closePath(); m.fill();
      m.restore();
    }
    // bomb
    const b = st.bomb;
    if (b.st === 'dropped' || b.st === 'planted') {
      const blink = b.st === 'planted' ? Math.sin(now / 130) > 0 : true;
      if (blink) {
        m.fillStyle = b.st === 'planted' ? '#ff4757' : '#ffd166';
        m.save();
        m.translate(b.x * s, b.y * s);
        m.rotate(Math.PI / 4);
        m.fillRect(-3, -3, 6, 6);
        m.restore();
      }
    }
  }
}

// ------------------------------------------------------------
// visibility polygon: cast rays to wall corners (±ε) within range
// ------------------------------------------------------------

const SEG_EPS = 0.0004;

function visibilityPolygon(ex, ey) {
  const angles = [];
  const R = VIEW_RADIUS + 200;
  for (const w of WALLS) {
    // cull far walls
    const nx = clamp(ex, w.x, w.x + w.w);
    const ny = clamp(ey, w.y, w.y + w.h);
    if ((ex - nx) ** 2 + (ey - ny) ** 2 > R * R) continue;
    for (const [cxx, cyy] of [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h]]) {
      const a = Math.atan2(cyy - ey, cxx - ex);
      angles.push(a - SEG_EPS, a, a + SEG_EPS);
    }
  }
  // a base fan so the polygon is sane even with few corners
  for (let i = 0; i < 12; i++) angles.push((i / 12) * Math.PI * 2);
  angles.sort((a, b) => a - b);

  const pts = [];
  for (const a of angles) {
    const dx = Math.cos(a), dy = Math.sin(a);
    const hit = raycastWalls(ex, ey, dx, dy, VIEW_RADIUS, WALLS);
    pts.push({ x: ex + dx * hit.d, y: ey + dy * hit.d });
  }
  return pts;
}

function lightenColor(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (n >> 16) + 70);
  const g = Math.min(255, ((n >> 8) & 255) + 70);
  const b = Math.min(255, (n & 255) + 70);
  return `rgb(${r}, ${g}, ${b})`;
}
