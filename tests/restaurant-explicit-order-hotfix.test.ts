import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptySemanticContext, parseSemanticTurnResponse } from '../netlify/functions/_semantic-interpreter';

function output(informationNeed = 'availability'): string {
  return JSON.stringify({
    normalizedMeaning:'customer explicitly places a food preorder',
    speechAct:'transaction_request',
    domain:'restaurant',
    intent:'place_food_order',
    action:'order',
    informationNeed,
    entities:{
      restaurantTransactionType:'preorder',
      items:[{name:'ตำไทย',quantity:1}],
      customerName:'ทดสอบ E2E',
      phone:'0800000002',
    },
    references:[], constraints:[], confidence:.96, needsClarification:false,
  });
}

test('explicit Restaurant preorder cannot be misrouted as table availability and recovers date/time', () => {
  const turn=parseSemanticTurnResponse(
    output(), emptySemanticContext(),
    'ยืนยันสั่งตำไทย 1 จาน วันที่ 2 ตุลาคม 2569 เวลา 18:00 ชื่อทดสอบ E2E โทร 0800000002',
  );
  assert.equal(turn.action,'order');
  assert.equal(turn.informationNeed,'none');
  assert.equal(turn.entities.date,'2026-10-02');
  assert.equal(turn.entities.time,'18:00');
  assert.deepEqual(turn.entities.items,[{name:'ตำไทย',quantity:1}]);
});

test('a genuinely conditional Restaurant availability question stays read-only', () => {
  const turn=parseSemanticTurnResponse(
    output(), emptySemanticContext(),
    'ถ้าตำไทยว่างค่อยสั่งให้ได้ไหม วันที่ 2 ตุลาคม 2569 เวลา 18:00',
  );
  assert.equal(turn.informationNeed,'availability');
  assert.equal(turn.entities.date,undefined);
  assert.equal(turn.entities.time,undefined);
});
