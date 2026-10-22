/** Log writes of one customer turn run side by side, and all finish before
 *  the reply leaves.
 *
 *  A no-model turn spent about a quarter of its time on bookkeeping rows
 *  written one after another -- ai_response_turns, one_mind_traces,
 *  guest_events, the turn outcome -- none of which reads another. Inside a
 *  turn scope a write is started at once and collected instead of awaited
 *  where it is issued; the scope owner awaits every collected write before
 *  it returns. Nothing is fire-and-forget: a function that ends with the
 *  turn (Netlify) could otherwise drop it.
 *
 *  Only independent, append/upsert log rows belong here. State that is
 *  compare-and-swapped (guest_agent_state) stays awaited in order. Outside a
 *  scope, a deferred write is simply awaited. */
import { AsyncLocalStorage } from 'node:async_hooks';

type Scope = { pending: Array<Promise<unknown>>; reads: Map<string, Promise<unknown>>; answerDeadlineAt?: number };
const storage = new AsyncLocalStorage<Scope>();

/** Run one turn; resolves after `run` and every write it deferred -- but
 *  never later than `drainLimitMs()` after `run` settles. The writes were
 *  awaited before this change too; the cap only stops a stalled store (or
 *  the leftovers of an abandoned, over-budget attempt) from holding the
 *  reply past the turn deadline. */
export async function withTurnWrites<T>(run: () => Promise<T>, drainLimitMs: () => number, answerDeadlineAt?: number): Promise<T> {
  const scope: Scope = { pending: [], reads: new Map(), answerDeadlineAt };
  try {
    return await storage.run(scope, run);
  } finally {
    const limit = Math.max(0, drainLimitMs());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cap = new Promise<'cap'>(resolve => { timer = setTimeout(() => resolve('cap'), limit); });
    const drain = (async () => {
      // Writes may defer further writes while settling; drain until quiet.
      while (scope.pending.length) await Promise.allSettled(scope.pending.splice(0));
      return 'drained' as const;
    })();
    if (await Promise.race([drain, cap]) === 'cap') {
      console.error('THONGTHAI_TURN_WRITE_DRAIN_CAPPED', JSON.stringify({ pending: scope.pending.length, limit_ms: limit }));
    }
    if (timer) clearTimeout(timer);
  }
}

/** The one absolute answer deadline includes identity, memory and sources.
 * A downstream model stage must not start a fresh full budget after that
 * work has already consumed most of the customer's turn. */
export function remainingTurnAnswerMs(): number {
  const deadline = storage.getStore()?.answerDeadlineAt;
  return deadline === undefined ? Infinity : Math.max(0, deadline - Date.now());
}

/** Start `write` now; inside a turn scope, wait for it at the end of the
 *  turn instead of here. Its result is never needed by the caller. A
 *  deferred failure can no longer reach the caller's catch, so it is logged
 *  here (THONGTHAI_TURN_WRITE_ERROR {write}) for monitoring. Outside a
 *  scope the write is awaited and its error propagates as before. */
export async function deferTurnWrite(label: string, write: () => Promise<unknown>): Promise<void> {
  const scope = storage.getStore();
  if (!scope) { await write(); return; }
  scope.pending.push(write().catch(error => {
    console.error('THONGTHAI_TURN_WRITE_ERROR', JSON.stringify({
      write: label, error: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    }));
  }));
}

/** One read of `key` per turn, shared by every caller that only LOOKS at
 *  the value. A no-model turn read the same guest_agent_state row eight
 *  times one after another, from read-only checks (is a task open? was ATV
 *  discussed? is a question pending?) -- about 150 ms each in production.
 *  Any write to that table in this turn forgets every memoised read (see
 *  noteBackendWrite), so a later look sees the write. Never use it for a
 *  read that feeds a compare-and-swap: those must read the row fresh, as
 *  the cost ledger and patchGuestAgentState do. A failed read is not kept.
 *  Outside a scope the read simply runs. */
export function readOncePerTurn<T>(key: string, read: () => Promise<T>): Promise<T> {
  const scope = storage.getStore();
  if (!scope) return read();
  const cached = scope.reads.get(key) as Promise<T> | undefined;
  if (cached) return cached;
  const pending = read();
  scope.reads.set(key, pending);
  pending.catch(() => { if (scope.reads.get(key) === pending) scope.reads.delete(key); });
  return pending;
}

/** Called for every backend request that is not a GET: a write to
 *  guest_agent_state makes every memoised read of this turn stale. */
export function noteBackendWrite(url: string): void {
  if (!url.includes('/rest/v1/guest_agent_state')) return;
  storage.getStore()?.reads.clear();
}

/** True while a turn scope is collecting writes (for tests). */
export function inTurnScope(): boolean {
  return storage.getStore() !== undefined;
}
