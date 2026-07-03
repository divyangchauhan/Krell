// ============================================================
// KRELL client — game state, prediction, interpolation
// ============================================================

import { PHASE, INTERP_MS, BTN, PLAYER_RADIUS, TEAM } from '/shared/const.js';
import { stepPlayer, clamp, lerp, angleLerp, dist2 } from '/shared/util.js';
import { WEAPONS, weaponSpread } from '/shared/weapons.js';
import { WALLS, MAP_W, MAP_H } from '/shared/map.js';

const SNAP_KEEP = 40;

export class GameState {
  constructor(net, input) {
    this.net = net;
    this.input = input;
    this.id = 0;
    this.team = 0;
    this.connectedAt = 0;

    // authoritative-ish self
    this.me = {
      x: 0, y: 0, vx: 0, vy: 0, angle: 0,
      hp: 100, armor: 0, money: 0, alive: false,
      slot: 2, wid: 'pistol', mag: 0, res: 0, nades: 0, primary: null,
      reloadLeft: 0, heat: 0, plant: 0, defuse: 0, hasBomb: false,
    };
    this.predicted = { x: MAP_W / 2, y: MAP_H / 2, vx: 0, vy: 0 };
    this.smooth = { x: 0, y: 0 };           // error-smoothing offset
    this.pending = [];                       // unacked inputs [{seq, dtMs, keys, buttons, x, y, vx, vy}]
    this.seq = 0;
    this.sendAccum = [];
    this.lastSendAt = 0;

    // world
    this.snaps = [];                         // [{at(localMs), sv, players: Map, nades, bomb}]
    this.roster = new Map();                 // id -> {name, team, bot, kills, deaths, money, ping, alive}
    this.phase = PHASE.WARMUP;
    this.phaseEnd = 0;
    this.svOffset = 0;                       // serverTime - localTime
    this.round = 0;
    this.scores = [0, 0];
    this.bomb = { st: 'none' };
    this.nadesLive = [];
    this.spectateId = 0;
    this.lastKiller = null;

    this.onEvent = null;                     // (ev) => void   render/ui/audio hook
    this.fireFlash = 0;                      // local muzzle for own weapon
    this.lastStepSoundAt = 0;
  }

  svNow() { return performance.now() + this.svOffset; }

  // ---------------------------------------------------------- snapshots

  handleHello(m) {
    this.id = m.id;
    this.team = m.team;
    this.phase = m.phase;
    this.scores = m.scores;
    this.round = m.round;
    this.connectedAt = performance.now();
  }

  handleRoster(m) {
    const seen = new Set();
    for (const r of m.players) {
      seen.add(r.i);
      this.roster.set(r.i, {
        name: r.n, team: r.tm, bot: !!r.b,
        kills: r.k, deaths: r.d, money: r.mo, ping: r.pg, alive: !!r.al,
      });
    }
    for (const id of [...this.roster.keys()]) if (!seen.has(id)) this.roster.delete(id);
  }

  handleSnap(m) {
    const now = performance.now();
    // smooth server-clock offset estimate
    const off = m.sv - now;
    this.svOffset = this.svOffset === 0 ? off : lerp(this.svOffset, off, 0.08);

    this.phase = m.ph;
    this.phaseEnd = m.pe;
    this.round = m.rn;
    this.scores = m.sc;
    this.bomb = m.bm;
    this.nadesLive = m.gn || [];

    const players = new Map();
    for (const [id, x, y, a, hp, wid, fl] of m.pl) {
      players.set(id, { x, y, a, hp, wid, dead: !!(fl & 1), reloading: !!(fl & 2), planting: !!(fl & 4), defusing: !!(fl & 8), hasBomb: !!(fl & 16) });
    }
    this.snaps.push({ at: now, sv: m.sv, players });
    if (this.snaps.length > SNAP_KEEP) this.snaps.shift();

    // self
    const me = m.me;
    const wasAlive = this.me.alive;
    Object.assign(this.me, {
      hp: me.hp, armor: me.ar, money: me.mo, alive: !!me.al,
      slot: me.sl, wid: me.wid,
      mag: me.am ? me.am[0] : -1, res: me.am ? me.am[1] : 0,
      nades: me.nd, primary: me.pr,
      reloadLeft: me.rl, heat: me.ht, plant: me.pp, defuse: me.dp,
      hasBomb: !!me.bomb, angle: this.me.angle,
    });

    // reconciliation
    this.reconcile(m.ls, me);

    if (!wasAlive && this.me.alive) {
      this.predicted.x = me.x; this.predicted.y = me.y;
      this.predicted.vx = 0; this.predicted.vy = 0;
      this.smooth.x = 0; this.smooth.y = 0;
      this.spectateId = 0;
      this.lastKiller = null;
    }
    if (wasAlive && !this.me.alive) this.pickSpectate();
    // mid-round joiners start dead with no spectate target
    if (!this.me.alive && !this.spectateId) this.pickSpectate();

    for (const ev of m.ev) this.onEvent?.(ev);
  }

