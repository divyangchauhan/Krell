// Direct simulation: instantiate Game with a stub human, watch bots play.
// Usage: node test/botsim.js [seconds]
import { Game } from '../server/game.js';
import { TEAM, PHASE } from '../public/shared/const.js';
import { SITES } from '../public/shared/map.js';

const SECS = Number(process.argv[2]) || 120;
const stubWs = { readyState: 1, send() {} };
const game = new Game();
const human = game.addHuman(stubWs, 'STUB');

let lastPhase = '';
const t0 = Date.now();
const timer = setInterval(() => {
  if (game.phase !== lastPhase) {
    lastPhase = game.phase;
    console.log(`[${((Date.now() - t0) / 1000).toFixed(0)}s] phase=${game.phase} round=${game.round} score=${game.scores[0]}-${game.scores[1]} bomb=${game.bomb.state}`);
  }
}, 100);

const posLog = setInterval(() => {
  const lines = [];
  for (const p of game.players.values()) {
    if (!p.isBot) continue;
    const goal = p.bot.goal ? `goal(${p.bot.goal.x | 0},${p.bot.goal.y | 0})` : 'nogoal';
    const path = p.bot.path.length;
    lines.push(`  ${p.name}[${p.team === TEAM.KRELL ? 'K' : 'W'}]${p.alive ? '' : ' DEAD'} @(${p.x | 0},${p.y | 0}) ${goal} path=${path} target=${p.bot.target ? p.bot.target.name : '-'}`);
  }
  console.log(`t=${((Date.now() - t0) / 1000).toFixed(0)}s bomb=${game.bomb.state} carrier=${game.bomb.carrier}`);
  console.log(lines.join('\n'));
}, 10000);

setTimeout(() => {
  clearInterval(timer); clearInterval(posLog);
  console.log('\nFINAL:', 'round', game.round, 'score', game.scores[0] + '-' + game.scores[1]);
  let k = 0, d = 0;
  for (const p of game.players.values()) { k += p.kills; d += p.deaths; }
  console.log('total kills', k, 'deaths', d);
  console.log('site centers A', SITES.A.cx, SITES.A.cy, 'B', SITES.B.cx, SITES.B.cy);
  process.exit(0);
}, SECS * 1000);
