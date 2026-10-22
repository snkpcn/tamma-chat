import test from 'node:test';
import assert from 'node:assert/strict';
import { checkCustomerTurnHostedReadiness } from '../scripts/check-customer-turn-hosted-readiness.mjs';

const configuration = { baseUrl: 'https://fixture.supabase.co', serviceRoleKey: 'test-key' };

test('hosted build preflight reads no customer rows and accepts all schema prerequisites', async () => {
  const calls: string[] = [];
  const checks = await checkCustomerTurnHostedReadiness({ ...configuration, fetchImpl: async (url, init) => {
    calls.push(String(url));
    assert.equal(new URL(url).searchParams.get('limit'), '0');
    assert.equal(init.method, undefined);
    assert.equal(init.redirect, 'error');
    return new Response('[]');
  } });
  assert.equal(calls.length, 3);
  assert.ok(checks.every(check => check.pass));
});

test('missing outbox or context column prevents publishing a production build', async () => {
  for (const missing of ['line_customer_deliveries', 'thongthai_customer_turn_monitor']) {
    const checks = await checkCustomerTurnHostedReadiness({ ...configuration, fetchImpl: async url =>
      String(url).includes(missing) ? new Response('{"code":"PGRST205"}', { status: 404 }) : new Response('[]') });
    assert.equal(checks.filter(check => !check.pass).length, 1);
  }
});

test('unauthorized, malformed and unreachable schema responses fail without leaking details', async () => {
  for (const fetchImpl of [
    async () => new Response('{"message":"test-key"}', { status: 401 }),
    async () => new Response('not-json'),
    async () => { throw new Error('test-key'); },
  ]) {
    const checks = await checkCustomerTurnHostedReadiness({ ...configuration, fetchImpl });
    assert.ok(checks.every(check => !check.pass));
    assert.ok(!JSON.stringify(checks).includes('test-key'));
  }
});

test('missing deployment credentials fail before requesting the database', async () => {
  const checks = await checkCustomerTurnHostedReadiness({ baseUrl: '', serviceRoleKey: '', fetchImpl: async () => {
    assert.fail('must not fetch without configuration');
  } });
  assert.equal(checks[0].pass, false);
});
