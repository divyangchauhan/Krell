// ============================================================
// KRELL — bot AI: tile-grid BFS nav + objective play + combat
// ============================================================

import { TEAM, PHASE, KEY, BTN, NADE, PLAYER_RADIUS } from '../public/shared/const.js';
import { dist, dist2, hasLOS, clamp, angleLerp } from '../public/shared/util.js';
import { WEAPONS } from '../public/shared/weapons.js';
import {
  WALLS, COLS, ROWS, TILE, isWalkableTile, tileOf, SITES, siteAt, MAP_W, MAP_H,
} from '../public/shared/map.js';

export const BOT_NAMES = [
  'ALTAIR', 'MORBIUS', 'ROBBY', 'QUORRA', 'VEX-9', 'NYX',
  'THAL-7', 'ZIRCON', 'KRUG', 'SABLE', 'OSSIA', 'DRAVEN',
];

// precompute list of walkable tiles for random wander goals
const FLOOR_TILES = [];
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) {
    if (isWalkableTile(c, r)) FLOOR_TILES.push([c, r]);
  }
}

function bfsPath(from, to) {
  const key = (c, r) => r * COLS + c;
  if (!isWalkableTile(to[0], to[1]) || !isWalkableTile(from[0], from[1])) return null;
  const prev = new Map([[key(from[0], from[1]), null]]);
  let frontier = [from];
  while (frontier.length) {
    const next = [];
    for (const [c, r] of frontier) {
      if (c === to[0] && r === to[1]) {
        const path = [];
        let k = key(c, r);
        let cur = [c, r];
        while (cur) {
          path.unshift(cur);
          cur = prev.get(k);
          if (cur) k = key(cur[0], cur[1]);
        }
        return path;
      }
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr;
        const nk = key(nc, nr);
        if (prev.has(nk) || !isWalkableTile(nc, nr)) continue;
        prev.set(nk, [c, r]);
        next.push([nc, nr]);
      }
    }
    frontier = next;
  }
  return null;
}

const center = ([c, r]) => ({ x: (c + 0.5) * TILE, y: (r + 0.5) * TILE });

// LOS with body width — three parallel rays so bots don't clip corners
function clearPath(x1, y1, x2, y2) {
  const d = dist(x1, y1, x2, y2);
  if (d < 1) return true;
  const px = -(y2 - y1) / d, py = (x2 - x1) / d;
  const m = PLAYER_RADIUS * 0.9;
  return (
    hasLOS(x1, y1, x2, y2, WALLS) &&
    hasLOS(x1 + px * m, y1 + py * m, x2 + px * m, y2 + py * m, WALLS) &&
    hasLOS(x1 - px * m, y1 - py * m, x2 - px * m, y2 - py * m, WALLS)
  );
}

export class Bot {
  constructor(player, game) {
    this.p = player;
    this.game = game;
    this.skill = 0.65 + Math.random() * 0.35;    // per-bot flavor
    this.path = [];
    this.goal = null;                            // {x, y}
    this.nextThink = 0;
    this.nextRepath = 0;
    this.target = null;
    this.spottedAt = 0;
    this.engageStart = 0;
    this.aimAngle = 0;
    this.burstUntil = 0;
    this.burstRestUntil = 0;
    this.strafeDir = 1;
    this.strafeFlip = 0;
    this.holdSpot = null;
    this.stuckCheck = { x: 0, y: 0, at: 0 };
    this.assignedSite = 'A';
    this.boughtThisRound = false;
    this.nadeAt = 0;
  }

  onSpawn() {
    this.path = [];
    this.goal = null;
    this.target = null;
    this.holdSpot = null;
    this.aimAngle = this.p.angle;
  }

  onRoundStart() {
    this.boughtThisRound = false;
    this.assignedSite = Math.random() < 0.5 ? 'A' : 'B';
    this.onSpawn();
  }

  onHurt(attacker) {
    // snap attention toward whoever shot us
    if (attacker && attacker.alive && !this.target) {
      this.target = attacker;
      this.spottedAt = this.game.now() + this.reactionMs() * 0.6;
      this.engageStart = this.game.now();
    }
  }

