// Phase C of the Thongthai one-mind architecture program (see THONGTHAI_HANDOFF.md).
//
// Server-side, canonical-guest-keyed conversation continuity. thongthai-chat no
// longer needs to trust a channel to remember the conversation: it loads this
// context by resolved canonical guest identity (the same identity every other
// memory table already keys on), same for web and LINE.
//
// Storage: extends the EXISTING guest_agent_state.state JSONB blob with a new
// `conversationContext` field -- additive, no new table, no migration. This
// follows the exact pattern restaurantProposedSet/pendingPromotionRedemption
// already use in _thongthai-runtime-v3.ts. guest_agent_state is explicitly
// documented (THONGTHAI_BRAIN.md's Memory model) as "working memory, not a
// transcript" -- this module keeps that promise: bounded turns, bounded
// entities, a factual rolling summary, and an application-level expiry that
// makes stale context inert without needing a DB-level TTL/cron job.
//
// Privacy: never stores payment secrets, raw image/slip content (those never
// reach this module -- only request.message TEXT does; slips are handled
// entirely separately by _payments.ts/_line-webhook-core.ts), passwords, or
// tokens. Turn text passes through redactSensitiveContent() before storage as
// defense in depth. This is bounded working memory, not a permanent
// transcript -- consistent with tamma-backoffice's stated "no raw chat
// storage" product philosophy (see THONGTHAI_HANDOFF.md Phase K notes).
//
// Layering discipline: this module builds SemanticContext (Phase B's type) --
// it does NOT call interpretSemanticTurn itself and the Semantic Interpreter
// does NOT query the DB itself. Flow: identity -> loadConversationContext ->
// buildSemanticContext -> interpretSemanticTurn(message, context) -> (later
// phases use the SemanticTurn). Layers stay separated.

import type { SemanticAction, SemanticContext, SemanticContextEntity, SemanticDomain } from './_semantic-interpreter';
import { patchGuestAgentState } from './_guest-agent-state-store';

export const CONVERSATION_CONTEXT_SCHEMA_VERSION = 'conversation-context-v1';

export const MAX_RECENT_TURNS = 8;
export const MAX_TURN_CHARS = 400;
export const MAX_RECENT_ENTITIES = 6;
export const MAX_RECENT_EVENT_IDS = 5;
export const MAX_SUMMARY_CHARS = 600;
export const CONTEXT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours of inactivity -- a stale context is treated as absent, never as a permanent transcript

export type ConversationTurnRole = 'user' | 'assistant';

export type ConversationTurn = {
  role: ConversationTurnRole;
  content: string;
  at: string; // ISO timestamp
  channel: string;
};

export type ConversationEntityRecord = SemanticContextEntity & {
  observedAt: string;
};

export type ConversationContextState = {
  schemaVersion: string;
  recentTurns: ConversationTurn[];
  rollingSummary: string;
  activeDomain: SemanticDomain | null;
  activeTopic: string | null;
  openQuestion: string | null;
  recentEntities: ConversationEntityRecord[];
  lastAction: SemanticAction | null;
  currentTaskReference: string | null;
  lastRecommendationReference: string | null;
  lastToolResultSummary: string | null;
  recentEventIds: string[];
  updatedAt: string;
  expiresAt: string;
};

export function emptyConversationContextState(now: Date = new Date()): ConversationContextState {
  return {
    schemaVersion: CONVERSATION_CONTEXT_SCHEMA_VERSION,
    recentTurns: [],
    rollingSummary: '',
    activeDomain: null,
    activeTopic: null,
    openQuestion: null,
    recentEntities: [],
    lastAction: null,
    currentTaskReference: null,
    lastRecommendationReference: null,
    lastToolResultSummary: null,
    recentEventIds: [],
    updatedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString(),
  };
}

