/**
 * netlify/functions/chess-game.ts
 *
 * Challenge Thongthai — server-authoritative chess session endpoint.
 * The browser is NEVER trusted for a result: every move is validated and
 * applied server-side against the stored FEN via chess.js, Thongthai's
 * reply move is computed server-side, and only a verified checkmate here
 * can ever lead to a reward being issued (see chess-rewards.ts).
 *
 * Actions (all POST):
 *  - state:  { guestId } -> the guest's current active game, if any, plus
 *            whether Master difficulty is unlocked.
 *  - start:  { guestId, language, difficulty, playerColor } -> abandons any
 *            other active game for this guest and starts a new one. If the
 *            guest plays black, Thongthai's opening move is made immediately.
 *  - move:   { guestId, gameId, from, to, promotion? } -> validates and
 *            applies the player's move, then (if the game continues)
 *            computes and applies Thongthai's reply.
 *  - resign: { guestId, gameId } -> ends the game as a resignation.
 *
 * Endpoint once deployed: POST /.netlify/functions/chess-game
 */

import type { Handler, HandlerEvent } from '@netlify/functions';
import {
  abandonActiveGames,
  createGame,
  getEligibleZones,
  hasVerifiedHardWin,
  insertChessEvent,
  isValidAnonymousId,
  loadActiveGame,
  loadGame,
  resolveOrCreateGuestId,
  toPublicReward,
  updateGameAfterMoves,
  issueRewardForWin,
  type ChessGame,
  type Difficulty,
  type PublicChessReward,
} from './_chess-db';
import { applyMove, gameStatusFromFen, isValidFen, selectThongthaiMove, startingFen } from './_chess-engine';

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'master'];
const LANGUAGES = ['th', 'en', 'zh', 'lo', 'vi'];

