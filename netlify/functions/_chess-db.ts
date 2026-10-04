/**
 * netlify/functions/_chess-db.ts
 *
 * Server-only data access for Challenge Thongthai. Same conventions as the
 * rest of the Thongthai backend: private configuration()/dbFetch() pair,
 * service-role key only, guest_id always resolves through the same
 * public.guests table every other feature uses.
 *
 * Chess remains isolated from commerce: this module stores game state and
 * progress only, and never reads service/OTOP catalogs or creates discounts.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(['th', 'en', 'zh', 'lo', 'vi', 'ja', 'ko']);

export type Difficulty = 'easy' | 'medium' | 'hard' | 'master';
export type GameStatus = 'active' | 'player_won' | 'thongthai_won' | 'draw' | 'resigned' | 'abandoned';

export interface ChessGame {
  id: string;
  guestId: string;
  difficulty: Difficulty;
  playerColor: 'white' | 'black';
  fen: string;
  moves: string[];
  status: GameStatus;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
}


function safeDbError(stage: string, err: unknown): void {
  const message = err instanceof Error ? err.message : 'Unknown database error';
  console.error('CHESS_DB_ERROR', stage, message.slice(0, 240));
}

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = configuration();
  if (!config) throw new Error('Customer database is not configured');
  const res = await fetch(config.url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error('Chess database request failed: ' + res.status + ' ' + body.slice(0, 200));
  }
  return res;
}

export function isValidAnonymousId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Find-or-create the canonical guest row, same pattern as _customer-db.ts. */
export async function resolveOrCreateGuestId(anonymousId: string, language: string): Promise<string> {
  const existingRes = await dbFetch(
    'guests?anonymous_id=eq.' + encodeURIComponent(anonymousId) + '&select=id&limit=1',
  );
  const existing = await existingRes.json() as Array<{ id: string }>;
  if (existing[0]?.id) return existing[0].id;

  const createdRes = await dbFetch('guests', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      anonymous_id: anonymousId,
      language: LANGUAGES.has(language) ? language : null,
      last_seen_at: new Date().toISOString(),
    }),
  });
  const created = await createdRes.json() as Array<{ id: string }>;
  if (!created[0]?.id) throw new Error('Could not resolve guest id');
  return created[0].id;
}

async function insertEvent(guestDbId: string, eventType: string, metadata: Record<string, unknown> = {}): Promise<void> {
  try {
    await dbFetch('guest_events', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ guest_id: guestDbId, event_type: eventType, intent: null, metadata }),
    });
  } catch (err) {
    safeDbError('event:' + eventType, err);
  }
}
export { insertEvent as insertChessEvent };

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------
export async function hasVerifiedHardWin(guestDbId: string): Promise<boolean> {
  const res = await dbFetch(
    'chess_games?guest_id=eq.' + encodeURIComponent(guestDbId)
    + '&difficulty=eq.hard&status=eq.player_won&select=id&limit=1',
  );
  const rows = await res.json() as Array<{ id: string }>;
  return rows.length > 0;
}

export async function createGame(
  guestDbId: string,
  difficulty: Difficulty,
  playerColor: 'white' | 'black',
  fen: string,
): Promise<ChessGame> {
  const res = await dbFetch('chess_games', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      guest_id: guestDbId,
      difficulty,
      player_color: playerColor,
      fen,
      moves: [],
      status: 'active',
    }),
  });
  const rows = await res.json() as Array<Record<string, unknown>>;
  const row = rows[0];
  if (!row) throw new Error('Could not create chess game');
  await insertEvent(guestDbId, 'chess_game_started', { difficulty, game_id: row.id });
  return rowToGame(row);
}

export async function loadGame(gameId: string, guestDbId: string): Promise<ChessGame | null> {
  const res = await dbFetch(
    'chess_games?id=eq.' + encodeURIComponent(gameId)
    + '&guest_id=eq.' + encodeURIComponent(guestDbId) + '&select=*&limit=1',
  );
  const rows = await res.json() as Array<Record<string, unknown>>;
  return rows[0] ? rowToGame(rows[0]) : null;
}

export async function loadActiveGame(guestDbId: string): Promise<ChessGame | null> {
  const res = await dbFetch(
    'chess_games?guest_id=eq.' + encodeURIComponent(guestDbId)
    + '&status=eq.active&select=*&order=started_at.desc&limit=1',
  );
  const rows = await res.json() as Array<Record<string, unknown>>;
  return rows[0] ? rowToGame(rows[0]) : null;
}

export async function updateGameAfterMoves(
  gameId: string,
  fen: string,
  moves: string[],
  status: GameStatus,
): Promise<void> {
  const finished = status !== 'active';
  await dbFetch('chess_games?id=eq.' + encodeURIComponent(gameId), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      fen,
      moves,
      status,
      updated_at: new Date().toISOString(),
      ...(finished ? { finished_at: new Date().toISOString() } : {}),
    }),
  });
}

export async function abandonActiveGames(guestDbId: string): Promise<void> {
  await dbFetch(
    'chess_games?guest_id=eq.' + encodeURIComponent(guestDbId) + '&status=eq.active',
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'abandoned', updated_at: new Date().toISOString(), finished_at: new Date().toISOString() }),
    },
  );
}

function rowToGame(row: Record<string, unknown>): ChessGame {
  return {
    id: String(row.id),
    guestId: String(row.guest_id),
    difficulty: row.difficulty as Difficulty,
    playerColor: row.player_color as 'white' | 'black',
    fen: String(row.fen),
    moves: Array.isArray(row.moves) ? row.moves.filter((m): m is string => typeof m === 'string') : [],
    status: row.status as GameStatus,
    startedAt: String(row.started_at),
    updatedAt: String(row.updated_at),
    finishedAt: row.finished_at ? String(row.finished_at) : null,
  };
}
