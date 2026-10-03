(() => {
  'use strict';

  const STORAGE_KEY = 'thammachat-lang-v1';
  const CHANGE_EVENT = 'thammachat:locale-change';

  const DEFINITIONS = Object.freeze({
    th: Object.freeze({ language:'th', locale:'th-TH', label:'ไทย', direction:'ltr' }),
    en: Object.freeze({ language:'en', locale:'en-US', label:'English', direction:'ltr' }),
    zh: Object.freeze({ language:'zh', locale:'zh-CN', label:'中文', direction:'ltr' }),
    lo: Object.freeze({ language:'lo', locale:'lo-LA', label:'ລາວ', direction:'ltr' }),
    vi: Object.freeze({ language:'vi', locale:'vi-VN', label:'Tiếng Việt', direction:'ltr' }),
  });
  const SUPPORTED = Object.freeze(Object.keys(DEFINITIONS));
  let memory = null;

  function normalize(input) {
    if (typeof input !== 'string' || !input.trim()) return null;
    const raw = input.trim().replace(/_/g, '-');
    let canonical = raw;
    try { canonical = Intl.getCanonicalLocales(raw)[0] || raw; } catch {}
    const primary = canonical.split('-')[0].toLowerCase();
    return SUPPORTED.includes(primary) ? primary : null;
  }

  function browserLanguages() {
    const values = Array.isArray(navigator.languages) && navigator.languages.length
      ? navigator.languages
      : [navigator.language || 'th'];
    return values.map(normalize).filter(Boolean);
  }

  function queryLanguage() {
    try { return normalize(new URLSearchParams(location.search).get('lang')); }
    catch { return null; }
  }

  function storedLanguage() {
    try { return normalize(localStorage.getItem(STORAGE_KEY)); }
    catch { return normalize(memory); }
  }

  function resolveInitial() {
    const fromQuery = queryLanguage();
    if (fromQuery) return fromQuery;
    const stored = storedLanguage();
    if (stored) return stored;
    return browserLanguages()[0] || 'th';
  }

  let current = resolveInitial();
  memory = current;

  function locale(lang=current) {
    const normalized = normalize(lang) || 'th';
    return DEFINITIONS[normalized].locale;
  }

  function fallbackChain(lang=current) {
    const normalized = normalize(lang) || 'th';
    if (normalized === 'th') return ['th'];
    if (normalized === 'en') return ['en'];
    return [normalized, 'en'];
  }

  function translate(dictionaries, key, vars={}, lang=current) {
    for (const candidate of fallbackChain(lang)) {
      const value = dictionaries?.[candidate]?.[key];
      if (value !== undefined && value !== null) return interpolate(value, vars);
    }
    return interpolate(key, vars);
  }

  function interpolate(value, vars={}) {
    return String(value ?? '').replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? '');
  }

  function set(lang, options={}) {
    const normalized = normalize(lang);
    if (!normalized) return current;
    const persist = options.persist !== false;
    const dispatch = options.dispatch !== false;
    const source = options.source || 'surface';
    current = normalized;
    memory = normalized;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, normalized); } catch {}
    }
    document.documentElement.lang = locale(normalized);
    document.documentElement.dir = DEFINITIONS[normalized].direction;
    if (dispatch) {
      window.dispatchEvent(new CustomEvent(CHANGE_EVENT, {
        detail: { lang: normalized, locale: locale(normalized), source },
      }));
    }
    return normalized;
  }

  function get() { return current; }

  window.addEventListener('storage', event => {
    if (event.key !== STORAGE_KEY) return;
    const normalized = normalize(event.newValue);
    if (!normalized || normalized === current) return;
    set(normalized, { persist:false, source:'storage' });
  });

  // Query-string language is an explicit user/deep-link preference and should
  // become the same cross-surface preference used by the rest of the site.
  if (queryLanguage()) {
    try { localStorage.setItem(STORAGE_KEY, current); } catch {}
  }

  document.documentElement.lang = locale(current);
  document.documentElement.dir = DEFINITIONS[current].direction;

  window.ThammachatLocale = Object.freeze({
    storageKey: STORAGE_KEY,
    changeEvent: CHANGE_EVENT,
    supported: [...SUPPORTED],
    definitions: DEFINITIONS,
    normalize,
    get,
    set,
    locale,
    fallbackChain,
    translate,
    interpolate,
  });
})();
