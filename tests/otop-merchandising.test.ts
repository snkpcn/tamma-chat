import assert from 'node:assert/strict';
import test from 'node:test';
import { completedUnitsByProduct } from '../netlify/functions/_otop-merchandising';

test('aggregates only completed OTOP order quantities by product', () => {
  const units = completedUnitsByProduct(
    ['order-complete-1', 'order-complete-2'],
    [
      { order_id: 'order-complete-1', product_id: 'p1', quantity: 2 },
      { order_id: 'order-complete-2', product_id: 'p1', quantity: '3' },
      { order_id: 'order-complete-2', product_id: 'p2', quantity: 1 },
      { order_id: 'order-pending', product_id: 'p1', quantity: 99 },
    ],
  );
  assert.equal(units.get('p1'), 5);
  assert.equal(units.get('p2'), 1);
  assert.equal(units.has('missing'), false);
});
