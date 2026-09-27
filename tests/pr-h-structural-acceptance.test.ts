import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';
import { renderCafeUnavailableSourceResponse } from '../netlify/functions/_human-grounded-response';
import { composeGroundedDeterministicResponse, composeThongthaiResponse } from '../netlify/functions/_response-composer';
import { resolveSupervisedCafeCutover } from '../netlify/functions/thongthai-chat';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';

function semantic(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    domain: 'cafe', intent: 'cafe_question', action: 'ask', informationNeed: 'catalog',
    entities: {}, references: [], constraints: [], confidence: 0.95, needsClarification: false,
    ...overrides,
  };
}
function decision(overrides: Record<string, unknown> = {}) {
  return {
    mode: 'answer', taskStateContainer: emptyTaskStateContainer(), knowledgeRequests: [],
    missingFields: [], responseIntent: 'grounded_answer', reasons: [], ...overrides,
  } as any;
}
function oneMind(
  turn: SemanticTurn,
  dialog = decision(),
  source: 'openai_supervisor' | 'deterministic_fallback' = 'openai_supervisor',
  status: 'composed' | 'legacy_required' = 'legacy_required',
) {
  const owned = { ...turn, semanticSource: source };
  return {
    status, reason: 'domain_not_cut_over',
    turn: {
      semanticTurn: owned, dialogSemanticTurn: owned,
      dialogDecision: dialog, groundedKnowledge: [],
      knowledgeDegradation: { condition: 'none', level: 'normal', reasons: [], retryable: false },
    },
    response: status === 'composed'
      ? { message: 'ตอนนี้ยังไม่มีข้อมูลคาเฟ่ที่ยืนยันได้ครับ', mode: 'deterministic', usedFactKeys: [], composerVersion: 'x', bibleVersion: 'x', channel: 'web', language: 'th' }
      : undefined,
    observability: {},
  } as any;
}

test('1. supervised Cafe terminal gate precedes the legacy raw-text responder and runThongthaiBrain', () => {
  const source = readFileSync(new URL('../netlify/functions/thongthai-chat.ts', import.meta.url), 'utf8');
  const gate = source.indexOf('const supervisedCafe = earlyOneMind');
  const legacy = source.indexOf('const deterministicCafe = deterministicCafeResponse');
  const brain = source.indexOf('firstResponse = await runThongthaiBrain');
  assert.ok(gate > 0 && gate < legacy && legacy < brain, `gate=${gate} legacy=${legacy} brain=${brain}`);
});

test('2. supervised Cafe cutover performs no provider/network call', () => {
  let calls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async () => { calls += 1; throw new Error('network forbidden'); }) as typeof fetch;
  try {
    const result = resolveSupervisedCafeCutover(oneMind(semantic()), 'web', 'th');
    assert.equal(result?.kind, 'respond');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test('3. provider-outage/deterministic Cafe classification is never trusted as the terminal decision', () => {
  assert.equal(resolveSupervisedCafeCutover(oneMind(semantic(), decision(), 'deterministic_fallback'), 'web', 'th'), null);
});

test('4. a non-cafe domain never triggers the Cafe cutover', () => {
  assert.equal(resolveSupervisedCafeCutover(oneMind(semantic({ domain: 'restaurant' })), 'web', 'th'), null);
});

test('5. an already-composed Cafe turn reuses the composed response verbatim (zero extra work)', () => {
  const result = resolveSupervisedCafeCutover(oneMind(semantic(), decision(), 'openai_supervisor', 'composed'), 'web', 'th');
  assert.equal(result?.kind, 'respond');
  assert.equal(result?.response.message, 'ตอนนี้ยังไม่มีข้อมูลคาเฟ่ที่ยืนยันได้ครับ');
});

test('6. every cafe informationNeed (catalog/price/schedule) gets the SAME honest no-verified-source answer, never fabricated specifics', () => {
  const needs: SemanticTurn['informationNeed'][] = ['catalog', 'price', 'schedule'];
  const messages = needs.map(informationNeed => renderCafeUnavailableSourceResponse({
    language: 'th', dialogDecision: decision(), knowledgeBundles: [],
    semanticTurn: semantic({ informationNeed }),
  })?.message);
  assert.ok(messages.every(message => typeof message === 'string'));
  assert.equal(new Set(messages).size, 1, 'no per-need fabrication -- one honest answer for a domain with no live source');
  assert.match(messages[0]!, /ยังไม่มีข้อมูล/);
});

test('7. a non-ask/discover/recommend cafe action (e.g. provide_information) does not trigger the honest-unavailable renderer', () => {
  assert.equal(renderCafeUnavailableSourceResponse({
    language: 'th', dialogDecision: decision(), knowledgeBundles: [],
    semanticTurn: semantic({ action: 'provide_information' }),
  }), null);
});

test('8. the cafe renderer is wired into the real composer chain (composeGroundedDeterministicResponse), not just callable in isolation', () => {
  const composed = composeGroundedDeterministicResponse({
    channel: 'web', language: 'th', semanticTurn: semantic(),
    dialogDecision: decision(), knowledgeBundles: [], degradation: { condition: 'none', level: 'normal', reasons: [], retryable: false } as any,
  });
  assert.ok(composed);
  assert.match(composed!.message, /ยังไม่มีข้อมูล/);
});

test('9. the zero-cost composer path never makes a network/model call for a cafe turn', async () => {
  const before = Date.now();
  const result = await composeThongthaiResponse({
    channel: 'line', language: 'th', semanticTurn: semantic({ informationNeed: 'price' }),
    dialogDecision: decision(), knowledgeBundles: [], degradation: { condition: 'none', level: 'normal', reasons: [], retryable: false } as any,
  });
  assert.ok(Date.now() - before < 50);
  assert.equal(result.mode, 'deterministic');
});
