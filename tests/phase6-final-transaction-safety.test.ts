import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  planDialogTurn,
  resolveDialogDecision,
  type DialogPlan,
} from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer, type TaskStateContainer } from '../netlify/functions/_task-state';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import {
  hasExplicitNoTransactionMarker,
  hasStandaloneTransactionRequest,
} from '../netlify/functions/_slot-parsers';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

const NOW = new Date('2026-09-30T00:30:00+07:00');

function semantic(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    semanticSource: 'openai_supervisor',
    domain: 'activity',
    intent: 'phase6_final_acceptance',
    action: 'ask',
    informationNeed: 'none',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.99,
    needsClarification: false,
    ...overrides,
  };
}

function plan(
  turn: SemanticTurn,
  taskState: TaskStateContainer = emptyTaskStateContainer(),
  eventId = 'phase6',
): DialogPlan {
  return planDialogTurn({
    semanticTurn: turn,
    conversationContext: emptyConversationContextState(NOW),
    taskState,
    channel: 'web',
    eventId,
  }, NOW);
}

function activityAvailable(): KnowledgeBundle {
  return {
    domain: 'activity',
    sources: [{
      need: 'availability',
      sourceId: 'phase6-live-schedule',
      sourceType: 'activity_live',
      status: 'ok',
    }],
    facts: [{
      key: 'availability:activity-horse:2026-10-06T10:00:00+07:00:available',
      value: true,
      domain: 'activity',
      sourceId: 'phase6-live-schedule',
      sourceType: 'activity_live',
      authoritative: true,
      fetchedAt: NOW.toISOString(),
    }],
    entities: [],
    missing: [],
    warnings: [],
    freshness: 'live',
  };
}

test('Phase 6 final: shared current-turn boundary rejects questions, resume language and explicit withholding', () => {
  for (const message of [
    'ยังไม่ต้องจอง',
    'เอาไว้ก่อน ยังไม่จอง',
    'ถามเรื่องจองเฉย ๆ ยังไม่ได้ให้จอง',
    'กลับมาจองม้าต่อ',
    'จองได้ไหม',
  ]) {
    assert.equal(hasStandaloneTransactionRequest(message), false, message);
  }
  assert.equal(hasStandaloneTransactionRequest('จองเลย'), true);
  assert.equal(hasStandaloneTransactionRequest('ยืนยันจอง'), true);
  for (const message of ['จองไว้ก่อน','จองม้าไว้ก่อน','สั่งอาหารไว้ก่อน']) {
    assert.equal(hasStandaloneTransactionRequest(message), true, message);
    assert.equal(hasExplicitNoTransactionMarker(message), false, message);
  }
  assert.equal(hasStandaloneTransactionRequest('ไม่จองอันนี้ แต่จองอีกอัน'), true,
    'a later affirmative alternative must outrank an earlier rejected transaction');
  assert.equal(hasStandaloneTransactionRequest('จองอันนี้ แต่เปลี่ยนใจ ยังไม่จอง'), false,
    'a later withholding signal must revoke an earlier affirmative request');
  assert.equal(hasExplicitNoTransactionMarker('เอาไว้ก่อน ยังไม่ต้องจอง'), true);

  // Same-turn self-correction: the latest explicit consent signal wins.
  assert.equal(hasExplicitNoTransactionMarker('เอาไว้ก่อน เดี๋ยวค่อยคิด... เอาละ จองเลย'), false);
  assert.equal(hasStandaloneTransactionRequest('เอาไว้ก่อน เดี๋ยวค่อยคิด... เอาละ จองเลย'), true);
  assert.equal(hasExplicitNoTransactionMarker('จองเลย แต่เดี๋ยวก่อน ยังไม่จองนะ'), true);
  assert.equal(hasStandaloneTransactionRequest('จองเลย แต่เดี๋ยวก่อน ยังไม่จองนะ'), false);
});

