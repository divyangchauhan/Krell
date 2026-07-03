# KRELL

A browser-based multiplayer top-down tactical shooter — a Counter-Strike–style
round game reskinned as a raid on a derelict alien facility, **SITE-9**. Two
squads fight over a defusable objective (the **Void Charge**) across a best-of
match, with a buy economy, bots that fill empty slots, and an authoritative
server.

No build step, no framework, no art assets — pure Node + vanilla ES modules +
Canvas, with all audio synthesized at runtime via WebAudio.

```
pnpm install
pnpm start
# open http://localhost:3000
```

Bots fill both teams immediately, so it's playable solo the moment it boots.
Open a second browser tab — or share your LAN address — for live multiplayer.

---

## Gameplay

- **KRELL** (attackers) carry the Void Charge to a rift site (**A — Reactor** or
  **B — Obelisk**) and arm it. **WARDENS** (defenders) hold the sites and defuse.
- A round ends by **elimination**, **charge detonation**, **defuse**, or the
  **round timer** (defenders win if it runs out un-armed). First squad to **8**
  rounds wins the match; it then resets and rolls again.
- **Economy:** earn money for kills, round wins, plants and defuses; spend it in
  the supply cache during the freeze/buy window. Losing streaks pay out more.

### Controls

| Input | Action |
|---|---|
| `W A S D` | move |
| `Shift` | walk (quiet, slower) |
| Left mouse | aim / fire |
| Right mouse | scope (LONGLANCE only) |
| `R` | reload |
| `B` | supply cache (buy menu) |
| Hold `E` | plant / defuse |
| `G` | grenade |
| `1` `2` `3` / wheel | weapon slots (primary / sidearm / blade) |
| `Tab` | scoreboard |
| `Enter` | chat |
| `Esc` | pause / options |

### Arsenal

VIPER SMG · MAUL SCATTERGUN · KF-7 PULSE RIFLE · LONGLANCE (sniper, scoped) ·
KP-9 SIDEARM · PHASE BLADE · plasma grenade · aegis weave (armor).

---

## Architecture

```
server/
  index.js   HTTP static server + WebSocket gateway
  game.js    authoritative 30 Hz room: rounds, combat, economy, bomb,
             lag compensation, per-team visibility culling, delta snapshots
  bot.js     BFS navigation + objective AI + combat (reaction, bursts, strafe)
public/
  shared/    const · util (deterministic physics) · weapons · map  (server+client)
  js/        net · input · audio · game (prediction/interp) · render · ui · main
  css/       theme
test/        node + playwright verification scripts
```

**Netcode.** The server simulates authoritatively at 30 Hz and sends per-client
delta snapshots. The client runs **prediction** for the local player
(re-simulating unacknowledged inputs through the *same* movement code the server
uses, in `shared/util.js`), **reconciliation** with smooth error correction, and
**entity interpolation** (~100 ms) for everyone else. Hits are **lag-compensated**
by rewinding targets to roughly when the shooter saw them.

**Fog of war.** Visibility is enforced server-side: you only receive enemies a
living teammate can actually see (distance + line-of-sight). The client draws a
matching visibility polygon so you can't see — or be told about — what's around
the corner.

**Audio.** Every sound (gunfire per weapon, explosions, footsteps, reloads, UI
blips, the bomb's accelerating beep) is synthesized from oscillators and filtered
noise at runtime and positionally panned. There are no audio files.

---

## Development

```
pnpm start            # run the server (also: pnpm dev)
node test/smoke.js    # fake WS clients drive a round; asserts combat events
node test/botsim.js   # headless bot match, logs navigation/objective state
node test/matchend.js # fast deterministic match-end -> restart check
node test/browser.js  # Playwright end-to-end (menu, buy, combat, HUD)
node test/polish.js   # Playwright: sniper scope + floating combat text
```

The Playwright scripts need a running server and a one-time
`npx playwright install chromium`.

Configuration (tick rate, round timings, economy, weapon stats, the map) lives in
`public/shared/` and is imported unchanged by both server and client, so tuning
stays in one place.
