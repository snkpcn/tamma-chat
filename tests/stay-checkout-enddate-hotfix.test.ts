import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
} from '../netlify/functions/_semantic-interpreter';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { planDialogTurn, resolveDialogDecision } from '../netlify/functions/_dialog-manager';
import { createBooking } from '../netlify/functions/_operations-db';

const activeStayContext = {
  ...emptySemanticContext(),
  activeDomain: 'stay' as const,
  activeTask: {
    type: 'stay_booking',
    domain: 'stay' as const,
    status: 'collecting',
    knownSlots: {
      resourceCode: 'stay-varee',
      date: '2026-10-02',
      partySize: 2,
    },
    missingFields: ['endDate'],
    selectedEntities: [],
    constraints: [],
  },
};

function supervisorOutput(entities: Record<string, unknown> = {}): string {
  return JSON.stringify({
    normalizedMeaning: 'customer supplies checkout date',
    reply: '',
    speechAct: 'statement',
    domain: 'stay',
    intent: 'provide_stay_checkout',
    action: 'provide_information',
    informationNeed: 'none',
    entities,
    references: [],
    constraints: [],
    confidence: 0.96,
    needsClarification: false,
  });
}

test('explicit Thai checkout date fills endDate when supervisor omits the slot', () => {
  const turn = parseSemanticTurnResponse(
    supervisorOutput(),
    activeStayContext,
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
  );
  assert.equal(turn.entities.endDate, '2026-10-03');
});

test('checkout recovery never overwrites a structured supervisor endDate', () => {
  const turn = parseSemanticTurnResponse(
    supervisorOutput({ endDate: '2026-10-04' }),
    activeStayContext,
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
  );
  assert.equal(turn.entities.endDate, '2026-10-04');
});

test('a checkout date without an active Stay task cannot manufacture task state', () => {
  const turn = parseSemanticTurnResponse(
    supervisorOutput(),
    emptySemanticContext(),
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
  );
  assert.equal(turn.entities.endDate, undefined);
});

test('provider fallback maps an explicitly labelled Stay checkout to endDate, never check-in date', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  const activeTask = createActiveTask({
    type: 'stay_booking',
    sourceChannel: 'line',
    now,
    initialSlots: {
      resourceCode: 'stay-varee',
      date: '2026-10-02',
      partySize: 2,
    },
  });
  const taskState = { ...emptyTaskStateContainer(), activeTask };
  const turn = deriveDeterministicSemanticTurn(
    'เช็กเอาต์วันที่ 3 ตุลาคม 2569 ครับ',
    activeStayContext,
    taskState,
    now,
  );
  assert.equal(turn?.entities.endDate, '2026-10-03');
  assert.equal(turn?.entities.date, undefined);
});

test('an explicit Stay commit can propose a manual requested booking when the live source has no schedule rows', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  const plan = planDialogTurn({
    semanticTurn: {
      domain: 'stay', intent: 'confirm_booking', action: 'book',
      entities: {
        resourceCode: 'stay-varee', accommodationName: 'วารี',
        date: '2026-10-02', endDate: '2026-10-03', partySize: 2, quantity: 1,
      },
      references: [], constraints: [], confidence: 0.98, needsClarification: false,
    },
    conversationContext: emptyConversationContextState(now),
    taskState: emptyTaskStateContainer(),
    channel: 'line', eventId: 'stay-manual-request-1',
  }, now);
  const decision = resolveDialogDecision(plan, [{
    domain: 'stay',
    sources: [{ need: 'availability', sourceId: 'stay_booking_options_live', sourceType: 'stay_live', status: 'ok' }],
    facts: [{
      key: 'stay:stay-varee:name', value: 'วารี', domain: 'stay',
      sourceId: 'stay_booking_options_live', sourceType: 'stay_live',
      authoritative: true, fetchedAt: now.toISOString(),
    }],
    entities: [], missing: [], warnings: [], freshness: 'live',
  }]);

  assert.equal(decision.actionProposal?.toolName, 'create_booking');
  assert.ok(decision.reasons.includes('stay_manual_availability_request'));
});

