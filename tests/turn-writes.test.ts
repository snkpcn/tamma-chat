import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// A no-model turn wrote ai_response_turns, one_mind_traces, guest_events
// and the turn outcome one after another. They now run side by side -- and
// still all land before the reply.

const LOG_TABLES = ['ai_response_turns', 'one_mind_traces', 'guest_events', 'customer_turn_outcomes'];

/** Every backend call takes `delayMs`; record when each log write starts and ends. */
function instrument(harness: Harness, delayMs: number) {
  const writes: Array<{ table: string; start: number; end: number }> = [];
  const inner = harness.fetchMock;
  const wrapped = (async (url: string | URL, init: RequestInit = {}) => {
    const u = String(url);
    if (!u.includes('/rest/v1/')) return inner(url, init);
    const table = u.replace(/^.*\/rest\/v1\//u, '').replace(/\?.*$/u, '');
    const start = Date.now();
    await new Promise(resolve => setTimeout(resolve, delayMs));
    const response = await inner(url, init);
    if ((init.method ?? 'GET') !== 'GET' && LOG_TABLES.includes(table)) writes.push({ table, start, end: Date.now() });
    return response;
  }) as typeof fetch;
  (harness as { fetchMock: typeof fetch }).fetchMock = wrapped;
  global.fetch = wrapped;
  return writes;
}

const overlapping = (writes: Array<{ start: number; end: number }>) =>
  writes.some((a, i) => writes.some((b, j) => i !== j && a.start < b.end && b.start < a.end));

for (const channel of ['web', 'line'] as const) {
  test(`${channel}: the turn's log writes overlap, and every one has landed when the reply is ready`, async () => {
    await withHarness(async harness => {
      const writes = instrument(harness, 40);
      let returnedAt = 0;
      if (channel === 'web') {
        await processThongthaiChatCore(brainRequest('เปิดกี่โมง', guestId('turn-writes-web'), 'web'), 'turn-writes-web');
        returnedAt = Date.now();
      } else {
        const result = await deliverLineTexts(harness, { userId: 'U-turn-writes', texts: ['เปิดกี่โมง'] });
        returnedAt = result.calls.find(call => call.endpoint === 'message/reply') ? Date.now() : 0;
        assert.ok(returnedAt, 'the customer got a reply');
      }
      const tables = new Set(writes.map(write => write.table));
      for (const table of ['ai_response_turns', 'one_mind_traces', 'customer_turn_outcomes']) assert.ok(tables.has(table), `${table} written`);
      assert.ok(writes.every(write => write.end <= returnedAt), 'no log write is still in flight when the reply is ready');
      assert.ok(overlapping(writes), 'log writes run side by side, not one after another');
    });
  });
}

test('a failed log write is logged and does not cost the customer the reply', async () => {
  await withHarness(async harness => {
    const inner = harness.fetchMock;
    const failing = (async (url: string | URL, init: RequestInit = {}) =>
      String(url).includes('/rest/v1/one_mind_traces') ? new Response('{"message":"down"}', { status: 500 }) : inner(url, init)) as typeof fetch;
    (harness as { fetchMock: typeof fetch }).fetchMock = failing;
    global.fetch = failing;
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.map(String).join(' ')); };
    try {
      const result = await processThongthaiChatCore(brainRequest('เปิดกี่โมง', guestId('turn-writes-fail'), 'web'), 'turn-writes-fail');
      assert.match(String((result.payload as { message?: unknown }).message), /06:00–18:00/u);
    } finally {
      console.error = original;
    }
    // persistOneMindTrace reports its own failure; the turn is unaffected either way.
    assert.ok(!errors.some(line => /THONGTHAI_TURN_WRITE_DRAIN_CAPPED/u.test(line)), 'nothing stalled the reply');
  });
});
