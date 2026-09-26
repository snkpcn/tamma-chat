import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  providerTimingPolicyForCaller,
} from '../netlify/functions/_thongthai-model-provider';

test('Phase 5.15 RED: customer runtime keeps the proven shared 7s provider budget',()=>{
  assert.deepEqual(providerTimingPolicyForCaller('semantic-interpreter'),{
    totalBudgetMs:7_000,
    perAttemptCapMs:6_000,
  });
});

test('Phase 5.15 RED: grouped build-time semantic certification gets a longer FREE-provider response window only',()=>{
  const cert=providerTimingPolicyForCaller('semantic-certification-group');
  assert.ok(cert.totalBudgetMs>=25_000,'grouped certification needs enough wall-clock budget for a 20-case structured response');
  assert.ok(cert.perAttemptCapMs>=20_000,'free Gemini fallback must not be cut off by the customer-runtime 6s cap');
  assert.ok(cert.perAttemptCapMs<cert.totalBudgetMs,'leave headroom for fast earlier fallback attempts');
});


test('Phase 5.15: callPreferredModel actually wires the caller-specific timing policy without enabling paid fallback',()=>{
  const source=readFileSync(new URL('../netlify/functions/_thongthai-model-provider.ts',import.meta.url),'utf8');
  assert.match(source,/const timing = providerTimingPolicyForCaller\(callerLabel\)/);
  assert.match(source,/callGemini\(systemPrompt, messages, callerLabel, deadlineAt, timing\.perAttemptCapMs\)/);
  assert.match(source,/Math\.min\(perAttemptCapMs, remainingMs\)/);
  assert.match(source,/THONGTHAI_ALLOW_PAID_FALLBACK !== '1'/);
});