  reconcile(lastSeq, serverMe) {
    // drop acked inputs
    while (this.pending.length && this.pending[0].seq <= lastSeq) this.pending.shift();
    if (!this.me.alive) return;

    // replay pending inputs from the authoritative state
    const sim = { x: serverMe.x, y: serverMe.y, vx: serverMe.vx, vy: serverMe.vy };
    const w = WEAPONS[this.me.wid] || WEAPONS.pistol;
    const rooted = this.me.plant > 0 || this.me.defuse > 0;
    const frozen = this.phase === PHASE.FREEZE || this.phase === PHASE.STARTING || this.phase === PHASE.OVER;
    for (const inp of this.pending) {
      if (!frozen && !rooted) stepPlayer(sim, inp.keys, inp.buttons, inp.dtMs / 1000, WALLS, w.speed);
    }
    const errX = sim.x - this.predicted.x;
    const errY = sim.y - this.predicted.y;
    const err2 = errX * errX + errY * errY;
    if (err2 > 0.01) {
      if (err2 > 120 * 120) {
        // huge desync: snap hard
        this.predicted = { ...sim };
        this.smooth.x = 0; this.smooth.y = 0;
      } else {
        // adopt server result, hide the delta with a decaying visual offset
        this.smooth.x = clamp(this.smooth.x - errX, -60, 60);
        this.smooth.y = clamp(this.smooth.y - errY, -60, 60);
        this.predicted = { ...sim };
      }
    }
  }

  // ---------------------------------------------------------- per-frame

  update(dt, camera) {
    const now = performance.now();

    // aim angle from mouse (camera supplied by renderer)
    // camera.zoom maps world -> device px, so mouse CSS px must be scaled by dpr
    if (camera) {
      const wx = camera.x + (this.input.mouse.x - innerWidth / 2) * devicePixelRatio / camera.zoom;
      const wy = camera.y + (this.input.mouse.y - innerHeight / 2) * devicePixelRatio / camera.zoom;
      this.me.angle = Math.atan2(wy - this.predicted.y - this.smooth.y, wx - this.predicted.x - this.smooth.x);
    }

    if (this.me.alive) {
      const keys = this.input.keys();
      const buttons = this.input.buttons();
      const rooted = this.me.plant > 0 || this.me.defuse > 0;
      const frozen = this.phase === PHASE.FREEZE || this.phase === PHASE.STARTING || this.phase === PHASE.OVER;
      this.seq++;
      const dtMs = clamp(dt * 1000, 1, 50);
      const w = WEAPONS[this.me.wid] || WEAPONS.pistol;
      if (!frozen && !rooted) {
        stepPlayer(this.predicted, keys, buttons, dtMs / 1000, WALLS, w.speed);
        this.predicted.x = clamp(this.predicted.x, PLAYER_RADIUS, MAP_W - PLAYER_RADIUS);
        this.predicted.y = clamp(this.predicted.y, PLAYER_RADIUS, MAP_H - PLAYER_RADIUS);
      }
      const inp = { seq: this.seq, dtMs, keys, buttons };
      this.pending.push(inp);
      if (this.pending.length > 90) this.pending.shift();
      this.sendAccum.push([inp.seq, Math.round(dtMs), keys, +this.me.angle.toFixed(3), buttons]);

      // own footsteps
      const spd = Math.hypot(this.predicted.vx, this.predicted.vy);
      if (spd > 120 && !(buttons & BTN.WALK) && now - this.lastStepSoundAt > 21500 / spd) {
        this.lastStepSoundAt = now;
        this.onEvent?.(['ownstep']);
      }
    } else {
      // keep server informed of aim/heartbeat even when dead
      this.seq++;
      this.sendAccum.push([this.seq, Math.round(clamp(dt * 1000, 1, 50)), 0, +this.me.angle.toFixed(3), 0]);
    }

    // decay error-smoothing offset
    const decay = Math.exp(-12 * dt);
    this.smooth.x *= decay;
    this.smooth.y *= decay;

    // flush input batch ~every 45ms
    if (now - this.lastSendAt > 45 && this.sendAccum.length) {
      this.lastSendAt = now;
      this.net.send({ t: 'in', i: this.sendAccum });
      this.sendAccum = [];
    }

    // local crosshair heat decay (server echoes authoritative value)
    const w = WEAPONS[this.me.wid] || WEAPONS.pistol;
    if (!w.melee) this.me.heat = Math.max(0, this.me.heat - (w.spreadDecay || 0.2) * dt);
  }

