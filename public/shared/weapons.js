// ============================================================
// KRELL — weapon definitions (server + client)
// ============================================================
// slot: 1 primary, 2 sidearm, 3 blade, 4 grenade
// spread values are radians; spreadMove scales with velocity,
// spreadKick is added per shot ("heat") and decays at spreadDecay/s.

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'PHASE BLADE', short: 'BLADE', slot: 3, price: 0,
    melee: true, dmg: 55, range: 70, arc: 1.6,
    fireDelay: 420, auto: false, speed: 268, killReward: 1500,
  },
  pistol: {
    id: 'pistol', name: 'KP-9 SIDEARM', short: 'KP-9', slot: 2, price: 0,
    dmg: 24, mag: 13, reserve: 39, fireDelay: 175, reloadMs: 1700, auto: false,
    spreadBase: 0.016, spreadMove: 0.00030, spreadKick: 0.028, spreadDecay: 0.22,
    range: 1700, falloff: 0.25, speed: 252, killReward: 300,
  },
  smg: {
    id: 'smg', name: 'VIPER SMG', short: 'VIPER', slot: 1, price: 1250,
    dmg: 17, mag: 30, reserve: 90, fireDelay: 78, reloadMs: 2200, auto: true,
    spreadBase: 0.030, spreadMove: 0.00022, spreadKick: 0.011, spreadDecay: 0.28,
    range: 1400, falloff: 0.35, speed: 246, killReward: 600,
  },
  shotgun: {
    id: 'shotgun', name: 'MAUL SCATTERGUN', short: 'MAUL', slot: 1, price: 2000,
    dmg: 9, pellets: 8, mag: 7, reserve: 32, fireDelay: 880, reloadMs: 3000, auto: false,
    spreadBase: 0.10, spreadMove: 0.00018, spreadKick: 0.02, spreadDecay: 0.30,
    range: 560, falloff: 0.65, speed: 238, killReward: 900,
  },
  rifle: {
    id: 'rifle', name: 'KF-7 PULSE RIFLE', short: 'KF-7', slot: 1, price: 2700,
    dmg: 29, mag: 30, reserve: 90, fireDelay: 102, reloadMs: 2500, auto: true,
    spreadBase: 0.011, spreadMove: 0.00042, spreadKick: 0.017, spreadDecay: 0.26,
    range: 2400, falloff: 0.15, speed: 232, killReward: 300,
  },
  sniper: {
    id: 'sniper', name: 'LONGLANCE', short: 'LANCE', slot: 1, price: 4750,
    dmg: 260, mag: 5, reserve: 15, fireDelay: 1350, reloadMs: 3300, auto: false,
    spreadBase: 0.0012, spreadMove: 0.00120, spreadKick: 0.09, spreadDecay: 0.18,
    range: 3200, falloff: 0, speed: 212, killReward: 100,
  },
};

// effective spread for a given speed + heat
export function weaponSpread(w, speed, heat) {
  if (w.melee) return 0;
  return w.spreadBase + speed * w.spreadMove + heat;
}

// damage after distance falloff
export function weaponDamage(w, d) {
  if (!w.falloff) return w.dmg;
  const t = Math.min(1, d / w.range);
  return w.dmg * (1 - w.falloff * t);
}

// shop layout (client buy menu + server validation)
export const SHOP = [
  { id: 'smg',     hotkey: '1', cat: 'PRIMARY', desc: 'Spray-friendly. Fast feet.' },
  { id: 'shotgun', hotkey: '2', cat: 'PRIMARY', desc: 'Door policy enforcement.' },
  { id: 'rifle',   hotkey: '3', cat: 'PRIMARY', desc: 'The workhorse. Tap fire.' },
  { id: 'sniper',  hotkey: '4', cat: 'PRIMARY', desc: 'One lance, one body.' },
  { id: 'armor',   hotkey: '5', cat: 'GEAR',    desc: 'Halves incoming damage.' },
  { id: 'nade',    hotkey: '6', cat: 'GEAR',    desc: 'Plasma grenade. Cook nothing.' },
  { id: 'ammo',    hotkey: '7', cat: 'GEAR',    desc: 'Refill all reserves.' },
];

export const GEAR_PRICES = { armor: 650, nade: 300, ammo: 100 };
