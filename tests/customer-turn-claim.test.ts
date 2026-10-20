import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import {
  claimCustomerTurn,
  persistCustomerTurnOutcome,
  TURN_CLAIM_STALE_MS,
  TURN_CLAIM_TIMEOUT_MS,
  type TurnClaimOutcome,
} from '../netlify/functions/_ai-cost-store';

const sql = (path:string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const CORE_SOURCE = readFileSync(
  new URL('../netlify/functions/_line-webhook-core.ts', import.meta.url),
  'utf8',
);

// ---------------------------------------------------------------------------
// Migration: real Postgres via pglite. Never applied to a hosted database.
// ---------------------------------------------------------------------------

async function migratedDb(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(sql('supabase/migrations/20260929003000_ai_api_cost_observability_v1.sql').split('alter table public.ops_notification_channels')[0]);
  await db.exec(sql('netlify/functions/supabase/one-mind-observability-v1.sql'));
  await db.exec(sql('supabase/migrations/20261009090000_customer_turn_monitor_v1.sql'));
  return db;
}

test('the claim migration keeps every pre-existing row valid under the new check', async () => {
  const db = await migratedDb();
  try {
    // Rows written by the deployed code BEFORE this migration exists.
    await db.exec(`
      insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,error_type,duration_ms)
      values ('line','old-done','c','completed',null,1200),
             ('line','old-failed','c','failed','TimeoutError',2500),
             ('web','old-done','c','completed',null,800);
    `);
    const before = await db.query<{ count:string }>('select count(*)::text as count from customer_turn_outcomes');
    assert.equal(before.rows[0].count, '3');

    // Applying the migration must not fail on, or invalidate, those rows.
    await db.exec(sql('supabase/migrations/20261020120000_customer_turn_claim_v1.sql'));

    const after = await db.query<Record<string,unknown>>(
      'select event_id,channel,outcome,claimed_at from customer_turn_outcomes order by channel,event_id',
    );
    assert.equal(after.rows.length, 3, 'no pre-existing row may be dropped');
    assert.ok(after.rows.every(row => row.claimed_at === null), 'existing rows need no backfill');

    // The constraint really is enforced, and really does accept the new value.
    await db.exec(`
      insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,duration_ms,claimed_at)
      values ('line','claimed-now','c','in_progress',0,now());
    `);
    await assert.rejects(
      db.exec(`
        insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,duration_ms)
        values ('line','bogus','c','not_a_real_outcome',0);
      `),
      /customer_turn_outcomes_outcome_check|violates check constraint/u,
    );
  } finally {
    await db.close();
  }
});

test('an abandoned claim is reported honestly by the monitor view', async () => {
  const db = await migratedDb();
  try {
    await db.exec(sql('supabase/migrations/20261020120000_customer_turn_claim_v1.sql'));
    await db.exec(`
      insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,duration_ms,claimed_at)
      values ('line','abandoned','c','in_progress',0,now()-interval '5 minutes');
    `);
    const { rows } = await db.query<Record<string,unknown>>(
      `select outcome,final_response_source from thongthai_customer_turn_monitor where event_id='abandoned'`,
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].outcome, 'in_progress');
    assert.equal(
      rows[0].final_response_source, 'in_flight_or_abandoned',
      'an abandoned claim must not be bucketed with unrelated legacy routes',
    );
  } finally {
    await db.close();
  }
});

test('a completed turn overwrites its own claim instead of adding a row', async () => {
  const db = await migratedDb();
  try {
    await db.exec(sql('supabase/migrations/20261020120000_customer_turn_claim_v1.sql'));
    // The claim, then the end-of-turn merge write, on the same primary key.
    await db.exec(`
      insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,duration_ms,claimed_at)
      values ('line','turn-1','c','in_progress',0,now());
      insert into customer_turn_outcomes (channel,event_id,conversation_id,outcome,error_type,duration_ms)
      values ('line','turn-1','c','completed',null,1340)
      on conflict (channel,event_id,environment)
      do update set outcome=excluded.outcome,duration_ms=excluded.duration_ms,error_type=excluded.error_type;
    `);
    const { rows } = await db.query<Record<string,unknown>>(
      `select outcome,duration_ms from customer_turn_outcomes where event_id='turn-1'`,
    );
    assert.equal(rows.length, 1, 'the claim and the outcome are one row, not two');
    assert.equal(rows[0].outcome, 'completed');
    assert.equal(Number(rows[0].duration_ms), 1340);
  } finally {
    await db.close();
  }
});