test('Phase 6 final: provider-outage deterministic fallback emits canonical no_transaction for an open task', () => {
  const committed = plan(semantic({
    action: 'book',
    speechAct: 'transaction_request',
    entities: { resourceCode: 'activity-horse', date: '2026-10-06' },
  }), emptyTaskStateContainer(), 'phase6-provider-outage-start');

  const context: SemanticContext = {
    ...emptySemanticContext(),
    activeDomain: 'activity',
    activeTask: committed.taskStateContainer.activeTask ? {
      type: committed.taskStateContainer.activeTask.type,
      domain: committed.taskStateContainer.activeTask.domain,
      status: committed.taskStateContainer.activeTask.status,
      knownSlots: committed.taskStateContainer.activeTask.slots,
      missingFields: committed.taskStateContainer.activeTask.missingFields,
      selectedEntities: committed.taskStateContainer.activeTask.selectedEntities,
      constraints: committed.taskStateContainer.activeTask.constraints,
    } : null,
  };
  const turn = deriveDeterministicSemanticTurn(
    'เอาไว้ก่อนนะ ยังไม่ต้องจอง',
    context,
    committed.taskStateContainer,
    NOW,
  );
  assert.ok(turn);
  assert.notEqual(turn!.action, 'book');
  assert.notEqual(turn!.action, 'order');
  assert.ok(turn!.constraints.includes('no_transaction'));
});

test('Phase 6 final: CURRENT no-transaction revokes historical commitment and later slot-fill cannot resurrect it', () => {
  const committed = plan(semantic({
    action: 'book',
    speechAct: 'transaction_request',
    entities: { resourceCode: 'activity-horse', date: '2026-10-06', time: '10:00' },
  }), emptyTaskStateContainer(), 'phase6-revoke-start');

  assert.equal(committed.taskStateContainer.activeTask?.commitmentIntent, true);
  assert.equal(committed.customerCommitPresent, true);
  assert.deepEqual(committed.missingFields, ['durationMinutes']);

  const revoked = plan(semantic({
    action: 'correct_previous',
    speechAct: 'correction',
    constraints: ['no_transaction'],
  }), committed.taskStateContainer, 'phase6-revoke-now');

  assert.equal(revoked.taskStateContainer.activeTask?.commitmentIntent, false);
  assert.equal(revoked.customerCommitPresent, false);
  assert.ok(revoked.reasons.includes('transaction_commitment_revoked'));
  assert.equal(resolveDialogDecision(revoked, [activityAvailable()]).actionProposal, undefined);

  const innocentFill = plan(semantic({
    action: 'provide_information',
    entities: { durationMinutes: 60 },
  }), revoked.taskStateContainer, 'phase6-revoke-fill');

  assert.deepEqual(innocentFill.missingFields, []);
  assert.equal(innocentFill.customerCommitPresent, false,
    'a later slot fill must not inherit consent that the customer explicitly revoked');
  assert.equal(resolveDialogDecision(innocentFill, [activityAvailable()]).actionProposal, undefined,
    'complete slots are READY state, not write authorization');

  const rearmed = plan(semantic({
    action: 'book',
    speechAct: 'transaction_request',
  }), innocentFill.taskStateContainer, 'phase6-revoke-rearm');

  assert.equal(rearmed.taskStateContainer.activeTask?.commitmentIntent, true);
  assert.equal(rearmed.customerCommitPresent, true);
  assert.equal(resolveDialogDecision(rearmed, [activityAvailable()]).actionProposal?.toolName, 'create_booking',
    'a fresh explicit transaction request must be able to re-arm the same task');
});

test('Phase 6 final: resume_suspended plus no_transaction clears a suspended task old commitment', () => {
  const activityCommitted = plan(semantic({
    action: 'book',
    speechAct: 'transaction_request',
    entities: { resourceCode: 'activity-horse', date: '2026-10-06' },
  }), emptyTaskStateContainer(), 'phase6-resume-start');
  assert.equal(activityCommitted.taskStateContainer.activeTask?.commitmentIntent, true);

  const restaurantSelection = plan(semantic({
    domain: 'restaurant',
    action: 'confirm',
    speechAct: 'selection',
    entities: {
      restaurantTransactionType: 'preorder',
      itemName: 'ผัดไทย',
    },
  }), activityCommitted.taskStateContainer, 'phase6-resume-switch');

  assert.equal(restaurantSelection.taskStateContainer.activeTask?.domain, 'restaurant');
  assert.equal(restaurantSelection.taskStateContainer.suspendedTask?.domain, 'activity');
  assert.equal(restaurantSelection.taskStateContainer.suspendedTask?.commitmentIntent, true);

  const resumed = plan(semantic({
    domain: 'activity',
    action: 'ask',
    speechAct: 'request',
    taskDirective: 'resume_suspended',
    constraints: ['no_transaction'],
  }), restaurantSelection.taskStateContainer, 'phase6-resume-withhold');

  assert.equal(resumed.taskStateContainer.activeTask?.domain, 'activity');
  assert.equal(resumed.taskStateContainer.activeTask?.commitmentIntent, false);
  assert.equal(resumed.customerCommitPresent, false);
  assert.ok(resumed.reasons.includes('task_resumed'));
  assert.ok(resumed.reasons.includes('transaction_commitment_revoked'));
  assert.equal(resolveDialogDecision(resumed, [activityAvailable()]).actionProposal, undefined);
});

