/** Wall-clock budget for ONE customer turn, shared by every channel.
 *
 *  A synchronous Netlify function is killed at its request limit, the lowest
 *  of which is 10s. Nothing in the customer path is bounded by that on its
 *  own: each provider call owns an independent 7s budget, a turn makes two
 *  of them (interpretation then grounded composition), and LINE's retry
 *  doubles the whole thing -- a worst case near 29s. The function dies
 *  first, so the customer gets silence instead of the honest fallback each
 *  channel already has.
 *
 *  8s leaves room for the channel's own reply/serialization work inside 10s.
 *  This bounds when the customer gets AN ANSWER; it does not cancel
 *  already-issued database writes, which remain idempotent.
 */
export const CUSTOMER_TURN_BUDGET_MS = 8_000;

/** Reserved after the answer budget for the channel to deliver the reply.
 *  The answer may use all of CUSTOMER_TURN_BUDGET_MS; the reply must then
 *  land inside this slice, so the whole turn ends at
 *  CUSTOMER_TURN_HARD_DEADLINE_MS from function entry. */
export const CUSTOMER_REPLY_BUDGET_MS = 1_000;

/** Absolute end of one turn, reply included, measured from function entry.
 *  Kept under the 10s synchronous limit with margin for the response. */
export const CUSTOMER_TURN_HARD_DEADLINE_MS = CUSTOMER_TURN_BUDGET_MS + CUSTOMER_REPLY_BUDGET_MS;

/** Below this there is not enough time left for a retry to plausibly
 *  finish, so spend the remaining time on the fallback reply instead of
 *  starting an attempt that cannot land. Only channels that retry (LINE)
 *  consult this. */
export const CUSTOMER_MIN_RETRY_BUDGET_MS = 2_500;

export class TurnBudgetExhaustedError extends Error {
  constructor(remainingMs: number) {
    super(`Customer turn budget exhausted with ${remainingMs}ms left`);
    this.name = 'TurnBudgetExhaustedError';
  }
}

/** Resolve with the attempt, or reject once the turn budget runs out --
 *  whichever happens first. The abandoned attempt's own per-call timeouts
 *  still fire; we simply stop waiting for it. */
export function withinTurnBudget<T>(attempt: Promise<T>, budgetMs: number): Promise<T> {
  if (budgetMs <= 0) return Promise.reject(new TurnBudgetExhaustedError(budgetMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new TurnBudgetExhaustedError(0)), budgetMs);
  });
  return Promise.race([attempt, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Milliseconds left in a turn that began at `turnStartedAt`. */
export function remainingTurnBudgetMs(
  turnStartedAt: number,
  budgetMs: number = CUSTOMER_TURN_BUDGET_MS,
  now: number = Date.now(),
): number {
  return budgetMs - (now - turnStartedAt);
}