export function isContextExpired(state: ConversationContextState, now: Date = new Date()): boolean {
  const expiresAt = Date.parse(state.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
}

/** A stale context is treated as if it never existed -- this IS the retention
 *  mechanism (no separate delete/cron job required for correctness; a
 *  background cleanup job could reclaim storage later as an optimization,
 *  not a privacy requirement, since expired context is already inert). */
export function pruneExpired(state: ConversationContextState, now: Date = new Date()): ConversationContextState {
  return isContextExpired(state, now) ? emptyConversationContextState(now) : state;
}

// Defensive redaction applied to every turn before storage. This is bounded
// conversational text (never payment secrets, never image/slip content --
// those don't reach this module), but a customer can still type a phone
// number or email mid-conversation, and it doesn't need to persist here.
const PHONE_RE = /(?:\+?66|0)[\d\s-]{8,13}/gu;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
const LONG_DIGIT_RUN_RE = /\d{6,}/gu;

export function redactSensitiveContent(text: string): string {
  // PHONE_RE's char class allows internal spaces/hyphens (real phone numbers
  // are written that way), which means a greedy match can swallow a trailing
  // space before the next word -- put that trailing whitespace back outside
  // the redaction marker so surrounding punctuation/spacing isn't disturbed.
  return text
    .replace(PHONE_RE, match => `[phone]${match.match(/\s+$/u)?.[0] ?? ''}`)
    .replace(EMAIL_RE, '[email]')
    .replace(LONG_DIGIT_RUN_RE, '[number]');
}

function boundTurnContent(content: string): string {
  const redacted = redactSensitiveContent(content);
  return redacted.length > MAX_TURN_CHARS ? `${redacted.slice(0, MAX_TURN_CHARS)}…` : redacted;
}

function boundTurns(turns: ConversationTurn[]): ConversationTurn[] {
  return turns.slice(-MAX_RECENT_TURNS);
}

function boundEntities(entities: ConversationEntityRecord[]): ConversationEntityRecord[] {
  // Most-recently-observed first, capped, de-duplicated by id (a re-mention
  // moves an entity back to the front rather than creating a second copy).
  const seen = new Set<string>();
  const ordered: ConversationEntityRecord[] = [];
  for (const entity of entities) {
    if (seen.has(entity.id)) continue;
    seen.add(entity.id);
    ordered.push(entity);
    if (ordered.length >= MAX_RECENT_ENTITIES) break;
  }
  return ordered;
}

function truncateSummary(summary: string): string {
  return summary.length > MAX_SUMMARY_CHARS ? summary.slice(summary.length - MAX_SUMMARY_CHARS) : summary;
}

export type ConversationContextUpdate = {
  /** Idempotence key for this turn (e.g. a LINE webhook event id, or a
   *  request-scoped id for web). If this id was already applied, the update
   *  is a no-op -- a retried/duplicated webhook delivery or two fast
   *  messages racing must never duplicate continuity state. */
  eventId?: string;
  channel: string;
  userMessage?: string;
  assistantMessage?: string;
  activeDomain?: SemanticDomain;
  activeTopic?: string;
  /** Explicit null clears the open question (it was answered/resolved). */
  openQuestion?: string | null;
  newEntities?: SemanticContextEntity[];
  lastAction?: SemanticAction;
  currentTaskReference?: string | null;
  lastRecommendationReference?: string | null;
  lastToolResultSummary?: string | null;
  /** A short, factual addition to the rolling summary -- what the customer is
   *  trying to do, a stated preference/constraint, a selection already made,
   *  an unresolved question. Never model reasoning. */
  summaryFact?: string;
};

/**
 * Pure reducer: current persisted state + one turn's update -> next state.
 * Idempotent on `update.eventId`. Never grows unbounded. This is the ONLY
 * place conversation continuity state is computed -- callers (a real DB
 * loader, or a test) just feed it state in and take state out.
 */
export function applyConversationContextUpdate(
  current: ConversationContextState,
  update: ConversationContextUpdate,
  now: Date = new Date(),
): ConversationContextState {
  const base = pruneExpired(current, now);

  if (update.eventId && base.recentEventIds.includes(update.eventId)) {
    // Duplicate delivery of an already-applied turn -- no-op, but still
    // refresh expiry so an active conversation doesn't expire mid-retry.
    return { ...base, updatedAt: now.toISOString(), expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString() };
  }

  const nowIso = now.toISOString();
  const newTurns: ConversationTurn[] = [...base.recentTurns];
  if (update.userMessage) newTurns.push({ role: 'user', content: boundTurnContent(update.userMessage), at: nowIso, channel: update.channel });
  if (update.assistantMessage) newTurns.push({ role: 'assistant', content: boundTurnContent(update.assistantMessage), at: nowIso, channel: update.channel });

  const newEntityRecords: ConversationEntityRecord[] = (update.newEntities ?? []).map(entity => ({ ...entity, observedAt: nowIso }));
  // New/re-mentioned entities move to the front (most-recent-first).
  const mergedEntities = boundEntities([...newEntityRecords, ...base.recentEntities]);

  const recentEventIds = update.eventId
    ? [update.eventId, ...base.recentEventIds].slice(0, MAX_RECENT_EVENT_IDS)
    : base.recentEventIds;

  const rollingSummary = update.summaryFact
    ? truncateSummary(base.rollingSummary ? `${base.rollingSummary} ${update.summaryFact}` : update.summaryFact)
    : base.rollingSummary;

  return {
    schemaVersion: CONVERSATION_CONTEXT_SCHEMA_VERSION,
    recentTurns: boundTurns(newTurns),
    rollingSummary,
    activeDomain: update.activeDomain ?? base.activeDomain,
    activeTopic: update.activeTopic ?? base.activeTopic,
    openQuestion: update.openQuestion === null ? null : (update.openQuestion ?? base.openQuestion),
    recentEntities: mergedEntities,
    lastAction: update.lastAction ?? base.lastAction,
    currentTaskReference: update.currentTaskReference === null ? null : (update.currentTaskReference ?? base.currentTaskReference),
    lastRecommendationReference: update.lastRecommendationReference === null ? null : (update.lastRecommendationReference ?? base.lastRecommendationReference),
    lastToolResultSummary: update.lastToolResultSummary === null ? null : (update.lastToolResultSummary ?? base.lastToolResultSummary),
    recentEventIds,
    updatedAt: nowIso,
    expiresAt: new Date(now.getTime() + CONTEXT_TTL_MS).toISOString(),
  };
}

/**
 * The context builder Phase B's interpreter consumes. Pure, no I/O -- takes
 * whatever loadConversationContext() returned (or an empty state for a new
 * guest) and produces exactly the SemanticContext shape
 * interpretSemanticTurn() expects. The Semantic Interpreter never sees
 * ConversationContextState directly, only this.
 */
export function buildSemanticContext(state: ConversationContextState, now: Date = new Date()): SemanticContext {
  const live = pruneExpired(state, now);
  return {
    activeDomain: live.activeDomain,
    recentEntities: live.recentEntities.map(({ observedAt: _observedAt, ...entity }) => entity),
    lastAction: live.lastAction ?? undefined,
    openQuestion: live.openQuestion ?? undefined,
  };
}

// --- DB I/O (extends guest_agent_state.state.conversationContext) ---
// Not covered by npm test (network) -- same convention as
// _thongthai-runtime-v3.ts's loadBrainRuntime/persistBrainRuntime, which this
// mirrors. The reducer/builder above carry all the tested logic; these are
// thin persistence wrappers around it.

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}
async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = configuration(); if (!c) throw new Error('Supabase configuration missing');
  const res = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Supabase ${res.status}: ${body.slice(0, 180)}`); }
  return res;
}
function eq(value: string): string { return encodeURIComponent(value); }

function isConversationContextState(value: unknown): value is ConversationContextState {
  return Boolean(value) && typeof value === 'object' && (value as { schemaVersion?: unknown }).schemaVersion === CONVERSATION_CONTEXT_SCHEMA_VERSION;
}

export function parseConversationContextState(value: unknown, now: Date = new Date()): ConversationContextState {
  return isConversationContextState(value) ? pruneExpired(value, now) : emptyConversationContextState(now);
}

export async function loadConversationContext(guestDbId: string | null, now: Date = new Date()): Promise<ConversationContextState> {
  if (!guestDbId || !configuration()) return emptyConversationContextState(now);
  try {
    const res = await dbFetch(`guest_agent_state?guest_id=eq.${eq(guestDbId)}&select=state&limit=1`);
    const rows = await res.json() as Array<{ state?: Record<string, unknown> }>;
    const raw = rows[0]?.state?.conversationContext;
    return parseConversationContextState(raw, now);
  } catch (error) {
    console.error('CONVERSATION_CONTEXT_LOAD_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
    return emptyConversationContextState(now);
  }
}

export async function persistConversationContext(guestDbId: string | null, state: ConversationContextState): Promise<void> {
  if (!guestDbId || !configuration()) return;
  try {
    const applied = await patchGuestAgentState(guestDbId, { set:{ conversationContext:state } });
    if (!applied) throw new Error('guest_agent_state_cas_exhausted');
  } catch (error) {
    console.error('CONVERSATION_CONTEXT_PERSIST_ERROR', error instanceof Error ? error.message.slice(0, 200) : 'unknown');
  }
}