test('the no-schedule fallback never weakens Activity availability safety', () => {
  const now = new Date('2026-09-30T00:00:00Z');
  const plan = planDialogTurn({
    semanticTurn: {
      domain: 'activity', intent: 'confirm_booking', action: 'book',
      entities: { resourceCode: 'activity-horse', date: '2026-10-02', durationMinutes: 30, partySize: 1 },
      references: [], constraints: [], confidence: 0.98, needsClarification: false,
    },
    conversationContext: emptyConversationContextState(now),
    taskState: emptyTaskStateContainer(),
    channel: 'line', eventId: 'activity-no-schedule-1',
  }, now);
  const decision = resolveDialogDecision(plan, [{
    domain: 'activity',
    sources: [{ need: 'availability', sourceId: 'activity_booking_options_live', sourceType: 'activity_live', status: 'empty' }],
    facts: [], entities: [], missing: [], warnings: [], freshness: 'live',
  }]);
  assert.equal(decision.actionProposal, undefined);
});

test('Stay executor creates one requested row for the selected property when schedules are not configured', async () => {
  const originalFetch = global.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  const bookings: Array<Record<string, unknown>> = [];
  let allocationPosts = 0;

  global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    const value = decodeURIComponent(String(url));
    const method = init.method ?? 'GET';
    if (value.includes('/service_resources') && method === 'GET') {
      return new Response(JSON.stringify([{ id: 'res-varee', code: 'stay-varee', name: 'วารี' }]));
    }
    if (value.includes('/service_schedules') && method === 'GET') return new Response('[]');
    if (value.includes('/customer_accounts') && method === 'GET') return new Response(JSON.stringify([{ id: 'cust-1' }]));
    if (value.includes('/customer_accounts') && method === 'PATCH') return new Response('[]');
    if (value.includes('/bookings?') && method === 'GET') {
      const prior = bookings[0];
      return new Response(JSON.stringify(prior ? [{
        booking_code: 'BK-STAY-0001', status: 'requested',
        start_at: prior.start_at, end_at: prior.end_at,
      }] : []));
    }
    if (value.endsWith('/bookings') && method === 'POST') {
      const body = JSON.parse(String(init.body ?? '{}')) as Record<string, unknown>;
      bookings.push(body);
      return new Response(JSON.stringify([{ id: 'booking-1', booking_code: 'BK-STAY-0001', status: 'requested' }]));
    }
    if (value.includes('/booking_allocations') && method === 'POST') {
      allocationPosts += 1;
      return new Response('[]');
    }
    throw new Error(`unexpected fetch: ${method} ${value}`);
  }) as typeof fetch;

  try {
    const input = {
      guestDbId: '44444444-4444-4444-8444-444444444444',
      channel: 'line' as const,
      serviceType: 'stay' as const,
      resourceCode: 'stay-varee',
      date: '2026-10-02', endDate: '2026-10-03', partySize: 2, quantity: 1,
    };
    const first = await createBooking(input);
    const retry = await createBooking(input);

    assert.equal(first.bookingCode, 'BK-STAY-0001');
    assert.equal(first.status, 'requested');
    assert.equal(retry.bookingCode, first.bookingCode);
    assert.equal(bookings.length, 1, 'a retry must not duplicate the real Stay request');
    assert.equal(bookings[0]?.resource_id, 'res-varee', 'the selected property must be preserved');
    assert.equal(bookings[0]?.contact_status, 'pending');
    assert.match(String(bookings[0]?.staff_note), /ตรวจสอบห้องว่างก่อนยืนยัน/u);
    assert.equal(allocationPosts, 0, 'an unverified request must never reserve capacity');
  } finally {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  }
});