  reactionMs() { return 420 - this.skill * 220; }

  buy() {
    const g = this.game;
    const p = this.p;
    if (p.armor < 50 && p.money >= 1700 + 650) g.tryBuy(p, 'armor');
    if (!p.inv.primary || p.inv.primary === 'smg') {
      if (p.money >= 4750 && Math.random() < 0.18) g.tryBuy(p, 'sniper');
      else if (p.money >= 2700) g.tryBuy(p, 'rifle');
      else if (p.money >= 1250 && !p.inv.primary) g.tryBuy(p, 'smg');
    }
    if (p.armor < 100 && p.money >= 650) g.tryBuy(p, 'armor');
    if (p.inv.nades < 1 && p.money >= 800) g.tryBuy(p, 'nade');
    if (p.money >= 300) g.tryBuy(p, 'ammo');
  }

  // ---------------------------------------------------------- perception

  acquireTarget() {
    const g = this.game;
    const p = this.p;
    let best = null, bestD = Infinity;
    for (const q of g.players.values()) {
      if (q.team === p.team || !q.alive) continue;
      const d = dist(p.x, p.y, q.x, q.y);
      if (d > 1250 || d >= bestD) continue;
      if (!hasLOS(p.x, p.y, q.x, q.y, WALLS)) continue;
      best = q; bestD = d;
    }
    if (best && this.target !== best) {
      this.spottedAt = g.now() + this.reactionMs();
      this.engageStart = g.now();
    }
    if (!best) this.target = null;
    else this.target = best;
  }

  // ---------------------------------------------------------- navigation

  setGoal(x, y) {
    if (this.goal && dist2(this.goal.x, this.goal.y, x, y) < TILE * TILE) return;
    this.goal = { x, y };
    this.nextRepath = 0;
  }

  repath() {
    const p = this.p;
    if (!this.goal) { this.path = []; return; }
    const path = bfsPath(tileOf(p.x, p.y), tileOf(this.goal.x, this.goal.y));
    this.path = path ? path.map(center) : [];
    if (this.path.length) this.path[this.path.length - 1] = { ...this.goal };
  }

  nextWaypoint() {
    const p = this.p;
    // drop reached nodes; skip ahead while we have clear line
    while (this.path.length && dist2(p.x, p.y, this.path[0].x, this.path[0].y) < 30 * 30) this.path.shift();
    while (this.path.length > 1 && clearPath(p.x, p.y, this.path[1].x, this.path[1].y)) this.path.shift();
    return this.path[0] || null;
  }

  // ---------------------------------------------------------- objectives

  chooseObjective() {
    const g = this.game;
    const p = this.p;
    const b = g.bomb;
    const now = g.now();

    if (g.phase === PHASE.WARMUP) {
      if (!this.goal || dist2(p.x, p.y, this.goal.x, this.goal.y) < 80 * 80) {
        const t = FLOOR_TILES[Math.floor(Math.random() * FLOOR_TILES.length)];
        this.setGoal(...Object.values(center(t)));
      }
      return;
    }

    if (p.team === TEAM.KRELL) {
      const iAmCarrier = b.state === 'carried' && b.carrier === p.id;
      if (b.state === 'planted') {
        // guard the charge from outside the blast radius
        if (!this.holdSpot) this.holdSpot = this.spotNear(b.x, b.y, 560, 380);
        this.setGoal(this.holdSpot.x, this.holdSpot.y);
      } else if (b.state === 'dropped') {
        this.setGoal(b.x, b.y);
      } else if (iAmCarrier) {
        const site = SITES[this.assignedSite];
        this.setGoal(site.cx, site.cy);
      } else if (b.state === 'carried') {
        // escort: bias toward the carrier's site, spread a bit
        const carrier = g.players.get(b.carrier);
        const site = SITES[carrier && carrier.bot ? carrier.bot.assignedSite : this.assignedSite];
        if (!this.holdSpot || now > (this.holdRefresh || 0)) {
          this.holdSpot = this.spotNear(site.cx, site.cy, 300);
          this.holdRefresh = now + 6000;
        }
        this.setGoal(this.holdSpot.x, this.holdSpot.y);
      } else {
        const site = SITES[this.assignedSite];
        this.setGoal(site.cx, site.cy);
      }
    } else {
      // WARDEN
      if (b.state === 'planted') {
        this.setGoal(b.x, b.y);
      } else {
        const site = SITES[this.assignedSite];
        if (!this.holdSpot) this.holdSpot = this.spotNear(site.cx, site.cy, 220);
        this.setGoal(this.holdSpot.x, this.holdSpot.y);
        // late round with no contact: start hunting
        if (g.phaseEnd && g.phaseEnd - now < 30000 && b.state === 'dropped') this.setGoal(b.x, b.y);
      }
    }
  }

