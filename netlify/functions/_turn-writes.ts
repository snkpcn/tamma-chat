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

type Scope = { pending: Array<Promise<unknown>> };
const storage = new AsyncLocalStorage<Scope>();

/** Run one turn; resolves after `run` and every write it deferred -- but
 *  never later than `drainLimitMs()` after `run` settles. The writes were
 *  awaited before this change too; the cap only stops a stalled store (or
 *  the leftovers of an abandoned, over-budget attempt) from holding the
 *  reply past the turn deadline. */
export async function withTurnWrites<T>(run: () => Promise<T>, drainLimitMs: () => number): Promise<T> {
  const scope: Scope = { pending: [] };
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

/** True while a turn scope is collecting writes (for tests). */
export function inTurnScope(): boolean {
  return storage.getStore() !== undefined;
}
