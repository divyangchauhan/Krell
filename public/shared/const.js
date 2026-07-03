// ============================================================
// KRELL — shared constants (server + client)
// ============================================================

export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const PLAYER_RADIUS = 16;
export const INTERP_MS = 100;          // client renders remote entities this far in the past
export const VISION_DIST = 1500;       // server-side visibility culling distance
export const MAX_PLAYERS = 10;
export const TEAM_SIZE_FILL = 3;       // bots keep each team at least this size
export const WIN_ROUNDS = 8;

export const TEAM = { KRELL: 0, WARDEN: 1 };

export const TEAM_INFO = {
  [TEAM.KRELL]:  { name: 'KRELL',   color: '#ff5f8f', dim: '#7c2c47', role: 'Attack — deliver the Void Charge' },
  [TEAM.WARDEN]: { name: 'WARDENS', color: '#3fd9ff', dim: '#1d5d72', role: 'Defend — stop the Void Charge' },
};

export const PHASE = {
  WARMUP: 'warmup',       // waiting for players, free respawns
  STARTING: 'starting',   // match-start countdown
  FREEZE: 'freeze',       // buy time, players frozen
  LIVE: 'live',           // round in progress
  POST: 'post',           // round-end pause
  OVER: 'over',           // match over screen
};

export const TIMING = {
  starting: 5000,
  freeze: 6000,
  live: 100000,
  post: 5000,
  over: 12000,
  bomb: 40000,            // void charge fuse
  plant: 3200,
  defuse: 6000,
  buyWindow: 10000,       // can still buy this long into LIVE (inside buy zone)
  respawnWarmup: 2500,
};

export const ECON = {
  start: 800,
  warmup: 10000,
  win: 3250,
  lossBase: 1400,
  lossStep: 500,
  lossMax: 3400,
  plant: 300,
  defuse: 300,
  max: 16000,
};

// input bitmasks
export const KEY = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8 };
export const BTN = { FIRE: 1, USE: 2, RELOAD: 4, WALK: 8, NADE: 16 };

export const NADE = {
  price: 300,
  maxCarry: 1,
  fuse: 1600,             // ms after throw
  speed: 560,
  radius: 16,             // projectile size vs walls
  bounce: 0.55,
  friction: 0.9,          // velocity multiplier per second-ish (applied exponentially)
  dmgRadius: 270,
  dmg: 96,
};

export const ARMOR = { price: 650, amount: 100, absorb: 0.5 };

export const BOMB_NAME = 'VOID CHARGE';

export const END_REASON = {
  elimination: 'squad eliminated',
  bomb: 'void charge detonated',
  defuse: 'void charge neutralized',
  time: 'assault repelled',
};