test('Phase 6 final: complete selections in Activity, Stay, Restaurant table and Restaurant preorder remain non-transactional', () => {
  const cases: SemanticTurn[] = [
    semantic({
      domain: 'activity',
      action: 'confirm',
      speechAct: 'selection',
      entities: { resourceCode: 'activity-horse', date: '2026-10-06', durationMinutes: 60 },
    }),
    semantic({
      domain: 'stay',
      action: 'confirm',
      speechAct: 'selection',
      entities: { resourceCode: 'stay-hueun', date: '2026-10-06', endDate: '2026-10-07', partySize: 2 },
    }),
    semantic({
      domain: 'restaurant',
      action: 'confirm',
      speechAct: 'selection',
      entities: {
        restaurantTransactionType: 'table_booking',
        date: '2026-10-06',
        time: '18:00',
        partySize: 2,
        customerName: 'ทดสอบ',
        phone: '0812345678',
      },
    }),
    semantic({
      domain: 'restaurant',
      action: 'confirm',
      speechAct: 'selection',
      entities: {
        restaurantTransactionType: 'preorder',
        items: [{ name: 'ผัดไทย', quantity: 1 }],
        date: '2026-10-06',
        time: '18:00',
        customerName: 'ทดสอบ',
      },
    }),
  ];

  for (const [index, turn] of cases.entries()) {
    const p = plan(turn, emptyTaskStateContainer(), `phase6-selection-${index}`);
    assert.equal(p.customerCommitPresent, false, `case ${index} selection must not be transaction consent`);
    assert.equal(p.taskStateContainer.activeTask?.commitmentIntent, false, `case ${index} must keep commitment false`);
    assert.equal(resolveDialogDecision(p, []).actionProposal, undefined, `case ${index} must never propose a write`);
  }
});

test('Phase 6 final: cancellation is terminal and a later selection starts clean without inherited commitment', () => {
  const started = plan(semantic({
    action: 'book',
    speechAct: 'transaction_request',
    entities: { resourceCode: 'activity-horse', date: '2026-10-06' },
  }), emptyTaskStateContainer(), 'phase6-cancel-start');
  assert.equal(started.taskStateContainer.activeTask?.commitmentIntent, true);

  const cancelled = plan(semantic({
    action: 'cancel',
    taskDirective: 'cancel_active',
    speechAct: 'request',
  }), started.taskStateContainer, 'phase6-cancel-now');

  assert.equal(cancelled.taskStateContainer.activeTask?.status, 'cancelled');
  assert.equal(resolveDialogDecision(cancelled, []).actionProposal, undefined);

  const fresh = plan(semantic({
    action: 'confirm',
    speechAct: 'selection',
    entities: { resourceCode: 'activity-horse', horseName: 'ภาราดร' },
  }), cancelled.taskStateContainer, 'phase6-cancel-fresh-selection');

  assert.notEqual(fresh.taskStateContainer.activeTask?.taskId, cancelled.taskStateContainer.activeTask?.taskId);
  assert.equal(fresh.taskStateContainer.activeTask?.commitmentIntent, false);
  assert.equal(fresh.customerCommitPresent, false);
  assert.equal(resolveDialogDecision(fresh, []).actionProposal, undefined);
});

test('Phase 6 gate: fixed bounded candidate-set suitability is compare even if model says recommend', () => {
  const context: SemanticContext = {
    ...emptySemanticContext(),
    activeDomain: 'activity',
    recentEntities: [
      { id: 'activity_asset:horse-pharadon', type: 'activity_asset', name: 'ภาราดร', domain: 'activity', source: 'catalog', canonical: true },
      { id: 'activity_asset:horse-thongthai', type: 'activity_asset', name: 'ทองไทย', domain: 'activity', source: 'catalog', canonical: true },
    ],
  };
  const raw = JSON.stringify({
    normalizedMeaning: 'which of the two known horses suits a first-time rider',
    reply: '',
    speechAct: 'question',
    domain: 'activity',
    intent: 'horse_suitability',
    action: 'recommend',
    informationNeed: 'recommendation',
    entities: { selectionCriterion: 'first_time_rider' },
    references: [{ type: 'candidate_set', value: 'สองตัวนี้', refersToPriorContext: true }],
    constraints: ['first_time_rider'],
    confidence: 0.98,
    needsClarification: false,
  });
  const turn = parseSemanticTurnResponse(raw, context, 'สองตัวนี้ตัวไหนเหมาะกับคนไม่เคยขี่');
  assert.equal(turn.action, 'compare');
  assert.equal(turn.domain, 'activity');
});

