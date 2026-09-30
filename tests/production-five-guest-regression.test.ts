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
import {
  resolveOtopStructuredSlots,
  resolveStayCatalogStructuredSlots,
} from '../netlify/functions/_dialog-manager';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { resolveExplicitStayFallbackArgs } from '../netlify/functions/thongthai-chat';

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

  const turn = parseSemanticTurnResponse(
    readOnlyModel('activity', { horseName: 'ทองไทย', activityCode: 'horse' }),
    emptySemanticContext(),
    message,
  );
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

  const fallback = deriveDeterministicSemanticTurn(
    message, emptySemanticContext(), emptyTaskStateContainer(), new Date('2026-09-30T00:00:00Z'),
  );
  assert.equal(fallback?.domain, 'restaurant');
  assert.equal(fallback?.action, 'book');
  assert.equal(fallback?.entities.restaurantTransactionType, 'table_booking');
  assert.equal(fallback?.entities.customerName, 'E2E TEST 01');
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
  const turn = parseSemanticTurnResponse(readOnlyModel('ecosystem'), emptySemanticContext(), message);
  assert.equal(turn.domain, 'stay');
  assert.equal(turn.action, 'book');
  assert.equal(turn.speechAct, 'transaction_request');
  assert.equal(turn.informationNeed, 'none');
  assert.equal(turn.entities.date, '2026-10-17');
  assert.equal(turn.entities.endDate, '2026-10-18');
  assert.equal(turn.entities.partySize, 2);
  assert.equal(turn.entities.bedrooms, 1);

  const fallback = deriveDeterministicSemanticTurn(
    message, emptySemanticContext(), emptyTaskStateContainer(), new Date('2026-09-30T00:00:00Z'),
  );
  assert.equal(fallback?.domain, 'stay');
  assert.equal(fallback?.action, 'book');
  assert.equal(fallback?.entities.date, '2026-10-17');
  assert.equal(fallback?.entities.endDate, '2026-10-18');
  assert.equal(fallback?.entities.bedrooms, 1);

  const task = createActiveTask({
    type:'stay_booking', sourceChannel:'web',
    initialSlots:{...turn.entities},
  });
  const bundle = {
    domain:'stay', sourceId:'stay_service_resources_live', sourceType:'stay_live', status:'ok',
    freshness:{fetchedAt:'2026-09-30T00:00:00Z'},
    facts:[
      {key:'stay:stay-one-bedroom:name',value:'เฮือนสเตย์ 1 ห้องนอน',domain:'stay',authoritative:true},
      {key:'stay:stay-one-bedroom:bedrooms',value:1,domain:'stay',authoritative:true},
      {key:'stay:stay-two-bedroom:name',value:'เฮือนสเตย์ 2 ห้องนอน',domain:'stay',authoritative:true},
      {key:'stay:stay-two-bedroom:bedrooms',value:2,domain:'stay',authoritative:true},
    ],
  } as any;
  assert.deepEqual(resolveStayCatalogStructuredSlots(task, [bundle]), {
    resourceCode:'stay-one-bedroom', resourceName:'เฮือนสเตย์ 1 ห้องนอน',
  });

  const namedMessage = 'เลือกที่พักนภา 1 ห้องนอน วันที่ 17-18 ตุลาคม 2569 พัก 2 คน พาผู้สูงอายุไปด้วย ชื่อ E2E TEST 03 โทร 0800000003 ยืนยันส่งจองเข้าระบบจริงตอนนี้ครับ';
  assert.deepEqual(resolveExplicitStayFallbackArgs(namedMessage, [
    {code:'stay-napa',name:'นภา'}, {code:'stay-rin',name:'ริน'}, {code:'stay-varee',name:'วารี'},
  ], new Date('2026-09-30T00:00:00Z')), {
    serviceType:'stay', resourceCode:'stay-napa', accommodationName:'นภา',
    date:'2026-10-17', endDate:'2026-10-18', partySize:2, quantity:1,
    customerName:'E2E TEST 03', phone:'0800000003',
    note:'มีผู้สูงอายุร่วมเข้าพัก — กรุณาตรวจสอบการเข้าถึงก่อนยืนยัน',
  });
  assert.equal(resolveExplicitStayFallbackArgs(
    message,
    [{code:'stay-napa',name:'นภา'}, {code:'stay-rin',name:'ริน'}],
    new Date('2026-09-30T00:00:00Z'),
  ), null, 'a room type that matches multiple live properties must remain a clarification');
});

test('guest 4: an imperative send-now cafe request becomes a staff inquiry even without the word order', () => {
  const message = 'ขอสั่งลาเต้เย็น 5 แก้ว วันที่ 18 ตุลาคม 2569 เวลา 09:00 ชื่อ E2E TEST 04 โทร 0800000004 ฝากส่งเรื่องให้อินทนิลจริงตอนนี้และให้โทรกลับครับ';
  const turn = parseSemanticTurnResponse(readOnlyModel('cafe'), emptySemanticContext(), message);
  assert.equal(turn.action, 'order');
  assert.equal(turn.speechAct, 'transaction_request');
  assert.equal(turn.informationNeed, 'none');
  assert.equal(turn.entities.question, message);
  assert.equal(turn.reply, undefined);

  const fallback = deriveDeterministicSemanticTurn(
    message, emptySemanticContext(), emptyTaskStateContainer(), new Date('2026-09-30T00:00:00Z'),
  );
  assert.equal(fallback?.domain, 'cafe');
  assert.equal(fallback?.action, 'order');
  assert.equal(fallback?.speechAct, 'transaction_request');
  assert.equal(fallback?.entities.question, message);
  assert.equal(fallback?.entities.customerName, 'E2E TEST 04');
  assert.equal(fallback?.entities.phone, '0800000004');
});

test('guest 5: harmless OTOP product-name spacing resolves to one live SKU and stock', () => {
  const message = 'ขอสั่งซื้อผ้าไหมมัดหมี่บ้านเขว้า 1 ชิ้น จัดส่ง ชื่อ E2E TEST 05 โทร 0800000005 ที่อยู่ 99 หมู่ 1 ตำบลในเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000 ยืนยันสั่งซื้อจริงตอนนี้';
  const turn = parseSemanticTurnResponse(readOnlyModel('restaurant', {
    productName:'ผ้าไหมมัดหมี่บ้านเขว้า', quantity:1, fulfillmentType:'pickup',
  }), emptySemanticContext(), message);
  assert.equal(turn.domain, 'otop');
  assert.equal(turn.entities.fulfillmentType, 'shipping');
  assert.equal(turn.entities.shippingAddress, '99 หมู่ 1 ตำบลในเมือง อำเภอเมืองชัยภูมิ จังหวัดชัยภูมิ 36000');

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
