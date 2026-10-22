/** LINE's short answer budget leaves a separate slice for delivery.
 * Web uses its own budget below: a real provider call plus Supabase state
 * and cost persistence can legitimately take more than eight seconds.
 * Budgets bound waiting; already-issued idempotent writes may still settle.
 */
export const CUSTOMER_TURN_BUDGET_MS = 8_000;

/** Reserved after the answer budget for the channel to deliver the reply.
 *  The answer may use all of CUSTOMER_TURN_BUDGET_MS; the reply must then
 *  land inside this slice, so the whole turn ends at
 *  CUSTOMER_TURN_HARD_DEADLINE_MS from function entry. */
export const CUSTOMER_REPLY_BUDGET_MS = 1_000;

/** LINE's absolute end, reply included, measured from function entry.
 *  Retain the short delivery target independently of the web deadline. */
export const CUSTOMER_TURN_HARD_DEADLINE_MS = CUSTOMER_TURN_BUDGET_MS + CUSTOMER_REPLY_BUDGET_MS;

/** Below the browser's 30s request timeout, including a 750ms claim and
 * transport overhead. Netlify synchronous functions default to 60s:
 * https://docs.netlify.com/build/functions/configuration/
 * A successful OpenAI interpretation must not be discarded merely because
 * real database round trips pushed the whole web turn past LINE's 8s.
 */
export const WEB_CUSTOMER_TURN_BUDGET_MS = 22_000;
export const WEB_CUSTOMER_TURN_HARD_DEADLINE_MS = 23_000;

export function customerTurnTiming(channel: string): { answerMs: number; hardDeadlineMs: number } {
  return channel === 'web'
    ? { answerMs: WEB_CUSTOMER_TURN_BUDGET_MS, hardDeadlineMs: WEB_CUSTOMER_TURN_HARD_DEADLINE_MS }
    : { answerMs: CUSTOMER_TURN_BUDGET_MS, hardDeadlineMs: CUSTOMER_TURN_HARD_DEADLINE_MS };
}

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
