import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRawBusinessIncidentRoute,
  classifySemanticBusinessIncidentRoute,
  semanticIncidentFeedbackMatch,
} from '../netlify/functions/_business-incident-router';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

function semantic(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    semanticSource: 'openai_supervisor',
    domain: 'general',
    intent: 'phase5_test',
    action: 'ask',
    informationNeed: 'none',
    speechAct: 'question',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.99,
    needsClarification: false,
    ...overrides,
  };
}

function message(payload: unknown): string {
  return String((payload as { message?: string }).message ?? '');
}

test('Phase 5 router maps all customer-facing business domains including OTOP', () => {
  const cases: Array<[SemanticTurn['domain'], string]> = [
    ['restaurant', 'restaurant'],
    ['activity', 'activity'],
    ['stay', 'stay'],
    ['cafe', 'cafe'],
    ['otop', 'otop'],
    ['membership', 'membership'],
    ['promotion', 'membership'],
    ['payment', 'membership'],
  ];
  for (const [domain, businessUnit] of cases) {
    const route = classifySemanticBusinessIncidentRoute(deriveSemanticMeaning(semantic({ domain })));
    assert.equal(route.kind, 'business', domain);
    assert.equal(route.lane, 'BUSINESS', domain);
    assert.equal(route.businessUnit, businessUnit, domain);
  }
});

test('Phase 5 INCIDENT meaning outranks an otherwise explicit transaction action', () => {
  const meaning = deriveSemanticMeaning(semantic({
    domain: 'activity',
    speechAct: 'complaint',
    action: 'book',
    informationNeed: 'none',
  }));
  assert.equal(meaning.commitmentLevel, 'explicit_transaction');
  assert.equal(meaning.conversationalMode, 'INCIDENT');

  const route = classifySemanticBusinessIncidentRoute(meaning);
  assert.equal(route.kind, 'semantic_incident');
  assert.equal(route.lane, 'INCIDENT');
  assert.equal(route.businessUnit, 'activity');

  const feedback = semanticIncidentFeedbackMatch(meaning);
  assert.equal(feedback.feedbackType, 'complaint');
  assert.equal(feedback.businessUnit, 'activity');
});

test('Phase 5 semantic safety/help becomes a high-severity safety case without inventing names or assets', () => {
  const meaning = deriveSemanticMeaning(semantic({
    domain: 'activity',
    speechAct: 'request_help',
    action: 'ask',
    informationNeed: 'safety',
    entities: { activityCode: 'atv' },
  }));
  const route = classifySemanticBusinessIncidentRoute(meaning);
  assert.equal(route.kind, 'semantic_incident');
  assert.equal(route.businessUnit, 'activity');

  const feedback = semanticIncidentFeedbackMatch(meaning);
  assert.equal(feedback.feedbackType, 'safety_issue');
  assert.equal(feedback.severity, 'high');
  assert.deepEqual(feedback.issueKeywords, ['safety']);
  assert.deepEqual(feedback.personMentions, []);
  assert.deepEqual(feedback.namedAssets, []);
});

test('Phase 5 raw router preserves authority-boundary precedence over complaint vocabulary', () => {
  const route = classifyRawBusinessIncidentRoute('ขอคืนเงินครับ บริการแย่มาก');
  assert.equal(route?.kind, 'authority_boundary');
  assert.equal(route?.lane, 'INCIDENT');
});

test('Phase 5 raw OTOP complaint routes to OTOP customer voice instead of owner/general', () => {
  const route = classifyRawBusinessIncidentRoute('OTOP ส่งของช้ามาก ไม่โอเคครับ');
  assert.equal(route?.kind, 'service_feedback');
  assert.equal(route?.businessUnit, 'otop');
  assert.equal(route?.lane, 'INCIDENT');
  if (route?.kind === 'service_feedback') {
    assert.equal(route.feedback.feedbackType, 'complaint');
  }
});

