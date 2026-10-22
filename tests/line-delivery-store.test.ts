import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { withHarness } from './helpers/canonical-core-harness';
import { loadLineDelivery, prepareLineDelivery, leaseLineDelivery, updateLineDelivery, lineDeliveryMessages } from '../netlify/functions/_line-delivery-store';

// Exercise the production migration and the actual query predicates against
// Postgres; the HTTP adapter below binds filters instead of emulating leases.
test('outbox migration, encryption, concurrent leases, takeover, target isolation and expiry', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
    await db.exec(readFileSync(new URL('../supabase/migrations/20261021120000_line_customer_deliveries.sql', import.meta.url), 'utf8'));
    await withHarness(async () => {
      global.fetch = (async (input, init = {}) => {
        const url = new URL(String(input));
        const q = url.searchParams;
        const body = init.body ? JSON.parse(String(init.body)) : {};
        const args: unknown[] = [];
        const bind = (value: unknown) => { args.push(value); return `$${args.length}`; };
        let sql: string;
        const keys = Object.keys(body);
        const allowed = new Set(['event_id', 'target_hash', 'payload_enc', 'status', 'mode', 'lease_id', 'leased_at']);
        assert.ok(keys.every(key => allowed.has(key)));
        if (init.method === 'POST') {
          sql = `insert into line_customer_deliveries (${keys.join(',')}) values (${keys.map(key => bind(body[key])).join(',')}) on conflict (event_id) do nothing returning *`;
        } else {
          const set = init.method === 'PATCH' ? keys.map(key => `${key}=${bind(body[key])}`).join(',') : '';
          const conditions = ['event_id', 'target_hash', 'lease_id'].filter(key => q.has(key)).map(key => `${key}=${bind(q.get(key)!.slice(3))}`);
          if (q.has('expires_at')) conditions.push(`expires_at > ${bind(q.get('expires_at')!.slice(3))}::timestamptz`);
          if (q.has('or')) {
            const stale = /leased_at.lt.([^)]*)/u.exec(q.get('or')!)?.[1];
            assert.ok(stale);
            conditions.push(`(status='pending' or (status='sending' and leased_at < ${bind(stale)}::timestamptz))`);
          }
          sql = `${init.method === 'PATCH' ? `update line_customer_deliveries set ${set}` : 'select * from line_customer_deliveries'} where ${conditions.join(' and ')}${init.method === 'PATCH' ? ' returning *' : ''}`;
        }
        const result = await db.query(sql, args);
        return new Response(JSON.stringify(result.rows));
      }) as typeof fetch;
      const messages = [{ type: 'text', text: 'Your confirmed booking reference: private-123' }];
      await prepareLineDelivery('evt', 'U-1', messages);
      await prepareLineDelivery('evt', 'U-1', [{ type: 'text', text: 'do not overwrite' }]);
      const stored = (await loadLineDelivery('evt', 'U-1'))!;
      assert.ok(!stored.payload_enc.includes('private-123'));
      assert.deepEqual(lineDeliveryMessages(stored), messages);
      assert.equal(await loadLineDelivery('evt', 'U-2'), null);
      await db.exec('set role anon');
      await assert.rejects(db.query('select * from line_customer_deliveries'), /permission denied/u);
      await db.exec('reset role; set role service_role');
      const leases = await Promise.all([leaseLineDelivery('evt', 'U-1'), leaseLineDelivery('evt', 'U-1')]);
      assert.equal(leases.filter(Boolean).length, 1);
      const first = leases.find(Boolean)!;
      await db.exec('reset role');
      await db.query("update line_customer_deliveries set leased_at=now()-interval '20 seconds' where event_id='evt'");
      const second = (await leaseLineDelivery('evt', 'U-1'))!;
      assert.ok(second);
      assert.notEqual(second.lease_id, first.lease_id);
      await assert.rejects(updateLineDelivery(first, 'U-1', { status: 'delivered' }), /lease lost/u);
      await updateLineDelivery(second, 'U-1', { status: 'delivered' });
      assert.equal(await leaseLineDelivery('evt', 'U-1'), null);
      await db.query("update line_customer_deliveries set expires_at=now()-interval '1 second' where event_id='evt'");
      assert.equal(await loadLineDelivery('evt', 'U-1'), null);
      assert.equal(await leaseLineDelivery('evt', 'U-1'), null);
      await prepareLineDelivery('next', 'U-1', messages);
      const count = await db.query("select * from line_customer_deliveries where event_id='evt'");
      assert.equal(count.rows.length, 0, 'expired ciphertext is pruned on insert');
    });
  } finally { await db.close(); }
});
