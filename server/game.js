// ============================================================
// KRELL — authoritative game server: one room, 30Hz simulation
// ============================================================

import {
  TICK_RATE, TICK_MS, PLAYER_RADIUS, VISION_DIST, MAX_PLAYERS, TEAM_SIZE_FILL,
  WIN_ROUNDS, TEAM, PHASE, TIMING, ECON, KEY, BTN, NADE, ARMOR,
} from '../public/shared/const.js';
import {
  clamp, dist, dist2, hasLOS, raycastWalls, rayCircle, stepPlayer, moveAxis,
} from '../public/shared/util.js';
import { WEAPONS, GEAR_PRICES, weaponSpread, weaponDamage } from '../public/shared/weapons.js';
import {
  WALLS, MAP_W, MAP_H, SITES, BUY_ZONES, inRect, siteAt, spawnPoints, validateMap,
} from '../public/shared/map.js';
import { Bot, BOT_NAMES } from './bot.js';

const HISTORY_TICKS = 20;     // ~660ms of position history for lag compensation
const REWIND_TICKS = 3;       // ≈ client interpolation delay (100ms)

let nextEntityId = 1;

export class Player {
  constructor(ws, name, team, isBot = false) {
    this.id = nextEntityId++;
    this.ws = ws;                 // null for bots
    this.bot = isBot ? null : undefined; // Bot controller attached after construction
    this.isBot = isBot;
    this.name = name;
    this.team = team;
    this.alive = false;
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.angle = 0;
    this.hp = 100;
    this.armor = 0;
    this.money = ECON.start;
    this.kills = 0;
    this.deaths = 0;
    this.ping = 0;
    this.slot = 2;
    this.inv = { primary: null, nades: 0 };
    this.ammo = {};               // weaponId -> { mag, res }
    this.heat = 0;                // accumulated recoil spread
    this.nextFireAt = 0;
    this.reloadEnd = 0;           // 0 = not reloading
    this.lastSeq = 0;
    this.inputs = [];             // queued client inputs
    this.prevButtons = 0;
    this.useHeld = false;
    this.plantProgress = 0;       // 0..1
    this.defuseProgress = 0;
    this.history = [];            // ring of {x, y, alive}
    this.respawnAt = 0;           // warmup respawn timer
    this.diedAt = 0;
    this.lastDamageFrom = null;   // {x, y} for client damage direction
    this.joinedMidRound = false;
  }

  weapon() {
    if (this.slot === 1 && this.inv.primary) return WEAPONS[this.inv.primary];
    if (this.slot === 3) return WEAPONS.knife;
    return WEAPONS.pistol;
  }

  giveDefaultLoadout() {
    this.ammo.pistol = { mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve };
    this.slot = 2;
  }

  resetForRound() {
    this.alive = true;
    this.hp = 100;
    this.vx = 0; this.vy = 0;
    this.heat = 0;
    this.reloadEnd = 0;
    this.nextFireAt = 0;
    this.plantProgress = 0;
    this.defuseProgress = 0;
    this.joinedMidRound = false;
    if (!this.inv.primary && !this.ammo.pistol) this.giveDefaultLoadout();
    if (!this.ammo.pistol) this.ammo.pistol = { mag: WEAPONS.pistol.mag, res: WEAPONS.pistol.reserve };
  }

  stripLoadout() {
    this.inv = { primary: null, nades: 0 };
    this.ammo = {};
    this.armor = 0;
    this.giveDefaultLoadout();
  }

  send(msg) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));
  }
}

export class Game {
  constructor() {
    const info = validateMap();
    console.log(`[map] SITE-9 ok — ${info.floorCount} floor tiles, ${info.walls} wall rects`);
    this.players = new Map();     // id -> Player
    this.phase = PHASE.WARMUP;
    this.phaseEnd = 0;            // Date.now() ms when phase auto-advances (0 = none)
    this.round = 0;
    this.scores = { [TEAM.KRELL]: 0, [TEAM.WARDEN]: 0 };
    this.lossStreak = { [TEAM.KRELL]: 0, [TEAM.WARDEN]: 0 };
    this.bomb = { state: 'none', carrier: 0, x: 0, y: 0, plantedAt: 0, site: null, defuser: 0 };
    this.nades = [];              // live grenade projectiles
    this.events = [];             // flushed into every snapshot each tick
    this.tick = 0;
    this.rosterDirty = true;
    this.lastRosterAt = 0;
    setInterval(() => this.step(), TICK_MS);
  }

  // ---------------------------------------------------------- helpers

  now() { return Date.now(); }

  emit(...ev) { this.events.push(ev); }

