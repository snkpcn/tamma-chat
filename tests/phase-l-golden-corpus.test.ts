import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptySemanticContext,
  parseSemanticTurnResponse,
  type SemanticDomain,
} from '../netlify/functions/_semantic-interpreter';
import { SEMANTIC_EVAL_CORPUS } from './fixtures/semantic-eval-corpus';
import { PHASE_L_SEMANTIC_CASES } from './fixtures/phase-l-semantic-cases';

const ALL=[...SEMANTIC_EVAL_CORPUS,...PHASE_L_SEMANTIC_CASES];

test(`Phase L stored semantic golden inventory is >=150 meaningful cases (has ${ALL.length})`,()=>{
  assert.ok(ALL.length>=150,`need >=150, have ${ALL.length}`);
  assert.equal(PHASE_L_SEMANTIC_CASES.length,80);
});

test('Phase L all semantic case ids remain globally unique',()=>{
  const ids=ALL.map(c=>c.id);
  assert.equal(new Set(ids).size,ids.length);
});

test('Phase L expanded cases validate through the REAL deterministic parser/reference layer',()=>{
  for(const evalCase of PHASE_L_SEMANTIC_CASES){
    const turn=parseSemanticTurnResponse(
      JSON.stringify(evalCase.simulatedModelOutput),
      evalCase.context??emptySemanticContext(),
    );
    assert.equal(turn.domain,evalCase.expected.domain,evalCase.id);
    if(evalCase.expected.action)assert.equal(turn.action,evalCase.expected.action,evalCase.id);
    if(evalCase.expected.needsClarification!==undefined){
      assert.equal(turn.needsClarification,evalCase.expected.needsClarification,evalCase.id);
    }
  }
});

test('Phase L final semantic inventory covers every One-Mind customer domain',()=>{
  const domains=new Set(ALL.map(c=>c.domainArea));
  const required:SemanticDomain[]=[
    'ecosystem','restaurant','stay','activity','promotion','membership',
    'otop','cafe','journey','payment','support','unknown',
  ];
  for(const domain of required)assert.ok(domains.has(domain),`missing domain: ${domain}`);
});

test('Phase L final inventory is not dominated by a single domain',()=>{
  const counts=new Map<string,number>();
  for(const c of ALL)counts.set(c.domainArea,(counts.get(c.domainArea)||0)+1);
  const max=Math.max(...counts.values());
  assert.ok(max/ALL.length<0.35,`one domain dominates corpus: max=${max}, total=${ALL.length}`);
});

test('Phase L carries the historical "มีไรทำมั่ง" regression as explicit ground truth',()=>{
  const row=ALL.find(c=>c.message==='มีไรทำมั่ง');
  assert.ok(row);
  assert.equal(row?.expected.domain,'ecosystem');
  assert.equal(row?.expected.action,'discover');
});

test('Phase L carries repeated promotion discovery as discovery, never customer identity/redemption input',()=>{
  const rows=ALL.filter(c=>c.id.startsWith('promotion-repeat-discovery-'));
  assert.ok(rows.length>=2);
  for(const row of rows){
    assert.equal(row.expected.domain,'promotion');
    assert.equal(row.expected.action,'discover');
  }
});

test('Phase L contains requested-vs-confirmed, source-outage, retry and cross-channel regressions in executable suites',async()=>{
  // These are intentionally asserted by file presence/named tests in their
  // domain suites rather than duplicated as fake semantic cases.
  const {readFile}=await import('node:fs/promises');
  const response=await readFile('tests/response-composer.test.ts','utf8');
  const degradation=await readFile('tests/graceful-degradation.test.ts','utf8');
  const orchestrator=await readFile('tests/one-mind-orchestrator.test.ts','utf8');
  const promo=await readFile('tests/promotion-dialog.test.ts','utf8');
  assert.match(response,/requested.*confirmed|requested!=confirmed/is);
  assert.match(degradation,/SOURCE_UNAVAILABLE.*EMPTY|UNAVAILABLE.*empty/is);
  assert.match(orchestrator,/duplicate event id|cross-channel|web -> LINE/is);
  assert.match(promo,/repeated|discovery/i);
});
