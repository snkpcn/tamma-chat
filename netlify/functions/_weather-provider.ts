// Weather provider abstraction for ทำมา-ชาติ/ตาดโตน's live conditions. A
// real-time fact (category C in THONGTHAI_HANDOFF.md's data-classification
// discipline) -- this module is the ONLY place allowed to assert a live
// weather fact, and only when a real provider, API key, and coordinates
// are all actually configured. Never blocks the concierge answer: every
// caller gets a structured result back, "unavailable" included, never a
// thrown error for the ordinary case of missing/partial config (same
// "never let a missing integration become a hard failure" discipline as
// _dialog-source-adapters.ts's other real adapters).
//
// Reads exactly the 4 Netlify env vars the owner configured in production:
//   WEATHER_PROVIDER   -- must be 'openweathermap' (the only provider this
//                         module implements); anything else is reported as
//                         unavailable rather than silently ignored.
//   WEATHER_API_KEY    -- OpenWeatherMap API key.
//   TAMMA_WEATHER_LAT  -- ทำมา-ชาติ/ตาดโตน latitude, as a plain number string.
//   TAMMA_WEATHER_LON  -- ทำมา-ชาติ/ตาดโตน longitude, as a plain number string.
// Deliberately its OWN coordinate source, separate from
// _local-concierge-location.ts's TAMMA_CHART_LOCATION (which is the
// customer-facing Maps-link/address fact, still unresolved) -- the owner
// supplied these specifically for weather lookups, and this module must
// not wait on the Maps-link resolution to start working.

export type WeatherResult = {
  status: 'ok' | 'unavailable';
  condition: string | null;
  precipitationChance: number | null;
  temperatureCelsius: number | null;
  forecastSummary: string | null;
  source: string | null;
  fetchedAt: string | null;
  unavailableReason: 'no_api_key_configured' | 'location_not_resolved' | 'unsupported_provider' | 'provider_error' | null;
};

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
 * Live current-conditions lookup for ทำมา-ชาติ/ตาดโตน. Requires
 * WEATHER_PROVIDER='openweathermap', a configured WEATHER_API_KEY, AND
 * valid TAMMA_WEATHER_LAT/TAMMA_WEATHER_LON env vars -- any one missing or
 * invalid is reported as 'unavailable', never a guess.
 *
 * Calls OpenWeatherMap's free current-weather endpoint server-side, but
 * callers depend only on this function's WeatherResult contract, not on
 * any provider-specific detail -- swapping providers later never needs a
 * caller-side change (just a new branch on WEATHER_PROVIDER).
 */
export async function getWeatherForTammaLocation(now: Date = new Date()): Promise<WeatherResult> {
  const apiKey = process.env.WEATHER_API_KEY;
  if (!apiKey) return unavailable('no_api_key_configured');

  const provider = process.env.WEATHER_PROVIDER;
  if (provider !== 'openweathermap') return unavailable('unsupported_provider');

  const latitude = Number(process.env.TAMMA_WEATHER_LAT);
  const longitude = Number(process.env.TAMMA_WEATHER_LON);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return unavailable('location_not_resolved');

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${latitude}&lon=${longitude}&units=metric&appid=${apiKey}`;
    const response = await fetch(url);
    if (!response.ok) return unavailable('provider_error');
    const data = await response.json() as OpenWeatherCurrentResponse;

    const condition = data.weather?.[0]?.main ?? null;
    const description = data.weather?.[0]?.description ?? null;
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
  } catch {
    return unavailable('provider_error');
  }
}