  humans() { return [...this.players.values()].filter((p) => !p.isBot); }
  bots() { return [...this.players.values()].filter((p) => p.isBot); }
  teamPlayers(team) { return [...this.players.values()].filter((p) => p.team === team); }
  aliveTeam(team) { return this.teamPlayers(team).filter((p) => p.alive); }

  broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws && p.ws.readyState === 1) p.ws.send(s);
    }
  }

  // ---------------------------------------------------------- join / leave

  addHuman(ws, name) {
    if (this.humans().length >= MAX_PLAYERS) {
      ws.send(JSON.stringify({ t: 'full' }));
      ws.close();
      return null;
    }
    const team = this.pickTeam();
    // a bot on that team gives up its seat
    const seat = this.bots().find((b) => b.team === team);
    if (seat) this.removePlayer(seat.id, true);

    const p = new Player(ws, name, team);
    p.money = this.phase === PHASE.WARMUP ? ECON.warmup : ECON.start;
    p.giveDefaultLoadout();
    this.players.set(p.id, p);

    if (this.phase === PHASE.WARMUP || this.phase === PHASE.STARTING || this.phase === PHASE.FREEZE) {
      this.spawn(p);
    } else {
      p.alive = false;
      p.joinedMidRound = true;
    }

    p.send({
      t: 'hello',
      id: p.id,
      team: p.team,
      phase: this.phase,
      scores: [this.scores[0], this.scores[1]],
      round: this.round,
    });
    this.emit('join', p.id);
    this.rosterDirty = true;
    this.maybeStartMatch();
    this.fillBots();
    console.log(`[join] ${name} -> ${team === TEAM.KRELL ? 'KRELL' : 'WARDENS'} (${this.players.size} in game)`);
    return p;
  }

  pickTeam() {
    const hk = this.humans().filter((p) => p.team === TEAM.KRELL).length;
    const hw = this.humans().filter((p) => p.team === TEAM.WARDEN).length;
    if (hk !== hw) return hk < hw ? TEAM.KRELL : TEAM.WARDEN;
    const k = this.teamPlayers(TEAM.KRELL).length;
    const w = this.teamPlayers(TEAM.WARDEN).length;
    if (k !== w) return k < w ? TEAM.KRELL : TEAM.WARDEN;
    return Math.random() < 0.5 ? TEAM.KRELL : TEAM.WARDEN;
  }

  removePlayer(id, silent = false) {
    const p = this.players.get(id);
    if (!p) return;
    if (this.bomb.carrier === id && this.bomb.state === 'carried') {
      this.dropBomb(p.x, p.y);
    }
    if (this.bomb.defuser === id) this.bomb.defuser = 0;
    this.players.delete(id);
    if (!silent) this.emit('leave', p.id);
    this.rosterDirty = true;
    if (!p.isBot) {
      console.log(`[leave] ${p.name}`);
      this.fillBots();
      if (this.humans().length === 0) this.toWarmup();
    }
  }

  fillBots() {
    // keep each team at TEAM_SIZE_FILL while humans are short; trim extras
    for (const team of [TEAM.KRELL, TEAM.WARDEN]) {
      let members = this.teamPlayers(team);
      while (members.length < TEAM_SIZE_FILL && this.players.size < MAX_PLAYERS) {
        this.addBot(team);
        members = this.teamPlayers(team);
      }
      let botMembers = members.filter((p) => p.isBot);
      while (members.length > TEAM_SIZE_FILL && botMembers.length > 0) {
        this.removePlayer(botMembers.pop().id);
        members = this.teamPlayers(team);
        botMembers = members.filter((p) => p.isBot);
      }
    }
  }

  addBot(team) {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const name = BOT_NAMES.find((n) => !used.has(n)) || `UNIT-${nextEntityId}`;
    const p = new Player(null, name, team, true);
    p.money = this.phase === PHASE.WARMUP ? ECON.warmup : ECON.start;
    p.giveDefaultLoadout();
    p.bot = new Bot(p, this);
    this.players.set(p.id, p);
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.POST) this.spawn(p);
    this.rosterDirty = true;
  }

  // ---------------------------------------------------------- spawning

  spawn(p) {
    const pts = spawnPoints(p.team);
    const taken = [...this.players.values()].filter((q) => q.alive && q !== p);
    let best = pts[Math.floor(Math.random() * pts.length)];
    for (const pt of [...pts].sort(() => Math.random() - 0.5)) {
      if (!taken.some((q) => dist2(q.x, q.y, pt.x, pt.y) < 40 * 40)) { best = pt; break; }
    }
    p.x = best.x; p.y = best.y;
    p.resetForRound();
    if (p.bot) p.bot.onSpawn();
  }

  // ---------------------------------------------------------- match flow

  maybeStartMatch() {
    if (this.phase === PHASE.WARMUP && this.humans().length >= 1) {
      this.phase = PHASE.STARTING;
      this.phaseEnd = this.now() + TIMING.starting;
      this.emit('phase', this.phase);
    }
  }

  toWarmup() {
    this.phase = PHASE.WARMUP;
    this.phaseEnd = 0;
    this.round = 0;
    this.scores = { 0: 0, 1: 0 };
    this.lossStreak = { 0: 0, 1: 0 };
    this.bomb = { state: 'none', carrier: 0, x: 0, y: 0, plantedAt: 0, site: null, defuser: 0 };
    this.nades = [];
    for (const p of this.players.values()) {
      p.money = ECON.warmup;
      p.stripLoadout();
      this.spawn(p);
    }
    this.emit('phase', this.phase);
    this.rosterDirty = true;
  }

  startMatch() {
    this.round = 0;
    this.scores = { 0: 0, 1: 0 };
    this.lossStreak = { 0: 0, 1: 0 };
    for (const p of this.players.values()) {
      p.money = ECON.start;
      p.kills = 0; p.deaths = 0;
      p.stripLoadout();
    }
    this.rosterDirty = true;
    this.startRound();
  }

  startRound() {
    this.round++;
    this.phase = PHASE.FREEZE;
    this.phaseEnd = this.now() + TIMING.freeze;
    this.nades = [];
    this.bomb = { state: 'carried', carrier: 0, x: 0, y: 0, plantedAt: 0, site: null, defuser: 0 };
    for (const p of this.players.values()) this.spawn(p);
    const krell = this.aliveTeam(TEAM.KRELL);
    if (krell.length) {
      const carrier = krell[Math.floor(Math.random() * krell.length)];
      this.bomb.carrier = carrier.id;
    } else {
      this.bomb.state = 'none';
    }
    for (const p of this.players.values()) {
      if (p.bot) p.bot.onRoundStart();
    }
    this.emit('round_start', this.round);
    this.emit('phase', this.phase);
    this.rosterDirty = true;
  }

  endRound(winner, reason) {
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.FREEZE) return;
    this.phase = PHASE.POST;
    this.phaseEnd = this.now() + TIMING.post;
    this.scores[winner]++;
    const loser = winner === TEAM.KRELL ? TEAM.WARDEN : TEAM.KRELL;
    this.lossStreak[winner] = 0;
    this.lossStreak[loser] = Math.min(this.lossStreak[loser] + 1, 4);
    const lossBonus = Math.min(ECON.lossBase + (this.lossStreak[loser] - 1) * ECON.lossStep, ECON.lossMax);
    for (const p of this.players.values()) {
      p.money = clamp(p.money + (p.team === winner ? ECON.win : lossBonus), 0, ECON.max);
    }
    this.emit('round_end', winner, reason, this.scores[0], this.scores[1]);
    this.rosterDirty = true;
    if (this.scores[winner] >= WIN_ROUNDS) {
      this.phase = PHASE.OVER;
      this.phaseEnd = this.now() + TIMING.over;
      this.emit('game_over', winner, this.scores[0], this.scores[1]);
    }
  }

  advancePhase() {
    switch (this.phase) {
      case PHASE.STARTING:
        this.startMatch();
        break;
      case PHASE.FREEZE:
        this.phase = PHASE.LIVE;
        this.phaseEnd = this.now() + TIMING.live;
        this.emit('phase', this.phase);
        break;
      case PHASE.LIVE:
        // time ran out; planted bomb extends the round past the clock
        if (this.bomb.state !== 'planted') this.endRound(TEAM.WARDEN, 'time');
        else this.phaseEnd = this.bomb.plantedAt + TIMING.bomb + 1000;
        break;
      case PHASE.POST: {
        // players that died during the round lose their gear
        for (const p of this.players.values()) {
          if (!p.alive) { p.stripLoadout(); }
        }
        this.startRound();
        break;
      }
      case PHASE.OVER:
        this.startMatch();
        break;
    }
  }

  // ---------------------------------------------------------- input

  queueInput(p, batch) {
    for (const i of batch) {
      // [seq, dtMs, keys, aim, buttons]
      if (!Array.isArray(i) || i.length < 5) continue;
      p.inputs.push(i);
    }
    if (p.inputs.length > 60) p.inputs.splice(0, p.inputs.length - 60);
  }

  processInput(p, seq, dtMs, keys, aim, buttons) {
    if (seq <= p.lastSeq) return;
    p.lastSeq = seq;
    const dt = clamp(dtMs, 1, 50) / 1000;
    p.angle = typeof aim === 'number' && isFinite(aim) ? aim : p.angle;
    if (!p.alive) return;

    const frozen = this.phase === PHASE.FREEZE || this.phase === PHASE.STARTING || this.phase === PHASE.OVER;
    const acting = this.updateUse(p, buttons, dt);  // planting/defusing roots you in place

    if (!frozen && !acting) {
      stepPlayer(p, keys, buttons, dt, WALLS, p.weapon().speed);
      p.x = clamp(p.x, PLAYER_RADIUS, MAP_W - PLAYER_RADIUS);
      p.y = clamp(p.y, PLAYER_RADIUS, MAP_H - PLAYER_RADIUS);
    } else {
      p.vx = 0; p.vy = 0;
    }

    const pressed = buttons & ~p.prevButtons;
    p.prevButtons = buttons;

    if (!frozen) {
      if (buttons & BTN.FIRE) this.tryFire(p, (pressed & BTN.FIRE) !== 0);
      if (pressed & BTN.RELOAD) this.tryReload(p);
      if (pressed & BTN.NADE) this.throwNade(p);
    }
    this.finishReload(p);
    const decay = p.weapon().spreadDecay || 0.25;
    p.heat = Math.max(0, p.heat - decay * dt);
  }

  setSlot(p, slot) {
    if (!p.alive) return;
    if (slot === 1 && !p.inv.primary) return;
    if (slot === 4) return; // grenades throw via G, not a held slot
    if (slot !== p.slot && [1, 2, 3].includes(slot)) {
      p.slot = slot;
      p.reloadEnd = 0;
      p.nextFireAt = Math.max(p.nextFireAt, this.now() + 120); // draw time
    }
  }

  // ---------------------------------------------------------- combat

  tryFire(p, isPress) {
    const w = p.weapon();
    const now = this.now();
    if (now < p.nextFireAt) return;
    if (!w.auto && !isPress) return;
    if (p.reloadEnd) return;

    if (w.melee) {
      p.nextFireAt = now + w.fireDelay;
      this.emit('swing', p.id, +p.x.toFixed(1), +p.y.toFixed(1), +p.angle.toFixed(3));
      this.meleeHit(p, w);
      return;
    }

    const ammo = p.ammo[w.id];
    if (!ammo || ammo.mag <= 0) {
      if (isPress) {
        this.emit('dry', p.id);
        this.tryReload(p);
      }
      return;
    }

    ammo.mag--;
    p.nextFireAt = now + w.fireDelay;
    const speed = Math.hypot(p.vx, p.vy);
    const spread = weaponSpread(w, speed, p.heat);
    p.heat = Math.min(p.heat + w.spreadKick, 0.25);

    const pellets = w.pellets || 1;
    const rewound = this.rewoundPositions(p);
    for (let i = 0; i < pellets; i++) {
      const a = p.angle + (Math.random() * 2 - 1) * spread;
      this.fireRay(p, w, a, rewound);
    }
    if (ammo.mag === 0) this.tryReload(p);
  }

  rewoundPositions(shooter) {
    // lag compensation: test hits against where targets were ~100ms ago
    const out = new Map();
    for (const q of this.players.values()) {
      if (q === shooter || !q.alive || q.team === shooter.team) continue;
      const h = q.history.length >= REWIND_TICKS ? q.history[q.history.length - REWIND_TICKS] : null;
      out.set(q.id, h && h.alive ? { x: h.x, y: h.y } : { x: q.x, y: q.y });
    }
    return out;
  }

  fireRay(p, w, angle, rewound) {
    const dx = Math.cos(angle), dy = Math.sin(angle);
    const wallHit = raycastWalls(p.x, p.y, dx, dy, w.range, WALLS);
    let bestD = wallHit.d;
    let victim = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team) continue;
      const pos = rewound.get(q.id) || { x: q.x, y: q.y };
      const t = rayCircle(p.x, p.y, dx, dy, pos.x, pos.y, PLAYER_RADIUS);
      if (t < bestD) { bestD = t; victim = q; }
    }
    const hx = p.x + dx * bestD, hy = p.y + dy * bestD;
    this.emit('shot', p.id, w.id, +p.x.toFixed(1), +p.y.toFixed(1), +hx.toFixed(1), +hy.toFixed(1), victim ? 1 : 0);
    if (victim) {
      this.damage(victim, weaponDamage(w, bestD), p, w.id);
    } else if (bestD < w.range) {
      this.emit('impact', +hx.toFixed(1), +hy.toFixed(1), wallHit.nx, wallHit.ny);
    }
  }

  meleeHit(p, w) {
    let best = null, bestD = Infinity;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || q.team === p.team) continue;
      const d = dist(p.x, p.y, q.x, q.y);
      if (d > w.range + PLAYER_RADIUS) continue;
      const da = Math.abs(normAngle(Math.atan2(q.y - p.y, q.x - p.x) - p.angle));
      if (da > w.arc / 2) continue;
      if (!hasLOS(p.x, p.y, q.x, q.y, WALLS)) continue;
      if (d < bestD) { bestD = d; best = q; }
    }
    if (best) this.damage(best, w.dmg, p, w.id);
  }

  damage(victim, rawDmg, attacker, weaponId) {
    if (!victim.alive) return;
    let dmg = rawDmg;
    if (victim.armor > 0) {
      const absorbed = Math.min(victim.armor, dmg * ARMOR.absorb);
      victim.armor = Math.round(victim.armor - absorbed);
      dmg -= absorbed;
    }
    dmg = Math.max(1, Math.round(dmg));
    victim.hp -= dmg;
    victim.lastDamageFrom = attacker ? { x: attacker.x, y: attacker.y } : null;
    // taking damage interrupts plant/defuse
    victim.plantProgress = 0;
    if (this.bomb.defuser === victim.id) { this.bomb.defuser = 0; victim.defuseProgress = 0; }
    this.emit('hurt', victim.id, dmg, attacker ? attacker.id : 0,
      attacker ? +attacker.x.toFixed(0) : 0, attacker ? +attacker.y.toFixed(0) : 0);
    if (victim.bot) victim.bot.onHurt(attacker);
    if (victim.hp <= 0) this.kill(victim, attacker, weaponId);
  }

  kill(victim, attacker, weaponId) {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.diedAt = this.now();
    victim.plantProgress = 0;
    victim.defuseProgress = 0;
    if (this.bomb.defuser === victim.id) this.bomb.defuser = 0;
    let kid = 0;
    let reward = 0;
    if (attacker && attacker !== victim) {
      attacker.kills++;
      kid = attacker.id;
      reward = (WEAPONS[weaponId] && WEAPONS[weaponId].killReward) || 300;
      if (this.phase !== PHASE.WARMUP) attacker.money = clamp(attacker.money + reward, 0, ECON.max);
      else reward = 0;
    }
    if (this.bomb.state === 'carried' && this.bomb.carrier === victim.id) {
      this.dropBomb(victim.x, victim.y);
    }
    this.emit('die', victim.id, kid, weaponId, +victim.x.toFixed(0), +victim.y.toFixed(0), reward);
    this.rosterDirty = true;

    if (this.phase === PHASE.WARMUP) {
      victim.respawnAt = this.now() + TIMING.respawnWarmup;
    } else if (this.phase === PHASE.LIVE) {
      this.checkElimination();
    }
  }

  checkElimination() {
    const k = this.aliveTeam(TEAM.KRELL).length;
    const w = this.aliveTeam(TEAM.WARDEN).length;
    if (w === 0 && this.bomb.state !== 'planted') this.endRound(TEAM.KRELL, 'elimination');
    else if (w === 0 && this.bomb.state === 'planted') { /* bomb decides it */ }
    else if (k === 0 && this.bomb.state !== 'planted') this.endRound(TEAM.WARDEN, 'elimination');
    // if bomb is planted and Krell are all dead, Wardens still must defuse
  }

  // ---------------------------------------------------------- reload / buy

  tryReload(p) {
    const w = p.weapon();
    if (w.melee || p.reloadEnd) return;
    const ammo = p.ammo[w.id];
    if (!ammo || ammo.mag >= w.mag || ammo.res <= 0) return;
    p.reloadEnd = this.now() + w.reloadMs;
    this.emit('reload', p.id, w.id);
  }

  finishReload(p) {
    if (!p.reloadEnd || this.now() < p.reloadEnd) return;
    const w = p.weapon();
    const ammo = p.ammo[w.id];
    if (ammo) {
      const need = w.mag - ammo.mag;
      const take = Math.min(need, ammo.res);
      ammo.mag += take;
      ammo.res -= take;
    }
    p.reloadEnd = 0;
  }

  tryBuy(p, itemId) {
    const fail = (why) => p.send({ t: 'buyfail', why });
    if (!p.alive) return fail('dead');
    const inWindow =
      this.phase === PHASE.WARMUP ||
      this.phase === PHASE.FREEZE ||
      (this.phase === PHASE.LIVE && this.now() < this.phaseEnd - TIMING.live + TIMING.buyWindow);
    if (!inWindow) return fail('time');
    if (!inRect(p.x, p.y, BUY_ZONES[p.team])) return fail('zone');

    if (itemId === 'armor') {
      if (p.armor >= ARMOR.amount) return fail('owned');
      if (p.money < GEAR_PRICES.armor) return fail('money');
      p.money -= GEAR_PRICES.armor;
      p.armor = ARMOR.amount;
    } else if (itemId === 'nade') {
      if (p.inv.nades >= NADE.maxCarry) return fail('owned');
      if (p.money < GEAR_PRICES.nade) return fail('money');
      p.money -= GEAR_PRICES.nade;
      p.inv.nades++;
    } else if (itemId === 'ammo') {
      if (p.money < GEAR_PRICES.ammo) return fail('money');
      let bought = false;
      for (const wid of Object.keys(p.ammo)) {
        const w = WEAPONS[wid];
        if (p.ammo[wid].res < w.reserve) { p.ammo[wid].res = w.reserve; bought = true; }
      }
      if (!bought) return fail('owned');
      p.money -= GEAR_PRICES.ammo;
    } else {
      const w = WEAPONS[itemId];
      if (!w || !w.price || w.slot !== 1) return fail('item');
      if (p.inv.primary === itemId && p.ammo[itemId] && p.ammo[itemId].mag >= w.mag && p.ammo[itemId].res >= w.reserve) return fail('owned');
      if (p.money < w.price) return fail('money');
      p.money -= w.price;
      if (p.inv.primary && p.inv.primary !== itemId) delete p.ammo[p.inv.primary];
      p.inv.primary = itemId;
      p.ammo[itemId] = { mag: w.mag, res: w.reserve };
      p.slot = 1;
      p.reloadEnd = 0;
    }
    p.send({ t: 'bought', item: itemId, money: p.money });
    this.emit('buy', p.id);
  }

  // ---------------------------------------------------------- grenades

  throwNade(p) {
    if (p.inv.nades <= 0) return;
    if (this.phase !== PHASE.LIVE && this.phase !== PHASE.WARMUP) return;
    p.inv.nades--;
    const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
    this.nades.push({
      id: nextEntityId++,
      owner: p.id,
      x: p.x + dx * (PLAYER_RADIUS + 6),
      y: p.y + dy * (PLAYER_RADIUS + 6),
      vx: dx * NADE.speed + p.vx * 0.4,
      vy: dy * NADE.speed + p.vy * 0.4,
      explodeAt: this.now() + NADE.fuse,
    });
    this.emit('throw', p.id);
  }

  stepNades(dt) {
    const now = this.now();
    for (let i = this.nades.length - 1; i >= 0; i--) {
      const n = this.nades[i];
      const decay = Math.exp(-1.6 * dt);
      n.vx *= decay; n.vy *= decay;
      // bounce off walls, one axis at a time
      let nx = n.x + n.vx * dt;
      if (circleIntersects(nx, n.y, NADE.radius)) { n.vx = -n.vx * NADE.bounce; this.emit('tink', +n.x.toFixed(0), +n.y.toFixed(0)); }
      else n.x = nx;
      let ny = n.y + n.vy * dt;
      if (circleIntersects(n.x, ny, NADE.radius)) { n.vy = -n.vy * NADE.bounce; }
      else n.y = ny;

      if (now >= n.explodeAt) {
        this.nades.splice(i, 1);
        this.explodeNade(n);
      }
    }
  }

  explodeNade(n) {
    this.emit('boom', +n.x.toFixed(0), +n.y.toFixed(0), 0);
    const owner = this.players.get(n.owner);
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      if (owner && q.team === owner.team && q !== owner) continue; // no team damage; self damage allowed
      const d = dist(n.x, n.y, q.x, q.y);
      if (d > NADE.dmgRadius) continue;
      if (!hasLOS(n.x, n.y, q.x, q.y, WALLS)) continue;
      const dmg = NADE.dmg * (1 - d / NADE.dmgRadius) + 8;
      this.damage(q, dmg, owner && owner !== q ? owner : q, 'nade');
    }
  }

  // ---------------------------------------------------------- bomb

  updateUse(p, buttons, dt) {
    const using = (buttons & BTN.USE) !== 0;
    if (!using || this.phase !== PHASE.LIVE) {
      if (p.plantProgress > 0) this.emit('plant_stop', p.id);
      p.plantProgress = 0;
      if (this.bomb.defuser === p.id) { this.bomb.defuser = 0; this.emit('defuse_stop', p.id); }
      p.defuseProgress = 0;
      return false;
    }

    // planting
    if (p.team === TEAM.KRELL && this.bomb.state === 'carried' && this.bomb.carrier === p.id) {
      const site = siteAt(p.x, p.y);
      if (site) {
        if (p.plantProgress === 0) this.emit('plant_start', p.id);
        p.plantProgress += (dt * 1000) / TIMING.plant;
        if (p.plantProgress >= 1) {
          p.plantProgress = 0;
          this.bomb.state = 'planted';
          this.bomb.x = p.x; this.bomb.y = p.y;
          this.bomb.site = site;
          this.bomb.plantedAt = this.now();
          this.bomb.carrier = 0;
          p.money = clamp(p.money + ECON.plant, 0, ECON.max);
          this.phaseEnd = this.bomb.plantedAt + TIMING.bomb + 1000;
          this.emit('planted', site, +p.x.toFixed(0), +p.y.toFixed(0), p.id);
        }
        return true;
      }
    }

    // defusing
    if (p.team === TEAM.WARDEN && this.bomb.state === 'planted') {
      if (dist(p.x, p.y, this.bomb.x, this.bomb.y) < 70) {
        if (this.bomb.defuser && this.bomb.defuser !== p.id) return false;
        if (this.bomb.defuser !== p.id) { this.bomb.defuser = p.id; this.emit('defuse_start', p.id); }
        p.defuseProgress += (dt * 1000) / TIMING.defuse;
        if (p.defuseProgress >= 1) {
          p.defuseProgress = 0;
          this.bomb.state = 'defused';
          this.bomb.defuser = 0;
          p.money = clamp(p.money + ECON.defuse, 0, ECON.max);
          this.emit('defused', p.id);
          this.endRound(TEAM.WARDEN, 'defuse');
        }
        return true;
      }
      if (this.bomb.defuser === p.id) { this.bomb.defuser = 0; this.emit('defuse_stop', p.id); }
      p.defuseProgress = 0;
    }
    return false;
  }

  dropBomb(x, y) {
    this.bomb.state = 'dropped';
    this.bomb.carrier = 0;
    this.bomb.x = x; this.bomb.y = y;
    this.emit('bomb_drop', +x.toFixed(0), +y.toFixed(0));
  }

  stepBomb() {
    if (this.bomb.state === 'dropped' && this.phase === PHASE.LIVE) {
      for (const p of this.players.values()) {
        if (!p.alive || p.team !== TEAM.KRELL) continue;
        if (dist2(p.x, p.y, this.bomb.x, this.bomb.y) < 45 * 45) {
          this.bomb.state = 'carried';
          this.bomb.carrier = p.id;
          this.emit('bomb_pickup', p.id);
          break;
        }
      }
    }
    if (this.bomb.state === 'planted' && this.now() >= this.bomb.plantedAt + TIMING.bomb) {
      this.bomb.state = 'exploded';
      this.emit('boom', +this.bomb.x.toFixed(0), +this.bomb.y.toFixed(0), 1);
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        const d = dist(q.x, q.y, this.bomb.x, this.bomb.y);
        if (d < 650) this.damage(q, 500 * (1 - d / 700), null, 'bomb');
      }
      this.endRound(TEAM.KRELL, 'bomb');
    }
  }

  // ---------------------------------------------------------- main loop

  step() {
    this.tick++;
    const now = this.now();
    const dt = TICK_MS / 1000;

    // phase timer
    if (this.phaseEnd && now >= this.phaseEnd) this.advancePhase();

    // bots think + synthesize inputs
    for (const p of this.players.values()) {
      if (p.bot && p.alive) {
        const input = p.bot.tickInput(dt);
        this.processInput(p, p.lastSeq + 1, TICK_MS, input.keys, input.aim, input.buttons);
      } else if (p.bot && !p.alive) {
        p.prevButtons = 0;
      }
    }

    // human inputs
    for (const p of this.players.values()) {
      if (p.isBot) continue;
      const batch = p.inputs;
      p.inputs = [];
      for (const [seq, dtMs, keys, aim, buttons] of batch) {
        this.processInput(p, seq, dtMs, keys, aim, buttons);
      }
      this.finishReload(p);
    }

    // gentle player-vs-player separation (server only)
    this.separatePlayers();

    // warmup respawns
    if (this.phase === PHASE.WARMUP) {
      for (const p of this.players.values()) {
        if (!p.alive && p.respawnAt && now >= p.respawnAt) { p.respawnAt = 0; this.spawn(p); }
      }
    }

    this.stepNades(dt);
    this.stepBomb();

    // record history for lag compensation
    for (const p of this.players.values()) {
      p.history.push({ x: p.x, y: p.y, alive: p.alive });
      if (p.history.length > HISTORY_TICKS) p.history.shift();
    }

    this.sendSnapshots();
    if (this.rosterDirty || now - this.lastRosterAt > 2000) {
      this.lastRosterAt = now;
      this.rosterDirty = false;
      this.broadcast(this.rosterMsg());
    }
    this.events = [];
  }

  separatePlayers() {
    const list = [...this.players.values()].filter((p) => p.alive);
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = PLAYER_RADIUS * 2;
        if (d2 >= min * min || d2 === 0) continue;
        const d = Math.sqrt(d2);
        const push = (min - d) / 2;
        const ux = dx / d, uy = dy / d;
        moveAxis(a, -ux * push, 0, WALLS); moveAxis(a, 0, -uy * push, WALLS);
        moveAxis(b, ux * push, 0, WALLS); moveAxis(b, 0, uy * push, WALLS);
      }
    }
  }

  // ---------------------------------------------------------- snapshots

  visibleEnemySets() {
    // per-team union: an enemy is visible if any living teammate sees them
    const sets = { [TEAM.KRELL]: new Set(), [TEAM.WARDEN]: new Set() };
    const list = [...this.players.values()];
    for (const team of [TEAM.KRELL, TEAM.WARDEN]) {
      const lookers = list.filter((p) => p.team === team && p.alive);
      for (const q of list) {
        if (q.team === team || !q.alive) continue;
        for (const p of lookers) {
          if (dist2(p.x, p.y, q.x, q.y) > VISION_DIST * VISION_DIST) continue;
          if (hasLOS(p.x, p.y, q.x, q.y, WALLS)) { sets[team].add(q.id); break; }
        }
      }
    }
    // everyone is visible outside live play
    if (this.phase !== PHASE.LIVE) {
      for (const q of list) { sets[TEAM.KRELL].add(q.id); sets[TEAM.WARDEN].add(q.id); }
    }
    return sets;
  }

  packPlayer(p) {
    let fl = 0;
    if (!p.alive) fl |= 1;
    if (p.reloadEnd) fl |= 2;
    if (p.plantProgress > 0) fl |= 4;
    if (p.defuseProgress > 0) fl |= 8;
    if (this.bomb.state === 'carried' && this.bomb.carrier === p.id) fl |= 16;
    return [p.id, +p.x.toFixed(1), +p.y.toFixed(1), +p.angle.toFixed(3), p.hp, p.weapon().id, fl];
  }

  sendSnapshots() {
    const vis = this.visibleEnemySets();
    const now = this.now();
    const base = {
      t: 's',
      sv: now,
      ph: this.phase,
      pe: this.phaseEnd,
      rn: this.round,
      sc: [this.scores[0], this.scores[1]],
      bm: this.packBomb(),
      gn: this.nades.map((n) => [+n.x.toFixed(0), +n.y.toFixed(0)]),
      ev: this.events,
    };
    for (const p of this.players.values()) {
      if (!p.ws || p.ws.readyState !== 1) continue;
      const visSet = vis[p.team];
      const pl = [];
      for (const q of this.players.values()) {
        if (q.id === p.id) continue;
        if (q.team === p.team || visSet.has(q.id) || !q.alive) {
          // dead enemies stay visible briefly so death anims play out
          if (q.team !== p.team && !q.alive && !visSet.has(q.id) && now - q.diedAt > 1500) continue;
          pl.push(this.packPlayer(q));
        }
      }
      const w = p.weapon();
      const msg = {
        ...base,
        ls: p.lastSeq,
        me: {
          x: +p.x.toFixed(2), y: +p.y.toFixed(2),
          vx: +p.vx.toFixed(2), vy: +p.vy.toFixed(2),
          hp: p.hp, ar: p.armor, mo: p.money,
          al: p.alive ? 1 : 0,
          sl: p.slot,
          wid: w.id,
          am: p.ammo[w.id] ? [p.ammo[w.id].mag, p.ammo[w.id].res] : null,
          nd: p.inv.nades,
          pr: p.inv.primary,
          rl: p.reloadEnd ? Math.max(0, p.reloadEnd - now) : 0,
          ht: +p.heat.toFixed(4),
          pp: +p.plantProgress.toFixed(3),
          dp: +p.defuseProgress.toFixed(3),
          bomb: this.bomb.state === 'carried' && this.bomb.carrier === p.id ? 1 : 0,
        },
        pl,
      };
      p.ws.send(JSON.stringify(msg));
    }
  }

  packBomb() {
    const b = this.bomb;
    // bomb position is only public once planted/dropped
    if (b.state === 'planted' || b.state === 'dropped' || b.state === 'exploded') {
      return { st: b.state, x: +b.x.toFixed(0), y: +b.y.toFixed(0), si: b.site, pa: b.plantedAt, df: b.defuser };
    }
    return { st: b.state, c: b.carrier };
  }

  rosterMsg() {
    return {
      t: 'roster',
      players: [...this.players.values()].map((p) => ({
        i: p.id, n: p.name, tm: p.team, b: p.isBot ? 1 : 0,
        k: p.kills, d: p.deaths, mo: p.money, pg: p.ping, al: p.alive ? 1 : 0,
      })),
    };
  }
}

function normAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function circleIntersects(x, y, r) {
  for (const w of WALLS) {
    const nx = clamp(x, w.x, w.x + w.w);
    const ny = clamp(y, w.y, w.y + w.h);
    if ((x - nx) ** 2 + (y - ny) ** 2 < r * r) return true;
  }
  return false;
}
