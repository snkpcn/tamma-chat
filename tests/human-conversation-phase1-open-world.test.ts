import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
  semanticTurnNeedsReview,
  type SemanticContext,
} from '../netlify/functions/_semantic-interpreter';

function parsed(payload: Record<string, unknown>, context: SemanticContext = emptySemanticContext()) {
  return parseSemanticTurnResponse(JSON.stringify({
    normalizedMeaning: 'test meaning',
    speechAct: 'question',
    domain: 'general',
    intent: 'general_question',
    action: 'ask',
    informationNeed: 'none',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.95,
    needsClarification: false,
    ...payload,
  }), context);
}

test('Phase 1 open world: lost wallet is a valid incident meaning, not forced into a business keyword domain', () => {
  const turn = parsed({
    normalizedMeaning: 'ลูกค้าแจ้งว่ากระเป๋าสตางค์หายหลังจากมาใช้บริการเมื่อวาน',
    speechAct: 'incident_report',
    domain: 'incident',
    intent: 'report_lost_item',
    action: 'ask',
    entities: { itemType: 'wallet', visitTime: 'yesterday' },
  });
  assert.equal(turn.domain, 'incident');
  assert.equal(turn.speechAct, 'incident_report');
  assert.equal(turn.intent, 'report_lost_item');
  assert.match(turn.normalizedMeaning ?? '', /กระเป๋าสตางค์/);
});

test('Phase 1 open world: nearby cat question can remain local without inventing organization knowledge', () => {
  const turn = parsed({
    normalizedMeaning: 'ลูกค้าถามว่าบริเวณแถวนั้นมีแมวอยู่หรือไม่',
    speechAct: 'question',
    domain: 'local',
    intent: 'ask_nearby_animals',
    action: 'ask',
  });
  assert.equal(turn.domain, 'local');
  assert.equal(turn.action, 'ask');
  assert.equal(turn.informationNeed, 'none');
});

test('Phase 1 language: colloquial no-pork statement is a preference update, independent of exact wording', () => {
  const turn = parsed({
    normalizedMeaning: 'ลูกค้าเพิ่มข้อจำกัดว่าไม่รับประทานหมู',
    speechAct: 'preference_update',
    domain: 'restaurant',
    intent: 'add_dietary_constraint',
    action: 'provide_information',
    constraints: ['no_pork'],
  });
  assert.equal(turn.speechAct, 'preference_update');
  assert.deepEqual(turn.constraints, ['no_pork']);
});

test('Phase 1 review gate: a confident open-world interpretation does not spend Sol review', () => {
  const turn = parsed({
    domain: 'incident',
    intent: 'report_lost_item',
    speechAct: 'incident_report',
    confidence: 0.93,
  });
  assert.equal(semanticTurnNeedsReview(turn, 'เมื่อวานมาร้านแล้วกระเป๋าตังหาย', emptySemanticContext()), false);
});

test('Phase 1 review gate: weak unknown meaning is escalated', () => {
  const turn = parsed({
    domain: 'unknown',
    intent: 'unknown',
    action: 'unknown',
    speechAct: 'unknown',
    confidence: 0.41,
  });
  assert.equal(semanticTurnNeedsReview(turn, 'อันที่เมื่อกี้อะ มันหายไปไหน', emptySemanticContext()), true);
});

test('Phase 1 architecture: runtime provider has no Gemini network path', () => {
  const source = fs.readFileSync(new URL('../netlify/functions/_thongthai-model-provider.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('generativelanguage.googleapis.com'));
  assert.ok(!source.includes('GEMINI_API_KEY'));
  assert.ok(source.includes('gpt-5.6-terra'));
  assert.ok(source.includes('gpt-5.6-sol'));
});

test('Phase 1 architecture: response composer never calls an LLM', () => {
  const source = fs.readFileSync(new URL('../netlify/functions/_response-composer.ts', import.meta.url), 'utf8');
  const composerStart = source.indexOf('export async function composeThongthaiResponse');
  assert.ok(composerStart > 0);
  const tail = source.slice(composerStart);
  assert.ok(!tail.includes('callPreferredModel('));
  assert.ok(!tail.includes('callSemanticSupervisor('));
  assert.ok(!tail.includes('callSemanticReviewer('));
});

test('Phase 1 architecture: semantic interpreter owns OpenAI supervisor and reviewer calls', () => {
  const source = fs.readFileSync(new URL('../netlify/functions/_semantic-interpreter.ts', import.meta.url), 'utf8');
  assert.ok(source.includes('callSemanticSupervisor'));
  assert.ok(source.includes('callSemanticReviewer'));
  assert.ok(source.includes('OPEN-WORLD LANGUAGE RULES'));
});