// ---------------------------------------------------------------------------
// claimCustomerTurn behavior against a scripted PostgREST
// ---------------------------------------------------------------------------

type Scripted = {
  insert?: (signal?: AbortSignal | null) => Promise<Response> | Response;
  patch?: (signal?: AbortSignal | null) => Promise<Response> | Response;
};

/** A request that only ever ends when its deadline aborts it -- the same way
 *  a real fetch behaves against an unresponsive server. backendFetch passes
 *  the deadline in as init.signal, so the fake must honor it or nothing can
 *  ever time out. */
function neverResponds(signal?: AbortSignal | null): Promise<Response> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    if (signal.aborted) {
      reject(Object.assign(new Error('aborted'), { name:'AbortError' }));
      return;
    }
    signal.addEventListener('abort', () => {
      reject(Object.assign(new Error('aborted'), { name:'AbortError' }));
    }, { once:true });
  });
}

type Captured = { outcome:string; channel:string; event_id:string; latency_ms:number; environment:string };

async function withScriptedStore<T>(
  scripted: Scripted,
  run: (captured: Captured[]) => Promise<T>,
): Promise<T> {
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const captured: Captured[] = [];
  process.env.SUPABASE_URL = 'https://claim.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  global.fetch = (async (_input, init) => {
    const method = init?.method ?? 'GET';
    const signal = init?.signal ?? null;
    if (method === 'POST') return scripted.insert ? await scripted.insert(signal) : new Response('[]');
    if (method === 'PATCH') return scripted.patch ? await scripted.patch(signal) : new Response('[]');
    throw new Error(`unexpected ${method}`);
  }) as typeof fetch;
  console.log = (name?:unknown, payload?:unknown) => {
    if (String(name) === 'THONGTHAI_TURN_CLAIM') captured.push(JSON.parse(String(payload)));
  };
  try {
    return await run(captured);
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
}

const TURN = { conversationId:'c', eventId:'wh-1', channel:'line' } as const;

test('a first delivery is claimed and logged as claimed', async () => {
  await withScriptedStore(
    { insert: () => new Response(JSON.stringify([{ event_id:'wh-1' }]), { status:201 }) },
    async captured => {
      assert.equal(await claimCustomerTurn({ ...TURN }), 'claimed');
      assert.equal(captured.length, 1);
      assert.equal(captured[0].outcome, 'claimed');
      assert.equal(captured[0].channel, 'line');
      assert.equal(captured[0].event_id, 'wh-1');
      assert.equal(captured[0].environment, 'live');
      assert.ok(Number.isFinite(captured[0].latency_ms));
    },
  );
});

test('a redelivery of a live turn is skipped', async () => {
  await withScriptedStore(
    {
      // Insert conflicts (nothing returned) and no stale row matches.
      insert: () => new Response('[]', { status:201 }),
      patch: () => new Response('[]', { status:200 }),
    },
    async captured => {
      assert.equal(await claimCustomerTurn({ ...TURN }), 'duplicate_skipped');
      assert.equal(captured[0].outcome, 'duplicate_skipped');
    },
  );
});

test('an abandoned claim older than the in-flight window is taken over', async () => {
  await withScriptedStore(
    {
      insert: () => new Response('[]', { status:201 }),
      patch: () => new Response(JSON.stringify([{ event_id:'wh-1' }]), { status:200 }),
    },
    async captured => {
      assert.equal(await claimCustomerTurn({ ...TURN }), 'stale_reclaimed');
      assert.equal(captured[0].outcome, 'stale_reclaimed');
    },
  );
});

