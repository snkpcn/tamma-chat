import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isPhase3SemanticLearningCandidate } from '../netlify/functions/_semantic-concept-memory';
import { isShortStandaloneConceptCandidate } from '../netlify/functions/_thongthai-one-mind-orchestrator';

test('Phase 3 production bridge recognizes only the closed learning-family signals',()=>{
  for(const message of [
    'ไม่อยากเหนื่อยมากครับ',
    'วันนี้ขอชิลๆครับ',
    'เอาอันนี้ไว้ก่อนนะครับ',
    'ยังไม่จองครับ',
    'มากับภรรยาครับ',
    'มากับคนรู้ใจครับ',
  ]){
    assert.equal(isPhase3SemanticLearningCandidate(message),true,message);
  }

  for(const message of [
    'จองเลยครับ',
    'ยืนยันจอง',
    'พรุ่งนี้มีห้องว่างไหม',
    'ขี่ม้ากี่บาท',
    'ขอคืนเงินครับ',
  ]){
    assert.equal(isPhase3SemanticLearningCandidate(message),false,message);
  }
});

test('Phase 3 bridge remains bounded to short standalone messages',()=>{
  assert.equal(isShortStandaloneConceptCandidate('ไม่อยากเหนื่อยมากครับ'),true);
  assert.equal(
    isShortStandaloneConceptCandidate('ไม่อยากเหนื่อยมาก แต่ขอจองม้าพรุ่งนี้ตอนห้าโมงเลยครับ'),
    false,
    'multi-clause mixed transaction language must not enter the learning bridge',
  );
});

test('customer runtime places Phase 3 learning bridge before 100% primary Agent and accepts learned HIT output',()=>{
  const source=readFileSync(
    new URL('../netlify/functions/thongthai-chat.ts',import.meta.url),
    'utf8',
  );
  const candidate=source.indexOf('const phase3SemanticLearningEligible');
  const primary=source.indexOf('const readOnlyPrimaryAgentEligible');
  const agentCall=source.indexOf('runThongthaiAgentPrimaryTurn({',primary);
  const oneMind=source.indexOf('processOneMindCustomerTurn({',agentCall);

  assert.ok(candidate>=0);
  assert.ok(primary>candidate);
  assert.ok(agentCall>primary);
  assert.ok(oneMind>agentCall);
  assert.match(
    source,
    /const readOnlyPrimaryAgentEligible = !phase3SemanticLearningEligible && shouldUseThongthaiAgentPrimary/u,
  );
  assert.match(
    source,
    /semanticSource === 'semantic_concept_memory'/u,
    'a learned zero-call SemanticTurn must be customer-visible instead of falling back into Agent Primary',
  );
});
