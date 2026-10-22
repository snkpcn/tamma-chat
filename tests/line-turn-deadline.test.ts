import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createHarness } from './helpers/canonical-core-harness';
import {
  CUSTOMER_TURN_BUDGET_MS,
  CUSTOMER_TURN_HARD_DEADLINE_MS,
} from '../netlify/functions/_customer-turn-budget';
import { TURN_CLAIM_STALE_MS } from '../netlify/functions/_ai-cost-store';

/** The lowest synchronous Netlify request limit. */
const NETLIFY_SYNC_LIMIT_MS = 10_000;
const LINE_REPLY = 'https://api.line.me/v2/bot/message/reply';
// Both the plain and the transaction wording of the LINE turn-unfinished
// reply contain this; these turns ask a price, so the plain one is sent.
const FALLBACK = 'ไม่ทันในรอบนี้';

const ENV = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  CUSTOMER_PII_ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  OPENAI_API_KEY: 'test-openai-key',
  LINE_CHANNEL_SECRET: 'test-line-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'test-line-token',
  THONGTHAI_ONE_MIND_CUTOVER: '1',
};

type Seen = { url: string; at: number; hasSignal: boolean; abortedAt?: number; body?: string };

/** Every request hangs until its own signal aborts it -- the worst case a
 *  dependency can produce. A request with NO signal is recorded and
 *  rejected after 50ms so a regression fails the assertion instead of
 *  hanging the suite. `answerAt` lets a test answer a request immediately
 *  instead, e.g. to model webhook-level work that completed. */
async function withHangingNetwork<T>(
  run: (seen: Seen[], startedAt: number) => Promise<T>,
  answerAt?: (url: string) => Response | undefined,
): Promise<T> {
  const before = Object.fromEntries(Object.keys(ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  const originalFetch = global.fetch;
  const originalNow = Date.now;
  const deliveryStore = createHarness().fetchMock;
  const seen: Seen[] = [];
  const startedAt = Date.now();
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === 'string' ? input : (input as Request).url ?? input);
    const entry: Seen = { url, at: originalNow() - startedAt, hasSignal: Boolean(init?.signal), body: String(init?.body ?? '') };
    seen.push(entry);
    // The durable outbox is available; answer dependencies and LINE itself
    // hang. Outbox outages are tested separately as retryable failures.
    if (url.includes('/rest/v1/line_customer_deliveries')) return deliveryStore(input, init);
    const answer = answerAt?.(url);
    if (answer) return answer;
    const signal = init?.signal;
    return new Promise<Response>((_resolve, reject) => {
      if (!signal) { setTimeout(() => reject(new Error('unbounded request')), 50); return; }
      const abort = () => { entry.abortedAt = originalNow() - startedAt; reject(signal.reason); };
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort);
    });
  }) as typeof fetch;
  try {
    return await run(seen, startedAt);
  } finally {
    global.fetch = originalFetch;
    Date.now = originalNow;
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
}

function customerTextDelivery(text: string): { httpMethod: string; headers: Record<string, string>; body: string } {
  const body = JSON.stringify({
    destination: 'test',
    events: [{
      type: 'message', webhookEventId: `deadline-${text}`, replyToken: 'reply-token', timestamp: Date.now(),
      source: { type: 'user', userId: 'U-deadline-test' },
      message: { id: `m-${text}`, type: 'text', text },
    }],
  });
  const signature = createHmac('sha256', ENV.LINE_CHANNEL_SECRET).update(body, 'utf8').digest('base64');
  return { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body };
}

test('the turn deadline, reply included, fits the function limit and the claim window', () => {
  assert.ok(CUSTOMER_TURN_HARD_DEADLINE_MS > CUSTOMER_TURN_BUDGET_MS, 'the reply needs its own slice');
  assert.ok(CUSTOMER_TURN_HARD_DEADLINE_MS < NETLIFY_SYNC_LIMIT_MS);
  // A live turn holds its claim until its reply is sent, at the latest at
  // the hard deadline; it must not look abandoned before then.
  assert.ok(TURN_CLAIM_STALE_MS >= CUSTOMER_TURN_HARD_DEADLINE_MS);
});

