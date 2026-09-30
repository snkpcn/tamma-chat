import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

const NOW = new Date('2026-09-30T00:00:00+07:00');

const fact = (key: string, value: unknown) => ({
  key,
  value,
  domain: 'activity' as const,
  sourceId: 'phase7-transaction-hotfix',
  sourceType: 'activity_live' as const,
  authoritative: true,
  fetchedAt: NOW.toISOString(),
});

test('activityCode resolves through the live catalog to resourceCode before create_booking', async () => {
  const result = await processDialogTurn({
    semanticTurn: {
      semanticSource: 'openai_supervisor',
      domain: 'activity',
      intent: 'book_selected_horse',
      action: 'book',
      speechAct: 'transaction_request',
      informationNeed: 'none',
      // This is the real production shape that previously stalled: the
      // language brain knew the horse and activity type, but did not emit a
      // selectedEntities reference or invent a database resourceCode.
      entities: {
        horseName: 'ภาราดร',
        activityCode: 'horse',
        date: '2026-10-02',
        time: '10:00',
        durationMinutes: 45,
        partySize: 1,
      },
      references: [],
      constraints: [],
      confidence: 0.99,
      needsClarification: false,
    },
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase7-activity-identity-hotfix',
  }, {
    activity: {
      catalog: async () => ({
        status: 'ok' as const,
        sourceId: 'phase7-transaction-hotfix',
        sourceType: 'activity_live' as const,
        fetchedAt: NOW.toISOString(),
        data: [
          fact('activity_asset:horse-pharadon:name', 'ภาราดร'),
          fact('activity_asset:horse-pharadon:activityCode', 'horse'),
          fact('activity:horse:resourceCode', 'activity-horse'),
          fact('activity:horse:30min:price', 300),
          fact('activity:horse:45min:price', 500),
        ],
      }),
      availability: async () => ({
        status: 'ok' as const,
        sourceId: 'phase7-transaction-hotfix',
        sourceType: 'activity_live' as const,
        fetchedAt: NOW.toISOString(),
        data: [
          fact('availability:activity-horse:2026-10-02T10:00:00+07:00:available', true),
        ],
      }),
    },
  }, NOW);

  assert.equal(result.taskStateContainer.activeTask?.slots.resourceCode, 'activity-horse');
  assert.deepEqual(result.missingFields, []);
  assert.equal(result.actionProposal?.toolName, 'create_booking');
  assert.equal(result.actionProposal?.validatedArgs.resourceCode, 'activity-horse');
  assert.equal(result.actionProposal?.customerCommitPresent, true);
});

test('an unknown activityCode still fails closed and never proposes a booking', async () => {
  const result = await processDialogTurn({
    semanticTurn: {
      semanticSource: 'openai_supervisor',
      domain: 'activity',
      intent: 'book_unknown_activity',
      action: 'book',
      speechAct: 'transaction_request',
      informationNeed: 'none',
      entities: {
        activityCode: 'zipline',
        date: '2026-10-02',
        durationMinutes: 45,
        partySize: 1,
      },
      references: [],
      constraints: [],
      confidence: 0.99,
      needsClarification: false,
    },
    conversationContext: emptyConversationContextState(NOW),
    taskState: emptyTaskStateContainer(),
    channel: 'line',
    eventId: 'phase7-unknown-activity-fails-closed',
  }, {
    activity: {
      catalog: async () => ({
        status: 'ok' as const,
        sourceId: 'phase7-transaction-hotfix',
        sourceType: 'activity_live' as const,
        fetchedAt: NOW.toISOString(),
        data: [fact('activity:horse:resourceCode', 'activity-horse')],
      }),
    },
  }, NOW);

  assert.equal(result.taskStateContainer.activeTask?.slots.resourceCode, undefined);
  assert.ok(result.taskStateContainer.activeTask?.missingFields.includes('resourceCode'));
  assert.equal(result.actionProposal, undefined);
});
