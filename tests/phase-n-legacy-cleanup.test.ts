import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase N web never invokes the retired local ConciergeProvider as a second business brain',()=>{
  const html=readFileSync('index.html','utf8');
  assert.doesNotMatch(html,/ConciergeProvider\.reply\s*\(/);
  assert.match(html,/Canonical endpoint unavailable — local business-intelligence fallback retired/);
  assert.doesNotMatch(html,/since no live AI endpoint is deployed yet/i);
});

test('Phase N canonical endpoint remains the first customer intelligence path before legacy compatibility',()=>{
  const source=readFileSync('netlify/functions/thongthai-chat.ts','utf8');
  const cutover=source.indexOf("THONGTHAI_ONE_MIND_CUTOVER === '1'");
  const legacyExperience=source.indexOf('deterministicExperienceDiscoveryResponse(request');
  const runtimeLoad=source.indexOf('loadBrainRuntime(guestDbId, channel)');
  assert.ok(cutover>=0);
  assert.ok(runtimeLoad>cutover,'One-Mind cutover must be attempted before legacy runtime/phrase fallbacks');
  assert.ok(legacyExperience>cutover,'legacy experience matcher may remain only behind the compatibility path');
});

test('Phase N legacy experience phrase matcher is explicitly frozen compatibility code',()=>{
  const source=readFileSync('netlify/functions/_experience-discovery.ts','utf8');
  assert.match(source,/LEGACY COMPATIBILITY FALLBACK ONLY/);
  assert.match(source,/MUST NOT be expanded with new\s*\n \* customer phrasings/);
});

test('Phase N LINE remains a transport adapter, not a new One-Mind semantic implementation',()=>{
  const source=readFileSync('netlify/functions/_line-webhook-core.ts','utf8');
  assert.doesNotMatch(source,/_semantic-interpreter|_dialog-manager|_knowledge-resolver|_response-composer/);
  assert.match(source,/event\.message\.id/,'stable LINE message id must be forwarded for server idempotence');
  // LINE calls the canonical brain in-process (processThongthaiChatCore, the
  // same function the web HTTP handler calls) rather than self-fetching its
  // own thongthai-chat endpoint over HTTP -- see the One-Mind architecture
  // consolidation audit's "LINE self-fetch" finding in THONGTHAI_HANDOFF.md
  // for why the old HTTP round-trip was a real structural risk.
  assert.match(source,/processThongthaiChatCore/);
  assert.doesNotMatch(source,/THONGTHAI_ENDPOINT|CUSTOMER_MEMORY_ENDPOINT/,'LINE must not self-fetch its own site functions for the canonical brain or customer memory');
});

test('Phase N Dialog Manager no longer carries stale "not wired" architecture documentation',()=>{
  const source=readFileSync('netlify/functions/_dialog-manager.ts','utf8');
  assert.doesNotMatch(source,/NOT wired into any live request handler/);
  assert.match(source,/canonical One-Mind orchestrator/);
});

test('Phase N does not delete deterministic transaction executors still required for strangler safety',()=>{
  const runtime=readFileSync('netlify/functions/_thongthai-runtime-v3.ts','utf8');
  for(const tool of ['create_booking','create_restaurant_preorder','redeem_promotion','create_otop_order','create_cafe_inquiry']){
    assert.match(runtime,new RegExp("call\\.name === '"+tool+"'"),tool);
  }
});