function json(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function publicGame(game: ChessGame) {
  return {
    gameId: game.id,
    difficulty: game.difficulty,
    playerColor: game.playerColor,
    fen: game.fen,
    moves: game.moves,
    status: game.status,
    startedAt: game.startedAt,
  };
}

async function thongthaiReplyIfGameContinues(
  game: ChessGame,
  fenAfterPlayerMove: string,
  movesAfterPlayerMove: string[],
): Promise<{ fen: string; moves: string[]; thongthaiSan: string | null }> {
  const statusAfterPlayer = gameStatusFromFen(fenAfterPlayerMove);
  if (statusAfterPlayer.isGameOver) {
    return { fen: fenAfterPlayerMove, moves: movesAfterPlayerMove, thongthaiSan: null };
  }

  const thongthaiPick = selectThongthaiMove(fenAfterPlayerMove, game.difficulty);
  const applied = applyMove(fenAfterPlayerMove, thongthaiPick.from, thongthaiPick.to, thongthaiPick.promotion);
  if (!applied.ok || !applied.fen || !applied.san) {
    // Should not happen (the engine only ever selects a legal move), but
    // never corrupt state if it somehow does — leave the position as-is
    // after the player's move rather than applying a broken reply.
    console.error('CHESS_ENGINE_MOVE_APPLY_FAILED', thongthaiPick);
    return { fen: fenAfterPlayerMove, moves: movesAfterPlayerMove, thongthaiSan: null };
  }
  return { fen: applied.fen, moves: [...movesAfterPlayerMove, applied.san], thongthaiSan: applied.san };
}

export const handler: Handler = async (event: HandlerEvent) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body ?? '{}') as Record<string, unknown>;
  } catch {
    return json(400, { error: 'Malformed JSON body' });
  }

  const guestId = body.guestId;
  if (!isValidAnonymousId(guestId)) return json(400, { error: 'Missing or invalid guestId' });
  const language = isNonEmptyString(body.language) && LANGUAGES.includes(body.language) ? body.language : 'th';

  let guestDbId: string;
  try {
    guestDbId = await resolveOrCreateGuestId(guestId, language);
  } catch (err) {
    console.error('CHESS_GUEST_RESOLVE_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
    return json(503, { error: 'Chess is temporarily unavailable' });
  }

  const action = body.action;

  if (action === 'state') {
    try {
      const [active, masterUnlocked] = await Promise.all([
        loadActiveGame(guestDbId),
        hasVerifiedHardWin(guestDbId),
      ]);
      return json(200, { activeGame: active ? publicGame(active) : null, masterUnlocked });
    } catch (err) {
      console.error('CHESS_STATE_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Chess is temporarily unavailable' });
    }
  }

  if (action === 'start') {
    const difficulty = body.difficulty;
    const playerColor = body.playerColor === 'black' ? 'black' : 'white';
    if (typeof difficulty !== 'string' || !DIFFICULTIES.includes(difficulty as Difficulty)) {
      return json(400, { error: 'Invalid difficulty' });
    }
    try {
      if (difficulty === 'master' && !(await hasVerifiedHardWin(guestDbId))) {
        return json(403, { error: 'master_locked', message: 'Master unlocks after a verified Hard win.' });
      }
      await abandonActiveGames(guestDbId);

      let fen = startingFen();
      let moves: string[] = [];
      if (playerColor === 'black') {
        const opening = selectThongthaiMove(fen, difficulty as Difficulty);
        const applied = applyMove(fen, opening.from, opening.to, opening.promotion);
        if (applied.ok && applied.fen && applied.san) {
          fen = applied.fen;
          moves = [applied.san];
        }
      }

      const game = await createGame(guestDbId, difficulty as Difficulty, playerColor, fen);
      if (moves.length) {
        await updateGameAfterMoves(game.id, fen, moves, 'active');
        game.fen = fen;
        game.moves = moves;
      }
      return json(200, { game: publicGame(game) });
    } catch (err) {
      console.error('CHESS_START_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Could not start a new game' });
    }
  }

  if (action === 'move') {
    const gameId = body.gameId;
    const from = body.from;
    const to = body.to;
    const promotion = isNonEmptyString(body.promotion) ? body.promotion : undefined;
    if (!isNonEmptyString(gameId) || !isNonEmptyString(from) || !isNonEmptyString(to)) {
      return json(400, { error: 'Missing gameId, from or to' });
    }

    try {
      const game = await loadGame(gameId, guestDbId);
      if (!game) return json(404, { error: 'Game not found' });
      if (game.status !== 'active') return json(409, { error: 'game_not_active', status: game.status });
      if (!isValidFen(game.fen)) return json(500, { error: 'Corrupted game state' });

      const playerTurn = game.playerColor === 'white' ? 'w' : 'b';
      const status = gameStatusFromFen(game.fen);
      if (status.turn !== playerTurn) return json(409, { error: 'not_your_turn' });

      const playerMoveResult = applyMove(game.fen, from, to, promotion);
      if (!playerMoveResult.ok || !playerMoveResult.fen || !playerMoveResult.san) {
        return json(400, { error: 'illegal_move' });
      }

      const movesAfterPlayer = [...game.moves, playerMoveResult.san];

      if (playerMoveResult.isGameOver) {
        const finalStatus = playerMoveResult.isCheckmate ? 'player_won' : 'draw';
        const reward = await finalizeGame(game, guestDbId, playerMoveResult.fen, movesAfterPlayer, finalStatus);
        return json(200, {
          fen: playerMoveResult.fen,
          moves: movesAfterPlayer,
          status: finalStatus,
          playerSan: playerMoveResult.san,
          thongthaiSan: null,
          isCheck: playerMoveResult.isCheck,
          isCheckmate: playerMoveResult.isCheckmate,
          isStalemate: playerMoveResult.isStalemate,
          isDraw: playerMoveResult.isDraw,
          reward,
        });
      }

      const reply = await thongthaiReplyIfGameContinues(game, playerMoveResult.fen, movesAfterPlayer);
      const statusAfterReply = gameStatusFromFen(reply.fen);
      const finalStatus = !statusAfterReply.isGameOver
        ? 'active'
        : statusAfterReply.isCheckmate
          ? 'thongthai_won'
          : 'draw';

      const reward = await finalizeGame(game, guestDbId, reply.fen, reply.moves, finalStatus);

      return json(200, {
        fen: reply.fen,
        moves: reply.moves,
        status: finalStatus,
        playerSan: playerMoveResult.san,
        thongthaiSan: reply.thongthaiSan,
        isCheck: statusAfterReply.isCheck,
        isCheckmate: statusAfterReply.isCheckmate,
        isStalemate: statusAfterReply.isStalemate,
        isDraw: statusAfterReply.isDraw,
        reward,
      });
    } catch (err) {
      console.error('CHESS_MOVE_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Could not process move' });
    }
  }

  if (action === 'resign') {
    const gameId = body.gameId;
    if (!isNonEmptyString(gameId)) return json(400, { error: 'Missing gameId' });
    try {
      const game = await loadGame(gameId, guestDbId);
      if (!game) return json(404, { error: 'Game not found' });
      if (game.status === 'active') {
        await updateGameAfterMoves(game.id, game.fen, game.moves, 'resigned');
        await insertChessEvent(guestDbId, 'chess_game_lost', { difficulty: game.difficulty, game_id: game.id, reason: 'resigned' });
      }
      return json(200, { ok: true });
    } catch (err) {
      console.error('CHESS_RESIGN_ERROR', err instanceof Error ? err.message.slice(0, 200) : 'unknown');
      return json(503, { error: 'Could not resign the game' });
    }
  }

  return json(400, { error: 'Unknown or missing action' });
};

async function finalizeGame(
  game: ChessGame,
  guestDbId: string,
  fen: string,
  moves: string[],
  status: 'active' | 'player_won' | 'thongthai_won' | 'draw',
): Promise<PublicChessReward | null> {
  // Check BEFORE updating this game's own status — hasVerifiedHardWin
  // queries for an existing hard win, and this game would otherwise count
  // itself once its own row is updated below, making "was this the first"
  // always false.
  const wasFirstHardWin = status === 'player_won' && game.difficulty === 'hard' && !(await hasVerifiedHardWin(guestDbId));

  await updateGameAfterMoves(game.id, fen, moves, status);
  if (status === 'active') return null;

  if (status === 'player_won') {
    await insertChessEvent(guestDbId, 'chess_game_won', { difficulty: game.difficulty, game_id: game.id });
    const reward = await issueRewardForWin(guestDbId, game.id, game.difficulty);
    if (wasFirstHardWin) {
      await insertChessEvent(guestDbId, 'chess_master_unlocked', { game_id: game.id });
    }
    const zones = await getEligibleZones();
    return toPublicReward(reward, zones);
  } else if (status === 'thongthai_won') {
    await insertChessEvent(guestDbId, 'chess_game_lost', { difficulty: game.difficulty, game_id: game.id, reason: 'checkmate' });
  } else if (status === 'draw') {
    await insertChessEvent(guestDbId, 'chess_game_drawn', { difficulty: game.difficulty, game_id: game.id });
  }
  return null;
}
