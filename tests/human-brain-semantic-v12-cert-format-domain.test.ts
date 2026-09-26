import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSemanticInterpreterPrompt,
  emptySemanticContext,
  SEMANTIC_INTERPRETER_VERSION,
} from '../netlify/functions/_semantic-interpreter';
import { maxOutputTokensForCaller } from '../netlify/functions/_thongthai-model-provider';
import { parseGroupedSemanticEnvelope } from '../netlify/functions/_semantic-live-certification';

test('semantic-v12 version is explicit',()=>{
  assert.equal(SEMANTIC_INTERPRETER_VERSION,'semantic-v12');
});

test('semantic-v12 makes an explicitly named business category own its domain',()=>{
  const prompt=buildSemanticInterpreterPrompt(emptySemanticContext());
  assert.ok(prompt.includes('the category noun itself is enough to establish that domain'));
  assert.ok(prompt.includes('asking what activities are offered belongs to activity'));
});

test('semantic certification gets a larger structured-output budget without changing customer runtime',()=>{
  assert.equal(maxOutputTokensForCaller('semantic-certification-group'),8192);
  assert.equal(maxOutputTokensForCaller('semantic-interpreter'),4096);
  assert.equal(maxOutputTokensForCaller('thongthai-brain-v3'),4096);
});

test('grouped certification still treats a malformed whole envelope as explicit failure rather than skipping coverage',()=>{
  const source=readFileSync(new URL('../netlify/functions/_semantic-live-certification.ts',import.meta.url),'utf8');
  assert.match(source,/Provider returned, but the GROUP envelope itself was not parseable/);
  assert.match(source,/semanticError:\{name:providerErrorName\(error\)\}/);
});


test('grouped parser salvages complete result objects before a truncated tail without inventing missing cases',()=>{
  const raw='{"results":[{"id":"a","semantic":{"domain":"activity","intent":"x","action":"discover","informationNeed":"catalog","entities":{},"references":[],"constraints":[],"confidence":0.9,"needsClarification":false}},{"id":"b","semantic":{"domain":"stay"';
  const parsed=parseGroupedSemanticEnvelope(raw);
  assert.equal(parsed.size,1);
  assert.equal(parsed.get('a')?.domain,'activity');
  assert.equal(parsed.has('b'),false);
});
