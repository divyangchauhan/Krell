# KRELL — Vision & Continuity Document

> Paste this at the start of any new session (or keep it as `CLAUDE.md` so
> Claude Code loads it automatically). It captures the intent, style, and
> invariants of the project so future models continue the same game instead
> of building a different one.

---

## 1. What KRELL is

A **browser-based multiplayer top-down 2D tactical shooter** — a faithful
Counter-Strike loop transplanted into a dark sci-fi setting. Not an arena
shooter, not a battle royale: **round-based, economy-driven, objective play**
where information, positioning, and money management matter as much as aim.

The name comes first: *Krell* evokes the vanished alien civilization of
*Forbidden Planet* — ancient machinery, void, dread. Everything (art, copy,
sound, naming) serves that tone: **ominous, neon-against-black, terse,
military-scifi**. If a feature reads as cute, bouncy, or cartoonish, it's
off-brand.

### The fiction
- Map: **SITE-9**, a derelict alien facility.
- Attackers: **KRELL** (magenta `#ff5f8f`) — deliver and arm the **VOID CHARGE**.
- Defenders: **WARDENS** (cyan `#3fd9ff`) — hold the two rift sites, defuse.
- Sites: **A — REACTOR** (map right), **B — OBELISK** (map left).
- Bots are **SYNTH** units, named after Forbidden Planet nods: ALTAIR, MORBIUS,
  ROBBY, QUORRA, VEX-9, NYX, THAL-7, ZIRCON, KRUG, SABLE, OSSIA, DRAVEN.
- UI voice: terse, all-caps, jargon-flavored — "PAUSED UPLINK", "SUPPLY CACHE",
  "DEPLOY", "CHARGE ARMED", "UPLINK LOST", "squad eliminated". Never chatty.

### The CS loop (do not dilute it)
- Phases: `warmup → starting → freeze(6s, buy) → live(100s) → post(5s)`;
  first to **8 rounds** wins, then the match resets.
- Win conditions: elimination, charge detonation (40s fuse), defuse (6s hold-E),
  or round timer (defenders win). **A planted charge overrides elimination** —
  Wardens must still defuse even if all Krell are dead.
- Economy: $800 start; kill rewards per weapon (knife $1500, shotgun $900, SMG
  $600, rifle/pistol $300, sniper $100); win $3250; loss bonus $1400→$3400
  stepping $500; cap $16000. Survivors keep guns; the dead respawn with
  pistol+knife.
- Counter-strafing matters: spread is `base + speed·move + heat`, so stopping
  to shoot is rewarded. TTK is CS-like (rifle ~4 body shots, sniper ~1).

---

## 2. Design pillars (ranked)

1. **Fair by architecture.** The server is authoritative for everything that
   matters. Visibility is culled **server-side per team** — a client is never
   told about an enemy no living teammate can see. Wallhacks are impossible by
   construction, not by trust. Never add a feature that leaks hidden enemy
   state (positions in sounds/events are OK only for things CS also reveals:
   gunshots, tracers, the planted bomb).
2. **Instantly playable.** Bots keep both teams at 3 players minimum, join and
   yield seats as humans come and go. A solo player must get a real match the
   second the server boots.
3. **Zero assets, full polish.** No image, font, or audio files in the repo.
   All sound is synthesized WebAudio (oscillators + filtered noise, positional
   panning). All visuals are canvas-drawn. Fonts come from Google Fonts *with
   local fallback stacks* — the game must look right offline.
4. **Feel over feature count.** Screen shake scaled per weapon, hitmarkers,
   tracers, muzzle flashes, floating damage/money text, corpse fade, low-HP
   vignette, damage-direction arcs, bomb beep accelerating over the fuse,
   multi-kill callouts (DOUBLE KILL → RAMPAGE). Prefer deepening feedback on
   existing mechanics over adding new mechanics.
5. **No build step.** Vanilla ES modules served raw; `pnpm start` runs
   everything. No bundlers, no frameworks, no TypeScript. Keep it that way
   unless the user asks.

---

## 3. Architecture invariants (breaking these = breaking the game)

```
server/index.js   HTTP static + WS gateway (port 3000, path /ws)
server/game.js    authoritative room @30Hz: rounds, combat, economy, bomb,
                  lag comp, per-team visibility, snapshots every tick
server/bot.js     BFS nav on tile grid + objective AI + combat
public/shared/    const.js · util.js · weapons.js · map.js
                  ← imported UNCHANGED by both server (../public/shared/…)
                    and client (/shared/…). All tuning lives here.
public/js/        net · input · audio · game (prediction) · render · ui · main
```

- **Shared determinism:** `stepPlayer()` in `shared/util.js` is the single
  movement function. Client prediction replays unacked inputs through it;
  server runs the same code. Any movement change must stay in that one
  function or prediction desyncs.
- **Netcode shape:** client sends input batches
  `{t:'in', i:[[seq,dtMs,keys,aim,buttons],…]}` (~every 45ms). Server sends a
  full snapshot every tick (`t:'s'`) with `ls` (last acked seq), `me` (private
  self state), `pl` (visible players as packed arrays), `ev` (event tuples),
  plus roster messages on change. Events are **positional arrays**
  (`['die', vid, kid, wid, x, y, reward]`) — append new fields at the end,
  never reorder.
