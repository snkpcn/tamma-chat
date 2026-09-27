import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(relative:string):string {
  return readFileSync(new URL(`../${relative}`,import.meta.url),'utf8');
}

test('Phase 7 readiness: semantic provider is OpenAI Responses only and Sol remains behind the bounded review gate',()=>{
  const provider=source('netlify/functions/_thongthai-model-provider.ts');
  const semantic=source('netlify/functions/_semantic-interpreter.ts');

  assert.match(provider,/api\.openai\.com\/v1\/responses/u);
  assert.doesNotMatch(provider,/generativelanguage\.googleapis\.com|google\.generativeai|@google\/generative-ai/iu);
  assert.match(provider,/'gpt-5\.6-terra'/u);
  assert.match(provider,/'gpt-5\.6-sol'/u);

  assert.equal((semantic.match(/callSemanticReviewer\(/gu)??[]).length,1);
  const reviewGate=semantic.indexOf('if (!semanticTurnNeedsReview(primary, message, context)) return primary;');
  const reviewerCall=semantic.indexOf('const reviewedRaw = await callSemanticReviewer(');
  assert.ok(reviewGate>=0&&reviewerCall>reviewGate,'reviewer call must remain after the bounded review gate');
});

test('Phase 7 readiness: customer response composition cannot call a model or provider network',()=>{
  const composer=source('netlify/functions/_response-composer.ts');
  assert.doesNotMatch(composer,/callSemantic|interpretSemantic|callOpenAI|api\.openai|fetch\s*\(/u);
});

test('Phase 7 readiness: both customer text channels enter the shared core without legacy booking, membership, or payment-text pre-routing',()=>{
  const lineCore=source('netlify/functions/_line-webhook-core.ts');
  const lineWebhook=source('netlify/functions/line-webhook.ts');
  for(const channelSource of [lineCore,lineWebhook]){
    assert.match(channelSource,/processThongthaiChatCore/u);
    assert.doesNotMatch(channelSource,/handleLineBookingMessage|handleLineMembershipMessage|handleCustomerPaymentText/u);
  }

  const webCore=source('netlify/functions/thongthai-chat.ts');
  assert.match(webCore,/requireSemanticSupervisor:true/u);
  assert.ok(
    webCore.indexOf('requireSemanticSupervisor:true')<webCore.indexOf("responder: 'pendingQuestionContinuationResponse'"),
    'semantic supervisor must run before legacy conversational continuation routing',
  );
});

test('Phase 7 readiness: semantic and One-Mind layers may propose but never execute booking/order/payment',()=>{
  const semantic=source('netlify/functions/_semantic-interpreter.ts');
  const orchestrator=source('netlify/functions/_thongthai-one-mind-orchestrator.ts');
  const response=source('netlify/functions/_thongthai-one-mind-response.ts');
  const combined=`${semantic}\n${orchestrator}\n${response}`;

  assert.doesNotMatch(combined,/create_booking|create_restaurant_preorder|submit_payment|confirm_payment/u);
  assert.doesNotMatch(combined,/\.from\(['"]bookings['"]\)|\.from\(['"]orders['"]\)|\.from\(['"]payments['"]\)/u);
  assert.match(orchestrator,/actionProposed/u);
  assert.match(response,/legacy_required/u);
});

test('Phase 7 readiness: live Phase 6 smoke is semantic-only and cannot reach business state or executors',()=>{
  const live=source('scripts/run-phase6-live-multiturn.ts');
  assert.match(live,/interpretSemanticTurn/u);
  assert.doesNotMatch(live,/one-mind-orchestrator|operations-db|payments|create_booking|create_restaurant_preorder/u);
  assert.match(live,/noBusinessExecutorCalled:true/u);
});
