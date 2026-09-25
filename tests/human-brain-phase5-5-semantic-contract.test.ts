import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDialogTurn } from '../netlify/functions/_dialog-manager';
import { emptyConversationContextState } from '../netlify/functions/_conversation-context';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  type SemanticTurn,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';

const NOW = new Date('2026-09-26T04:00:00.000Z');

function turn(overrides: Partial<SemanticTurn>): SemanticTurn {
  return {
    domain:'activity',
    intent:'model_free_form_label',
    action:'ask',
    informationNeed:'none',
    entities:{},
    references:[],
    constraints:[],
    confidence:0.95,
    needsClarification:false,
    ...overrides,
  };
}

function plan(semanticTurn: SemanticTurn, id: string) {
  return planDialogTurn({
    semanticTurn,
    conversationContext:emptyConversationContextState(NOW),
    taskState:emptyTaskStateContainer(),
    channel:'line',
    eventId:id,
  }, NOW);
}

test('Human Brain 5.5 RED: stay availability facet wins over status action and never becomes booking_status', () => {
  const result=plan(turn({
    domain:'stay',
    action:'status',
    informationNeed:'availability',
    entities:{date:'พรุ่งนี้'},
  }),'hb55-stay-availability');

  assert.deepEqual(result.knowledgeRequests[0]?.needs,['availability']);
  assert.ok(!result.knowledgeRequests[0]?.needs.includes('booking_status'));
});

test('Human Brain 5.5 RED: activity availability facet wins over status action and never becomes booking_status', () => {
  const result=plan(turn({
    domain:'activity',
    action:'status',
    informationNeed:'availability',
    entities:{time:'15:00'},
  }),'hb55-activity-availability');

  assert.deepEqual(result.knowledgeRequests[0]?.needs,['availability']);
  assert.ok(!result.knowledgeRequests[0]?.needs.includes('booking_status'));
});

test('Human Brain 5.5 RED: closed activity price facet routes price regardless of arbitrary free-form intent wording', () => {
  const result=plan(turn({
    domain:'activity',
    intent:'whatever_the_model_called_this_price_question',
    action:'ask',
    informationNeed:'price',
    entities:{activityType:'horse'},
  }),'hb55-activity-price');

  assert.deepEqual(result.knowledgeRequests[0]?.needs,['price']);
});

test('Human Brain 5.5 guard: explicit transaction_status still routes to operational booking status', () => {
  const stay=plan(turn({
    domain:'stay',
    action:'status',
    informationNeed:'transaction_status',
  }),'hb55-stay-existing-booking');

  const activity=plan(turn({
    domain:'activity',
    action:'status',
    informationNeed:'transaction_status',
  }),'hb55-activity-existing-booking');

  assert.deepEqual(stay.knowledgeRequests[0]?.needs,['booking_status']);
  assert.deepEqual(activity.knowledgeRequests[0]?.needs,['booking_status']);
});

test('Human Brain 5.5 RED: gold contract distinguishes catalog browsing from personalized recommendation', () => {
  const catalog=SEMANTIC_EVAL_CORPUS.find(item=>item.id==='restaurant-01');
  const recommend=SEMANTIC_EVAL_CORPUS.find(item=>item.id==='restaurant-03');
  const typoCatalog=SEMANTIC_EVAL_CORPUS.find(item=>item.id==='typo-02');

  assert.equal(catalog?.expected.action,'discover');
  assert.equal(catalog?.simulatedModelOutput.informationNeed,'catalog');
  assert.equal(typoCatalog?.expected.action,'discover');
  assert.equal(typoCatalog?.simulatedModelOutput.informationNeed,'catalog');

  assert.equal(recommend?.expected.action,'recommend');
  assert.equal(recommend?.simulatedModelOutput.informationNeed,'recommendation');
});

test('Human Brain 5.5 RED: bare stay availability follow-up has explicit stay context and a closed availability facet', () => {
  const item=SEMANTIC_EVAL_CORPUS.find(candidate=>candidate.id==='stay-02');
  assert.equal(item?.context?.activeDomain,'stay');
  assert.equal(item?.expected.action,'status');
  assert.equal(item?.simulatedModelOutput.informationNeed,'availability');
});

test('Human Brain 5.5 RED: explicit topic switch to room availability is status/availability, not booking status', () => {
  const item=SEMANTIC_EVAL_CORPUS.find(candidate=>candidate.id==='topic-switch-01');
  assert.equal(item?.expected.domain,'stay');
  assert.equal(item?.expected.action,'status');
  assert.equal(item?.simulatedModelOutput.informationNeed,'availability');
});

test('Human Brain 5.5 RED: semantic prompt locks transaction-boundary and broad-discovery doctrine', () => {
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());

  assert.match(prompt,/broad[^\n]*no specific domain|no specific domain[^\n]*ecosystem/i);
  assert.match(prompt,/selection[^\n]*(?:not|never)[^\n]*(?:book|booking|order)/i);
  assert.match(prompt,/slot[^\n]*(?:provide_information|answer)/i);
  assert.match(prompt,/availability[^\n]*(?:not|never)[^\n]*(?:book|booking)/i);
});
