// Weather provider abstraction for ทำมา-ชาติ/ตาดโตน's live conditions. A
// real-time fact (category C in THONGTHAI_HANDOFF.md's data-classification
// discipline) -- this module is the ONLY place allowed to assert a live
// weather fact, and only when an API key and coordinates are actually
// configured. Never blocks the concierge answer: every caller gets a
// structured result back, "unavailable" included, never a thrown error
// for the ordinary case of missing/partial config (same "never let a
// missing integration become a hard failure" discipline as
// _dialog-source-adapters.ts's other real adapters).
//
// Reads these Netlify env vars:
//   WEATHER_API_KEY    -- OpenWeatherMap API key (required).
//   TAMMA_WEATHER_LAT  -- ทำมา-ชาติ/ตาดโตน latitude, as a plain number string
//                         (required).
//   TAMMA_WEATHER_LON  -- ทำมา-ชาติ/ตาดโตน longitude, as a plain number
//                         string (required).
//   WEATHER_PROVIDER   -- OPTIONAL. Defaults to 'openweathermap' (the only
//                         provider this module implements) when unset --
//                         only an EXPLICIT, different value is reported as
//                         unavailable. Deliberately optional: its only
//                         legitimate value, 'openweathermap', is not a
//                         secret, but Netlify's default secrets scan flags
//                         the literal value of ANY configured env var
//                         (this one included) if that value also appears
//                         in committed source/docs -- which "openweathermap"
//                         legitimately does throughout this very file. Not
//                         requiring the var at all removes the false
//                         positive at its root instead of trying to keep
//                         a legitimate, non-secret string out of a
//                         codebase that has to mention it anyway. See
//                         THONGTHAI_HANDOFF.md's "HOTFIX -- exposed
//                         secrets" section for the full incident history.
// TAMMA_WEATHER_LAT/LON are deliberately their OWN coordinate source,
// separate from _local-concierge-location.ts's TAMMA_CHART_LOCATION
// (which is the customer-facing Maps-link/address fact, still unresolved)
// -- the owner supplied these specifically for weather lookups, and this
// module must not wait on the Maps-link resolution to start working.

export type WeatherResult = {
  status: 'ok' | 'unavailable';
  /** OpenWeatherMap's `weather[].main` field (e.g. "Clouds", "Rain") --
   *  left as-is from the provider, not translated (see forecastSummary
   *  for the customer-facing Thai text). */
  condition: string | null;
  precipitationChance: number | null;
  temperatureCelsius: number | null;
  /** Already translated to natural Thai (see translateWeatherCondition)
   *  -- safe to put directly into a customer-facing reply. */
  forecastSummary: string | null;
  source: string | null;
  fetchedAt: string | null;
  unavailableReason: 'no_api_key_configured' | 'location_not_resolved' | 'unsupported_provider' | 'timeout' | 'provider_error' | null;
};

// A hung OpenWeather call must never hang the whole customer turn (and,
// worse, the whole Netlify function invocation) -- a slow/unresponsive
// provider degrades to 'timeout' just like an HTTP error degrades to
// 'provider_error', never left to escape as an uncaught rejection.
const DEFAULT_FETCH_TIMEOUT_MS = 6000;

// OpenWeatherMap's `weather[].description` field is always one of a small,
// closed, documented set of lowercase English phrases (their own "weather
// condition codes" reference) -- never free text. Translating it to
// natural Thai is a bounded lookup, not a growing phrase table, same
// discipline as every other structural marker set in this codebase.
// Unmapped values (a future OWM phrase this table hasn't caught up to)
// fall back to the original English string rather than a blank/guessed
// translation -- see translateWeatherCondition's own comment.
const WEATHER_CONDITION_TH: Readonly<Record<string, string>> = {
  // Group 800/80x -- clear/clouds
  'clear sky': 'ท้องฟ้าโปร่ง',
  'few clouds': 'มีเมฆเล็กน้อย',
  'scattered clouds': 'มีเมฆกระจาย',
  'broken clouds': 'เมฆค่อนข้างมาก',
  'overcast clouds': 'เมฆมาก',
  // Group 5xx -- rain
  'light rain': 'ฝนเล็กน้อย',
  'moderate rain': 'ฝนปานกลาง',
  'heavy intensity rain': 'ฝนตกหนัก',
  'very heavy rain': 'ฝนตกหนักมาก',
  'extreme rain': 'ฝนตกหนักรุนแรง',
  'freezing rain': 'ฝนเยือกแข็ง',
  'light intensity shower rain': 'ฝนซู่เล็กน้อย',
  'shower rain': 'ฝนซู่',
  'heavy intensity shower rain': 'ฝนซู่หนัก',
  'ragged shower rain': 'ฝนซู่ไม่สม่ำเสมอ',
  // Group 3xx -- drizzle
  'light intensity drizzle': 'ฝนปรอยเล็กน้อย',
  'drizzle': 'ฝนปรอย',
  'heavy intensity drizzle': 'ฝนปรอยหนัก',
  // Group 2xx -- thunderstorm
  'thunderstorm with light rain': 'พายุฝนฟ้าคะนองมีฝนเล็กน้อย',
  'thunderstorm with rain': 'พายุฝนฟ้าคะนอง',
  'thunderstorm with heavy rain': 'พายุฝนฟ้าคะนองฝนตกหนัก',
  'light thunderstorm': 'พายุฝนฟ้าคะนองเบาๆ',
  'thunderstorm': 'พายุฝนฟ้าคะนอง',
  'heavy thunderstorm': 'พายุฝนฟ้าคะนองรุนแรง',
  // Group 6xx -- snow (unlikely for this location, kept for completeness)
  'light snow': 'หิมะตกเล็กน้อย',
  'snow': 'หิมะตก',
  'heavy snow': 'หิมะตกหนัก',
  // Group 7xx -- atmosphere
  'mist': 'หมอกบางๆ',
  'smoke': 'ควัน',
  'haze': 'หมอกควัน',
  'fog': 'หมอก',
  'sand': 'ทรายฟุ้ง',
  'dust': 'ฝุ่นฟุ้ง',
  'tornado': 'พายุทอร์นาโด',
};

