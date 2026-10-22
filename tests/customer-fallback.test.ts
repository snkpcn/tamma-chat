import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { askThongthaiReliably, LINE_TURN_BUDGET_MS } from '../netlify/functions/_line-webhook-core';
import { isTransactionMessage, turnUnfinishedMessage } from '../netlify/functions/_customer-fallback';
import { withHarness, brainRequest, guestId, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

const message = (payload: unknown) => String((payload as { message?: unknown }).message ?? '');
const RETRY = /ลองพิมพ์อีกครั้ง|ลองส่ง|try again|send .* again/iu;
const SLOW = /คิดช้า|slower than usual/iu;
// Questions only a model can answer: no deterministic path owns them.
const OPEN_TH = 'เล่าเรื่องตลกให้ฟังหน่อย';
const OPEN_EN = 'Tell me something funny';

/** Run with the REAL 2 THB ledger tightened to 0.5 THB, so this
 *  conversation's first paid call is already refused by the cost guard. The
 *  env override can only lower the cap, never raise it. */
async function withSpentBudget<T>(run: (harness: Harness) => Promise<T>): Promise<T> {
  return withHarness(async harness => {
    const before = { cap: process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_THB, bypass: process.env.THONGTHAI_TEST_BYPASS_COST_CAP };
    process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_THB = '0.5';
    delete process.env.THONGTHAI_TEST_BYPASS_COST_CAP;
    try { return await run(harness); }
    finally {
      if (before.cap === undefined) delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_THB;
      else process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_THB = before.cap;
      if (before.bypass === undefined) delete process.env.THONGTHAI_TEST_BYPASS_COST_CAP;
      else process.env.THONGTHAI_TEST_BYPASS_COST_CAP = before.bypass;
    }
  });
}

const sources = (harness: Harness) => harness.postsTo('ai_response_turns').map(row => String(row.final_response_source));

test('budget exhausted, web: no "retry", the live catalog instead, in the customer language, visible in the monitor', async () => {
  await withSpentBudget(async harness => {
    const th = message((await processThongthaiChatCore(brainRequest(OPEN_TH, guestId('fb-budget-web-th'), 'web'), 'fb-budget-web-th')).payload);
    assert.doesNotMatch(th, SLOW);
    assert.doesNotMatch(th, RETRY, 'retrying cannot bring the budget back');
    assert.match(th, /ตอบคำถามแบบนี้ให้ละเอียดในแชตนี้ไม่ได้แล้ว/u);
    assert.match(th, /กิจกรรม — ขี่ม้า/u, 'useful content from the live activity catalog');

    const en = message((await processThongthaiChatCore(brainRequest(OPEN_EN, guestId('fb-budget-web-en'), 'web'), 'fb-budget-web-en')).payload);
    assert.match(en, /can’t give a detailed answer to this in this chat anymore/u);
    assert.match(en, /Activities — ขี่ม้า/u);
    assert.doesNotMatch(en, RETRY);

    assert.ok(sources(harness).includes('fallback_budget_exhausted'), `monitor rows: ${sources(harness).join(', ')}`);
  });
});

test('budget exhausted, LINE: the same honest reply through the real webhook', async () => {
  await withSpentBudget(async harness => {
    const result = await deliverLineTexts(harness, { userId: 'U-fb-budget', texts: [OPEN_TH, OPEN_EN] });
    const [th, en] = result.replies.map(reply => reply?.texts.join('\n') ?? '');
    assert.match(th, /ตอบคำถามแบบนี้ให้ละเอียดในแชตนี้ไม่ได้แล้ว/u);
    assert.doesNotMatch(th, RETRY);
    assert.match(en, /can’t give a detailed answer/u);
    assert.doesNotMatch(en, RETRY);
    assert.ok(sources(harness).includes('fallback_budget_exhausted'));
  });
});

test('provider unavailable: "try again" is allowed, in the customer language, on both channels', async () => {
  // The harness answers an unprogrammed model call with HTTP 503.
  await withHarness(async harness => {
    const web = message((await processThongthaiChatCore(brainRequest(OPEN_EN, guestId('fb-down-web'), 'web'), 'fb-down-web')).payload);
    assert.match(web, /Please try again in a moment/u);
    assert.doesNotMatch(web, /[฀-๿]/u, 'no Thai in an English reply');

    const line = await deliverLineTexts(harness, { userId: 'U-fb-down', texts: [OPEN_TH] });
    assert.match(line.replies[0]?.texts.join('\n') ?? '', /ลองพิมพ์อีกครั้ง/u);

    assert.ok(sources(harness).includes('fallback_provider_unavailable'), `monitor rows: ${sources(harness).join(', ')}`);
    assert.ok(!sources(harness).includes('fallback_budget_exhausted'), 'an outage is not reported as a spent budget');
  });
});

test('LINE turn not answered in time: orders are mentioned only for a transaction', async () => {
  const exhausted = Date.now() - LINE_TURN_BUDGET_MS - 1;
  const reply = async (text: string) => String(((await askThongthaiReliably(text, 'U-fb-late', `late-${text}`, undefined, exhausted)) as { message?: unknown }).message);
  const price = await reply('ขี่ม้าราคาเท่าไหร่');
  assert.match(price, /ตอบไม่ทันในรอบนี้/u);
  assert.doesNotMatch(price, /ออเดอร์|order/iu, 'a price question never placed an order');

  const booking = await reply('ขอจองขี่ม้า 2 คน พรุ่งนี้ 10 โมง');
  assert.match(booking, /ไม่สร้างออเดอร์ซ้ำ/u);

  const english = await reply('How much is horse riding?');
  assert.match(english, /couldn’t finish answering in time/u);
  assert.doesNotMatch(english, /order/iu);
});

test('web turn not answered in time: the same rule, through the real core under a stalled backend', async t => {
  await withHarness(async harness => {
    const inner = harness.fetchMock;
    // Advance the web deadline instead of waiting in real time. The
    // diagnostic outcome write is available even while the read is stalled.
    const { WEB_CUSTOMER_TURN_BUDGET_MS } = await import('../netlify/functions/_customer-turn-budget');
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    global.fetch = (async (url: string | URL, init: RequestInit = {}) => {
      if (String(url).includes('/rest/v1/') && !String(url).includes('/customer_turn_outcomes')) await new Promise(() => {});
      return inner(url, init);
    }) as typeof fetch;
    try {
      const pending = processThongthaiChatCore(brainRequest('ขี่ม้าราคาเท่าไหร่', guestId('fb-late-web'), 'web'), 'fb-late-web');
      t.mock.timers.tick(WEB_CUSTOMER_TURN_BUDGET_MS + 1);
      const reply = message((await pending).payload);
      assert.match(reply, /ตอบไม่ทันในรอบนี้/u);
      assert.doesNotMatch(reply, /คำขอจองหรือสั่งซื้อ|ออเดอร์/u, 'a price question never placed an order');
    } finally {
      t.mock.timers.reset();
      global.fetch = inner;
    }
  });
});

test('the transaction check covers ordinary requests and leaves questions alone', () => {
  for (const text of ['ขอจองขี่ม้า 2 คน พรุ่งนี้ 10 โมง', 'สั่งต้มแซ่บ 1 ที่', 'ยืนยันจอง', 'Book horse riding for 2 tomorrow', 'I want to order the spicy soup']) {
    assert.equal(isTransactionMessage(text), true, text);
  }
  for (const text of ['ขี่ม้าราคาเท่าไหร่', 'มีต้มแซ่บไหม', 'How much is horse riding?', 'Is it open today?']) {
    assert.equal(isTransactionMessage(text), false, text);
  }
  // The web keeps "ask staff before resubmitting" for a real transaction.
  assert.match(turnUnfinishedMessage('th', true, 'web'), /กรุณาให้พนักงานตรวจสอบก่อนส่งคำขอซ้ำ/u);
});