test('Phase 6 final: parser fails closed when model mislabels resume/withhold text as transaction_request', () => {
  const suspendedTask: NonNullable<SemanticContext['suspendedTask']> = {
    type: 'activity_booking',
    domain: 'activity',
    status: 'collecting',
    knownSlots: { resourceCode: 'activity-horse', horseName: 'ภาราดร' },
    missingFields: ['durationMinutes'],
    selectedEntities: [],
    constraints: [],
  };
  const context: SemanticContext = {
    ...emptySemanticContext(),
    activeDomain: 'restaurant',
    suspendedTask,
  };
  const badModel = JSON.stringify({
    normalizedMeaning: 'resume and book the horse',
    reply: '',
    speechAct: 'transaction_request',
    domain: 'activity',
    intent: 'resume_booking',
    action: 'book',
    informationNeed: 'none',
    taskDirective: 'resume_suspended',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.99,
    needsClarification: false,
  });

  const resumeOnly = parseSemanticTurnResponse(badModel, context, 'กลับไปเรื่องม้าที่ค้างไว้');
  assert.equal(resumeOnly.taskDirective, 'resume_suspended');
  assert.notEqual(resumeOnly.action, 'book');
  assert.notEqual(resumeOnly.speechAct, 'transaction_request');

  const withheld = parseSemanticTurnResponse(badModel, context, 'เอาตัวนั้นไว้ก่อน แต่ยังไม่จองนะ');
  assert.notEqual(withheld.action, 'book');
  assert.notEqual(withheld.speechAct, 'transaction_request');
  assert.ok(withheld.constraints.includes('no_transaction'));

  const availabilityModel = JSON.stringify({
    normalizedMeaning:'customer asks availability but explicitly is not booking yet',
    reply:'',
    speechAct:'transaction_request',
    domain:'activity',
    intent:'check_availability_without_booking',
    action:'book',
    informationNeed:'availability',
    entities:{resourceCode:'activity-horse'},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
  });
  const readOnlyNeed = parseSemanticTurnResponse(
    availabilityModel,
    context,
    'ตัวนี้วันที่หกยังว่างไหม แต่ยังไม่จองนะ',
  );
  assert.notEqual(readOnlyNeed.action,'book');
  assert.equal(readOnlyNeed.informationNeed,'availability');
  assert.ok(readOnlyNeed.constraints.includes('no_transaction'));

  const trulyCommitted = parseSemanticTurnResponse(badModel, context, 'กลับไปเรื่องม้าที่ค้างไว้ แล้วจองเลย');
  assert.equal(trulyCommitted.action, 'book');
  assert.equal(trulyCommitted.speechAct, 'transaction_request');
});


test('Phase 6 final: cross-cutting promotion subject outranks a narrower restaurant label and preserves no-new-membership preference', () => {
  const badModel = JSON.stringify({
    normalizedMeaning:'customer wants to browse restaurant options',
    reply:'',
    speechAct:'request',
    domain:'restaurant',
    intent:'restaurant_topic_switch',
    action:'discover',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
  });
  const turn = parseSemanticTurnResponse(
    badModel,
    emptySemanticContext(),
    'ขอโปรร้านอาหารที่คุ้มสุด แต่ไม่เอาแบบต้องสมัครสมาชิกเพิ่ม',
  );
  assert.equal(turn.domain,'promotion');
  assert.equal(turn.action,'recommend');
  assert.equal(turn.informationNeed,'recommendation');
  assert.equal(turn.entities.businessScope,'restaurant');
  assert.ok(turn.constraints.includes('no_new_membership'));
});

