// Regression: a horse-temperament question containing a bare "ร้อน"/"หนาว"
// must never be classified as weather_condition and answered with raw
// OpenWeatherMap data -- the exact production failure this closes was
// independent of (and undiscovered by) _top-level-intent.ts's own earlier
// fix for the identical class of bug (see WEATHER_CONDITION_MARKER's
// comment in _local-concierge-intent.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyLocalConciergeQuestion } from '../netlify/functions/_local-concierge-intent';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

test('classifyLocalConciergeQuestion: bare horse-temperament question is not weather_condition', () => {
  const cases = ['ม้าร้อนไหม', 'ม้าตัวนี้ร้อนไหม', 'ขี่ม้าแล้วร้อนไหม', 'ภาราดรหนาวไหม'];
  for (const message of cases) {
    const result = classifyLocalConciergeQuestion(message);
    assert.notEqual(
      result?.category, 'weather_condition',
      `"${message}" must not be classified weather_condition`,
    );
  }
});

test('classifyLocalConciergeQuestion: an unconditional weather anchor still wins inside a horse message', () => {
  const result = classifyLocalConciergeQuestion('ฝนตกไหม ม้ายังขี่ได้ไหม');
  assert.ok(result, 'genuinely weather-relevant horse message must still classify');
});

test('classifyLocalConciergeQuestion: bare weather question with no horse mention is unaffected', () => {
  const result = classifyLocalConciergeQuestion('ร้อนไหม ต้องเตรียมอะไร');
  assert.equal(result?.category, 'weather_condition');
});

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

test('E2E: horse-temperament question through the real core path never returns raw OpenWeatherMap text', async () => {
  await withHarness(async () => {
    const gid = guestId('horse-temperament-not-weather');
    const r = await processThongthaiChatCore(brainRequest('ม้าตัวนี้ร้อนไหม', gid, 'line'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.doesNotMatch(message, /openweathermap/iu, 'must never leak the raw weather-provider source label');
    assert.doesNotMatch(message, /จากข้อมูลล่าสุด/u, 'must never answer with the raw weather-provider sentence shape');
  });
});
