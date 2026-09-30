import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dispatchCreatedTransactionNotification } from '../netlify/functions/_transaction-notifications';

test('every durable transaction type dispatches through its correct LINE notifier', async () => {
  const calls: string[] = [];
  const dispatchers = {
    booking: async (id: string) => { calls.push(`booking:${id}`); return 'sent' as const; },
    entity: async (entity: 'cafe_inquiry' | 'otop_order', id: string) => {
      calls.push(`${entity}:${id}`);
      return 'duplicate' as const;
    },
  };

  assert.equal(await dispatchCreatedTransactionNotification('booking', 'booking-1', dispatchers), 'sent');
  assert.equal(await dispatchCreatedTransactionNotification('cafe_inquiry', 'cafe-1', dispatchers), 'duplicate');
  assert.equal(await dispatchCreatedTransactionNotification('otop_order', 'order-1', dispatchers), 'duplicate');
  assert.deepEqual(calls, ['booking:booking-1', 'cafe_inquiry:cafe-1', 'otop_order:order-1']);
});

test('notification delivery failure is observable but never turns a successful transaction into a failed write', async () => {
  const status = await dispatchCreatedTransactionNotification('booking', 'booking-2', {
    booking: async () => { throw new Error('LINE unavailable'); },
    entity: async () => 'sent',
  });
  assert.equal(status, 'failed');
});

test('an absent durable entity id fails closed without calling a notifier', async () => {
  let called = false;
  const status = await dispatchCreatedTransactionNotification('otop_order', '', {
    booking: async () => { called = true; return 'sent'; },
    entity: async () => { called = true; return 'sent'; },
  });
  assert.equal(status, 'failed');
  assert.equal(called, false);
});

test('the real tool runtime dispatches after every supported durable write and exposes the status', () => {
  const source = readFileSync(new URL('../netlify/functions/_thongthai-runtime-v3.ts', import.meta.url), 'utf8');
  for (const entity of ['booking', 'cafe_inquiry', 'otop_order']) {
    assert.match(
      source,
      new RegExp(`dispatchCreatedTransactionNotification\\('${entity}', created\\.id\\)`),
      `${entity} must dispatch from the same runtime path that created its durable row`,
    );
  }
  assert.match(source, /JSON\.stringify\(\{\.\.\.created,notificationStatus\}\)/u);
});
