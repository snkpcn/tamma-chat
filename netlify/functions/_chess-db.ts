/**
 * netlify/functions/_chess-db.ts
 *
 * Server-only data access for Challenge Thongthai. Same conventions as the
 * rest of the Thongthai backend: private configuration()/dbFetch() pair,
 * service-role key only, guest_id always resolves through the same
 * public.guests table every other feature uses.
 *
 * This is also the ONE centralized place eligible reward "zones" are
 * defined — sourced live from public.service_resources (the same real,
 * active service catalog bookings already use), never hardcoded and never
 * duplicated into chess-game.ts, chess-rewards.ts or chess.html.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LANGUAGES = new Set(['th', 'en', 'zh', 'lo', 'vi']);

export type Difficulty = 'easy' | 'medium' | 'hard' | 'master';
export type GameStatus = 'active' | 'player_won' | 'thongthai_won' | 'draw' | 'resigned' | 'abandoned';
export type RewardScope = 'one_zone' | 'all_zones';
export type RewardStatus = 'available' | 'partially_used' | 'used' | 'expired';

export interface ChessZone {
  zoneKey: string; // = service_resources.code
  name: string;
  serviceType: string;
}

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

export interface ChessReward {
  id: string;
  guestId: string;
  gameId: string;
  difficulty: Difficulty;
  discountPercent: number;
  scope: RewardScope;
  selectedZone: string | null;
  status: RewardStatus;
  masterBadge: boolean;
  expiresAt: string;
  createdAt: string;
  redeemedZones: string[];
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
// Zone configuration — the ONE place eligible zones come from.
// ---------------------------------------------------------------------------
let zoneCache: { zones: ChessZone[]; loadedAt: number } | null = null;
const ZONE_CACHE_TTL_MS = 60_000;

export async function getEligibleZones(): Promise<ChessZone[]> {
  if (zoneCache && Date.now() - zoneCache.loadedAt < ZONE_CACHE_TTL_MS) return zoneCache.zones;
  try {
    const res = await dbFetch('service_resources?active=eq.true&select=code,name,service_type&order=service_type.asc');
    const rows = await res.json() as Array<{ code: string; name: string; service_type: string }>;
    const zones = rows.map(r => ({ zoneKey: r.code, name: r.name, serviceType: r.service_type }));
    zoneCache = { zones, loadedAt: Date.now() };
    return zones;
  } catch (err) {
    safeDbError('zones', err);
    return zoneCache?.zones ?? [];
  }
}

export async function isEligibleZone(zoneKey: string): Promise<boolean> {
  const zones = await getEligibleZones();
  return zones.some(z => z.zoneKey === zoneKey);
}

// ---------------------------------------------------------------------------
// Difficulty / reward rules — one place, exact values from spec.
// ---------------------------------------------------------------------------
export const DIFFICULTY_REWARD: Record<Difficulty, { discountPercent: number; scope: RewardScope; masterBadge: boolean }> = {
  easy: { discountPercent: 5, scope: 'one_zone', masterBadge: false },
  medium: { discountPercent: 10, scope: 'one_zone', masterBadge: false },
  hard: { discountPercent: 10, scope: 'all_zones', masterBadge: false },
  master: { discountPercent: 15, scope: 'all_zones', masterBadge: true },
};

function bangkokEndOfDayIso(): string {
  // 23:59:59 Asia/Bangkok (UTC+7, no DST) on "today" in Bangkok time.
  const now = new Date();
  const bangkokNowMs = now.getTime() + 7 * 60 * 60 * 1000;
  const bangkok = new Date(bangkokNowMs);
  const y = bangkok.getUTCFullYear();
  const m = bangkok.getUTCMonth();
  const d = bangkok.getUTCDate();
  // 23:59:59 Bangkok = 16:59:59 UTC same day.
  const endUtcMs = Date.UTC(y, m, d, 23, 59, 59) - 7 * 60 * 60 * 1000;
  return new Date(endUtcMs).toISOString();
}

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

// ---------------------------------------------------------------------------
// Rewards
// ---------------------------------------------------------------------------

/**
 * Issues a reward for a verified win. Uniqueness on chess_rewards.game_id
 * prevents a replayed/duplicate call from ever minting a second reward for
 * the same game — if one already exists, it's returned instead (idempotent).
 */
