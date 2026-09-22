// Weather provider tests -- _weather-provider.ts is the ONLY module
// allowed to assert a live weather fact for ทำมา-ชาติ/ตาดโตน, and only
// when WEATHER_PROVIDER, WEATHER_API_KEY, TAMMA_WEATHER_LAT, and
// TAMMA_WEATHER_LON are ALL configured (the exact 4 Netlify env vars the
// owner set in production). Covers: (1) unavailable -> structured result,
// no crash; (2) configured/mocked -> the response actually uses the
// weather data and cites freshness/source; (3) ground condition -> even
// with weather data available, actual ground condition is never claimed
// without a ground/staff source.
//
// Any end-to-end test that drives processThongthaiChatCore through
// withHarness MUST use harness.programWeatherFetch(...) for the mocked
// OpenWeather response, never a raw `global.fetch = ...` before calling
// withHarness -- withHarness unconditionally installs its own fetchMock
// for its whole run and restores the prior global.fetch only afterward,
// so a fetch mock set before entering it is invisible to any code that
// runs inside it. See programWeatherFetch's own doc comment in
// canonical-core-harness.ts for the exact bug this avoids (an unprogrammed
// OpenWeatherMap call would otherwise silently hit that harness's generic
// "unknown GET -> empty successful list" default, which looks like a
// data-less success rather than the intended "nothing programmed" state).
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

function setWeatherEnv(): void {
  process.env.WEATHER_PROVIDER = 'openweathermap';
  process.env.WEATHER_API_KEY = 'test-key';
  process.env.TAMMA_WEATHER_LAT = '15.9565721';
  process.env.TAMMA_WEATHER_LON = '102.0247859';
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
  setWeatherEnv();
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
  setWeatherEnv();
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
  setWeatherEnv();
  try {
    await withHarness(async harness => {
      harness.programWeatherFetch({ ok: true, body: { weather: [{ main: 'Rain', description: 'ฝนตกปรอยๆ' }], main: { temp: 26 }, rain: { '1h': 0.8 } } });
      for (const [i, message] of ['ฝนตกไหม', 'แดดออกไหม'].entries()) {
        const gid = guestId(`weather-live-basic-${i}`);
        const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
        assert.equal(r.statusCode, 200);
        const text = msg(r.payload);
        assert.doesNotMatch(text, NO_GENERIC_FAILURE, `"${message}" must not get a generic failure`);
        assert.match(text, /จากข้อมูลล่าสุด/u, `"${message}" must cite freshness/source when live weather data is actually used`);
        assert.match(text, /ฝนตกปรอยๆ|26°C/u, `"${message}" must reflect the actual mocked weather data, not just the "จากข้อมูลล่าสุด" prefix`);
      }
    });
  } finally {
    clearWeatherEnv();
  }
});