test('a claim slower than its 1s deadline fails open and is logged as claim_failed_open', async () => {
  await withScriptedStore(
    { insert: signal => neverResponds(signal) },
    async captured => {
      const startedAt = Date.now();
      const outcome = await claimCustomerTurn({ ...TURN });
      const elapsed = Date.now() - startedAt;
      assert.equal(outcome, 'claim_failed_open', 'a slow claim must never block the reply');
      assert.equal(captured[0].outcome, 'claim_failed_open');
      assert.ok(
        elapsed >= TURN_CLAIM_TIMEOUT_MS - 150,
        `expected the claim to wait for its deadline, gave up after ${elapsed}ms`,
      );
      assert.ok(
        elapsed < TURN_CLAIM_TIMEOUT_MS + 1_500,
        `a failing-open claim must not add more than its deadline, took ${elapsed}ms`,
      );
    },
  );
});

test('a store error fails open rather than dropping a real customer message', async () => {
  await withScriptedStore(
    { insert: () => new Response('boom', { status:500 }) },
    async captured => {
      assert.equal(await claimCustomerTurn({ ...TURN }), 'claim_failed_open');
      assert.equal(captured[0].outcome, 'claim_failed_open');
    },
  );
});

test('an unconfigured store fails open', async () => {
  const keys = ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalLog = console.log;
  const captured: Captured[] = [];
  console.log = (name?:unknown, payload?:unknown) => {
    if (String(name) === 'THONGTHAI_TURN_CLAIM') captured.push(JSON.parse(String(payload)));
  };
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    assert.equal(await claimCustomerTurn({ ...TURN }), 'claim_failed_open');
    assert.equal(captured[0].outcome, 'claim_failed_open');
  } finally {
    console.log = originalLog;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('the claim metric never carries customer text', async () => {
  await withScriptedStore(
    { insert: () => new Response(JSON.stringify([{ event_id:'wh-1' }]), { status:201 }) },
    async captured => {
      await claimCustomerTurn({ ...TURN });
      const fields = Object.keys(captured[0]).sort();
      assert.deepEqual(fields, ['channel','environment','event_id','latency_ms','outcome']);
      const serialized = JSON.stringify(captured[0]);
      assert.ok(!/[฀-๿]/u.test(serialized), 'no Thai text may appear in the claim metric');
    },
  );
});

test('the in-flight window is wider than any synchronous invocation', () => {
  // A takeover must mean the previous attempt is really gone, not slow.
  assert.ok(TURN_CLAIM_STALE_MS > 26_000);
  assert.ok(TURN_CLAIM_TIMEOUT_MS <= 1_000, 'dedupe may add at most ~1s to a reply');
});

test('the terminal write still reports a real outcome after a claim', async () => {
  await withScriptedStore(
    { insert: () => new Response('', { status:201 }) },
    async () => {
      // persistCustomerTurnOutcome merges onto the claimed row; it must stay
      // non-throwing so a storage problem never breaks the reply.
      await persistCustomerTurnOutcome({
        conversationId:'c', eventId:'wh-1', channel:'line',
        outcome:'completed', errorType:null, durationMs:1200,
      });
    },
  );
});

test('source guard: the LINE customer path claims before it answers', () => {
  const claimAt = CORE_SOURCE.indexOf('claimCustomerTurn({');
  const askAt = CORE_SOURCE.indexOf('askThongthaiReliably(message');
  assert.ok(claimAt > 0, 'the LINE path must claim the turn');
  assert.ok(askAt > 0);
  assert.ok(claimAt < askAt, 'the claim must happen before any work or reply');
  assert.match(
    CORE_SOURCE.slice(claimAt, askAt),
    /duplicate_skipped[\s\S]*return;/u,
    'a duplicate delivery must return without replying',
  );
  // The dedupe key, the cost-ledger event id and the outcome row must agree.
  assert.match(CORE_SOURCE, /const turnId = event\.webhookEventId \?\? event\.message\.id/u);
  assert.match(CORE_SOURCE, /askThongthaiReliably\(message, userId, turnId,/u);
});

/** Compile-time proof the outcome union stays closed. */
const EXHAUSTIVE: Record<TurnClaimOutcome, true> = {
  claimed:true, stale_reclaimed:true, duplicate_skipped:true, claim_failed_open:true,
};
test('the claim outcome union is closed', () => {
  assert.deepEqual(
    Object.keys(EXHAUSTIVE).sort(),
    ['claim_failed_open','claimed','duplicate_skipped','stale_reclaimed'],
  );
});
