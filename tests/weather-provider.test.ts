// Weather provider tests -- _weather-provider.ts is the ONLY module
// allowed to assert a live weather fact for ทำมา-ชาติ/ตาดโตน, and only
// when WEATHER_PROVIDER, WEATHER_API_KEY, TAMMA_WEATHER_LAT, and
// TAMMA_WEATHER_LON are ALL configured (the exact 4 Netlify env vars the
// owner set in production). Covers: (1) unavailable -> structured result,
// no crash; (2) configured/mocked -> the response actually uses the
// weather data and cites freshness/source; (3) ground condition -> even
// with weather data available, actual ground condition is never claimed
// without a ground/staff source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWeatherForTammaLocation } from '../netlify/functions/_weather-provider';
import { withHarness, guestId, brainRequest } from './helpers/canonical-core-harness';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';

function msg(payload: unknown): string {
  return String((payload as { message: string }).message);
}

function clearWeatherEnv(): void {
  delete process.env.WEATHER_PROVIDER;
  delete process.env.WEATHER_API_KEY;
  delete process.env.TAMMA_WEATHER_LAT;
  delete process.env.TAMMA_WEATHER_LON;
}

test('unavailable when no env vars are configured at all -- structured result, no crash', async () => {
  clearWeatherEnv();
  const result = await getWeatherForTammaLocation();
  assert.equal(result.status, 'unavailable');
  assert.equal(result.unavailableReason, 'no_api_key_configured');
  assert.equal(result.condition, null);
  assert.equal(result.temperatureCelsius, null);
});

test('unavailable when WEATHER_PROVIDER is missing/unsupported, even with a key configured', async () => {
  clearWeatherEnv();
  process.env.WEATHER_API_KEY = 'test-key';
  try {
    const result = await getWeatherForTammaLocation();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'unsupported_provider');

    process.env.WEATHER_PROVIDER = 'some-other-provider';
    const result2 = await getWeatherForTammaLocation();
    assert.equal(result2.status, 'unavailable');
    assert.equal(result2.unavailableReason, 'unsupported_provider');
  } finally {
    clearWeatherEnv();
  }
});

test('unavailable when TAMMA_WEATHER_LAT/LON are missing or invalid, even with provider+key configured', async () => {
  clearWeatherEnv();
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.WEATHER_PROVIDER = 'openweathermap';
  try {
    const result = await getWeatherForTammaLocation();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'location_not_resolved');

    process.env.TAMMA_WEATHER_LAT = 'not-a-number';
    process.env.TAMMA_WEATHER_LON = '102.0247859';
    const result2 = await getWeatherForTammaLocation();
    assert.equal(result2.status, 'unavailable');
    assert.equal(result2.unavailableReason, 'location_not_resolved');
  } finally {
    clearWeatherEnv();
  }
});

test('all 4 env vars configured: calls OpenWeatherMap with the exact configured lat/lon, uses the real fetched data, cites source/freshness', async () => {
  clearWeatherEnv();
  process.env.WEATHER_PROVIDER = 'openweathermap';
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.TAMMA_WEATHER_LAT = '15.9565721';
  process.env.TAMMA_WEATHER_LON = '102.0247859';
  const originalFetch = global.fetch;
  let calledUrl: string | null = null;
  global.fetch = (async (url: string | URL) => {
    calledUrl = String(url);
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
    assert.match(String(calledUrl), /openweathermap\.org/u);
    assert.match(String(calledUrl), /lat=15\.9565721/u, 'must call the provider with the exact configured TAMMA_WEATHER_LAT');
    assert.match(String(calledUrl), /lon=102\.0247859/u, 'must call the provider with the exact configured TAMMA_WEATHER_LON');
    assert.match(String(calledUrl), /appid=test-key/u, 'must call the provider with the exact configured WEATHER_API_KEY');
    assert.equal(result.status, 'ok');
    assert.equal(result.source, 'openweathermap');
    assert.equal(result.fetchedAt, '2026-09-22T10:00:00.000Z');
    assert.equal(result.temperatureCelsius, 27);
    assert.equal(result.forecastSummary, 'ฝนตกปรอยๆ');
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});

test('provider errors (non-ok response) degrade to unavailable, never a thrown error', async () => {
  clearWeatherEnv();
  process.env.WEATHER_PROVIDER = 'openweathermap';
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.TAMMA_WEATHER_LAT = '15.9565721';
  process.env.TAMMA_WEATHER_LON = '102.0247859';
  const originalFetch = global.fetch;
  global.fetch = (async () => ({ ok: false }) as Response) as typeof fetch;
  try {
    const result = await getWeatherForTammaLocation();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'provider_error');
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});

const NO_GENERIC_FAILURE = /ทองไทยคิดช้า|เชื่อมต่อไม่ได้|ไม่มีข้อมูลที่ยืนยันได้สำหรับเรื่องนี้/u;

test('end-to-end: "ฝนตกไหม" and "แดดออกไหม" use live mocked weather and cite freshness/source', async () => {
  clearWeatherEnv();
  process.env.WEATHER_PROVIDER = 'openweathermap';
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.TAMMA_WEATHER_LAT = '15.9565721';
  process.env.TAMMA_WEATHER_LON = '102.0247859';
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    json: async () => ({ weather: [{ main: 'Rain', description: 'ฝนตกปรอยๆ' }], main: { temp: 26 }, rain: { '1h': 0.8 } }),
  }) as Response) as typeof fetch;
  try {
    await withHarness(async () => {
      for (const [i, message] of ['ฝนตกไหม', 'แดดออกไหม'].entries()) {
        const gid = guestId(`weather-live-basic-${i}`);
        const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
        assert.equal(r.statusCode, 200);
        const text = msg(r.payload);
        assert.doesNotMatch(text, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
        assert.match(text, /จากข้อมูลล่าสุด/u, `"${message}" must cite freshness/source when live weather data is actually used`);
      }
    });
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});

test('end-to-end: "แดดแรงไหม ไปทำอะไรดี" uses live weather AND gives a local recommendation', async () => {
  clearWeatherEnv();
  process.env.WEATHER_PROVIDER = 'openweathermap';
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.TAMMA_WEATHER_LAT = '15.9565721';
  process.env.TAMMA_WEATHER_LON = '102.0247859';
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    json: async () => ({ weather: [{ main: 'Clear', description: 'แดดจัด' }], main: { temp: 35 } }),
  }) as Response) as typeof fetch;
  try {
    await withHarness(async () => {
      const gid = guestId('weather-live-recommendation');
      const r = await processThongthaiChatCore(brainRequest('แดดแรงไหม ไปทำอะไรดี', gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200);
      const text = msg(r.payload);
      assert.doesNotMatch(text, NO_GENERIC_FAILURE);
      assert.match(text, /จากข้อมูลล่าสุด/u, 'must cite the live weather data');
      assert.match(text, /Inthanin|เฮือนสเตย์|ตำมา-ชาติ|ที่ร่ม/u, 'must still connect to a real local recommendation');
    });
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});

