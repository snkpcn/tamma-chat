import test from 'node:test';
import assert from 'node:assert/strict';
import { withHarness } from './helpers/canonical-core-harness';
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
  await expectBoth('avail-open', WITH_LENGTH, /ขี่ม้า 30 นาที วันที่ \d{4}-\d{2}-\d{2} ยังว่างรอบ 10:00 น\. \(ว่าง 3\)/u,
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