test('Phase 5 wrong OTOP fulfilment is complaint, not suggestion, and never invents a staff name/positive sentiment', () => {
  const route = classifyRawBusinessIncidentRoute('สินค้า OTOP ได้ของผิดครับ อยากให้ช่วยตรวจสอบ');
  assert.equal(route?.kind, 'service_feedback');
  assert.equal(route?.lane, 'INCIDENT');
  assert.equal(route?.businessUnit, 'otop');
  if (route?.kind === 'service_feedback') {
    assert.equal(route.feedback.feedbackType, 'complaint');
    assert.deepEqual(route.feedback.issueKeywords, ['fulfillment']);
  }

  const staffRoute = classifyRawBusinessIncidentRoute('ขอสั่งสินค้า OTOP ชิ้นนี้เลยครับ แต่พนักงานพูดไม่ดีมาก ขอให้ช่วยดูเรื่องนี้ก่อน');
  assert.equal(staffRoute?.kind, 'service_feedback');
  if (staffRoute?.kind === 'service_feedback') {
    assert.equal(staffRoute.feedback.staffName, null);
    assert.equal(staffRoute.feedback.personMentions.some(item => item.kind === 'named'), false);
    assert.equal(staffRoute.feedback.keywordSummary.topPositive.includes('ดีมาก'), false);
    assert.ok(staffRoute.feedback.keywordSummary.topNegative.includes('พูดไม่ดี'));
  }
});

test('Phase 5 raw OTOP complaint creates one durable case and notifies OTOP with zero model calls', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('otop');
    const result = await processThongthaiChatCore(
      brainRequest('OTOP ส่งของช้ามาก ไม่โอเคครับ', guestId('phase5-otop-raw'), 'line'),
      'phase5-otop-raw-event',
    );

    assert.equal(result.statusCode, 200);
    assert.match(message(result.payload), /รับเรื่อง|ส่งเรื่อง/u);
    assert.equal(harness.modelCallCount(), 0);

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.feedback_type, 'complaint');
    assert.equal(events[0]?.business_unit, 'otop');
    assert.equal(events[0]?.route_target, 'otop_group');

    const deliveries = harness.notificationDeliveries();
    assert.equal(deliveries.length, 1);
    assert.equal(deliveries[0]?.teamCode, 'otop');

    assert.equal(harness.postsTo('otop_orders').length, 0);
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('restaurant_preorders').length, 0);
  });
});

test('Phase 5 semantic-only OTOP complaint is durably routed before the model reply can escape', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('otop');
    const gid = guestId('phase5-otop-semantic');
    harness.programGeminiReply({
      normalizedMeaning: 'customer reports poor treatment by the OTOP seller and wants help',
      reply: 'MODEL_DRAFT_MUST_NOT_REACH_CUSTOMER',
      speechAct: 'complaint',
      domain: 'otop',
      intent: 'report_otop_service_problem',
      action: 'ask',
      informationNeed: 'none',
      entities: {},
      references: [],
      constraints: [],
      confidence: 0.99,
      needsClarification: false,
    });

    const result = await processThongthaiChatCore(
      brainRequest('The OTOP seller treated us badly and I need help.', gid, 'line'),
      'phase5-otop-semantic-event',
    );

    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message(result.payload), /MODEL_DRAFT_MUST_NOT_REACH_CUSTOMER/u);
    assert.match(message(result.payload), /รับเรื่อง/u);
    assert.equal(harness.modelCallCount(), 1);

    const events = harness.postsTo('ops_feedback_events');
    assert.equal(events.length, 1);
    assert.equal(events[0]?.feedback_type, 'complaint');
    assert.equal(events[0]?.business_unit, 'otop');
    assert.equal(events[0]?.route_target, 'otop_group');
    assert.equal(harness.postsTo('otop_orders').length, 0);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('Phase 5 semantic complaint blocks a conflicting order action from crossing into OTOP execution', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('otop');
    const gid = guestId('phase5-incident-over-order');
    harness.programGeminiReply({
      normalizedMeaning: 'customer asks for help after a service problem while mentioning an order',
      reply: 'MODEL_TRANSACTION_DRAFT_MUST_NOT_REACH_CUSTOMER',
      speechAct: 'complaint',
      domain: 'otop',
      intent: 'complaint_with_order_language',
      action: 'order',
      informationNeed: 'none',
      entities: { productId: 'otop-honey' },
      references: [],
      constraints: [],
      confidence: 0.99,
      needsClarification: false,
    });

    const result = await processThongthaiChatCore(
      brainRequest('Please order this item, but the seller treated us badly and I need help.', gid, 'web'),
      'phase5-incident-over-order-event',
    );

    assert.equal(result.statusCode, 200);
    assert.doesNotMatch(message(result.payload), /MODEL_TRANSACTION_DRAFT_MUST_NOT_REACH_CUSTOMER/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 1);
    assert.equal(harness.postsTo('otop_orders').length, 0);
    assert.equal(harness.postsTo('bookings').length, 0);
    assert.equal(harness.postsTo('restaurant_preorders').length, 0);
  });
});