test('Phase 6 final: promotion reconciliation has negative guards for polite "โปรด" and explicit promo rejection', () => {
  const restaurantModel = JSON.stringify({
    normalizedMeaning:'customer wants ordinary menu recommendations',
    reply:'',
    speechAct:'request',
    domain:'restaurant',
    intent:'restaurant_recommendation',
    action:'recommend',
    informationNeed:'recommendation',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.99,
    needsClarification:false,
  });

  const polite = parseSemanticTurnResponse(
    restaurantModel,
    emptySemanticContext(),
    'โปรดแนะนำเมนูไม่เผ็ดหน่อย',
  );
  assert.equal(polite.domain,'restaurant');

  const rejectsPromo = parseSemanticTurnResponse(
    restaurantModel,
    emptySemanticContext(),
    'ไม่เอาโปร ขอเมนูปกติที่ไม่เผ็ด',
  );
  assert.equal(rejectsPromo.domain,'restaurant');
});

function modelTurn(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    normalizedMeaning: 'phase 6 acceptance turn',
    reply: '',
    speechAct: 'statement',
    domain: 'activity',
    intent: 'phase6_e2e',
    action: 'provide_information',
    informationNeed: 'none',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.99,
    needsClarification: false,
    ...overrides,
  };
}

for (const channel of ['web', 'line'] as const) {
  test(`Phase 6 final E2E ${channel}: explicit commit -> revoke -> later slot fill produces zero booking writes`, async () => {
    await withHarness(async harness => {
      const gid = guestId(`phase6-e2e-revoke-${channel}`);

      harness.programGeminiReply(modelTurn({
        normalizedMeaning: 'customer asks to book horse riding for a date but duration is still missing',
        speechAct: 'transaction_request',
        action: 'book',
        entities: { resourceCode: 'activity-horse', date: '2026-10-06', time: '10:00' },
      }));
      const first = await processThongthaiChatCore(
        brainRequest('จองขี่ม้าวันที่ 6 ตุลา เวลา 10 โมง', gid, channel),
        `phase6-e2e-${channel}-1`,
      );
      assert.equal(first.statusCode, 200);
      const guestDbId = harness.guestDbId(gid);
      assert.ok(guestDbId);
      let task = (harness.getState(guestDbId!)?.state.taskState as {
        activeTask?: { commitmentIntent?: boolean };
      } | undefined)?.activeTask;
      assert.equal(task?.commitmentIntent, true);
      assert.equal(harness.postsTo('bookings').length, 0);

      harness.programGeminiReply(modelTurn({
        normalizedMeaning: 'customer explicitly retracts transaction consent and wants to keep considering',
        speechAct: 'correction',
        action: 'correct_previous',
        constraints: ['no_transaction'],
      }));
      const second = await processThongthaiChatCore(
        brainRequest('เดี๋ยวก่อน เอาไว้ก่อน ยังไม่จองนะ', gid, channel),
        `phase6-e2e-${channel}-2`,
      );
      assert.equal(second.statusCode, 200);
      task = (harness.getState(guestDbId!)?.state.taskState as {
        activeTask?: { commitmentIntent?: boolean };
      } | undefined)?.activeTask;
      assert.equal(task?.commitmentIntent, false,
        'full core must persist consent revocation, not only render non-booking copy');
      assert.equal(harness.postsTo('bookings').length, 0);

      harness.programGeminiReply(modelTurn({
        normalizedMeaning: 'customer only supplies the previously missing duration',
        speechAct: 'statement',
        action: 'provide_information',
        entities: { durationMinutes: 60 },
      }));
      const third = await processThongthaiChatCore(
        brainRequest('60 นาที', gid, channel),
        `phase6-e2e-${channel}-3`,
      );
      assert.equal(third.statusCode, 200);
      task = (harness.getState(guestDbId!)?.state.taskState as {
        activeTask?: { commitmentIntent?: boolean };
      } | undefined)?.activeTask;
      assert.equal(task?.commitmentIntent, false);
      assert.equal(harness.postsTo('bookings').length, 0,
        'later slot completion must not resurrect revoked consent into a real booking write');

      harness.programGeminiReply(modelTurn({
        normalizedMeaning: 'customer now explicitly asks to book',
        speechAct: 'transaction_request',
        action: 'book',
      }));
      const fourth = await processThongthaiChatCore(
        brainRequest('โอเค ทีนี้จองเลย', gid, channel),
        `phase6-e2e-${channel}-4`,
      );
      assert.equal(fourth.statusCode, 200);
      task = (harness.getState(guestDbId!)?.state.taskState as {
        activeTask?: { commitmentIntent?: boolean };
      } | undefined)?.activeTask;
      assert.equal(task?.commitmentIntent, true,
        'fresh explicit consent must re-arm the task after a prior revocation');
    });
  });
}
