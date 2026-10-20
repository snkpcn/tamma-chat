import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { touchAiConversation, reserveAiCall, AiBudgetBlockedError } from '../netlify/functions/_ai-cost-ledger';

const CHAT_SOURCE = readFileSync(
  new URL('../netlify/functions/thongthai-chat.ts', import.meta.url),
  'utf8',
);

const LEDGER_KEYS = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;

function withUnavailableLedger<T>(run: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(LEDGER_KEYS.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  process.env.SUPABASE_URL = 'https://heartbeat.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  // Reads succeed, writes never apply: this is the compare-and-swap
  // contention / degraded-store case, not a clean outage.
  global.fetch = (async (input, init) => {
    if (!String(input).startsWith('https://heartbeat.test/')) throw new Error('Unexpected paid provider request');
    if (!init?.method || init.method === 'GET') return new Response(JSON.stringify([]));
    return new Response(JSON.stringify([]));
  }) as typeof fetch;
  return run().finally(() => {
    global.fetch = originalFetch;
    for (const key of LEDGER_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
}

test('the ledger heartbeat really can reject when the store will not accept a write', async () => {
  await withUnavailableLedger(async () => {
    await assert.rejects(
      touchAiConversation({
        conversationId:'c', guestDbId:'g', channel:'line', eventId:'e', callerLabel:'customer_activity',
      }),
      error => error instanceof AiBudgetBlockedError && error.reason === 'ledger_unavailable',
    );
  });
});

test('a free turn survives a rejected heartbeat instead of losing the reply', async () => {
  await withUnavailableLedger(async () => {
    // This is the shape thongthai-chat.ts uses: the heartbeat runs beside
    // other independent writes in one Promise.all. Unguarded, its rejection
    // takes the whole customer turn down.
    const guarded = Promise.all([
      Promise.resolve('identity-registered'),
      touchAiConversation({
        conversationId:'c', guestDbId:'g', channel:'line', eventId:'e', callerLabel:'customer_activity',
      }).catch(() => undefined),
      Promise.resolve('preferences-captured'),
    ]);
    const settled = await guarded;
    assert.equal(settled[0], 'identity-registered');
    assert.equal(settled[2], 'preferences-captured');
  });
});

test('the paid path still fails closed when the ledger is unavailable', async () => {
  await withUnavailableLedger(async () => {
    // Guarding the heartbeat must not become a way for an unaccounted paid
    // call to proceed. reserveAiCall owns that gate independently.
    await assert.rejects(
      reserveAiCall(
        { conversationId:'c', guestDbId:'g', channel:'line', eventId:'e', callerLabel:'semantic-interpreter' },
        'gpt-5.6-terra', ['ราคาขี่ม้าเท่าไหร่'], 700,
      ),
      error => error instanceof AiBudgetBlockedError && error.reason === 'ledger_unavailable',
    );
  });
});

test('a missing guest id cannot produce a paid reservation either', async () => {
  await assert.rejects(
    reserveAiCall(
      { conversationId:'c', guestDbId:null, channel:'line', eventId:'e', callerLabel:'semantic-interpreter' },
      'gpt-5.6-terra', ['ทดสอบ'], 700,
    ),
    error => error instanceof AiBudgetBlockedError && error.reason === 'ledger_unavailable',
  );
});

test('source guard: the customer turn never awaits an unguarded heartbeat', () => {
  const call = CHAT_SOURCE.indexOf('touchAiConversation({');
  assert.ok(call > 0, 'thongthai-chat.ts must still send the activity heartbeat');
  const tail = CHAT_SOURCE.slice(call, call + 900);
  assert.match(
    tail,
    /\}\)\.catch\(/u,
    'the heartbeat must be .catch()-guarded so a free turn cannot fail on it',
  );
  assert.match(tail, /THONGTHAI_AI_CONVERSATION_HEARTBEAT_ERROR/u);
  // Exactly one heartbeat call site, so the guard above covers all of them.
  assert.equal(
    CHAT_SOURCE.split('touchAiConversation(').length - 1, 1,
    'a second heartbeat call site would need its own guard',
  );
});