test('end-to-end: "พรุ่งนี้ฝนตกไหม ขี่ม้าได้ไหม" explains the forecast limitation correctly (current data only, not a confirmed forecast)', async () => {
  clearWeatherEnv();
  process.env.WEATHER_PROVIDER = 'openweathermap';
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.TAMMA_WEATHER_LAT = '15.9565721';
  process.env.TAMMA_WEATHER_LON = '102.0247859';
  const originalFetch = global.fetch;
  global.fetch = (async () => ({
    ok: true,
    json: async () => ({ weather: [{ main: 'Clouds', description: 'เมฆมาก' }], main: { temp: 28 } }),
  }) as Response) as typeof fetch;
  try {
    await withHarness(async () => {
      const gid = guestId('weather-forecast-limitation');
      const r = await processThongthaiChatCore(brainRequest('พรุ่งนี้ฝนตกไหม ขี่ม้าได้ไหม', gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200);
      const text = msg(r.payload);
      assert.doesNotMatch(text, NO_GENERIC_FAILURE);
      assert.doesNotMatch(text, /พรุ่งนี้ฝนตกแน่นอน|พรุ่งนี้แดดออกแน่นอน/u, 'must never assert a definite fact about tomorrow');
      assert.match(text, /พยากรณ์/u, 'must explain the forecast limitation (today\'s data is not a confirmed forecast)');
      assert.match(text, /ม้า/u);
      assert.match(text, /สภาพพื้นจริงหน้างานต้องให้ทีมดูอีกทีครับ/u, 'must still never claim actual ground condition');
    });
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});

test('end-to-end: "พื้นลื่นไหม เล่น ATV ได้ไหม" never claims actual ground condition, defers to staff/on-site check', async () => {
  clearWeatherEnv();
  await withHarness(async () => {
    const gid = guestId('ground-condition-atv');
    const r = await processThongthaiChatCore(brainRequest('พื้นลื่นไหม เล่น ATV ได้ไหม', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const text = msg(r.payload);
    assert.doesNotMatch(text, NO_GENERIC_FAILURE);
    assert.doesNotMatch(text, /พื้นลื่นแน่นอน|พื้นแห้งแน่นอน|เล่นได้แน่นอน|เล่นไม่ได้แน่นอน/u, 'must never assert a definite ground-condition verdict');
    assert.match(text, /ทีมงาน|หน้างาน/u, 'must defer the real call to staff/on-site check');
  });
});

test('end-to-end: when weather is unavailable, the response says so plainly (never a generic failure)', async () => {
  clearWeatherEnv();
  await withHarness(async () => {
    const gid = guestId('weather-unavailable');
    const r = await processThongthaiChatCore(brainRequest('วันนี้อากาศเป็นยังไงบ้าง', gid, 'web'), 'evt-1');
    assert.equal(r.statusCode, 200);
    const message = msg(r.payload);
    assert.match(message, /ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ/u);
    assert.doesNotMatch(message, NO_GENERIC_FAILURE);
  });
});