- **Client timing:** interpolation ~100ms behind (`INTERP_MS`); reconciliation
  snaps + hides error via a decaying `smooth` offset; lag compensation rewinds
  3 ticks server-side (`REWIND_TICKS`).
- **Pixel convention:** the canvas is sized in **device pixels**
  (`innerWidth * devicePixelRatio`) and `camera.zoom` includes dpr. Any
  screen↔world conversion must multiply mouse CSS px by `devicePixelRatio`
  (a real bug was fixed here — see `test/aim-dpr.js`).
- **Map format:** ASCII grid in `shared/map.js` (`#` wall, `X` crate, `.`
  floor, `A`/`B` plant zones, `C`/`T` spawns), 100px tiles, greedy-merged into
  rects. `validateMap()` flood-fills at boot and must keep passing. Bots
  pathfind on this same grid — new geometry needs no extra nav work.
- **Input bitmasks** (`shared/const.js`): KEY up/down/left/right = 1/2/4/8;
  BTN fire/use/reload/walk/nade = 1/2/4/8/16.

---

## 4. Visual & code style

### Palette (CSS vars in `style.css`)
| Token | Value | Use |
|---|---|---|
| bg | `#05060d` | void background |
| panel | `rgba(10,14,28,.82)` | glass panels + `backdrop-filter: blur` |
| violet | `#b36bff` | brand/accent, logo, site markings |
| cyan | `#3fd9ff` | WARDENS |
| magenta | `#ff5f8f` | KRELL |
| gold | `#ffd166` | money, bomb, buy prompts |
| danger | `#ff4757` | damage, armed charge |
| green | `#41e596` | health, "OK" states |

- Fonts: **Rajdhani** (UI, wide letter-spacing on labels: `0.2–0.35em`),
  **Share Tech Mono** (numbers: timer, ammo, money, ping).
- World rendering: dark floor tiles with seeded variation, wall slabs with
  neon rims, crates with gold X strapping, fog-of-war as a visibility polygon
  cut from near-black, radial falloff at ~950px. Enemy blood is **teal ichor**
  (they're not human). Team glows under operatives.
- Code style: ES modules with semicolons, no clever tricks, section banner comments
  (`// ---- name ----`), file-top banner comments describing the module's job.
  Comments state constraints, not narration. Names in-fiction where visible to
  players, plain-English in code (`bomb`, not `voidCharge`, internally).
- Package manager: **pnpm**.

---

## 5. Testing conventions

- All tests are plain node scripts in `test/`, run against a live server
  (`node server/index.js`, port 3000). Playwright (pinned 1.60.0, chromium via
  `npx playwright install chromium`) for browser tests.
- The client exposes `window.__krell = { state, net, renderer, ui, input }`
  as the testing/debug hook — keep it working.
- Suite: `smoke.js` (WS clients, event flow) · `rounds.js` (long observer) ·
  `botsim.js` (drives `Game` directly, watches bot objectives) · `matchend.js`
  (deterministic match-over→restart) · `browser.js` (e2e UX) · `polish.js`
  (scope + floaters) · `aim-dpr.js` (high-DPI aim regression) · plus
  `gameplay/reload-check/multiplayer/midjoin`.
- **Verify visually.** After renderer/UI changes, take Playwright screenshots
  and actually look at them — several real issues were only caught that way.
- Gotchas: Playwright `keyboard.press()` is too fast for the 60Hz input
  sampler — use `down/waitForTimeout(100)/up`. `pkill -f "server/index.js"`
  kills its own shell (exit 144) — check reachability afterwards instead of
  trusting the exit code. A transient Google-Fonts CDN failure in headless
  runs is noise, not a bug.

---

## 6. Current state & deliberate omissions

**Built and verified:** full CS loop, buy menu, bots with objective play,
prediction/interp/lag-comp netcode, server-side fog of war, minimap, killfeed,
chat, scoreboard (Tab), spectate-on-death with click-to-cycle, HE grenades
with bounce physics, sniper scope (RMB, 1.95× render-side zoom), floating
combat text, multi-kill callouts, ping indicator, procedural audio throughout,
warmup/mid-round-join handling, match end + reset.

**Deliberately not built (know why before adding):**
- **Smoke grenades** — would have to occlude the visibility polygon *and*
  server-side culling to be fair; do not add as a purely visual effect.
- **Flashbangs** — top-down 360° view has no facing cone; needs a design idea
  (e.g., distance+LOS white-out) before it feels fair.
- **Halftime team swap / MR12** — kept to first-to-8 with no swap for pace.
- **Weapon drops/pickups** — only the bomb drops; guns are replaced on buy.
- **Free spectator cam, mobile/touch, multiple rooms** — single room, desktop
  mouse+keyboard only, cap 10 humans.

**Sensible next directions** (if the user asks for "more"): a second map
(new ASCII grid — validate + bot nav come free), defuse kits, side-switch at
4 rounds, sound-based minimap pings for unseen gunfire, a small lobby/room
system, persistent name-based stats, tuning passes on bot difficulty tiers.

---

## 7. How to run

```bash
pnpm install
pnpm start          # http://localhost:3000 — bots make it playable instantly
```

One server process, one room. Second browser tab (or LAN IP) = multiplayer.
`README.md` has player-facing docs; `CHATLOG.md` records the build history.
