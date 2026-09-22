// Weather provider tests -- _weather-provider.ts is the ONLY module
// allowed to assert a live weather fact for ทำมา-ชาติ, and only when both
// a real API key AND resolved coordinates are actually available. Covers
// the three cases the owner's Phase 7 message asked for: (1) unavailable
// -> structured result, no crash; (2) configured/mocked -> the response
// actually uses the weather data and cites freshness/source; (3) ground
// condition -> even with weather data available, actual ground condition
// is never claimed without a ground/staff source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeatherForTammaLocation } from '../netlify/functions/_weather-provider';
import { TAMMA_CHART_LOCATION } from '../netlify/functions/_local-concierge-location';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

test('unavailable when no API key is configured -- structured result, no crash', async () => {
  delete process.env.WEATHER_API_KEY;
  const result = await getWeatherForTammaLocation();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.unavailableReason, 'no_api_key_configured');
  assert.equal(result.condition, null);
  assert.equal(result.temperatureCelsius, null);
});

test('unavailable when location is not resolved, even with an API key configured', async () => {
  assert.equal(TAMMA_CHART_LOCATION.latitude, null, 'precondition: canonical location starts unresolved');
  process.env.WEATHER_API_KEY = 'test-key';
  try {
    const result = await getWeatherForTammaLocation();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'location_not_resolved');
  } finally {
    delete process.env.WEATHER_API_KEY;
  }
});

test('configured + resolved location: uses the real fetched data and cites source/freshness', async () => {
  process.env.WEATHER_API_KEY = 'test-key';
  const originalLat = TAMMA_CHART_LOCATION.latitude;
  const originalLng = TAMMA_CHART_LOCATION.longitude;
  TAMMA_CHART_LOCATION.latitude = 15.8;
  TAMMA_CHART_LOCATION.longitude = 102.03;
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL) => {
    assert.match(String(url), /openweathermap\.org/u);
    return {
      ok: true,
      json: async () => ({
        weather: [{ main: 'Rain', description: 'ฝนตกปรอยๆ' }],
        main: { temp: 27.4 },
        rain: { '1h': 1.2 },
      }),
    } as Response;
  }) as typeof fetch;
  try {
    const result = await getWeatherForTammaLocation(new Date('2026-09-22T10:00:00Z'));
    assert.equal(result.status, 'ok');
    assert.equal(result.source, 'openweathermap');
    assert.equal(result.fetchedAt, '2026-09-22T10:00:00.000Z');
    assert.equal(result.temperatureCelsius, 27);
    assert.equal(result.forecastSummary, 'ฝนตกปรอยๆ');
  } finally {
    global.fetch = originalFetch;
    TAMMA_CHART_LOCATION.latitude = originalLat;
    TAMMA_CHART_LOCATION.longitude = originalLng;
  }
});

test('provider errors (non-ok response) degrade to unavailable, never a thrown error', async () => {
  process.env.WEATHER_API_KEY = 'test-key';
  const originalLat = TAMMA_CHART_LOCATION.latitude;
  const originalLng = TAMMA_CHART_LOCATION.longitude;
  TAMMA_CHART_LOCATION.latitude = 15.8;
  TAMMA_CHART_LOCATION.longitude = 102.03;
  const originalFetch = global.fetch;
  global.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
  try {
    const result = await getWeatherForTammaLocation();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'provider_error');
  } finally {
    global.fetch = originalFetch;
    TAMMA_CHART_LOCATION.latitude = originalLat;
    TAMMA_CHART_LOCATION.longitude = originalLng;
  }
});

test('end-to-end: when live weather is configured, the concierge response uses it and cites freshness, ' +
  'but still never claims the actual ground condition', async () => {
  process.env.WEATHER_API_KEY = 'test-key';
  const originalLat = TAMMA_CHART_LOCATION.latitude;
  const originalLng = TAMMA_CHART_LOCATION.longitude;
  TAMMA_CHART_LOCATION.latitude = 15.8;
  TAMMA_CHART_LOCATION.longitude = 102.03;
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    json: async () => ({ weather: [{ main: 'Clear', description: 'แดดจัด' }], main: { temp: 34 } }),
  }) as Response) as typeof fetch;
  try {
    await withHarness(async () => {
      const gid = guestId('weather-live-activity');
      const r = await processThongthaiChatCore(brainRequest('วันนี้ขี่ม้าได้ไหม แดดแรงปะ', gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200);
      const message = msg(r.payload);
      assert.match(message, /จากข้อมูลล่าสุด/u, 'must cite freshness/source when live weather data is actually used');
      assert.match(message, /สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ/u, 'must never claim the actual ground condition from a weather fact alone');
      assert.doesNotMatch(message, /พื้นแห้งแน่นอน|พื้นลื่นแน่นอน|เล่นได้แน่นอน/u, 'must never assert a definite ground-condition verdict');
    });
  } finally {
    global.fetch = originalFetch;
    TAMMA_CHART_LOCATION.latitude = originalLat;
    TAMMA_CHART_LOCATION.longitude = originalLng;
  }
});

test('end-to-end: when live weather is unavailable, the concierge response says so plainly (never a generic failure)', async () => {
  delete process.env.WEATHER_API_KEY;
  await withHarness(async () => {
    const gid = guestId('weather-unavailable');
    const r = await processThongthaiChatCore(brainRequest('วันนี้อากาศเป็นยังไงบ้าง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.match(message, /ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ/u);
    assert.doesNotMatch(message, /ทองไทยคิดช้า|เชื่อมต่อไม่ได้|ไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้/u);
  });
});
