// ============================================================
// KRELL — shared math / physics helpers (server + client)
// Movement code here MUST stay identical on both sides:
// the client predicts with the same function the server runs.
// ============================================================

import { KEY, BTN, PLAYER_RADIUS } from './const.js';

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1);
export const dist2 = (x1, y1, x2, y2) => (x2 - x1) ** 2 + (y2 - y1) ** 2;
export const angleTo = (x1, y1, x2, y2) => Math.atan2(y2 - y1, x2 - x1);

export function angleLerp(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Mulberry32 — deterministic rng for map decor
export function seededRng(seed) {
  let s = seed >>> 0;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------
// Player movement (deterministic, shared by prediction + server)
// ------------------------------------------------------------

export function stepPlayer(p, keys, buttons, dt, walls, speed) {
  let ix = ((keys & KEY.RIGHT) ? 1 : 0) - ((keys & KEY.LEFT) ? 1 : 0);
  let iy = ((keys & KEY.DOWN) ? 1 : 0) - ((keys & KEY.UP) ? 1 : 0);
  if (ix || iy) {
    const l = Math.hypot(ix, iy);
    ix /= l; iy /= l;
  }
  const spd = speed * ((buttons & BTN.WALK) ? 0.48 : 1);
  // exponential approach to wish velocity — snappy but with a touch of glide
  const f = 1 - Math.exp(-14 * dt);
  p.vx += (ix * spd - p.vx) * f;
  p.vy += (iy * spd - p.vy) * f;
  moveAxis(p, p.vx * dt, 0, walls);
  moveAxis(p, 0, p.vy * dt, walls);
}

export function moveAxis(p, dx, dy, walls, r = PLAYER_RADIUS) {
  p.x += dx;
  p.y += dy;
  for (const w of walls) {
    const nx = clamp(p.x, w.x, w.x + w.w);
    const ny = clamp(p.y, w.y, w.y + w.h);
    const ox = p.x - nx, oy = p.y - ny;
    if (ox * ox + oy * oy >= r * r) continue;
    if (dx > 0) { p.x = w.x - r; p.vx = 0; }
    else if (dx < 0) { p.x = w.x + w.w + r; p.vx = 0; }
    else if (dy > 0) { p.y = w.y - r; p.vy = 0; }
    else if (dy < 0) { p.y = w.y + w.h + r; p.vy = 0; }
  }
}

export function circleHitsWalls(x, y, r, walls) {
  for (const w of walls) {
    const nx = clamp(x, w.x, w.x + w.w);
    const ny = clamp(y, w.y, w.y + w.h);
    if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
  }
  return false;
}

// ------------------------------------------------------------
// Raycasts
// ------------------------------------------------------------

// Ray vs axis-aligned rects (slab method). dx,dy must be normalized.
// Returns { d, nx, ny } — hit distance (or maxDist) and surface normal.
export function raycastWalls(x, y, dx, dy, maxDist, walls) {
  let best = maxDist, bnx = 0, bny = 0;
  const invx = 1 / (dx || 1e-9), invy = 1 / (dy || 1e-9);
  for (const w of walls) {
    let t1 = (w.x - x) * invx, t2 = (w.x + w.w - x) * invx;
    let nx = -1;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; nx = 1; }
    let t3 = (w.y - y) * invy, t4 = (w.y + w.h - y) * invy;
    let ny = -1;
    if (t3 > t4) { const t = t3; t3 = t4; t4 = t; ny = 1; }
    const tmin = Math.max(t1, t3);
    const tmax = Math.min(t2, t4);
    if (tmax < 0 || tmin > tmax || tmin >= best || tmin < 0) continue;
    best = tmin;
    if (t1 > t3) { bnx = nx; bny = 0; } else { bnx = 0; bny = ny; }
  }
  return { d: best, nx: bnx, ny: bny };
}

// Distance along ray (origin + t*dir) where it first enters circle, or Infinity.
export function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx, fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c > 0 && b > 0) return Infinity;       // outside, pointing away
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t < 0 ? 0 : t;
}

export function hasLOS(x1, y1, x2, y2, walls) {
  const d = Math.hypot(x2 - x1, y2 - y1);
  if (d < 1e-6) return true;
  const hit = raycastWalls(x1, y1, (x2 - x1) / d, (y2 - y1) / d, d, walls);
  return hit.d >= d - 0.5;
}
