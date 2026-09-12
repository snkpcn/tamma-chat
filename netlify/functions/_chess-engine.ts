/**
 * netlify/functions/_chess-engine.ts
 *
 * Server-side chess rules (chess.js — never hand-rolled legal-move logic)
 * plus Thongthai's own move selection. No claimed Elo ratings anywhere:
 * difficulty is described by behavior only ("forgiving", "competent",
 * "challenging", "strongest in the product"), not a number that was never
 * actually calibrated against real players.
 *
 * All search is synchronous negamax with alpha-beta pruning and a hard
 * wall-clock deadline per difficulty. If the deadline is hit mid-search,
 * the best move found at the last fully-completed depth is returned —
 * never a half-computed or corrupted result.
 */

import { Chess, type Move } from 'chess.js';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'master';

const PIECE_VALUE: Record<string, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Small centre-control bonus table (from White's orientation; mirrored for Black).
const CENTER_BONUS: Record<string, number> = {
  d4: 18, d5: 18, e4: 18, e5: 18,
  c3: 8, c4: 8, c5: 8, c6: 8,
  d3: 8, d6: 8, e3: 8, e6: 8,
  f3: 8, f4: 8, f5: 8, f6: 8,
};

function materialAndPosition(game: Chess): number {
  let score = 0;
  const board = game.board();
  for (const row of board) {
    for (const square of row) {
      if (!square) continue;
      const value = PIECE_VALUE[square.type] + (CENTER_BONUS[square.square] ?? 0);
      score += square.color === 'w' ? value : -value;
    }
  }
  return score;
}

/** Positive = good for the side to move (negamax convention). */
function evaluate(game: Chess): number {
  if (game.isCheckmate()) return -100000; // side to move has just been mated
  if (game.isDraw() || game.isStalemate() || game.isThreefoldRepetition() || game.isInsufficientMaterial()) return 0;

  const material = materialAndPosition(game);
  const mobility = game.moves().length * 2;
  const sideToMoveSign = game.turn() === 'w' ? 1 : -1;
  return (material + mobility) * sideToMoveSign;
}

function orderMoves(moves: Move[]): Move[] {
  // Captures and promotions first — dramatically improves alpha-beta pruning.
  return [...moves].sort((a, b) => {
    const score = (m: Move) => (m.captured ? PIECE_VALUE[m.captured] : 0) + (m.promotion ? 800 : 0);
    return score(b) - score(a);
  });
}

function negamax(game: Chess, depth: number, alpha: number, beta: number, deadline: number): number {
  if (game.isGameOver() || depth === 0 || Date.now() > deadline) {
    return evaluate(game);
  }
  let best = -Infinity;
  const moves = orderMoves(game.moves({ verbose: true }));
  for (const m of moves) {
    game.move({ from: m.from, to: m.to, promotion: m.promotion });
    const score = -negamax(game, depth - 1, -beta, -alpha, deadline);
    game.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
    if (Date.now() > deadline) break;
  }
  return best;
}

function bestMoveBySearch(game: Chess, maxDepth: number, timeBudgetMs: number, randomizeWithin = 0): Move {
  const deadline = Date.now() + timeBudgetMs;
  const legalMoves = orderMoves(game.moves({ verbose: true }));
  if (!legalMoves.length) throw new Error('No legal moves available');

  let bestMoveOverall: Move = legalMoves[0];
  let bestScoreOverall = -Infinity;

  for (let depth = 1; depth <= maxDepth; depth++) {
    if (Date.now() > deadline) break;
    let depthBestMove: Move | null = null;
    let depthBestScore = -Infinity;
    let alpha = -Infinity;
    const beta = Infinity;

    for (const m of legalMoves) {
      game.move({ from: m.from, to: m.to, promotion: m.promotion });
      const score = -negamax(game, depth - 1, -beta, -alpha, deadline);
      game.undo();
      if (score > depthBestScore) {
        depthBestScore = score;
        depthBestMove = m;
      }
      if (depthBestScore > alpha) alpha = depthBestScore;
      if (Date.now() > deadline) break;
    }

    if (depthBestMove && Date.now() <= deadline) {
      bestMoveOverall = depthBestMove;
      bestScoreOverall = depthBestScore;
    } else {
      break; // ran out of time mid-depth — keep the last fully completed depth's result
    }
  }

  if (randomizeWithin > 0) {
    // Pick uniformly among moves within `randomizeWithin` centipawns of the
    // best 1-ply-evaluated score, so a strong-but-not-perfect difficulty
    // doesn't play the identical line every time from the same position.
    const scored = legalMoves.map(m => {
      game.move({ from: m.from, to: m.to, promotion: m.promotion });
      const score = -evaluate(game);
      game.undo();
      return { move: m, score };
    });
    const top = Math.max(...scored.map(s => s.score));
    const nearBest = scored.filter(s => s.score >= top - randomizeWithin);
    if (nearBest.length > 1 && bestScoreOverall >= top - randomizeWithin) {
      return nearBest[Math.floor(Math.random() * nearBest.length)].move;
    }
  }

  return bestMoveOverall;
}

/** Easy: deliberately weak — mostly picks from the worse half of 1-ply outcomes, sometimes hangs material. */
function easyMove(game: Chess): Move {
  const moves = game.moves({ verbose: true });
  const scored = moves.map(m => {
    game.move({ from: m.from, to: m.to, promotion: m.promotion });
    const score = -evaluate(game);
    game.undo();
    return { move: m, score };
  }).sort((a, b) => b.score - a.score);

  const blunderRoll = Math.random();
  if (blunderRoll < 0.3) {
    // Intentional blunder: pick from the worst third of legal moves.
    const worstThird = scored.slice(Math.ceil(scored.length * 0.66));
    const pool = worstThird.length ? worstThird : scored;
    return pool[Math.floor(Math.random() * pool.length)].move;
  }
  // Otherwise: pick from the bottom half of reasonable moves — forgiving, not competent.
  const bottomHalf = scored.slice(Math.ceil(scored.length / 2));
  const pool = bottomHalf.length ? bottomHalf : scored;
  return pool[Math.floor(Math.random() * pool.length)].move;
}

/** Medium: greedy 1-ply with a small amount of randomness among good options — competent, not deep. */
function mediumMove(game: Chess): Move {
  return bestMoveBySearch(game, 2, 400, 40);
}

/** Hard: real search, still human-beatable, a little variation among near-equal top moves. */
function hardMove(game: Chess): Move {
  return bestMoveBySearch(game, 3, 1200, 20);
}

/** Master: the strongest level in the product — deepest search, negligible randomness. */
function masterMove(game: Chess): Move {
  return bestMoveBySearch(game, 4, 2500, 0);
}

export function selectThongthaiMove(fen: string, difficulty: Difficulty): { from: string; to: string; promotion?: string } {
  const game = new Chess(fen);
  if (game.isGameOver()) throw new Error('Game is already over');

  let move: Move;
  switch (difficulty) {
    case 'easy': move = easyMove(game); break;
    case 'medium': move = mediumMove(game); break;
    case 'hard': move = hardMove(game); break;
    case 'master': move = masterMove(game); break;
  }

  return { from: move.from, to: move.to, promotion: move.promotion };
}

export interface ApplyMoveResult {
  ok: boolean;
  fen?: string;
  san?: string;
  isCheck?: boolean;
  isCheckmate?: boolean;
  isStalemate?: boolean;
  isDraw?: boolean;
  isGameOver?: boolean;
  turn?: 'w' | 'b';
  error?: string;
}

/** Validates and applies exactly one move against the given FEN. Never trusts a client-claimed result. */
export function applyMove(
  fen: string,
  from: string,
  to: string,
  promotion?: string,
): ApplyMoveResult {
  try {
    const game = new Chess(fen);
    const move = game.move({ from, to, promotion: promotion as Move['promotion'] });
    if (!move) return { ok: false, error: 'Illegal move' };
    return {
      ok: true,
      fen: game.fen(),
      san: move.san,
      isCheck: game.isCheck(),
      isCheckmate: game.isCheckmate(),
      isStalemate: game.isStalemate(),
      isDraw: game.isDraw(),
      isGameOver: game.isGameOver(),
      turn: game.turn(),
    };
  } catch {
    return { ok: false, error: 'Illegal move' };
  }
}

export function gameStatusFromFen(fen: string): {
  isCheck: boolean; isCheckmate: boolean; isStalemate: boolean; isDraw: boolean; isGameOver: boolean; turn: 'w' | 'b';
} {
  const game = new Chess(fen);
  return {
    isCheck: game.isCheck(),
    isCheckmate: game.isCheckmate(),
    isStalemate: game.isStalemate(),
    isDraw: game.isDraw(),
    isGameOver: game.isGameOver(),
    turn: game.turn(),
  };
}

export function startingFen(): string {
  return new Chess().fen();
}

export function isValidFen(fen: string): boolean {
  try {
    // eslint-disable-next-line no-new
    new Chess(fen);
    return true;
  } catch {
    return false;
  }
}
