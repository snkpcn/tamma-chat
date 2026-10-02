import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSemanticMeaning } from '../netlify/functions/_semantic-meaning';
import type { SemanticTurn } from '../netlify/functions/_semantic-interpreter';
import { isAgentTransactionPrepareIntent } from '../netlify/functions/thongthai-chat';

function semantic(overrides: Partial<SemanticTurn> = {}): SemanticTurn {
  return {
    semanticSource: 'openai_supervisor',
    domain: 'general',
    intent: 'phase4_boundary',
    action: 'unknown',
    informationNeed: 'none',
    speechAct: 'statement',
    entities: {},
    references: [],
    constraints: [],
    confidence: 0.99,
    needsClarification: false,
    ...overrides,
  };
}

test('Kernel V2 Phase 4: canonical six-mode intent contract is closed and COMMIT alone carries transaction authority', () => {
  const cases: Array<[string, SemanticTurn, string, string]> = [
    ['chat', semantic({ speechAct:'social' }), 'CHAT', 'none'],
    ['ask', semantic({ domain:'activity', action:'ask', speechAct:'question', informationNeed:'price' }), 'ASK', 'exploratory'],
    ['discover', semantic({ domain:'activity', action:'recommend', speechAct:'request', informationNeed:'recommendation' }), 'DISCOVER', 'exploratory'],
    ['consider', semantic({ domain:'activity', action:'confirm', speechAct:'selection', entities:{horseName:'ภาราดร'} }), 'CONSIDER', 'planning'],
    ['commit', semantic({ domain:'activity', action:'book', speechAct:'transaction_request', entities:{horseName:'ภาราดร'} }), 'COMMIT', 'explicit_transaction'],
    ['incident', semantic({ domain:'incident', action:'ask', speechAct:'incident_report' }), 'INCIDENT', 'exploratory'],
  ];

  for (const [label, turn, mode, commitment] of cases) {
    const meaning=deriveSemanticMeaning(turn);
    assert.equal(meaning.conversationalMode,mode,label);
    assert.equal(meaning.commitmentLevel,commitment,label);
    assert.equal(
      meaning.commitmentLevel==='explicit_transaction',
      mode==='COMMIT',
      `${label}: only COMMIT may carry explicit transaction authority`,
    );
  }
});

test('Kernel V2 Phase 4: selection, availability questions and consideration cannot enter Agent commercial prepare mode', () => {
  const cases = [
    ['เอาภาราดรไว้ก่อนครับ','BUSINESS_TRANSACTION'],
    ['เอาชุดนี้ครับ','BUSINESS_TRANSACTION'],
    ['จองห้องได้ไหมครับ','BUSINESS_TRANSACTION'],
    ['สั่งอาหารได้ไหมครับ','BUSINESS_TRANSACTION'],
    ['เอาไว้ก่อน ยังไม่จองครับ','BUSINESS_TRANSACTION'],
    ['กลับมาจองม้าต่อครับ','BUSINESS_TRANSACTION'],
  ] as const;

  for (const [message, topLevel] of cases) {
    assert.equal(
      isAgentTransactionPrepareIntent(message,topLevel),
      false,
      message,
    );
  }
});

test('Kernel V2 Phase 4: explicit booking/order and explicit cafe staff handoff may enter prepare mode', () => {
  for (const message of [
    'ขอจองขี่ม้าน้องภาราดร 30 นาทีครับ',
    'จองที่พักวันที่ 16 ตุลาคมครับ',
    'สั่งอาหารชุดนี้ 1 ชุดครับ',
    'ยืนยันจองครับ',
    'ส่งคำถามนี้ให้ทีมเลยครับ',
  ]) {
    assert.equal(
      isAgentTransactionPrepareIntent(message,'BUSINESS_TRANSACTION'),
      true,
      message,
    );
  }
});

test('Kernel V2 Phase 4: a routing classifier can never manufacture transaction authority', () => {
  for (const message of [
    'เอาตามที่คุยไว้ครับ',
    'ขอดูรายละเอียดก่อนครับ',
    'มีห้องว่างไหมครับ',
    'ส่งคำถามนี้ให้ทีมได้ไหมครับ',
  ]) {
    assert.equal(
      isAgentTransactionPrepareIntent(message,'BUSINESS_TRANSACTION'),
      false,
      message,
    );
  }
});
