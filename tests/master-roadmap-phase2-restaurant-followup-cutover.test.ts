// PHASE 2 PRODUCTION REGRESSION — RESTAURANT FOLLOW-UP VS ONE-MIND CUTOVER
//
// Real LINE production sequence (2026-09-25):
// horse context existed -> dietary constraint -> restaurant recommendation ->
// "มีอะไรแนะนำอีก".
// The final turn fell through to One-Mind's generic clarification even though
// restaurantAdvisorContext had just been persisted server-side.
//
// Why existing tests missed it: LINE sends chatHistory: [], and the old
// preserveRestaurantFastPath inspected an EMPTY agent state before One-Mind
// cutover. Existing continuous restaurant tests checked only the FINAL reply.
// In the harness, One-Mind's default semantic answer happened to return
// legacy_required, so the request eventually fell through to the deterministic
// restaurant responder and looked correct. Production's real model can instead
// compose a generic clarification and stop there. This test therefore proves
// the stronger invariant: a persisted restaurant follow-up must not call the
// model/One-Mind at all before the deterministic restaurant responder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { withHarness } from './helpers/canonical-core-harness';
import { handler as lineWebhookHandler } from '../netlify/functions/line-webhook';

const CHANNEL_SECRET = 'test-phase2-restaurant-followup-cutover';

type CapturedReply = { replyToken: string; messages: Array<{ type: string; text?: string }> };

function installReplyCapture(): { restore: () => void; replies: CapturedReply[] } {
  const original = global.fetch;
  const replies: CapturedReply[] = [];
  global.fetch = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).includes('api.line.me/v2/bot/message/reply')) {
      replies.push(JSON.parse(String(init?.body ?? '{}')) as CapturedReply);
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return original(url as never, init);
  }) as typeof fetch;
  return { restore: () => { global.fetch = original; }, replies };
}

let seq = 0;
function privateEvent(text: string, userId: string) {
  seq += 1;
  return {
    type: 'message',
    replyToken: `reply-${userId}-${seq}`,
    timestamp: Date.now() + seq,
    source: { type: 'user', userId },
    message: { id: `msg-${userId}-${seq}`, type: 'text', text },
  };
}

async function callLineWebhook(text: string, userId: string) {
  const body = JSON.stringify({ destination: 'test-destination', events: [privateEvent(text, userId)] });
  const signature = createHmac('sha256', CHANNEL_SECRET).update(body, 'utf8').digest('base64');
  return lineWebhookHandler(
    { httpMethod: 'POST', headers: { 'x-line-signature': signature }, body } as never,
    {} as never,
  );
}

function replyText(replies: CapturedReply[], index: number): string {
  return replies[index]?.messages.map(m => m.text ?? '').join('\n') ?? '';
}

function menuLines(message: string): string[] {
  return message.split('\n').filter(line => /^\s*•/u.test(line));
}

test('production cutover: restaurant follow-up survives empty LINE history and pre-existing activity context', async () => {
  const oldSecret = process.env.LINE_CHANNEL_SECRET;
  const oldToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  const oldCutover = process.env.THONGTHAI_ONE_MIND_CUTOVER;
  process.env.LINE_CHANNEL_SECRET = CHANNEL_SECRET;
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-token';
  process.env.THONGTHAI_ONE_MIND_CUTOVER = '1';

  try {
    await withHarness(async harness => {
      const capture = installReplyCapture();
      try {
        const user = 'phase2-prod-restaurant-followup';

        // Competing activity context existed in the real production chat.
        await callLineWebhook('อยากขี่ม้า ไม่เคยเลย กลัวตก', user);

        // Establish dietary memory + restaurant server context.
        await callLineWebhook('กินไม่เผ็ด แพ้กุ้ง', user);
        await callLineWebhook('ร้านอาหารมีอะไรแนะนำ', user);
        const firstRecommendation = replyText(capture.replies, 2);
        assert.ok(menuLines(firstRecommendation).length >= 1, 'setup must produce a restaurant recommendation');

        // This exact production turn must continue restaurant context despite
        // LINE chatHistory being empty and One-Mind cutover being enabled.
        // The load-bearing property is stronger than just "eventually got a
        // menu": once server-side restaurant context proves the topic, the
        // follow-up must NEVER spend an LLM/One-Mind call first. Production's
        // real model sometimes composed a generic clarification there instead
        // of falling back, which is exactly what the owner observed.
        const modelCallsBeforeFollowup = harness.modelCallCount();
        await callLineWebhook('มีอะไรแนะนำอีก', user);
        const followup = replyText(capture.replies, 3);

        assert.equal(
          harness.modelCallCount(),
          modelCallsBeforeFollowup,
          'restaurant follow-up with persisted context must bypass One-Mind/model cutover',
        );
        assert.doesNotMatch(followup, /ขอรายละเอียดเพิ่มอีกนิด|ช่วยต่อให้ตรงเรื่อง/u);
        const followupItems = menuLines(followup);
        assert.ok(followupItems.length >= 1, 'follow-up should return another grounded restaurant recommendation');
        for (const line of followupItems) {
          assert.doesNotMatch(line, /กุ้ง/u, 'remembered shrimp allergy must filter recommended item lines');
        }
      } finally {
        capture.restore();
      }
    });
  } finally {
    if (oldSecret === undefined) delete process.env.LINE_CHANNEL_SECRET; else process.env.LINE_CHANNEL_SECRET = oldSecret;
    if (oldToken === undefined) delete process.env.LINE_CHANNEL_ACCESS_TOKEN; else process.env.LINE_CHANNEL_ACCESS_TOKEN = oldToken;
    if (oldCutover === undefined) delete process.env.THONGTHAI_ONE_MIND_CUTOVER; else process.env.THONGTHAI_ONE_MIND_CUTOVER = oldCutover;
  }
});
