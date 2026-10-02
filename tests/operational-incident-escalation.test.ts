import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { brainRequest, guestId, withHarness } from './helpers/canonical-core-harness';

function message(payload: unknown): string {
  return String((payload as { message?: string }).message ?? '');
}

test('lost property opens a durable incident and alerts the owner immediately', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('owner_general');
    const result = await processThongthaiChatCore(
      brainRequest('ของหายอะ น่าจะลืมหมวกไว้เมื่อเช้า', guestId('lost-item-owner'), 'line'),
      'lost-item-event-1',
    );

    assert.equal(result.statusCode, 200);
    assert.match(message(result.payload), /รับเรื่องของหาย/u);
    assert.match(message(result.payload), /ส่งให้เจ้าของตรวจสอบแล้ว/u);
    assert.match(message(result.payload), /ของที่หาย.*จุดที่เห็นครั้งสุดท้าย.*เวลา/u);
    const event = harness.postsTo('ops_feedback_events')[0];
    assert.equal(event?.feedback_type, 'incident');
    assert.equal(event?.severity, 'high');
    assert.deepEqual(event?.issue_keywords, ['lost_property']);
    assert.equal(harness.notificationDeliveries().filter(row => row.deliveryType.startsWith('feedback_incident')).length, 1);
    assert.equal(harness.postsTo('bookings').length, 0);
  });
});

test('a TEST cafe lost-property incident stays inside the dedicated cafe test LINE channel', async () => {
  await withHarness(async harness => {
    harness.programOpsChannel('cafe_test');
    harness.programOpsChannel('owner_general');
    const gid = guestId('lost-item-cafe');
    const request = brainRequest('ลืมกระเป๋าไว้ที่คาเฟ่ Inthanin ช่วยตามให้หน่อยครับ', gid, 'web');
    const first = await processThongthaiChatCore(request, 'lost-item-event-2');
    const replay = await processThongthaiChatCore(request, 'lost-item-event-2');

    assert.doesNotMatch(message(first.payload), /เจ้าของ/u);
    assert.doesNotMatch(message(replay.payload), /เจ้าของ/u);
    assert.equal(harness.postsTo('ops_feedback_events').length, 2, 'both transport attempts are observable');
    const deliveries = harness.notificationDeliveries().filter(row => row.deliveryType.startsWith('feedback_incident'));
    assert.equal(deliveries.length, 1, 'TEST cafe incidents notify only the isolated cafe_test channel');
    assert.deepEqual(new Set(deliveries.map(row => row.teamCode)), new Set(['cafe_test']));
  });
});
