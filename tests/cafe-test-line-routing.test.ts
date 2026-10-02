import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cafeNotificationTeam, parseTeamCode } from '../netlify/functions/_ops-notifications';

test('cafe TEST aliases bind to the isolated cafe_test team', () => {
  for (const alias of ['cafe test', 'test cafe', 'คาเฟ่เทส', 'inthanin test', 'อินทนินเทส']) {
    assert.equal(parseTeamCode(alias), 'cafe_test', alias);
  }
});

test('ordinary cafe aliases continue to bind LIVE Inthanin', () => {
  for (const alias of ['cafe', 'café', 'คาเฟ่', 'inthanin', 'อินทนิน']) {
    assert.equal(parseTeamCode(alias), 'cafe', alias);
  }
});

test('cafe notification routing is strict by environment', () => {
  assert.equal(cafeNotificationTeam('test'), 'cafe_test');
  assert.equal(cafeNotificationTeam('live'), 'cafe');
  assert.equal(cafeNotificationTeam('anything-else'), 'cafe');
});
