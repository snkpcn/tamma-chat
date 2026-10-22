import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { callPreferredModel, providerTimingPolicyForCaller } from '../netlify/functions/_thongthai-model-provider';
import { withTurnWrites, remainingTurnAnswerMs } from '../netlify/functions/_turn-writes';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

for (const [domain, message, expected] of [
  ['otop', 'อยากรู้เรื่องของที่ชุมชนทำกันครับ', /น้ำผึ้ง|ผ้าพันคอ/u],
  ['activity', 'มีแนวไหนที่ผมพอลองได้บ้างครับ', /ขี่ม้า|ภาราดร|ทองไทย/u],
] as const) {
  test(`${domain}: first response preserves model understanding and answers before the shared deadline`, async () => {
    await withHarness(async harness => {
      harness.programGeminiReply({domain,intent:'catalog_question',action:'discover',informationNeed:'catalog',
        speechAct:'question',entities:{},references:[],constraints:[],confidence:.98,needsClarification:false});
      const inner = harness.fetchMock;
      const originalNow = Date.now;
      let elapsed = 0;
      // Identity, sources and interpretation have used 13s of the 22s web
      // turn. A fresh 18s composer clock previously ignored all that work.
      global.fetch = (async (url, init = {}) => {
        const result = await inner(url, init);
        if (String(url).includes('api.openai.com/v1/responses')) elapsed = 13_000;
        return result;
      }) as typeof fetch;
      Date.now = () => originalNow() + elapsed;
      try {
        const result = await processThongthaiChatCore(brainRequest(message, guestId(`shared-${domain}`), 'web'), `shared-${domain}`);
        assert.equal(result.statusCode, 200);
        assert.match(String(result.payload.message), expected);
        assert.doesNotMatch(String(result.payload.message), /ตอบไม่ทัน|ส่งข้อความเดิม/u);
        assert.equal(harness.modelCallCount(), 1, 'understand once, then use grounded facts when no time remains for a second call');
        assert.equal(harness.postsTo('bookings').length, 0);
        assert.ok(harness.postsTo('ai_response_turns').length > 0);
      } finally { Date.now = originalNow; }
    });
  });
}

test('the provider refuses a new call when the parent turn needs its remaining time to finish', async () => {
  await withHarness(async harness => {
    await withTurnWrites(async () => {
      assert.ok(remainingTurnAnswerMs() <= 4_500);
      await assert.rejects(callPreferredModel('test', [{role:'user',content:'an arbitrary new question'}], 'shared-deadline'),
        /deadline leaves no time/);
      assert.equal(harness.modelCallCount(), 0);
      assert.equal(harness.postsTo('ai_api_cost_events').length, 0, 'no request or reservation was made');
    }, () => 1_000, Date.now() + 4_500);
    assert.equal(remainingTurnAnswerMs(), Infinity, 'the deadline never leaks to another request');
  });
});

test('required web interpretation can finish beyond six seconds within the shared deadline', async () => {
  assert.equal(providerTimingPolicyForCaller('semantic-interpreter').perAttemptCapMs, 6_000);
  await withTurnWrites(async () => {
    assert.equal(providerTimingPolicyForCaller('semantic-interpreter').perAttemptCapMs, 12_000);
    assert.equal(providerTimingPolicyForCaller('grounded-response-composition').perAttemptCapMs, 6_000);
  }, () => 1_000, Date.now() + 22_000);
  assert.equal(providerTimingPolicyForCaller('semantic-interpreter').perAttemptCapMs, 6_000);
});

test('a valid first interpretation arriving after the old provider timeout is delivered', async () => {
  await withHarness(async () => {
    global.fetch = (async (_url, init) => new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response(JSON.stringify({output_text:'{"understood":true}'}))), 6_250);
      init?.signal?.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(init.signal!.reason);
      }, {once:true});
    })) as typeof fetch;
    const answer = await withTurnWrites(() => callPreferredModel('test', [{role:'user',content:'an arbitrary first question'}], 'semantic-interpreter'),
      () => 1_000, Date.now() + 22_000);
    assert.equal(answer, '{"understood":true}');
  });
});
