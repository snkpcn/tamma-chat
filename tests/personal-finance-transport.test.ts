// Production wiring that the PGlite suites bypass (they inject an RPC): config, transport, and fail-safe behaviour.
import assert from 'node:assert/strict';
import test from 'node:test';
import { PfLedgerError, configuredOwnerId, supabaseRpc } from '../netlify/functions/_personal-finance-ledger';
import { routePersonalFinanceEvent } from '../netlify/functions/_personal-finance';

const KEYS = ['SNK_OS_SUPABASE_URL', 'SNK_OS_SERVICE_ROLE_KEY', 'SNK_MONEY_OWNER_ID', 'SNK_MONEY_ENABLED', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
async function withEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  try { return await fn(); } finally { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
}
async function withFetch<T>(impl: (url: string, init: RequestInit) => Promise<Response>, fn: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (u: any, i: any) => impl(String(u), i)) as typeof fetch;
  try { return await fn(); } finally { globalThis.fetch = real; }
}

test('the ledger uses the SNK OS project and never falls back to the Thongthai Supabase credentials', async () => {
  await withEnv({ SUPABASE_URL: 'https://thongthai.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'THONGTHAI_KEY' }, async () => {
    await assert.rejects(() => supabaseRpc('finance_get_accounts', {}), (e: any) => e instanceof PfLedgerError && e.code === 'pf_db_not_configured');
  });
  let seen: { url: string; auth: string; body: string } | null = null;
  await withEnv({ SNK_OS_SUPABASE_URL: 'https://snk.supabase.co/', SNK_OS_SERVICE_ROLE_KEY: 'SNK_KEY', SUPABASE_URL: 'https://thongthai.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'THONGTHAI_KEY' }, async () => {
    await withFetch(async (url, init) => {
      seen = { url, auth: String((init.headers as Record<string, string>).Authorization), body: String(init.body) };
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }, async () => { assert.deepEqual(await supabaseRpc('finance_get_accounts', { p_owner: 'o' }), { ok: true }); });
  });
  assert.equal(seen!.url, 'https://snk.supabase.co/rest/v1/rpc/finance_get_accounts');
  assert.equal(seen!.auth, 'Bearer SNK_KEY');
  assert.doesNotMatch(seen!.auth + seen!.url, /thongthai|THONGTHAI/);
});

test('transport maps database errors to stable codes and never leaks the key', async () => {
  await withEnv({ SNK_OS_SUPABASE_URL: 'https://snk.supabase.co', SNK_OS_SERVICE_ROLE_KEY: 'SNK_KEY' }, async () => {
    await withFetch(async () => new Response(JSON.stringify({ message: 'invalid_amount', code: 'P0001' }), { status: 400 }), async () => {
      await assert.rejects(() => supabaseRpc('finance_record_transaction', {}), (e: any) => e.code === 'invalid_amount' && !String(e.message).includes('SNK_KEY'));
    });
    await withFetch(async () => new Response(JSON.stringify({ code: 'PGRST202', message: 'Could not find the function' }), { status: 404 }), async () => {
      await assert.rejects(() => supabaseRpc('finance_nope', {}), (e: any) => e.code === 'pf_rpc_missing');
    });
    await withFetch(async () => new Response('boom', { status: 502 }), async () => {
      await assert.rejects(() => supabaseRpc('finance_get_accounts', {}), (e: any) => e.code === 'pf_rpc_502');
    });
  });
});

test('the owner id is a configured auth user uuid, never derived from LINE input', async () => {
  await withEnv({}, async () => assert.throws(() => configuredOwnerId(), /pf_db_not_configured/));
  await withEnv({ SNK_MONEY_OWNER_ID: 'not-a-uuid' }, async () => assert.throws(() => configuredOwnerId(), /pf_db_not_configured/));
  await withEnv({ SNK_MONEY_OWNER_ID: '3a2fc42f-0170-4cdf-a7f2-ee43f680663b' }, async () => assert.equal(configuredOwnerId(), '3a2fc42f-0170-4cdf-a7f2-ee43f680663b'));
});

test('feature flag on but ledger not configured: inert, business groups are not swallowed', async () => {
  await withEnv({ SNK_MONEY_ENABLED: '1' }, async () => {
    let sent = 0;
    const handled = await routePersonalFinanceEvent(
      { type: 'message', replyToken: 'x', source: { type: 'group', groupId: 'C1', userId: 'U1' }, message: { id: '1', type: 'text', text: 'ผูกทีม restaurant' } },
      async () => { sent++; },
    );
    assert.equal(handled, false);
    assert.equal(sent, 0);
  });
});

test('the scheduled reminder function is a quiet no-op while disabled or unconfigured', async () => {
  const { handler } = await import('../netlify/functions/personal-finance-reminders');
  await withEnv({}, async () => {
    const res: any = await handler({} as any, {} as any);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /disabled/);
  });
  await withEnv({ SNK_MONEY_ENABLED: '1' }, async () => {
    const res: any = await handler({} as any, {} as any);
    assert.equal(res.statusCode, 200);
    assert.match(res.body, /pf_db_not_configured/);
  });
});
