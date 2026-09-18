// Shared optimistic-concurrency store for guest_agent_state.
//
// Why this exists: conversationContext, taskState and legacy brain working
// state all live as sibling keys inside ONE JSONB column. Plain read-modify-
// write upserts can lose a concurrent sibling update. This module gives every
// writer the same compare-and-swap primitive keyed by the row's updated_at.
//
// A CAS conflict is not an error: callers that derived new state from the old
// snapshot MUST reload/recompute before retrying. Never blindly write the same
// stale patch after a conflict.
export type GuestAgentStateSnapshot = {
  exists: boolean;
  state: Record<string, unknown>;
  updatedAt: string | null;
};

export type GuestAgentStatePatch = {
  set?: Record<string, unknown>;
  removeKeys?: string[];
};

export type GuestAgentStateCasResult =
  | { status: 'applied'; snapshot: GuestAgentStateSnapshot }
  | { status: 'conflict' }
  | { status: 'unconfigured' };

function configuration(): { url: string; key: string } | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = configuration();
  if (!c) throw new Error('Supabase configuration missing');
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Supabase ${response.status}: ${body.slice(0, 180)}`);
  }
  return response;
}

function eq(value: string): string {
  return encodeURIComponent(value);
}

export function applyGuestAgentStatePatch(
  state: Record<string, unknown>,
  patch: GuestAgentStatePatch,
): Record<string, unknown> {
  const next = { ...state, ...(patch.set ?? {}) };
  for (const key of patch.removeKeys ?? []) delete next[key];
  return next;
}

export async function loadGuestAgentStateSnapshot(
  guestDbId: string | null,
): Promise<GuestAgentStateSnapshot> {
  if (!guestDbId || !configuration()) return { exists:false, state:{}, updatedAt:null };
  const response = await dbFetch(
    `guest_agent_state?guest_id=eq.${eq(guestDbId)}&select=state,updated_at&limit=1`,
  );
  const rows = await response.json() as Array<{ state?: Record<string, unknown>; updated_at?: string | null }>;
  const row = rows[0];
  return row
    ? { exists:true, state:row.state ?? {}, updatedAt:row.updated_at ?? null }
    : { exists:false, state:{}, updatedAt:null };
}

export async function compareAndSwapGuestAgentState(
  guestDbId: string | null,
  expected: GuestAgentStateSnapshot,
  patch: GuestAgentStatePatch,
  now: Date = new Date(),
): Promise<GuestAgentStateCasResult> {
  if (!guestDbId || !configuration()) return { status:'unconfigured' };

  const nextState = applyGuestAgentStatePatch(expected.state, patch);
  const nextUpdatedAt = now.toISOString();

  if (!expected.exists) {
    const response = await dbFetch('guest_agent_state?on_conflict=guest_id&select=state,updated_at', {
      method:'POST',
      headers:{ Prefer:'resolution=ignore-duplicates,return=representation' },
      body:JSON.stringify({ guest_id:guestDbId, state:nextState, updated_at:nextUpdatedAt }),
    });
    const rows = await response.json() as Array<{ state?: Record<string, unknown>; updated_at?: string | null }>;
    const row = rows[0];
    return row
      ? { status:'applied', snapshot:{ exists:true, state:row.state ?? {}, updatedAt:row.updated_at ?? nextUpdatedAt } }
      : { status:'conflict' };
  }

  // updated_at is our optimistic revision token. Null is treated as a
  // conflict-safe reload requirement rather than falling back to an
  // unconditional update.
  if (!expected.updatedAt) return { status:'conflict' };

  const response = await dbFetch(
    `guest_agent_state?guest_id=eq.${eq(guestDbId)}&updated_at=eq.${eq(expected.updatedAt)}&select=state,updated_at`,
    {
      method:'PATCH',
      headers:{ Prefer:'return=representation' },
      body:JSON.stringify({ state:nextState, updated_at:nextUpdatedAt }),
    },
  );
  const rows = await response.json() as Array<{ state?: Record<string, unknown>; updated_at?: string | null }>;
  const row = rows[0];
  return row
    ? { status:'applied', snapshot:{ exists:true, state:row.state ?? {}, updatedAt:row.updated_at ?? nextUpdatedAt } }
    : { status:'conflict' };
}

/** Convenience for legacy writers whose patch itself does not depend on the
 * current row. Safe to retry because each attempt recomputes the merge from a
 * fresh snapshot. */
export async function patchGuestAgentState(
  guestDbId: string | null,
  patch: GuestAgentStatePatch,
  maxAttempts = 4,
): Promise<boolean> {
  if (!guestDbId || !configuration()) return false;
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    const snapshot = await loadGuestAgentStateSnapshot(guestDbId);
    const result = await compareAndSwapGuestAgentState(guestDbId, snapshot, patch);
    if (result.status === 'applied') return true;
    if (result.status === 'unconfigured') return false;
  }
  return false;
}
