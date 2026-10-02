import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_PAGES = ['index.html','account.html','chess.html','menu.html','otop-map.html','otop.html'];
const SUPPORTED = ['th','en','zh','lo','vi'];
const NON_THAI = ['en','zh','lo','vi'];
const THAI = /[ก-๙]/;
const PROVINCES = [
  'chaiyaphum','khonkaen','buriram','surin','sisaket','nakhonratchasima','roiet','mahasarakham','kalasin','sakonnakhon',
  'nakhonphanom','mukdahan','yasothon','amnatcharoen','ubonratchathani','udonthani','nongkhai','buengkan','loei','nongbualamphu',
];
const LIVE_PRODUCT_IDS = Array.from({length:10},(_,i)=>`chaiyaphum-otop-${String(i+1).padStart(3,'0')}`);
const PRODUCT_FIELDS = ['name','originPlace','makerType','coreValue','materialOrIngredient','craftProcess','whyHere','shortDescription','imageCaption'];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}
function fail(message) {
  console.error('PRE_WORLDWIDE_READINESS_GATE_FAILED:', message);
  process.exitCode = 1;
}
function assert(condition, message) {
  if (!condition) fail(message);
}
function langBlock(source, lang, next, markerPrefix='    ', markerSuffix=': {') {
  const marker = `${markerPrefix}${lang}${markerSuffix}`;
  const start = source.indexOf(marker);
  if (start < 0) { fail(`missing ${lang} block`); return ''; }
  const endMarker = next ? `${markerPrefix}${next}${markerSuffix}` : '\n  };';
  const end = source.indexOf(endMarker, start + marker.length);
  if (end < 0) { fail(`cannot bound ${lang} block`); return ''; }
  return source.slice(start, end);
}
function decodeHtmlRef(value) {
  return value.replaceAll('&amp;', '&').trim();
}
function localPathFor(page, raw) {
  let ref = decodeHtmlRef(raw);
  if (!ref || /^(?:https?:|data:|blob:|mailto:|tel:|javascript:|#|\/\/)/i.test(ref)) return null;
  if (ref.includes('${') || ref.includes('{') || ref.includes('}')) return null;
  ref = ref.split('#')[0].split('?')[0];
  if (!ref) return null;
  if (ref === '/' || ref === './') return path.join(ROOT, 'index.html');
  if (ref.startsWith('/.netlify/')) return null;
  const target = ref.startsWith('/')
    ? path.join(ROOT, ref.slice(1))
    : path.resolve(ROOT, path.dirname(page), ref);
  const relative = path.relative(ROOT, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    fail(`${page} points outside repository: ${raw}`);
    return null;
  }
  return target;
}

// 1) Six public pages must remain valid, unique-ID documents with no broken static local refs.
for (const page of PUBLIC_PAGES) {
  const html = read(page);
  assert((html.match(/<!doctype html>/gi) || []).length === 1, `${page}: expected exactly one doctype`);
  assert((html.match(/<\/html>/gi) || []).length === 1, `${page}: expected exactly one closing html tag`);
  assert((html.match(/<\/body>/gi) || []).length === 1, `${page}: expected exactly one closing body tag`);

  const markup = html.replace(/<script\b[\s\S]*?<\/script>/gi, '').replace(/<style\b[\s\S]*?<\/style>/gi, '');
  const ids = [...markup.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  const duplicates = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))];
  assert(duplicates.length === 0, `${page}: duplicate DOM ids: ${duplicates.join(', ')}`);

  for (const match of html.matchAll(/\b(src|href|srcset)="([^"]+)"/g)) {
    const [,,raw] = match;
    const refs = match[1] === 'srcset' ? raw.split(',').map(x => x.trim().split(/\s+/)[0]) : [raw];
    for (const ref of refs) {
      const target = localPathFor(page, ref);
      if (target) assert(fs.existsSync(target), `${page}: missing local asset/link ${ref}`);
    }
  }
}