test('the clock starts at webhook entry, so pre-turn work spends the same budget', async () => {
  // Simulate 8.7s spent in webhook-level work before the customer turn:
  // contact registration completes, but the clock has moved 8.7s forward.
  // A clock started inside the core would grant a fresh 8s and a 9s reply.
  const { handler } = await import('../netlify/functions/line-webhook');
  const skewMs = CUSTOMER_TURN_BUDGET_MS + 700;
  const realNow = Date.now;
  await withHangingNetwork(async (seen, startedAt) => {
    const response = await handler(customerTextDelivery('ขี่ม้าราคาเท่าไหร่') as never, {} as never);
    const realElapsed = realNow() - startedAt;
    assert.equal(response?.statusCode, 503, 'an unacknowledged LINE send must request redelivery');

    assert.ok(
      !seen.some(entry => entry.url.includes('api.openai.com') || (entry.url.includes('/customer_turn_outcomes') && entry.body?.includes('in_progress'))),
      'with no answer budget left, neither the claim nor a core turn may start',
    );
    const replies = seen.filter(entry => entry.url === LINE_REPLY);
    assert.equal(replies.length, 1);
    assert.match(replies[0].body ?? '', new RegExp(FALLBACK, 'u'));
    // 9s deadline - 8.7s spent = ~300ms for the reply, in real time.
    assert.ok(realElapsed < 1_500, `the reply was given ${realElapsed}ms instead of what was left of the turn`);
  }, url => {
    if (!/\/rest\/v1\/(?:guests|customer_channel_contacts|customer_accounts|guest_identities)/u.test(url)) return undefined;
    Date.now = () => realNow() + skewMs;
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  });
});

test('askThongthaiReliably does not start a core turn once the budget is spent', async () => {
  const { askThongthaiReliably } = await import('../netlify/functions/_line-webhook-core');
  await withHangingNetwork(async seen => {
    const errors: string[] = [];
    const startedAt = Date.now();
    const result = await askThongthaiReliably(
      'ขี่ม้าราคาเท่าไหร่', 'U-deadline-test', 'deadline-exhausted',
      error => errors.push(error),
      Date.now() - CUSTOMER_TURN_BUDGET_MS - 1,
    );
    assert.ok(Date.now() - startedAt < 500, 'an exhausted turn must return at once');
    assert.match(String((result as { message?: unknown }).message), new RegExp(FALLBACK, 'u'), 'the honest fallback');
    assert.deepEqual(seen, [], 'no backend read and no provider call for a turn nobody waits for');
    assert.ok(errors.includes('TurnBudgetExhaustedError'));
  });
});

// Last on purpose: it abandons a core turn by design, and that turn's
// remaining requests must not land in another test's fetch mock.
test('worst case: every dependency hangs and the whole LINE turn still ends under 10s', async () => {
  const { handler } = await import('../netlify/functions/line-webhook');
  await withHangingNetwork(async (seen, startedAt) => {
    const response = await handler(customerTextDelivery('ขี่ม้าราคาเท่าไหร่') as never, {} as never);
    const elapsed = Date.now() - startedAt;
    assert.equal(response?.statusCode, 503, 'an unacknowledged LINE send must request redelivery');
    assert.ok(elapsed < NETLIFY_SYNC_LIMIT_MS, `the turn took ${elapsed}ms`);

    assert.deepEqual(seen.filter(entry => !entry.hasSignal).map(entry => entry.url), [], 'every request must be bounded');
    const replies = seen.filter(entry => entry.url === LINE_REPLY);
    assert.equal(replies.length, 1, 'the customer must still be answered');
    assert.match(replies[0].body ?? '', new RegExp(FALLBACK, 'u'), 'with the honest fallback');
    assert.ok(replies[0].at <= CUSTOMER_TURN_BUDGET_MS + 250, `the reply started at ${replies[0].at}ms`);
    assert.ok(
      (replies[0].abortedAt ?? Infinity) <= CUSTOMER_TURN_HARD_DEADLINE_MS + 250,
      `a hung reply must be cut at the hard deadline, was cut at ${replies[0].abortedAt}ms`,
    );
  });
});