test('end-to-end: "แดดแรงไหม ไปทำอะไรดี" uses live weather AND gives a local recommendation', async () => {
  clearWeatherEnv();
  setWeatherEnv();
  try {
    await withHarness(async harness => {
      harness.programWeatherFetch({ ok: true, body: { weather: [{ main: 'Clear', description: 'แดดจัด' }], main: { temp: 35 } } });
      const gid = guestId('weather-live-recommendation');
      const r = await processThongthaiChatCore(brainRequest('แดดแรงไหม ไปทำอะไรดี', gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200);
      const text = msg(r.payload);
      assert.doesNotMatch(text, NO_GENERIC_FAILURE);
      assert.match(text, /แดดจัด|35°C/u, 'must reflect the actual mocked weather data');
      assert.match(text, /Inthanin|เฮือนสเตย์|ตำมา-ชาติ|ที่ร่ม/u, 'must still connect to a real local recommendation');
    });
  } finally {
    clearWeatherEnv();
  }
});

test('end-to-end: "พรุ่งนี้ฝนตกไหม ขี่ม้าได้ไหม" explains the forecast limitation correctly (current data only, not a confirmed forecast)', async () => {
  clearWeatherEnv();
  setWeatherEnv();
  try {
    await withHarness(async harness => {
      harness.programWeatherFetch({ ok: true, body: { weather: [{ main: 'Clouds', description: 'เมฆมาก' }], main: { temp: 28 } } });
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

// ---------------------------------------------------------------------
// HOTFIX regression tests -- production live smoke reported "ฝนตกไหมตอนนี้"
// and "ฝนตกไหม" returning the generic LLM-outage apology ("...คิดช้ากว่า
// ปกติ...") instead of a weather-specific answer.
//
// Root cause investigation (see THONGTHAI_HANDOFF.md's hotfix section):
// the classifier and composer both already handle these exact phrases
// correctly in every provider state (proven below) -- the actual gaps
// closed by this hotfix are (1) a missing defensive `.catch()` around
// deterministicLocalConciergeResponse's call site (every sibling
// deterministic responder already had one -- see thongthai-chat.ts) and
// (2) no timeout on the OpenWeather fetch, so an unexpected throw or a
// hung provider call could have escaped uncaught rather than degrading to
// a weather-specific unavailable answer. (Investigating this ALSO
// surfaced an unrelated test-infrastructure bug: several existing "mocked
// success" tests were silently not exercising their intended mock at all,
// because withHarness's own fetchMock unconditionally overrides
// global.fetch -- fixed by adding harness.programWeatherFetch, see
// canonical-core-harness.ts.)
// ---------------------------------------------------------------------

test('HOTFIX: exact production-reported phrases never return the generic LLM-outage apology, in any provider state', async () => {
  const phrases = ['ฝนตกไหมตอนนี้', 'ฝนตกไหม'];
  const GENERIC_LLM_OUTAGE = /คิดช้ากว่าปกติ|ลองส่งอีกครั้งในอีกสักครู่/u;

  // State 1: no weather env configured at all.
  clearWeatherEnv();
  await withHarness(async () => {
    for (const [i, message] of phrases.entries()) {
      const gid = guestId(`hotfix-unset-${i}`);
      const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
      assert.equal(r.statusCode, 200);
      const text = msg(r.payload);
      assert.doesNotMatch(text, GENERIC_LLM_OUTAGE, `"${message}" (no weather env) must never hit the generic LLM-outage apology`);
      assert.match(text, /ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ/u);
    }
  });

  // State 2: fully configured, provider succeeds.
  clearWeatherEnv();
  setWeatherEnv();
  try {
    await withHarness(async harness => {
      harness.programWeatherFetch({ ok: true, body: { weather: [{ main: 'Rain', description: 'ฝนตกปรอยๆ' }], main: { temp: 26 }, rain: { '1h': 0.5 } } });
      for (const [i, message] of phrases.entries()) {
        const gid = guestId(`hotfix-success-${i}`);
        const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
        assert.equal(r.statusCode, 200);
        const text = msg(r.payload);
        assert.doesNotMatch(text, GENERIC_LLM_OUTAGE, `"${message}" (provider success) must never hit the generic LLM-outage apology`);
        assert.match(text, /จากข้อมูลล่าสุด/u, `"${message}" must use the mocked live weather data`);
        assert.match(text, /ฝนตกปรอยๆ|26°C/u, `"${message}" must reflect the actual mocked weather data`);
      }
    });
  } finally {
    clearWeatherEnv();
  }

  // State 3: fully configured, provider returns an HTTP error.
  clearWeatherEnv();
  setWeatherEnv();
  try {
    await withHarness(async harness => {
      harness.programWeatherFetch({ ok: false });
      for (const [i, message] of phrases.entries()) {
        const gid = guestId(`hotfix-fail-${i}`);
        const r = await processThongthaiChatCore(brainRequest(message, gid, 'web'), 'evt-1');
        assert.equal(r.statusCode, 200);
        const text = msg(r.payload);
        assert.doesNotMatch(text, GENERIC_LLM_OUTAGE, `"${message}" (provider error) must never hit the generic LLM-outage apology`);
        assert.match(text, /ตอนนี้ทองไทยยังไม่มีข้อมูลอากาศสดยืนยันในระบบครับ/u, `"${message}" must use the precise weather-unavailable wording, not a generic one`);
      }
    });
  } finally {
    clearWeatherEnv();
  }
});

test('HOTFIX: OpenWeather fetch that hangs past the timeout degrades to unavailable, never crashes, never hangs indefinitely', async () => {
  clearWeatherEnv();
  setWeatherEnv();
  const originalFetch = global.fetch;
  // Never resolves on its own -- only settles if the caller's AbortSignal
  // fires, exactly like a real hung network request would behave once the
  // provider's own timeout/abort kicks in.
  global.fetch = ((_url: string | URL, init?: RequestInit) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';
      reject(abortError);
    });
  })) as typeof fetch;
  try {
    const started = Date.now();
    const result = await getWeatherForTammaLocation(new Date(), 50);
    const elapsedMs = Date.now() - started;
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'timeout');
    assert.ok(elapsedMs < 2000, `must not hang past its own timeout (took ${elapsedMs}ms)`);
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});

test('HOTFIX: a fetch that throws synchronously (not just a rejected promise) still degrades gracefully, never escapes uncaught', async () => {
  clearWeatherEnv();
  setWeatherEnv();
  const originalFetch = global.fetch;
  global.fetch = (() => { throw new Error('DNS resolution failed'); }) as unknown as typeof fetch;
  try {
    const result = await getWeatherForTammaLocation();
    assert.equal(result.status, 'unavailable');
    assert.equal(result.unavailableReason, 'provider_error');
  } finally {
    global.fetch = originalFetch;
    clearWeatherEnv();
  }
});
