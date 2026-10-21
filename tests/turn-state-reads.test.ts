import test from 'node:test';
import assert from 'node:assert/strict';
import { backendFetch } from '../netlify/functions/_backend-fetch';
import { readOncePerTurn, withTurnWrites } from '../netlify/functions/_turn-writes';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// A no-model turn read the same guest_agent_state row eight times one after
// another from read-only checks, about 1.2 s at 150 ms per request. Those
// checks now share one read per turn; the cost ledger and every
// compare-and-swap still read the row fresh.

function countStateReads(harness: Harness): () => number {
  const inner = harness.fetchMock;
  let reads = 0;
  const wrapped = (async (url: string | URL, init: RequestInit = {}) => {
    if (String(url).includes('/rest/v1/guest_agent_state') && (init.method ?? 'GET') === 'GET') reads += 1;
    return inner(url, init);
  }) as typeof fetch;
  harness.fetchMock = wrapped;
  global.fetch = wrapped;
  return () => reads;
}

for (const channel of ['web', 'line'] as const) {
  test(`${channel}: "มีกิจกรรมอะไรบ้าง" reads the guest's state a handful of times, not once per check`, async () => {
    await withHarness(async harness => {
      const reads = countStateReads(harness);
      let reply = '';
      if (channel === 'web') {
        reply = String(((await processThongthaiChatCore(brainRequest('มีกิจกรรมอะไรบ้าง', guestId('state-reads'), 'web'), 'state-reads')).payload as { message?: unknown }).message ?? '');
      } else {
        reply = (await deliverLineTexts(harness, { userId: 'U-state-reads', texts: ['มีกิจกรรมอะไรบ้าง'] })).replies[0]?.texts.join('\n') ?? '';
      }
      assert.match(reply, /กิจกรรม/u);
      // ledger (fresh) + shared look + conversation context + brain runtime + CAS patch.
      assert.ok(reads() <= 5, `guest_agent_state reads: ${reads()}`);
    });
  });
}

test('a write to guest_agent_state in the turn makes the next look read the row again', async () => {
  process.env.SUPABASE_URL ??= 'https://example.supabase.co';
  const previous = global.fetch;
  global.fetch = (async () => new Response('[]', { status: 200 })) as typeof fetch;
  try {
    let reads = 0;
    const look = () => readOncePerTurn('guest_agent_state:g1', async () => { reads += 1; return { n: reads }; });
    await withTurnWrites(async () => {
      assert.deepEqual(await look(), { n: 1 });
      assert.deepEqual(await look(), { n: 1 }, 'shared inside the turn');
      await backendFetch(`${process.env.SUPABASE_URL}/rest/v1/guest_agent_state?guest_id=eq.g1`, { method: 'PATCH', body: '{}' });
      assert.deepEqual(await look(), { n: 2 }, 'read again after the write');
      await backendFetch(`${process.env.SUPABASE_URL}/rest/v1/guest_events`, { method: 'POST', body: '{}' });
      assert.deepEqual(await look(), { n: 2 }, 'a write to another table changes nothing');
    }, () => 1_000);
    // Outside a turn nothing is shared.
    await look(); await look();
    assert.equal(reads, 4);
  } finally {
    global.fetch = previous;
  }
});

test('a failed look is not kept for the rest of the turn', async () => {
  await withTurnWrites(async () => {
    let attempts = 0;
    const look = () => readOncePerTurn('k', async () => { attempts += 1; if (attempts === 1) throw new Error('down'); return attempts; });
    await assert.rejects(look());
    assert.equal(await look(), 2);
  }, () => 1_000);
});
