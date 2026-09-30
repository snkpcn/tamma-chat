import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyTopLevelSemanticIntent } from '../netlify/functions/_top-level-intent';
import {
  extractDateRange,
  hasStandaloneTransactionRequest,
} from '../netlify/functions/_slot-parsers';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
} from '../netlify/functions/_semantic-interpreter';
import { resolveOtopStructuredSlots } from '../netlify/functions/_dialog-manager';
import { createActiveTask } from '../netlify/functions/_task-state';

function readOnlyModel(domain: string, entities: Record<string, unknown> = {}): string {
  return JSON.stringify({
    normalizedMeaning: 'read only request',
    reply: 'ยังทำรายการไม่ได้',
    speechAct: 'request',
    domain,
    intent: 'read_only_request',
    action: 'ask',
    informationNeed: 'availability',
    entities,
    references: [],
    constraints: [],
    confidence: 0.94,
    needsClarification: false,
  });
}

test('guest 1: restaurant booking outranks the Thongthai horse-name collision', () => {
  const message = 'หวัดดีทองไทย ขอจองโต๊ะร้านตำมา-ชาติวันที่ 15 ตุลาคม 2569 เวลา 18:30 จำนวน 4 คน ชื่อ E2E TEST 01 โทร 0800000001 จองจริงเลยครับ';
  assert.equal(classifyTopLevelSemanticIntent(message), 'BUSINESS_TRANSACTION');

  const turn = parseSemanticTurnResponse(readOnlyModel('restaurant'), emptySemanticContext(), message);
  assert.equal(turn.domain, 'restaurant');
  assert.equal(turn.action, 'book');
  assert.equal(turn.speechAct, 'transaction_request');
  assert.equal(turn.informationNeed, 'none');
  assert.deepEqual(turn.entities, {
    restaurantTransactionType: 'table_booking',
    date: '2026-10-15',
    time: '18:30',
    partySize: 4,
    phone: '0800000001',
    customerName: 'E2E TEST 01',
  });
});

test('guest 2: an explicit send-to-system confirmation commits the one active activity task', () => {
  const activeTask = createActiveTask({
    type: 'activity_booking',
    sourceChannel: 'web',
    initialSlots: {
      resourceCode: 'activity-horse', horseName: 'ภาราดร',
      date: '2026-10-16', time: '10:00', durationMinutes: 45, partySize: 1,
      customerName: 'E2E TEST 02', phone: '0800000002',
    },
  });
  const context = { ...emptySemanticContext(), activeDomain: 'activity' as const, activeTask: {
    type: activeTask.type,
    domain: activeTask.domain,
    status: activeTask.status,
    knownSlots: activeTask.slots,
    missingFields: [],
    selectedEntities: [],
    constraints: [],
  } };
  const turn = parseSemanticTurnResponse(
    readOnlyModel('unknown'), context, 'ยืนยัน ส่งเข้าระบบเลยครับ',
  );
  assert.equal(hasStandaloneTransactionRequest('ยืนยัน ส่งเข้าระบบเลยครับ'), true);
  assert.equal(turn.domain, 'activity');
  assert.equal(turn.action, 'book');
  assert.equal(turn.speechAct, 'transaction_request');
  assert.equal(turn.informationNeed, 'none');
});

test('guest 3: compact Buddhist-year stay range is recovered without re-asking supplied dates', () => {
  const message = 'ขอจองเฮือนสเตย์แบบ 1 ห้องนอน วันที่ 17-18 ตุลาคม 2569 พัก 2 คน พาผู้สูงอายุไปด้วย ชื่อ E2E TEST 03 โทร 0800000003 ส่งจองจริงครับ';
  assert.deepEqual(extractDateRange(message, new Date('2026-09-30T00:00:00Z')), {
    date: '2026-10-17', endDate: '2026-10-18',
  });
  const turn = parseSemanticTurnResponse(readOnlyModel('stay', { bedrooms: 1 }), emptySemanticContext(), message);
  assert.equal(turn.action, 'book');
  assert.equal(turn.speechAct, 'transaction_request');
  assert.equal(turn.informationNeed, 'none');
  assert.equal(turn.entities.date, '2026-10-17');
  assert.equal(turn.entities.endDate, '2026-10-18');
  assert.equal(turn.entities.partySize, 2);
});

test('guest 4: an imperative send-now cafe request becomes a staff inquiry even without the word order', () => {
  const message = 'ไม่ต้องยืนยันเมนู กรุณาส่งคำถาม/คำขอไปทีมคาเฟ่ตอนนี้ให้โทรกลับ ชื่อ E2E TEST 04 โทร 0800000004';
  const turn = parseSemanticTurnResponse(readOnlyModel('cafe'), emptySemanticContext(), message);
  assert.equal(turn.action, 'order');
  assert.equal(turn.speechAct, 'transaction_request');
  assert.equal(turn.informationNeed, 'none');
  assert.equal(turn.entities.question, message);
  assert.equal(turn.reply, undefined);
});

test('guest 5: harmless OTOP product-name spacing resolves to one live SKU and stock', () => {
  const task = createActiveTask({
    type: 'otop_order', sourceChannel: 'web',
    initialSlots: { productName: 'ผ้าไหมมัดหมี่บ้านเขว้า', quantity: 1 },
  });
  const bundle = {
    domain: 'otop', sourceId: 'otop_products_live', sourceType: 'otop_live', status: 'ok',
    freshness: { fetchedAt: '2026-09-30T00:00:00Z' },
    facts: [
      { key: 'otop:OTOP-BK-001:name', value: 'ผ้าไหมมัดหมี่ บ้านเขว้า', domain: 'otop' },
      { key: 'otop:OTOP-BK-001:stock', value: 10, domain: 'otop' },
    ],
  } as any;
  assert.deepEqual(resolveOtopStructuredSlots(task, [bundle]), {
    sku: 'OTOP-BK-001', productName: 'ผ้าไหมมัดหมี่ บ้านเขว้า',
  });
  assert.equal(hasStandaloneTransactionRequest('ยืนยันสั่งซื้อจริงตอนนี้'), true);
});