  spotNear(x, y, radius, minRadius = 0) {
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = minRadius + Math.random() * (radius - minRadius);
      const tx = clamp(x + Math.cos(a) * r, TILE, MAP_W - TILE);
      const ty = clamp(y + Math.sin(a) * r, TILE, MAP_H - TILE);
      const [c, rr] = tileOf(tx, ty);
      if (isWalkableTile(c, rr)) return { x: tx, y: ty };
    }
    return { x, y };
  }

  // ---------------------------------------------------------- frame input

  tickInput(dt) {
    const g = this.game;
    const p = this.p;
    const now = g.now();
    let keys = 0, buttons = 0;

    if (g.phase === PHASE.FREEZE && !this.boughtThisRound) {
      this.boughtThisRound = true;
      this.buy();
    }
    if (g.phase === PHASE.WARMUP && !p.inv.primary && p.money > 3000 && Math.random() < 0.02) {
      this.buy();
    }

    if (now >= this.nextThink) {
      this.nextThink = now + 100;
      this.acquireTarget();
      this.chooseObjective();
      if (now >= this.nextRepath) {
        this.nextRepath = now + 900 + Math.random() * 400;
        this.repath();
      }
      // stuck detection
      if (now - this.stuckCheck.at > 1200) {
        if (g.phase === PHASE.LIVE && dist2(p.x, p.y, this.stuckCheck.x, this.stuckCheck.y) < 25 * 25 && !this.planting && !this.target) {
          this.nextRepath = 0;
          this.holdSpot = null;
        }
        this.stuckCheck = { x: p.x, y: p.y, at: now };
      }
    }

    const b = g.bomb;
    const iAmCarrier = b.state === 'carried' && b.carrier === p.id;
    const onSite = siteAt(p.x, p.y);
    this.planting = false;

    // ---- plant / defuse take precedence over everything else
    if (g.phase === PHASE.LIVE && p.team === TEAM.KRELL && iAmCarrier && onSite && !this.target) {
      this.planting = true;
      buttons |= BTN.USE;
      return { keys: 0, aim: this.aimAngle, buttons };
    }
    if (g.phase === PHASE.LIVE && p.team === TEAM.WARDEN && b.state === 'planted' &&
        dist(p.x, p.y, b.x, b.y) < 60 && (!this.target || p.defuseProgress > 0.5)) {
      this.planting = true;
      buttons |= BTN.USE;
      return { keys: 0, aim: this.aimAngle, buttons };
    }

    // ---- combat
    if (this.target && this.target.alive) {
      const q = this.target;
      const d = dist(p.x, p.y, q.x, q.y);
      const w = p.weapon();
      // aim with decaying error
      const engaged = clamp((now - this.engageStart) / 1500, 0, 1);
      const err = (1 - this.skill * 0.6) * (1 - engaged * 0.8) * 0.28;
      const trueAngle = Math.atan2(q.y - p.y, q.x - p.x);
      const wobble = Math.sin(now / 90 + p.id * 7) * err;
      this.aimAngle = angleLerp(this.aimAngle, trueAngle + wobble, 1 - Math.exp(-(6 + this.skill * 6) * dt));

      // pick weapon for range
      if (p.inv.primary && p.slot !== 1) g.setSlot(p, 1);
      else if (!p.inv.primary && p.slot !== 2) g.setSlot(p, 2);

      // fire discipline: bursts with rests, only after reaction time
      if (now > this.spottedAt && d < w.range * 0.95 && hasLOS(p.x, p.y, q.x, q.y, WALLS)) {
        if (now > this.burstRestUntil) {
          if (!this.burstUntil || now > this.burstUntil) {
            this.burstUntil = now + (w.auto ? 260 + Math.random() * 240 : w.fireDelay);
            this.burstRestUntil = this.burstUntil + 180 + Math.random() * 260 + (1 - this.skill) * 200;
          }
          if (now < this.burstUntil) {
            const aimedOff = Math.abs(normA(this.aimAngle - trueAngle));
            if (aimedOff < 0.22) buttons |= BTN.FIRE;
          }
        }
      }

      // toss a grenade at clumps occasionally
      if (p.inv.nades > 0 && now > this.nadeAt && d > 300 && d < 700 && Math.random() < 0.01) {
        buttons |= BTN.NADE;
        this.nadeAt = now + 5000;
      }

      // movement in combat: snipers/rifles plant feet, smg strafes
      if (now > this.strafeFlip) {
        this.strafeFlip = now + 400 + Math.random() * 600;
        this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        this.standStill = w.id === 'sniper' || (w.id === 'rifle' && Math.random() < 0.55);
      }
      if (!this.standStill && d > 120) {
        const sx = Math.cos(trueAngle + Math.PI / 2) * this.strafeDir;
        const sy = Math.sin(trueAngle + Math.PI / 2) * this.strafeDir;
        keys = dirToKeys(sx, sy);
      } else if (d < 90 && w.id !== 'knife') {
        // back off point blank
        keys = dirToKeys(-Math.cos(trueAngle), -Math.sin(trueAngle));
      }

      // reload when safe-ish
      const ammo = p.ammo[w.id];
      if (ammo && ammo.mag === 0) buttons |= BTN.RELOAD;
      return { keys, aim: this.aimAngle, buttons };
    }

    // ---- no target: top up mag while moving
    const w = p.weapon();
    const ammo = p.ammo[w.id];
    if (ammo && ammo.mag < w.mag * 0.4 && ammo.res > 0 && !p.reloadEnd) buttons |= BTN.RELOAD;
    if (p.inv.primary && p.slot !== 1) g.setSlot(p, 1);

    // ---- navigate
    const frozen = g.phase === PHASE.FREEZE || g.phase === PHASE.STARTING || g.phase === PHASE.POST || g.phase === PHASE.OVER;
    if (!frozen) {
      const wp = this.nextWaypoint();
      if (wp) {
        const dx = wp.x - p.x, dy = wp.y - p.y;
        keys = dirToKeys(dx, dy);
        const moveAngle = Math.atan2(dy, dx);
        this.aimAngle = angleLerp(this.aimAngle, moveAngle, 1 - Math.exp(-8 * dt));
      } else if (this.holdSpot) {
        // at hold spot: face the nearest approach (toward map center as a cheap heuristic)
        const fa = Math.atan2(MAP_H / 2 - p.y, MAP_W / 2 - p.x);
        this.aimAngle = angleLerp(this.aimAngle, fa, 1 - Math.exp(-2 * dt));
      }
    }
    return { keys, aim: this.aimAngle, buttons };
  }
}

function dirToKeys(dx, dy) {
  // normalize against magnitude so diagonals trigger sensibly
  const m = Math.hypot(dx, dy) || 1;
  let keys = 0;
  if (dx / m > 0.38) keys |= KEY.RIGHT;
  if (dx / m < -0.38) keys |= KEY.LEFT;
  if (dy / m > 0.38) keys |= KEY.DOWN;
  if (dy / m < -0.38) keys |= KEY.UP;
  return keys;
}

function normA(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