export async function issueRewardForWin(
  guestDbId: string,
  gameId: string,
  difficulty: Difficulty,
): Promise<ChessReward> {
  const existing = await loadRewardByGameId(gameId, guestDbId);
  if (existing) return existing;

  const rule = DIFFICULTY_REWARD[difficulty];
  try {
    const res = await dbFetch('chess_rewards', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({
        guest_id: guestDbId,
        game_id: gameId,
        difficulty,
        discount_percent: rule.discountPercent,
        scope: rule.scope,
        selected_zone: null,
        status: 'available',
        master_badge: rule.masterBadge,
        expires_at: bangkokEndOfDayIso(),
      }),
    });
    const rows = await res.json() as Array<Record<string, unknown>>;
    const row = rows[0];
    if (!row) throw new Error('Could not create reward');
    await insertEvent(guestDbId, 'chess_reward_issued', { difficulty, game_id: gameId, scope: rule.scope });
    return { ...rowToReward(row), redeemedZones: [] };
  } catch (err) {
    // Unique-violation race: another concurrent call already inserted the
    // reward for this game_id. Return the row that actually exists instead
    // of surfacing a duplicate-reward error to the player.
    const raceExisting = await loadRewardByGameId(gameId, guestDbId);
    if (raceExisting) return raceExisting;
    throw err;
  }
}

export async function loadRewardByGameId(gameId: string, guestDbId: string): Promise<ChessReward | null> {
  const res = await dbFetch(
    'chess_rewards?game_id=eq.' + encodeURIComponent(gameId)
    + '&guest_id=eq.' + encodeURIComponent(guestDbId) + '&select=*&limit=1',
  );
  const rows = await res.json() as Array<Record<string, unknown>>;
  if (!rows[0]) return null;
  return attachRedeemedZones(rowToReward(rows[0]));
}

export async function loadReward(rewardId: string, guestDbId: string): Promise<ChessReward | null> {
  const res = await dbFetch(
    'chess_rewards?id=eq.' + encodeURIComponent(rewardId)
    + '&guest_id=eq.' + encodeURIComponent(guestDbId) + '&select=*&limit=1',
  );
  const rows = await res.json() as Array<Record<string, unknown>>;
  if (!rows[0]) return null;
  return attachRedeemedZones(rowToReward(rows[0]));
}

export async function listRewards(guestDbId: string): Promise<ChessReward[]> {
  const res = await dbFetch(
    'chess_rewards?guest_id=eq.' + encodeURIComponent(guestDbId)
    + '&select=*&order=created_at.desc',
  );
  const rows = await res.json() as Array<Record<string, unknown>>;
  const rewards = rows.map(rowToReward);
  return Promise.all(rewards.map(r => attachRedeemedZones(r)));
}

async function attachRedeemedZones(reward: ChessReward): Promise<ChessReward> {
  const res = await dbFetch(
    'chess_reward_redemptions?reward_id=eq.' + encodeURIComponent(reward.id) + '&select=zone_key',
  );
  const rows = await res.json() as Array<{ zone_key: string }>;
  return { ...reward, redeemedZones: rows.map(r => r.zone_key) };
}

function rowToReward(row: Record<string, unknown>): ChessReward {
  return {
    id: String(row.id),
    guestId: String(row.guest_id),
    gameId: String(row.game_id),
    difficulty: row.difficulty as Difficulty,
    discountPercent: Number(row.discount_percent),
    scope: row.scope as RewardScope,
    selectedZone: row.selected_zone ? String(row.selected_zone) : null,
    status: row.status as RewardStatus,
    masterBadge: row.master_badge === true,
    expiresAt: String(row.expires_at),
    createdAt: String(row.created_at),
    redeemedZones: [],
  };
}

export function isRewardExpired(reward: ChessReward): boolean {
  return Date.parse(reward.expiresAt) < Date.now();
}

export interface PublicChessReward {
  rewardId: string;
  difficulty: Difficulty;
  discountPercent: number;
  scope: RewardScope;
  selectedZone: string | null;
  masterBadge: boolean;
  expiresAt: string;
  createdAt: string;
  status: RewardStatus;
  needsZoneSelection: boolean;
  coveredZones: Array<{ zoneKey: string; name: string; redeemed: boolean }>;
}

