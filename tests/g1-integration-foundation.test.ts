import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  bookingAvailabilityArgs,
  buildRealKnowledgeSourceAdapters,
} from '../netlify/functions/_dialog-source-adapters';
import type { KnowledgeRequest } from '../netlify/functions/_knowledge-resolver';
import type { ActiveTask } from '../netlify/functions/_task-state';

function request(task: ActiveTask | null, domain: KnowledgeRequest['domain'] = 'activity'): KnowledgeRequest {
  return {
    domain,
    intent: 'availability_check',
    action: 'ask',
    entities: {},
    constraints: [],
    task,
    needs: ['availability'],
  };
}

test('G.1 availability shaping reads validated task slots instead of raw channel text', () => {
  const task: ActiveTask = {
    taskId: 'task-1',
    type: 'activity_booking',
    domain: 'activity',
    status: 'collecting',
    slots: {
      resourceCode: 'activity-horse',
      date: '2026-09-19',
      durationMinutes: 60,
      partySize: 2,
    },
    missingFields: [],
    selectedEntities: [],
    constraints: [],
    sourceChannel: 'line',
    createdAt: '2026-09-18T12:00:00.000Z',
    updatedAt: '2026-09-18T12:00:00.000Z',
  };
  assert.deepEqual(bookingAvailabilityArgs(request(task)), {
    serviceType: 'activity',
    date: '2026-09-19',
    resourceCode: 'activity-horse',
    durationMinutes: 60,
    partySize: 2,
  });
});

test('G.1 stay availability shaping selects stay service type', () => {
  assert.deepEqual(bookingAvailabilityArgs({
    ...request(null, 'stay'),
    entities: { date: '2026-09-20', partySize: 2 },
  }), {
    serviceType: 'stay',
    date: '2026-09-20',
    resourceCode: null,
    durationMinutes: null,
    partySize: 2,
  });
});

test('real adapter registry exposes read-only stay, availability, booking-status and membership sources', () => {
  const adapters = buildRealKnowledgeSourceAdapters('line', { guestDbId: null });
  assert.equal(typeof adapters.activity?.availability, 'function');
  assert.equal(typeof adapters.stay?.catalog, 'function');
  assert.equal(typeof adapters.stay?.availability, 'function');
  assert.equal(typeof adapters.bookingStatus?.lookup, 'function');
  assert.equal(typeof adapters.membership?.status, 'function');
});

test('canonical orchestrator imports no transaction executor or customer-facing response composer', () => {
  const source = readFileSync('netlify/functions/_thongthai-one-mind-orchestrator.ts', 'utf8');
  assert.doesNotMatch(source, /executeBrainTools|createBooking|createOtopOrder|createCafeInquiry|redeem_promotion/);
  assert.doesNotMatch(source, /ResponseComposer|polishCustomerMessage|splitCustomerMessageForLine/);
  assert.match(source, /processDialogTurnDetailed/);
  assert.match(source, /buildSemanticContext/);
});

test('G.1 shared state persistence is sequential, not Promise.all read-modify-write race', () => {
  const source = readFileSync('netlify/functions/_thongthai-one-mind-orchestrator.ts', 'utf8');
  const block = source.slice(source.indexOf('if (persistState)'), source.indexOf('return {', source.indexOf('if (persistState)')));
  assert.match(block, /await deps\.persistConversationContext/);
  assert.match(block, /await deps\.persistTaskState/);
  assert.doesNotMatch(block, /Promise\.all/);
});

test('LINE legacy adapter still owns transport while One-Mind remains uncut-over in G.1', () => {
  const lineSource = readFileSync('netlify/functions/_line-webhook-core.ts', 'utf8');
  const chatSource = readFileSync('netlify/functions/thongthai-chat.ts', 'utf8');
  assert.match(lineSource, /chatHistory:\s*\[\]/, 'G.1 must prove server continuity without patching a LINE-local history array');
  assert.doesNotMatch(lineSource, /_thongthai-one-mind-orchestrator/);
  assert.doesNotMatch(chatSource, /_thongthai-one-mind-orchestrator/);
});
