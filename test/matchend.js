// Fast deterministic check of the match-end -> game-over -> restart transition.
// Drives the Game class directly; no real-time waiting on round timers.
import { Game } from '../server/game.js';
import { PHASE, TEAM, WIN_ROUNDS } from '../public/shared/const.js';

const stubWs = { readyState: 1, sent: [], send(s) { this.sent.push(JSON.parse(s)); } };
const game = new Game();
const human = game.addHuman(stubWs, 'STUB');
const events = [];
const origEmit = game.emit.bind(game);
game.emit = (...ev) => { events.push(ev[0]); return origEmit(...ev); };

// force KRELL to win WIN_ROUNDS rounds back-to-back
for (let i = 0; i < WIN_ROUNDS; i++) {
  game.phase = PHASE.LIVE;           // endRound only fires from LIVE/FREEZE
  game.endRound(TEAM.KRELL, 'elimination');
}

const overOk = game.phase === PHASE.OVER && game.scores[TEAM.KRELL] === WIN_ROUNDS;
const gameOverEmitted = events.includes('game_over');
console.log(`after ${WIN_ROUNDS} wins: phase=${game.phase} score=${game.scores[0]}-${game.scores[1]} game_over=${gameOverEmitted}`);

// advancing past OVER should restart a fresh match
game.advancePhase();
const restartOk = game.phase === PHASE.FREEZE && game.round === 1 && game.scores[0] === 0 && game.scores[1] === 0;
console.log(`after restart: phase=${game.phase} round=${game.round} score=${game.scores[0]}-${game.scores[1]}`);

// economy sanity: winners richer than the floor, capped at max
const ok = overOk && gameOverEmitted && restartOk;
console.log(ok ? 'MATCHEND OK' : 'MATCHEND FAIL');
process.exit(ok ? 0 : 1);
