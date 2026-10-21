import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// An availability question read each activity's schedule one after
// another: four activities meant four waits in a row before the answer.
// The reads now run side by side, and the answer is the same.

const resources = [
  { id: 'res-horse', code: 'activity-horse', service_type: 'activity', name: 'ขี่ม้า', active: true, metadata: {} },
  { id: 'res-atv', code: 'activity-atv', service_type: 'activity', name: 'ATV', active: true, metadata: {} },
  { id: 'res-archery', code: 'activity-archery', service_type: 'activity', name: 'ยิงธนู', active: true, metadata: {} },
  { id: 'res-boat', code: 'activity-boat', service_type: 'activity', name: 'ปั่นเป็ดน้ำ', active: true, metadata: {} },
];
const tomorrow10 = (() => { const at = new Date(Date.now() + 24 * 3_600_000); at.setUTCHours(3, 0, 0, 0); return at; })();
const schedules = resources.map((resource, index) => ({
  id: `round-${index}`, resource_id: resource.id, start_at: tomorrow10.toISOString(), end_at: new Date(tomorrow10.getTime() + 30 * 60_000).toISOString(),
  capacity_total: 4, capacity_reserved: 1, status: 'open', environment: 'live', metadata: {},
}));

function trackScheduleReads(harness: Harness): () => number {
  const inner = harness.fetchMock;
  let inFlight = 0;
  let most = 0;
  const wrapped = (async (url: string | URL, init: RequestInit = {}) => {
    if (!String(url).includes('/rest/v1/service_schedules')) return inner(url, init);
    inFlight += 1;
    most = Math.max(most, inFlight);
    try {
      await new Promise(resolve => setTimeout(resolve, 40));
      return await inner(url, init);
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  harness.fetchMock = wrapped;
  global.fetch = wrapped;
  return () => most;
}

for (const channel of ['web', 'line'] as const) {
  test(`${channel}: an availability question reads every activity's rounds side by side`, async () => {
    await withHarness(async harness => {
      const most = trackScheduleReads(harness);
      const text = 'พรุ่งนี้ขี่ม้า 30 นาทีว่างไหม';
      const reply = channel === 'web'
        ? String(((await processThongthaiChatCore(brainRequest(text, guestId('parallel-rounds'), 'web'), 'parallel-rounds')).payload as { message?: unknown }).message ?? '')
        : (await deliverLineTexts(harness, { userId: 'U-parallel-rounds', texts: [text] })).replies[0]?.texts.join('\n') ?? '';
      assert.match(reply, /^ขี่ม้า 30 นาที พรุ่งนี้ .*10:00/u, 'the same answer');
      assert.ok(most() >= 2, `schedule reads in flight at once: ${most()} -> ${reply}`);
    }, { serviceResources: resources, serviceSchedules: schedules });
  });
}
