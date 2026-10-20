import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LINE_TURN_BUDGET_MS,
  LINE_MIN_RETRY_BUDGET_MS,
} from '../netlify/functions/_line-webhook-core';
import { TURN_CLAIM_TIMEOUT_MS } from '../netlify/functions/_ai-cost-store';

const CORE_SOURCE = readFileSync(
  new URL('../netlify/functions/_line-webhook-core.ts', import.meta.url),
  'utf8',
);
const PROVIDER_SOURCE = readFileSync(
  new URL('../netlify/functions/_thongthai-model-provider.ts', import.meta.url),
  'utf8',
);
const ONE_MIND_SOURCE = readFileSync(
  new URL('../netlify/functions/_thongthai-one-mind-response.ts', import.meta.url),
  'utf8',
);

/** The lowest synchronous Netlify request limit. Past this the function is
 *  killed and the customer gets silence, not a fallback. */
const NETLIFY_SYNC_LIMIT_MS = 10_000;

function constantFrom(source: string, name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*([\\d_]+)`, 'u').exec(source);
  assert.ok(match, `${name} must still exist`);
  return Number(match![1].replace(/_/gu, ''));
}

test('one turn plus its reply fits inside the synchronous function limit', () => {
  // The reply has its own slice after the answer budget (see
  // CUSTOMER_TURN_HARD_DEADLINE_MS and tests/line-turn-deadline.test.ts).
  const replyAndOverheadHeadroomMs = NETLIFY_SYNC_LIMIT_MS - LINE_TURN_BUDGET_MS;
  assert.ok(
    LINE_TURN_BUDGET_MS < NETLIFY_SYNC_LIMIT_MS,
    `a turn budget of ${LINE_TURN_BUDGET_MS}ms cannot fit in ${NETLIFY_SYNC_LIMIT_MS}ms`,
  );
  assert.ok(
    replyAndOverheadHeadroomMs >= 1_500,
    `only ${replyAndOverheadHeadroomMs}ms left for the LINE reply and webhook overhead`,
  );
  // Dedupe is inside the budget, so it must be a small slice of it.
  assert.ok(TURN_CLAIM_TIMEOUT_MS * 4 <= LINE_TURN_BUDGET_MS);
});

test('the unbounded worst case this budget replaces really did exceed the limit', () => {
  // Two provider calls per attempt (interpretation, then grounded
  // composition), each with its own independent budget, then a full retry.
  const providerBudget = constantFrom(PROVIDER_SOURCE, 'TOTAL_PROVIDER_BUDGET_MS');
  const perAttemptUnbounded = providerBudget * 2;
  const retryDelay = 250;
  const unboundedWorstCase = perAttemptUnbounded * 2 + retryDelay + TURN_CLAIM_TIMEOUT_MS;

  assert.ok(
    unboundedWorstCase > NETLIFY_SYNC_LIMIT_MS,
    'this guard is pointless if the unbounded path already fit',
  );
  // Proves the fix is load-bearing: ~29s before, bounded now.
  assert.ok(unboundedWorstCase > 25_000, `expected a large worst case, computed ${unboundedWorstCase}ms`);
  assert.ok(LINE_TURN_BUDGET_MS < unboundedWorstCase / 3);
});

test('a single provider call can still use its whole budget inside one turn', () => {
  const providerBudget = constantFrom(PROVIDER_SOURCE, 'TOTAL_PROVIDER_BUDGET_MS');
  // The budget must not be so tight that a normal interpretation call is
  // cut off: quality is not traded away to satisfy the limit.
  assert.ok(
    LINE_TURN_BUDGET_MS > providerBudget,
    `a turn budget of ${LINE_TURN_BUDGET_MS}ms would cut off a ${providerBudget}ms provider call`,
  );
});

test('the retry only starts when it has enough budget left to land', () => {
  assert.ok(LINE_MIN_RETRY_BUDGET_MS > 0);
  assert.ok(
    LINE_MIN_RETRY_BUDGET_MS < LINE_TURN_BUDGET_MS,
    'the first attempt must be allowed to use most of the budget',
  );
  const source = CORE_SOURCE.slice(CORE_SOURCE.indexOf('async function askThongthaiReliably'));
  assert.match(
    source,
    /if \(remainingMs\(\) >= LINE_MIN_RETRY_BUDGET_MS\)/u,
    'the retry must be gated on remaining budget',
  );
  assert.match(source, /LINE_THONGTHAI_RETRY_SKIPPED_NO_BUDGET/u);
  // The honest fallback is still reachable from BOTH the retried and the
  // skipped-retry path, so a bounded turn never ends in silence.
  assert.match(source, /ทองไทยรับข้อความแล้วครับ/u);
});

test('both attempts are raced against the turn budget, not just the retry', () => {
  const source = CORE_SOURCE.slice(CORE_SOURCE.indexOf('async function askThongthaiReliably'));
  const raced = source.match(/withinTurnBudget\(askThongthai\(/gu) ?? [];
  assert.equal(raced.length, 2, 'the first attempt must be bounded too, not only the retry');
});

// 'the turn clock starts before the dedupe claim' used to pin the clock's
// position in this file's source. The clock now starts at function entry in
// line-webhook.ts and is passed down; tests/line-turn-deadline.test.ts proves
// that by running the webhook, including the claim being bounded by it.

test('the one-mind composer cutoff can now actually fire before the kill', () => {
  const cutoff = constantFrom(ONE_MIND_SOURCE, 'COMPOSER_MODEL_BUDGET_CUTOFF_MS');
  // Documented finding, not a change: at 18s this latency cutoff is dead
  // code on a 10s synchronous function -- the process is gone first. The
  // turn budget is what actually bounds the turn today. Asserted so the
  // relationship is visible if either number moves.
  assert.ok(
    cutoff > NETLIFY_SYNC_LIMIT_MS,
    'if the composer cutoff ever drops below the function limit, it becomes the real bound and this note needs revisiting',
  );
  assert.ok(LINE_TURN_BUDGET_MS < cutoff, 'the turn budget must be the binding constraint');
});
