// Real production gap: when a customer names a specific horse mid-
// conversation ("เอาภาราดร"), the legacy LINE booking executor only ever
// wrote the ACTIVITY TYPE resourceCode ("activity-horse") to the booking --
// the specific asset selection never reached the durable `bookings` row at
// all, so staff in Backoffice had no way to know which horse to prepare.
// These tests prove: (1) the selection is recognized from free text using
// the SAME bounded, owner-verified asset lexicon the deterministic semantic
// layer uses (never a second phrase table), (2) it round-trips correctly
// through the session's smuggled marker field alongside duration, and (3)
// the marker format changed from a strict single-value match to a multi-
// field one without breaking existing duration-only sessions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  activityAssetFromSession, activityAssetFromText, activityDurationFromSession, activitySessionMarker,
  type LineBookingSession,
} from '../netlify/functions/_operations-db';

function session(overrides: Partial<LineBookingSession> = {}): LineBookingSession {
  return {
    service_type: 'activity', resource_code: 'activity-horse', requested_date: null, requested_time: null,
    end_date: null, party_size: null, quantity: 1, special_request: null, status: 'collecting', booking_code: null,
    ...overrides,
  };
}

test('a named horse selection is recognized from free text and maps to the real asset_code', () => {
  const pharadon = activityAssetFromText('เอาภาราดร');
  assert.deepEqual(pharadon, { name: 'ภาราดร', assetCode: 'horse-pharadon' });
  const thongthai = activityAssetFromText('ขอทองไทยครับ');
  assert.deepEqual(thongthai, { name: 'ทองไทย', assetCode: 'horse-thongthai' });
  assert.equal(activityAssetFromText('60 นาที'), null);
});

test('the combined session marker carries both duration and asset, and both parse back out', () => {
  const marker = activitySessionMarker(60, { name: 'ภาราดร', assetCode: 'horse-pharadon' });
  assert.ok(marker);
  const withMarker = session({ special_request: marker, quantity: 60 });
  assert.equal(activityDurationFromSession(withMarker), 60);
  assert.deepEqual(activityAssetFromSession(withMarker), { name: 'ภาราดร', assetCode: 'horse-pharadon' });
});

test('a duration-only marker (no asset ever selected) still parses duration with no asset', () => {
  const marker = activitySessionMarker(30, null);
  assert.equal(marker, 'activity_duration:30');
  const withMarker = session({ special_request: marker });
  assert.equal(activityDurationFromSession(withMarker), 30);
  assert.equal(activityAssetFromSession(withMarker), null);
});

test('an asset-only marker (duration not yet known) still parses the asset with no duration', () => {
  const marker = activitySessionMarker(null, { name: 'ทองไทย', assetCode: 'horse-thongthai' });
  assert.ok(marker?.startsWith('activity_asset:'));
  const withMarker = session({ special_request: marker });
  assert.equal(activityDurationFromSession(withMarker), null);
  assert.deepEqual(activityAssetFromSession(withMarker), { name: 'ทองไทย', assetCode: 'horse-thongthai' });
});

test('a session with neither duration nor asset selected yet has a null marker and parses to nulls', () => {
  assert.equal(activitySessionMarker(null, null), null);
  const empty = session({ special_request: null });
  assert.equal(activityDurationFromSession(empty), null);
  assert.equal(activityAssetFromSession(empty), null);
});
