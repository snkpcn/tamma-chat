import test from 'node:test';
import assert from 'node:assert/strict';
import { readEnglishBasicQuestion } from '../netlify/functions/_english-basic-question';
import { classifyEscalationBoundary } from '../netlify/functions/_boundary-classifier';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, brainRequest, guestId, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

const message = (payload: unknown) => String((payload as { message?: unknown }).message ?? '');
const THAI = /[฀-๿]/u;

async function bothChannels(harness: Harness, seed: string, texts: string[]) {
  const web: Array<{ reply: string; modelCalls: number }> = [];
  const gid = guestId(seed);
  for (const [index, text] of texts.entries()) {
    const before = harness.modelCallCount();
    const result = await processThongthaiChatCore(brainRequest(text, gid, 'web'), `${seed}-${index}`);
    web.push({ reply: message(result.payload), modelCalls: harness.modelCallCount() - before });
  }
  const line: Array<{ reply: string; modelCalls: number }> = [];
  for (const text of texts) {
    const before = harness.modelCallCount();
    const result = await deliverLineTexts(harness, { userId: `U-${seed}`, texts: [text] });
    line.push({ reply: result.replies[0]?.texts.join('\n') ?? '', modelCalls: harness.modelCallCount() - before });
  }
  return { web, line };
}

test('the closed English shapes are read; bookings, second questions and "today" are not', () => {
  const cases: Array<[string, string]> = [
    ['What activities do you have?', 'activities'],
    ['What can I do here?', 'activities'],
    ['How much is horse riding?', 'activity_price'],
    ['How much is the ATV?', 'activity_price'],
    ["What's on the menu?", 'menu'],
    ['What time do you open?', 'hours'],
    ['What are your opening hours?', 'hours'],
  ];
  for (const [text, topic] of cases) assert.equal(readEnglishBasicQuestion(text)?.topic, topic, text);
  for (const text of [
    'I want to book horse riding', 'How much is horse riding and ATV?', 'Are you open today?',
    'How much is it?', 'Can you give me a discount?', 'What activities are good for kids aged 5?',
    'มีกิจกรรมอะไรบ้าง', 'What is the weather like?',
  ]) assert.equal(readEnglishBasicQuestion(text), null, text);
});

test('an English request FOR a discount escalates; asking whether one exists, a cheaper option, or less sugar does not', () => {
  for (const text of ['Can you give me a discount?', 'Can I get a discount?', 'Could we have a better price?', 'Can you lower the price?', 'Can you make it cheaper?']) {
    assert.equal(classifyEscalationBoundary(text)?.category, 'special_discount', text);
  }
  for (const text of ['Can I get my money back?', 'Can I get a refund?']) {
    assert.equal(classifyEscalationBoundary(text)?.category, 'refund_request', text);
  }
  for (const text of [
    'Do you have any promotions?', 'Are there any discounts?', 'Do you have discounts for kids?', 'Less sugar please',
    'Can you reduce the spice?', 'Is there a cheaper option?', 'Can I get the discounted price?', 'Can I get less ice?',
    'What is the price?', 'มีส่วนลดไหม',
  ]) assert.equal(classifyEscalationBoundary(text), null, text);
});

test('basic English questions are answered in English from live data with zero model calls, web and LINE', async () => {
  await withHarness(async harness => {
    const expected: Array<[string, RegExp]> = [
      ['What activities do you have?', /Here’s what Thammachat offers[\s\S]*Activities — ขี่ม้า/u],
      ['How much is horse riding?', /^Horse riding: 30 min for 300 THB or 45 min for 500 THB/u],
      ['How much is the ATV?', /^ATV: 30 min for 400 THB/u],
      ["What's on the menu?", /Dishes worth trying right now[\s\S]*• ผัดไทย — 120 THB/u],
      ['What time do you open?', /^Our regular hours are 06:00–18:00 every day/u],
    ];
    for (const [index, [text, answer]] of expected.entries()) {
      const { web, line } = await bothChannels(harness, `en-basic-${index}`, [text]);
      for (const [channel, [turn]] of [['web', web], ['line', line]] as const) {
        assert.match(turn!.reply, answer, `${channel}: ${text}`);
        assert.doesNotMatch(turn!.reply, /ครับ|บาท|slower than usual/u, `${channel}: ${text}`);
        assert.equal(turn!.modelCalls, 0, `${channel}: ${text}`);
      }
    }
  });
});

test('the reported English conversation: Hi -> activities -> "all of them" -> discount, web and LINE, zero model calls', async () => {
  await withHarness(async harness => {
    const { web, line } = await bothChannels(harness, 'en-conv', ['Hi', 'What activities do you have?', 'all of them', 'Can you give me a discount?']);
    for (const [channel, [greeting, activities, all, discount]] of [['web', web], ['line', line]] as const) {
      assert.match(greeting!.reply, /dining, stays, activities/u, channel);
      for (const turn of [activities!, all!]) assert.match(turn.reply, /Here’s what Thammachat offers/u, channel);
      assert.match(discount!.reply, /^A special discount needs the owner or pricing team/u, channel);
      for (const turn of [greeting!, activities!, all!, discount!]) {
        assert.equal(turn.modelCalls, 0, channel);
        assert.doesNotMatch(turn.reply.replace(/— [^\n]*/gu, ''), THAI, `${channel}: only stored names stay Thai`);
      }
    }
  });
});

test('near-miss English messages are not escalated as a discount request on either channel', async () => {
  await withHarness(async harness => {
    const { web, line } = await bothChannels(harness, 'en-near', ['Do you have any promotions?', 'Is there a cheaper option?', 'Less sugar please']);
    for (const turn of [...web, ...line]) assert.doesNotMatch(turn.reply, /special discount|pricing team/u);
  });
});