// 2) Public client files must never expose server/admin credentials.
const publicSources = [
  ...PUBLIC_PAGES,
  'assets/scripts/account-i18n.js','assets/scripts/menu-i18n.js','assets/scripts/otop-i18n.js',
  'assets/scripts/otop-map.js','assets/scripts/otop-product-translations.js','assets/scripts/otop-province-translations.js',
];
const forbiddenSecret = /SUPABASE_SERVICE_ROLE|SERVICE_ROLE_KEY|sb_secret_[A-Za-z0-9_-]{10,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/;
for (const rel of publicSources) {
  assert(!forbiddenSecret.test(read(rel)), `${rel}: server/admin secret pattern found in public source`);
}

// 3) Site-wide language and typography contracts must exist on every public page.
for (const page of PUBLIC_PAGES) {
  const html = read(page);
  assert(html.includes('assets/styles/site-typography.css'), `${page}: missing shared typography stylesheet`);
}
const typography = read('assets/styles/site-typography.css');
for (const token of ['--site-font-th: "IBM Plex Sans Thai"','--site-font-en: "Noto Sans"','--site-font-zh: "Noto Sans SC"','--site-font-lo: "Noto Sans Lao"']) {
  assert(typography.includes(token), `site typography missing ${token}`);
}

// 4) OTOP must stay exactly 20 provinces and every province name must cover all five languages.
const otopI18n = read('assets/scripts/otop-i18n.js');
const provinceStart = otopI18n.indexOf('const PROVINCES = {');
const provinceEnd = otopI18n.indexOf('\n  };', provinceStart);
assert(provinceStart >= 0 && provinceEnd > provinceStart, 'cannot bound OTOP province dictionary');
const provinceBlock = provinceStart >= 0 && provinceEnd > provinceStart ? otopI18n.slice(provinceStart, provinceEnd) : '';
const ids = [...provinceBlock.matchAll(/^\s{4}([a-z]+):\{th:/gm)].map(m => m[1]);
assert(ids.length === 20, `OTOP province dictionary must contain exactly 20 provinces, found ${ids.length}`);
assert(new Set(ids).size === 20, 'OTOP province dictionary contains duplicate province ids');
for (const id of PROVINCES) {
  const start = provinceBlock.indexOf(`    ${id}:{`);
  assert(start >= 0, `missing OTOP province ${id}`);
  const end = provinceBlock.indexOf('\n', start);
  const row = start >= 0 ? provinceBlock.slice(start, end > start ? end : undefined) : '';
  for (const lang of SUPPORTED) assert(row.includes(`${lang}:`), `${id}: missing ${lang} province name`);
}
for (const id of ids) assert(PROVINCES.includes(id), `unexpected OTOP province id ${id}`);

// 5) Province and live-product story copy must be complete and Thai-free in all non-Thai modes.
const provinceTranslations = read('assets/scripts/otop-province-translations.js');
const productTranslations = read('assets/scripts/otop-product-translations.js');
for (let i=0;i<NON_THAI.length;i++) {
  const lang = NON_THAI[i];
  const next = NON_THAI[i+1];
  const pBlock = langBlock(provinceTranslations, lang, next);
  assert(!THAI.test(pBlock), `OTOP province ${lang} copy contains Thai-script leakage`);
  for (const province of PROVINCES) assert(pBlock.includes(`${province}:{title:`), `OTOP province ${province} missing ${lang} story`);

  const tBlock = langBlock(productTranslations, lang, next);
  assert(!THAI.test(tBlock), `OTOP product ${lang} copy contains Thai-script leakage`);
  for (const [index,id] of LIVE_PRODUCT_IDS.entries()) {
    const marker = `'${id}': {`;
    const start = tBlock.indexOf(marker);
    assert(start >= 0, `${id}: missing ${lang} product story`);
    const nextId = LIVE_PRODUCT_IDS[index+1];
    const end = nextId ? tBlock.indexOf(`'${nextId}': {`, start + marker.length) : tBlock.length;
    const record = start >= 0 ? tBlock.slice(start, end > start ? end : undefined) : '';
    for (const field of PRODUCT_FIELDS) assert(new RegExp(`\\b${field}:`).test(record), `${id}: ${lang} missing ${field}`);
  }
}

// 6) Transaction-critical OTOP store contract must remain wired and authenticated.
const store = read('otop.html');
const storeFn = read('netlify/functions/otop-store.ts');
const addressesFn = read('netlify/functions/customer-addresses.ts');
for (const token of [
  "API='/.netlify/functions/otop-store'",
  "ADDRESS_API='/.netlify/functions/customer-addresses'",
  'crypto.randomUUID()',
  'idempotencyKey:checkoutKey',
  'memberFetch(API',
]) assert(store.includes(token), `OTOP store transaction contract missing ${token}`);
assert(storeFn.includes("if (!user) return json(401, { error: 'authentication_required' })"), 'OTOP checkout must require authenticated user');
assert(storeFn.includes('checkoutMemberOtopOrder(user.id, body)'), 'OTOP checkout executor is not wired');
assert(addressesFn.includes("if (!user) return json(401, { error: 'authentication_required' })"), 'customer addresses must require authenticated user');

// 7) Existing cross-page language preference and production layout contracts must remain loaded.
for (const rel of ['index.html','chess.html','assets/scripts/account-i18n.js','assets/scripts/menu-i18n.js','assets/scripts/otop-i18n.js']) {
  assert(read(rel).includes('thammachat-lang-v1'), `${rel}: missing shared language preference`);
}
assert(store.includes('assets/styles/pre-worldwide-production.css'), 'OTOP store missing production layout contract');
assert(read('index.html').includes('assets/styles/pre-worldwide-production.css'), 'homepage OTOP gateway missing production layout contract');

if (process.exitCode) process.exit(process.exitCode);
console.log('PRE_WORLDWIDE_READINESS_GATE_OK');
