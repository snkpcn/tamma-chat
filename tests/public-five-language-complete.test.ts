import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const THAI = /[ก-๙]/;

function dictionaryBlock(source: string, lang: string, next?: string) {
  const marker = `    ${lang}:{`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${lang} dictionary`);
  const end = next ? source.indexOf(`    ${next}:{`, start + marker.length) : source.indexOf('  };', start + marker.length);
  assert.ok(end > start, `could not bound ${lang} dictionary`);
  return source.slice(start, end);
}

function chessBlock(source: string, lang: string, next?: string) {
  const marker = `${lang}:{`;
  const root = source.indexOf('const TT_CHESS_I18N');
  const start = source.indexOf(marker, root);
  assert.notEqual(start, -1, `missing chess ${lang} dictionary`);
  const end = next ? source.indexOf(`${next}:{`, start + marker.length) : source.indexOf('},\n};', start + marker.length);
  assert.ok(end > start, `could not bound chess ${lang} dictionary`);
  return source.slice(start, end);
}

function compileInlineScripts(html: string, page: string) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  assert.ok(scripts.length > 0, `${page} should have inline JS`);
  for (const [index, source] of scripts.entries()) {
    if (/^\s*import\s/m.test(source)) continue;
    assert.doesNotThrow(() => new Function(source), `${page} inline script ${index + 1} should parse`);
  }
}

test('account is a complete five-language public surface', () => {
  const html = read('account.html');
  const i18n = read('assets/scripts/account-i18n.js');
  assert.equal((html.match(/id="accountLanguage"/g) || []).length, 1);
  assert.match(html, /assets\/scripts\/account-i18n\.js/);
  assert.match(html, /assets\/scripts\/otop-product-translations\.js/);
  assert.match(i18n, /thammachat-lang-v1/);
  assert.match(html, /localizedOtopName\(i\.otop_products\)/);
  assert.match(html, /language:accountLang\(\)/);
  assert.match(html, /inputmode="numeric" maxlength="5"/);

  const attrKeys = [...html.matchAll(/data-account-i18n(?:-placeholder)?="([^"]+)"/g)].map(m => m[1]);
  for (const [lang, next] of [['th','en'],['en','zh'],['zh','lo'],['lo','vi'],['vi',undefined]] as const) {
    const block = dictionaryBlock(i18n, lang, next);
    for (const key of new Set(attrKeys)) assert.match(block, new RegExp(`\\b${key}:`), `account ${lang} missing ${key}`);
    if (lang !== 'th') assert.equal(THAI.test(block), false, `account ${lang} dictionary leaks Thai`);
  }
  for (const key of ['status_confirmed','shipping_delivered','payment_verified','no_orders','address_saved','redeem_now']) {
    for (const [lang, next] of [['th','en'],['en','zh'],['zh','lo'],['lo','vi'],['vi',undefined]] as const) {
      assert.match(dictionaryBlock(i18n, lang, next), new RegExp(`\\b${key}:`), `account ${lang} missing dynamic key ${key}`);
    }
  }
  compileInlineScripts(html, 'account.html');
});

test('chess uses the shared five-language preference and exposes a language selector', () => {
  const html = read('chess.html');
  assert.equal((html.match(/id="ttChessLanguage"/g) || []).length, 1);
  assert.match(html, /thammachat-lang-v1/);
  assert.match(html, /document\.title = ttT\('page_title'\)/);
  assert.match(html, /data-tt-i18n-aria="choose_side_aria"/);
  assert.match(html, /data-tt-i18n-aria="board_aria"/);
  assert.match(html, /function ttSetLang\(/);
  assert.match(html, /localStorage\.setItem\(LANG_STORAGE_KEY,lang\)/);
  for (const [lang, next] of [['en','zh'],['zh','lo'],['lo','vi'],['vi',undefined]] as const) {
    const block = chessBlock(html, lang, next);
    assert.equal(THAI.test(block), false, `chess ${lang} dictionary leaks Thai`);
    for (const key of ['page_title','choose_side_aria','board_aria','heading','reward_status_available']) {
      assert.match(block, new RegExp(`\\b${key}:`), `chess ${lang} missing ${key}`);
    }
  }
  compileInlineScripts(html, 'chess.html');
});

test('restaurant menu localizes all current live categories, item names and Thai ingredients', () => {
  const html = read('menu.html');
  const i18n = read('assets/scripts/menu-i18n.js');
  assert.equal((html.match(/id="menuLanguage"/g) || []).length, 1);
  assert.match(html, /assets\/scripts\/menu-i18n\.js/);
  assert.match(i18n, /thammachat-lang-v1/);
  assert.match(html, /MenuI18n\.category\(category\)/);
  assert.match(html, /MenuI18n\.name\(item\.name\)/);
  assert.match(html, /map\(MenuI18n\.ingredient\)/);

  const categories = [
    'Thai Craft Spirits','ของหวาน','ข้าว • เส้น • เคียง','ต้ม • นึ่ง','ตำ','น้ำสมุนไพร',
    'เบียร์สด','เมนูปลา','ย่าง • ทอด','ลาบ • น้ำตก • ยำ','สุรา'
  ];
  const names = [
    'GAO HANG','Hong Thong','Kirikhan','Regency','SangSom','Singha Draft (แก้ว)','Singha Draft (เหยือก)','SONKLIN',
    'กล้วยบวชชี','ไก่บ้านทอดสมุนไพร','ไก่บ้านนึ่งสมุนไพรใส่วุ้นเส้น','ไก่บ้านย่างจิ้มแจ่ว','ขนมจีน',
    'ข้าวคอหมูย่างจิ้มแจ่ว','ข้าวจี่จิ้มแจ่ว','ข้าวเนื้อย่างจิ้มแจ่ว','ข้าวหอมมะลิ','ข้าวเหนียว',
    'ข้าวเหนียวดำเปียกมะพร้าวอ่อน','ไข่เจียวสมุนไพร','ไข่เจียวหมูสับ','คอหมูทอดสมุนไพร','คอหมูย่างจิ้มแจ่ว',
    'ต้มแซ่บไก่บ้าน','ต้มแซ่บเนื้อ','ต้มแซ่บหมู','ตำข้าวโพด','ตำซั่วไทย','ตำซั่วปลาร้า','ตำแตง','ตำถั่ว',
    'ตำไทย','ตำลาว','ทอดมันปลาช่อน','น้ำกระเจี๊ยบ','น้ำตกคอหมู','น้ำตกเนื้อ','น้ำตะไคร้ใบเตย','น้ำมะตูม',
    'ปลาช่อนทอดสมุนไพร','ปลานิลทอดสมุนไพร','ยำวุ้นเส้นหมูสับ','ลาบไก่บ้าน','ลาบเนื้อ','ลาบปลาช่อน',
    'ลาบปลานิล','ลาบหมู','เสือร้องไห้','ไอศกรีมกะทิสด'
  ];
  const ingredients = [
    'กระเจี๊ยบแห้ง','กระเทียม','กล้วยน้ำว้า','กะทิสด','กะหล่ำปลี','กุ้งแห้ง','เกลือ','ไก่บ้าน','ขนมจีน',
    'ข้าวคั่ว','ข้าวโพดหวาน','ข้าวหอมมะลิ','ข้าวเหนียว','ข้าวเหนียวดำ','ไข่ไก่','คอหมู','ซอสหอยนางรม',
    'ซีอิ๊วขาว','ตะไคร้','แตงกวา','ถั่วฝักยาว','ถั่วลิสงคั่ว','น้ำจิ้มแจ่ว','น้ำตาลทราย','น้ำตาลปี๊บ',
    'น้ำตำไทย','น้ำปลา','น้ำปลาร้า','น้ำมันพืช','น้ำยำ','น้ำลาบ','เนื้อวัว','ใบเตย','ใบมะกรูด','ปลาช่อน',
    'ปลานิล','แป้งทอดกรอบ','ผักชีฝรั่ง','พริกสด','พริกแห้ง','มะเขือเทศ','มะตูมแห้ง','มะนาว','มะพร้าวอ่อน',
    'มะละกอดิบ','วุ้นเส้น','สะระแหน่','หมูสับ','หอมแดง','ไอศกรีมกะทิสด'
  ];
  for (const category of categories) {
    if (THAI.test(category)) assert.ok(i18n.includes(`'${category}':{en:`), `missing category translation: ${category}`);
  }
  for (const name of names) {
    if (THAI.test(name)) assert.ok(i18n.includes(`'${name}':{en:`), `missing menu translation: ${name}`);
  }
  for (const ingredient of ingredients) {
    assert.ok(i18n.includes(`'${ingredient}':{en:`), `missing ingredient translation: ${ingredient}`);
  }

  for (const [, entry] of i18n.matchAll(/'[^']+':\{en:'([^']*)',zh:'([^']*)',lo:'([^']*)',vi:'([^']*)'\}/g)) {
    // This branch is intentionally empty; the full-match loop below performs the value checks.
  }
  const mapped = [...i18n.matchAll(/'[^']+':\{en:'([^']*)',zh:'([^']*)',lo:'([^']*)',vi:'([^']*)'\}/g)];
  assert.ok(mapped.length >= 50, 'expected deterministic menu translation entries');
  for (const match of mapped) {
    for (const value of match.slice(1)) assert.equal(THAI.test(value), false, `non-Thai menu value leaks Thai: ${value}`);
  }
  compileInlineScripts(html, 'menu.html');
});

test('all six public pages use the same stored language contract', () => {
  const index = read('index.html');
  const map = read('otop-map.html');
  const store = read('otop.html');
  const otopI18n = read('assets/scripts/otop-i18n.js');
  const account = read('assets/scripts/account-i18n.js');
  const menu = read('assets/scripts/menu-i18n.js');
  const chess = read('chess.html');
  assert.match(map, /assets\/scripts\/otop-i18n\.js/, 'map must load the shared OTOP language runtime');
  assert.match(store, /assets\/scripts\/otop-i18n\.js/, 'store must load the shared OTOP language runtime');
  for (const [name, source] of [['home',index],['otop',otopI18n],['account',account],['menu',menu],['chess',chess]] as const) {
    assert.match(source, /thammachat-lang-v1/, `${name} must use the shared language preference`);
  }
});