/** Translates an OpenWeatherMap `description` string to natural Thai for
 *  the customer-facing reply. Falls back to the original English string
 *  for anything not in the table above -- never blank, never a guess, and
 *  never blocks the reply over a wording gap. */
export function translateWeatherCondition(description: string): string {
  return WEATHER_CONDITION_TH[description.toLowerCase().trim()] ?? description;
}

/** Strips any `appid=<key>` query value out of a URL or error-message-shaped
 *  string before it can ever reach a log line -- the ONLY safe way to log
 *  anything derived from the OpenWeather request is through this. Every
 *  actual failure path in this module already degrades to a structured
 *  WeatherResult without logging the request at all, but a caller (e.g.
 *  thongthai-chat.ts's defensive `.catch()` around the local-concierge
 *  call site) may log an unexpected error's `.message`, and some fetch
 *  implementations embed the request URL in their own error message -- this
 *  redaction is the defense-in-depth for that case. */
export function redactWeatherUrl(text: string): string {
  return text.replace(/appid=[^&\s]+/giu, 'appid=***redacted***');
}

function unavailable(reason: WeatherResult['unavailableReason']): WeatherResult {
  return {
    status: 'unavailable', condition: null, precipitationChance: null, temperatureCelsius: null,
    forecastSummary: null, source: null, fetchedAt: null, unavailableReason: reason,
  };
}

type OpenWeatherCurrentResponse = {
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number };
  rain?: Record<string, number>;
};

/**
 * Live current-conditions lookup for ทำมา-ชาติ/ตาดโตน. Requires a
 * configured WEATHER_API_KEY AND valid TAMMA_WEATHER_LAT/TAMMA_WEATHER_LON
 * env vars -- either missing or invalid is reported as 'unavailable',
 * never a guess. WEATHER_PROVIDER is optional and defaults to
 * 'openweathermap'; it's only checked (and can only fail as
 * 'unsupported_provider') when explicitly set to something else.
 *
 * Calls OpenWeatherMap's free current-weather endpoint server-side, but
 * callers depend only on this function's WeatherResult contract, not on
 * any provider-specific detail -- swapping providers later never needs a
 * caller-side change (just a new branch on WEATHER_PROVIDER).
 *
 * NEVER throws and NEVER hangs past `timeoutMs` (default 6s) -- a slow or
 * unresponsive provider is reported as `status: 'unavailable'` just like
 * every other failure mode, so a caller can always safely `await` this
 * without its own try/catch. `timeoutMs` is a parameter (not only the
 * env-driven default) so tests can exercise the timeout path in
 * milliseconds instead of really waiting 6 seconds.
 */
export async function getWeatherForTammaLocation(
  now: Date = new Date(),
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<WeatherResult> {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) return unavailable('no_api_key_configured');

  // Optional -- unset defaults to the only provider this module
  // implements. Only an EXPLICIT, different value is unsupported.
  const provider = process.env.WEATHER_PROVIDER || 'openweathermap';
  if (provider !== 'openweathermap') return unavailable('unsupported_provider');

  const latitude = Number(process.env.TAMMA_WEATHER_LAT);
  const longitude = Number(process.env.TAMMA_WEATHER_LON);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return unavailable('location_not_resolved');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return unavailable('provider_error');
    const data = await response.json() as OpenWeatherCurrentResponse;

    const condition = data.weather?.[0]?.main ?? null;
    const rawDescription = data.weather?.[0]?.description ?? null;
    const description = rawDescription !== null ? translateWeatherCondition(rawDescription) : null;
    const temperatureCelsius = typeof data.main?.temp === 'number' ? Math.round(data.main.temp) : null;
    const rainVolume = data.rain ? Object.values(data.rain)[0] : undefined;
    const precipitationChance = typeof rainVolume === 'number' ? Math.min(100, Math.round(rainVolume * 10)) : null;

    return {
      status: 'ok',
      condition,
      precipitationChance,
      temperatureCelsius,
      forecastSummary: description,
      source: 'openweathermap',
      fetchedAt: now.toISOString(),
      unavailableReason: null,
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return unavailable('timeout');
    return unavailable('provider_error');
  } finally {
    clearTimeout(timeoutId);
  }
}