  // visual position of self (prediction + smoothing)
  selfPos() {
    return { x: this.predicted.x + this.smooth.x, y: this.predicted.y + this.smooth.y };
  }

  crosshairSpread() {
    const w = WEAPONS[this.me.wid] || WEAPONS.pistol;
    if (w.melee) return 0;
    const spd = Math.hypot(this.predicted.vx, this.predicted.vy);
    return weaponSpread(w, spd, this.me.heat);
  }

  // ---------------------------------------------------------- interpolation

  // Returns Map(id -> {x, y, a, ...snap fields, alpha}) at render time.
  interpPlayers() {
    const out = new Map();
    if (this.snaps.length === 0) return out;
    const rt = performance.now() - INTERP_MS;
    let a = this.snaps[0], b = this.snaps[this.snaps.length - 1];
    for (let i = this.snaps.length - 1; i >= 0; i--) {
      if (this.snaps[i].at <= rt) { a = this.snaps[i]; b = this.snaps[i + 1] || this.snaps[i]; break; }
    }
    const t = b.at === a.at ? 1 : clamp((rt - a.at) / (b.at - a.at), 0, 1.25);
    for (const [id, pb] of b.players) {
      const pa = a.players.get(id) || pb;
      out.set(id, {
        ...pb,
        x: lerp(pa.x, pb.x, t),
        y: lerp(pa.y, pb.y, t),
        a: angleLerp(pa.a, pb.a, Math.min(t, 1)),
      });
    }
    return out;
  }

  // ---------------------------------------------------------- spectating

  pickSpectate() {
    const mates = [...this.roster.entries()].filter(([id, r]) => r.team === this.team && r.alive && id !== this.id);
    this.spectateId = mates.length ? mates[0][0] : 0;
  }

  cycleSpectate() {
    const mates = [...this.roster.entries()].filter(([id, r]) => r.team === this.team && r.alive && id !== this.id).map(([id]) => id);
    if (!mates.length) { this.spectateId = 0; return; }
    const i = mates.indexOf(this.spectateId);
    this.spectateId = mates[(i + 1) % mates.length];
  }

  // camera focus: self when alive, else spectated teammate, else last self pos
  focusPos() {
    if (this.me.alive) return this.selfPos();
    if (this.spectateId) {
      const p = this.interpPlayers().get(this.spectateId);
      if (p) return { x: p.x, y: p.y };
      const r = this.roster.get(this.spectateId);
      if (!r || !r.alive) this.pickSpectate();
    }
    return this.selfPos();
  }

  phaseTimeLeft() {
    if (!this.phaseEnd) return 0;
    return Math.max(0, this.phaseEnd - this.svNow());
  }
}