/** Shared shape used by both chess-game.ts (win response) and chess-rewards.ts (list/select/redeem). */
export function toPublicReward(reward: ChessReward, eligibleZones: ChessZone[]): PublicChessReward {
  const covered = reward.scope === 'one_zone'
    ? (reward.selectedZone ? eligibleZones.filter(z => z.zoneKey === reward.selectedZone) : [])
    : eligibleZones;

  const expired = isRewardExpired(reward);
  return {
    rewardId: reward.id,
    difficulty: reward.difficulty,
    discountPercent: reward.discountPercent,
    scope: reward.scope,
    selectedZone: reward.selectedZone,
    masterBadge: reward.masterBadge,
    expiresAt: reward.expiresAt,
    createdAt: reward.createdAt,
    status: expired && reward.status !== 'used' ? 'expired' : reward.status,
    needsZoneSelection: reward.scope === 'one_zone' && !reward.selectedZone && !expired,
    coveredZones: covered.map(z => ({
      zoneKey: z.zoneKey,
      name: z.name,
      redeemed: reward.redeemedZones.includes(z.zoneKey),
    })),
  };
}

/** For a one_zone reward, the player picks which single eligible zone it applies to — exactly once. */
export async function selectRewardZone(rewardId: string, guestDbId: string, zoneKey: string): Promise<ChessReward | { error: string }> {
  const reward = await loadReward(rewardId, guestDbId);
  if (!reward) return { error: 'not_found' };
  if (isRewardExpired(reward)) return { error: 'expired' };
  if (reward.scope !== 'one_zone') return { error: 'not_applicable' };
  if (reward.selectedZone) return { error: 'already_selected' };
  if (!(await isEligibleZone(zoneKey))) return { error: 'invalid_zone' };

  await dbFetch('chess_rewards?id=eq.' + encodeURIComponent(rewardId) + '&selected_zone=is.null', {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ selected_zone: zoneKey, updated_at: new Date().toISOString() }),
  });
  const updated = await loadReward(rewardId, guestDbId);
  return updated ?? { error: 'not_found' };
}

/**
 * Atomic redemption: the DB's unique(reward_id, zone_key) constraint is the
 * real guard against a double-redeem race (two tabs, a retried request).
 * Every business rule (expiry, zone eligibility, zone-covered-by-this-reward,
 * already-used) is re-checked here server-side regardless of what the UI
 * believes, since a screenshot or a stale client must never be enough.
 */
export async function redeemZone(rewardId: string, guestDbId: string, zoneKey: string): Promise<{ ok: true; reward: ChessReward } | { ok: false; error: string }> {
  const reward = await loadReward(rewardId, guestDbId);
  if (!reward) return { ok: false, error: 'not_found' };
  if (isRewardExpired(reward) || reward.status === 'expired') return { ok: false, error: 'expired' };
  if (reward.status === 'used') return { ok: false, error: 'already_used' };
  if (!(await isEligibleZone(zoneKey))) return { ok: false, error: 'invalid_zone' };

  const coveredZones = reward.scope === 'one_zone'
    ? (reward.selectedZone ? [reward.selectedZone] : [])
    : (await getEligibleZones()).map(z => z.zoneKey);

  if (!coveredZones.includes(zoneKey)) return { ok: false, error: 'zone_not_covered' };
  if (reward.redeemedZones.includes(zoneKey)) return { ok: false, error: 'zone_already_redeemed' };

  try {
    await dbFetch('chess_reward_redemptions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ reward_id: rewardId, zone_key: zoneKey }),
    });
  } catch (err) {
    // Unique-violation = the exact race this constraint exists to stop.
    safeDbError('redeem-race', err);
    return { ok: false, error: 'zone_already_redeemed' };
  }

  const updatedReward = await loadReward(rewardId, guestDbId);
  if (!updatedReward) return { ok: false, error: 'not_found' };
  const nowUsedAll = coveredZones.every(z => updatedReward.redeemedZones.includes(z));
  const nextStatus: RewardStatus = nowUsedAll ? 'used' : 'partially_used';

  await dbFetch('chess_rewards?id=eq.' + encodeURIComponent(rewardId), {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: nextStatus, updated_at: new Date().toISOString() }),
  });
  await insertEvent(guestDbId, 'chess_reward_redeemed', { reward_id: rewardId, zone_key: zoneKey });

  const finalReward = await loadReward(rewardId, guestDbId);
  return finalReward ? { ok: true, reward: finalReward } : { ok: false, error: 'not_found' };
}
