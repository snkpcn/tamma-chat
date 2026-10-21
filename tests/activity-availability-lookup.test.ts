import test from 'node:test';
import assert from 'node:assert/strict';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { askBothChannels, failReads } from './helpers/both-channels';

// "พรุ่งนี้ขี่ม้าว่างไหม" used to be read as a catalog question and answered
// "มีขี่ม้าครับ ตอนนี้มีม้า 2 ตัว" whether the rounds were open, full, absent
// or unreadable -- a "yes" nobody checked.
const horse = { id: 'res-horse', code: 'activity-horse', service_type: 'activity', name: 'ขี่ม้า', active: true, metadata: {} };
const tomorrow10 = (() => {
  // 10:00 Bangkok tomorrow = 03:00 UTC.
  const at = new Date(Date.now() + 24 * 3_600_000);
  at.setUTCHours(3, 0, 0, 0);
  return at;
})();
const round = (reserved: number) => ({
  id: 'round-1', resource_id: horse.id, start_at: tomorrow10.toISOString(),
  end_at: new Date(tomorrow10.getTime() + 30 * 60_000).toISOString(),
  capacity_total: 4, capacity_reserved: reserved, status: 'open', environment: 'live', metadata: {},
});
const WITH_LENGTH = 'พรุ่งนี้ขี่ม้า 30 นาทีว่างไหม';

async function expectBoth(seed: string, text: string, expected: RegExp, catalog: Record<string, unknown>, fail = false) {
  await withHarness(async harness => {
    if (fail) failReads(harness, 'service_schedules');
    for (const answer of await askBothChannels(harness, seed, text)) {
      assert.match(answer.reply, expected, `${answer.channel}: ${answer.reply}`);
      assert.doesNotMatch(answer.reply, /ตอนนี้มีม้า/u, `${answer.channel}: not the catalog`);
      assert.equal(answer.modelCalls, 0, answer.channel);
    }
  }, catalog);
}

test('an open round is answered with its real time and free places, web and LINE', async () => {
  await expectBoth('avail-open', WITH_LENGTH, /ขี่ม้า 30 นาที พรุ่งนี้ \((?:อา|จ|อ|พ|พฤ|ศ|ส)\. \d{1,2} \S+\) ยังว่างรอบ 10:00 น\. \(ว่าง 3\)/u,
    { serviceResources: [horse], serviceSchedules: [round(1)] });
});

test('a full round and no rounds at all are "no free round confirmed", never "มี"', async () => {
  for (const [seed, schedules] of [['avail-full', [round(4)]], ['avail-none', []]] as const) {
    await expectBoth(seed, WITH_LENGTH, /ยังไม่มีคิวว่างที่ยืนยันได้ \(รอบเต็มหรือยังไม่เปิดรอบ\)/u,
      { serviceResources: [horse], serviceSchedules: schedules });
  }
});

test('a failed schedule read is "cannot confirm", web and LINE', async () => {
  await expectBoth('avail-fail', WITH_LENGTH, /ยังเช็กคิวสดของ ขี่ม้า ให้ยืนยันไม่ได้/u, { serviceResources: [horse] }, true);
});

test('a missing day or length is asked for, with the lengths sold -- not answered "no rounds"', async () => {
  const catalog = { serviceResources: [horse], serviceSchedules: [round(1)] };
  await expectBoth('avail-no-length', 'พรุ่งนี้ขี่ม้าว่างไหม', /อยากเช็กแบบกี่นาที \(มี 30 นาที \/ 45 นาที\)ครับ$/u, catalog);
  await expectBoth('avail-no-day', 'ขี่ม้าว่างไหม', /อยากเช็กวันไหน และแบบกี่นาที/u, catalog);
});

// The demo server found what one-question-per-customer tests missed: once
// the conversation was about an activity, the next round question took a
// different path, paid two model calls and ran out of time.
test('a follow-up round question, and a bare "30 นาที" answer, stay on the live rounds -- same customer, web and LINE', async () => {
  await withHarness(async harness => {
    const texts = ['พรุ่งนี้ขี่ม้าว่างไหม', WITH_LENGTH, '30 นาที'];
    const web: Array<{ reply: string; calls: number }> = [];
    const gid = guestId('avail-follow-web');
    for (const [index, text] of texts.entries()) {
      const before = harness.modelCallCount();
      const result = await processThongthaiChatCore(brainRequest(text, gid, 'web'), `avail-follow-web-${index}`);
      web.push({ reply: String((result.payload as { message?: unknown }).message ?? ''), calls: harness.modelCallCount() - before });
    }
    const line: Array<{ reply: string; calls: number }> = [];
    for (const text of texts) {
      const before = harness.modelCallCount();
      const result = await deliverLineTexts(harness, { userId: 'U-avail-follow', texts: [text] });
      line.push({ reply: result.replies[0]?.texts.join('\n') ?? '', calls: harness.modelCallCount() - before });
    }
    for (const [channel, turns] of [['web', web], ['line', line]] as const) {
      assert.match(turns[0]!.reply, /อยากเช็กแบบกี่นาที/u, channel);
      for (const answered of [turns[1]!, turns[2]!]) {
        assert.match(answered.reply, /ขี่ม้า 30 นาที พรุ่งนี้ \((?:อา|จ|อ|พ|พฤ|ศ|ส)\. \d{1,2} \S+\) ยังว่างรอบ 10:00 น\./u, `${channel}: ${answered.reply}`);
      }
      for (const turn of turns) assert.equal(turn.calls, 0, channel);
    }
  }, { serviceResources: [horse], serviceSchedules: [round(1)] });
});

test('English: "Is horse riding available tomorrow?" asks the length, then answers the real round -- same customer, web and LINE', async () => {
  await withHarness(async harness => {
    const texts = ['Is horse riding available tomorrow?', '30 minutes', 'Is horse riding available tomorrow for 30 minutes?'];
    const run = async (send: (text: string) => Promise<string>) => {
      const replies: Array<{ reply: string; calls: number }> = [];
      for (const text of texts) {
        const before = harness.modelCallCount();
        replies.push({ reply: await send(text), calls: harness.modelCallCount() - before });
      }
      return replies;
    };
    const gid = guestId('avail-en-web');
    let index = 0;
    const web = await run(async text => String(((await processThongthaiChatCore({ ...brainRequest(text, gid, 'web'), language: 'en' }, `avail-en-web-${index++}`)).payload as { message?: unknown }).message ?? ''));
    const line = await run(async text => (await deliverLineTexts(harness, { userId: 'U-avail-en', texts: [text] })).replies[0]?.texts.join('\n') ?? '');
    for (const [channel, turns] of [['web', web], ['line', line]] as const) {
      assert.match(turns[0]!.reply, /^I can check live Horse riding slots for you — how long \(30 min \/ 45 min\)\?/u, `${channel}: ${turns[0]!.reply}`);
      for (const answered of [turns[1]!, turns[2]!]) {
        assert.match(answered.reply, /^Horse riding, 30 min, tomorrow \((?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) \d{1,2} [A-Z][a-z]{2}\): open slots at 10:00 \(3 free\)/u, `${channel}: ${answered.reply}`);
      }
      for (const turn of turns) assert.equal(turn.calls, 0, channel);
    }
  }, { serviceResources: [horse], serviceSchedules: [round(1)] });
});
