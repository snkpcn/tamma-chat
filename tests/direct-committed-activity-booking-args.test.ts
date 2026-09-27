// Real bug found while researching Human Core PR C's activity SOT
// relationships: activityAssetFromText returned only {name, assetCode},
// discarding the resourceCode ACTIVITY_ASSET_SELECTIONS already carries for
// the matched asset -- so directCommittedActivityBookingArgs (a single-
// message "เอาภาราดร ... จองเลย" style deterministic booking path) sent
// resourceCode: undefined into create_booking whenever this path fired.
// Fixed by having activityAssetFromText also return the real resourceCode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { directCommittedActivityBookingArgs } from '../netlify/functions/thongthai-chat';

test('a single-message committed horse booking carries a real resourceCode, never undefined', () => {
  const args = directCommittedActivityBookingArgs('เอาภาราดร วันที่ 2026-10-05 เวลา 10:00 ระยะเวลา 30 นาที จำนวน 1 คน จองเลย');
  assert.ok(args);
  assert.equal(args!.resourceCode, 'activity-horse');
  assert.equal(args!.horseName, 'ภาราดร');
});

test('the other known asset also resolves a real resourceCode', () => {
  const args = directCommittedActivityBookingArgs('เอาทองไทย วันที่ 2026-10-05 เวลา 10:00 ระยะเวลา 60 นาที จำนวน 2 คน จองเลย');
  assert.ok(args);
  assert.equal(args!.resourceCode, 'activity-horse');
  assert.equal(args!.horseName, 'ทองไทย');
});
