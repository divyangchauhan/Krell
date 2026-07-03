// ============================================================
// KRELL — map "SITE-9" (server + client)
// ============================================================
// Tile legend:
//   #  wall          X  crate (solid, rendered as cargo)
//   .  floor         B  site B floor (Obelisk, plantable)
//   A  site A floor (Reactor, plantable)
//   C  Warden spawn  T  Krell spawn
//
// Layout: sites in the top corners, Warden spawn top-center with
// direct doors into both sites; Krell spawn bottom strip; three
// vertical lanes (B-tunnel / mid / long-A) with two mid connectors.

export const TILE = 100;

export const GRID = [
  '##############################',
  '#BBBBBB.X##..CCCC..##X.AAAAAA#',
  '#BBBBBB......CCCC......AAAAAA#',
  '#BBBBBB......CCCC......AAAAAA#',
  '#........##........##........#',
  '##..##..######..######..##..##',
  '#..........X................#'.padEnd(30, '#'),
  '#..................X.........#',
  '##...#########...########...##',
  '##...#########...########...##',
  '##...#########.X.########...##',
  '##...#########..............##',
  '##.X........................##',
  '##...............########.X.##',
  '##...#########...########...##',
  '##...#########...########...##',
  '#........X...................#',
  '#.....................X......#',
  '###..#########..#########..###',
  '#....X....TTTTTTTTTT.........#',
  '#.........TTTTTTTTTT....X....#',
  '##############################',
];

export const COLS = GRID[0].length;
export const ROWS = GRID.length;
export const MAP_W = COLS * TILE;
export const MAP_H = ROWS * TILE;

const solid = (ch) => ch === '#' || ch === 'X';
export const tileChar = (c, r) =>
  (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? '#' : GRID[r][c];
export const isWalkableTile = (c, r) => !solid(tileChar(c, r));
export const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];

// ------------------------------------------------------------
// Solid geometry — greedy-merge tiles into rects (fewer = faster
// raycasts). Crates are separate so the renderer can style them.
// ------------------------------------------------------------

function mergeRects(match) {
  const used = Array.from({ length: ROWS }, () => new Array(COLS).fill(false));
  const rects = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (used[r][c] || !match(tileChar(c, r))) continue;
      let w = 1;
      while (c + w < COLS && !used[r][c + w] && match(tileChar(c + w, r))) w++;
      let h = 1;
      outer: while (r + h < ROWS) {
        for (let i = 0; i < w; i++) {
          if (used[r + h][c + i] || !match(tileChar(c + i, r + h))) break outer;
        }
        h++;
      }
      for (let rr = r; rr < r + h; rr++) {
        for (let cc = c; cc < c + w; cc++) used[rr][cc] = true;
      }
      rects.push({ x: c * TILE, y: r * TILE, w: w * TILE, h: h * TILE });
    }
  }
  return rects;
}

export const WALLS = mergeRects((ch) => ch === '#' || ch === 'X');
export const CRATES = mergeRects((ch) => ch === 'X');

// ------------------------------------------------------------
// Zones
// ------------------------------------------------------------

function tilesMatching(ch) {
  const out = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (tileChar(c, r) === ch) out.push([c, r]);
    }
  }
  return out;
}

function zoneOf(tiles) {
  let minC = 1e9, minR = 1e9, maxC = -1, maxR = -1;
  for (const [c, r] of tiles) {
    minC = Math.min(minC, c); maxC = Math.max(maxC, c);
    minR = Math.min(minR, r); maxR = Math.max(maxR, r);
  }
  return {
    x: minC * TILE, y: minR * TILE,
    w: (maxC - minC + 1) * TILE, h: (maxR - minR + 1) * TILE,
    cx: (minC + maxC + 1) * TILE / 2, cy: (minR + maxR + 1) * TILE / 2,
    tiles,
  };
}

export const SITES = {
  A: { ...zoneOf(tilesMatching('A')), label: 'A', name: 'REACTOR' },
  B: { ...zoneOf(tilesMatching('B')), label: 'B', name: 'OBELISK' },
};

const spawnK = zoneOf(tilesMatching('T'));
const spawnW = zoneOf(tilesMatching('C'));
export const SPAWNS = { 0: spawnK, 1: spawnW }; // TEAM.KRELL=0, TEAM.WARDEN=1

// buy zones: spawn zone inflated by one tile
const inflate = (z, t) => ({ x: z.x - t, y: z.y - t, w: z.w + t * 2, h: z.h + t * 2 });
export const BUY_ZONES = { 0: inflate(spawnK, TILE), 1: inflate(spawnW, TILE) };

export const inRect = (x, y, z) => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h;

export function siteAt(x, y) {
  const [c, r] = tileOf(x, y);
  const ch = tileChar(c, r);
  return ch === 'A' ? 'A' : ch === 'B' ? 'B' : null;
}

export function spawnPoints(team) {
  const z = SPAWNS[team];
  return z.tiles.map(([c, r]) => ({ x: (c + 0.5) * TILE, y: (r + 0.5) * TILE }));
}

// ------------------------------------------------------------
// Sanity check — every floor tile reachable from both spawns
// (run at server boot; catches layout typos immediately)
// ------------------------------------------------------------

export function validateMap() {
  for (let r = 0; r < ROWS; r++) {
    if (GRID[r].length !== COLS) throw new Error(`map row ${r} has length ${GRID[r].length}, expected ${COLS}`);
  }
  const flood = (sc, sr) => {
    const seen = new Set([sc + ',' + sr]);
    const q = [[sc, sr]];
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = c + dc, nr = r + dr, k = nc + ',' + nr;
        if (!seen.has(k) && isWalkableTile(nc, nr)) { seen.add(k); q.push([nc, nr]); }
      }
    }
    return seen;
  };
  const [c0, r0] = SPAWNS[0].tiles[0];
  const reach = flood(c0, r0);
  let floorCount = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (isWalkableTile(c, r)) {
        floorCount++;
        if (!reach.has(c + ',' + r)) throw new Error(`unreachable floor tile at col ${c}, row ${r}`);
      }
    }
  }
  for (const s of ['A', 'B']) {
    const [c, r] = SITES[s].tiles[0];
    if (!reach.has(c + ',' + r)) throw new Error(`site ${s} unreachable`);
  }
  return { floorCount, walls: WALLS.length };
}
