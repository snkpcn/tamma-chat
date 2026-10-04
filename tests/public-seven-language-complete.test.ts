import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { normalizeResponseLanguageSurface } from '../netlify/functions/_response-composer';

const read = (path:string) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const pages = ['index.html','account.html','chess.html','menu.html','otop-map.html','otop.html'];
const packSource = read('assets/scripts/first-wave-language-packs.js');
const context = { window:{} as Record<string,unknown> };
vm.runInNewContext(packSource, context, { filename:'first-wave-language-packs.js' });
const packs = (context.window as any).THAMMACHAT_FIRST_WAVE_LANGUAGE_PACKS as Record<string,Record<'ja'|'ko',Record<string,unknown>>>;

function leaves(value:unknown, output:string[]=[]):string[] {
  if (typeof value === 'string') output.push(value);
  else if (value && typeof value === 'object') for (const child of Object.values(value)) leaves(child,output);
  return output;
}

function placeholders(value:string):string[] {
  return [...value.matchAll(/\{\w+\}/g)].map(match=>match[0]).sort();
}

function paths(value:unknown, prefix:string[]=[]):Map<string,string> {
  const result=new Map<string,string>();
  if(typeof value==='string') result.set(prefix.join('.'),value);
  else if(value&&typeof value==='object') for(const [key,child] of Object.entries(value)){
    for(const [path,text] of paths(child,[...prefix,key]))result.set(path,text);
  }
  return result;
}

test('all public surfaces expose Japanese and Korean and load their pack before the page runtime', () => {
  for(const page of pages){
    const html=read(page);
    assert.match(html, /(?:data-lang|option value)="ja"/u, `${page} missing Japanese selector`);
    assert.match(html, /(?:data-lang|option value)="ko"/u, `${page} missing Korean selector`);
    const kernel=html.indexOf('assets/scripts/global-locale.js');
    const pack=html.indexOf('assets/scripts/first-wave-language-packs.js');
    assert.ok(kernel>=0 && pack>kernel, `${page} must load the first-wave pack after the locale kernel`);
    const runtime=page==='index.html' ? html.indexOf('const TRANSLATIONS')
      : page==='chess.html' ? html.indexOf('const TT_CHESS_I18N')
        : html.search(/assets\/scripts\/(?:account|menu|otop)-i18n\.js/u);
    assert.ok(runtime>pack, `${page} must load translations before its language runtime`);
  }
});

test('seven-language locale kernel and typography are first-class, not aliases', () => {
  const kernel=read('assets/scripts/global-locale.js');
  const typography=read('assets/styles/site-typography.css');
  assert.match(kernel, /ja: Object\.freeze\(\{ language:'ja', locale:'ja-JP'/u);
  assert.match(kernel, /ko: Object\.freeze\(\{ language:'ko', locale:'ko-KR'/u);
  assert.match(typography, /Noto\+Sans\+JP/u);
  assert.match(typography, /Noto\+Sans\+KR/u);
  assert.match(typography, /html\[lang="ja"\]/u);
  assert.match(typography, /html\[lang="ko"\]/u);
});

test('Japanese and Korean packs cover every current public content family', () => {
  const minimum:Record<string,number>={
    home:375, account:160, chess:63, otop:119, menuUi:17,
    products:10, provinces:20, provinceNames:20,
    menuCategories:11, menuNames:49, menuIngredients:50,
  };
  for(const [section,count] of Object.entries(minimum)){
    assert.ok(packs[section], `missing ${section} pack`);
    for(const language of ['ja','ko'] as const){
      assert.ok(packs[section][language], `missing ${section}.${language}`);
      assert.ok(Object.keys(packs[section][language]).length>=count, `${section}.${language} is incomplete`);
      assert.ok(leaves(packs[section][language]).every(value=>value.trim().length>0), `${section}.${language} has an empty value`);
    }
  }
});

test('first-wave translations are native-script content with matching keys and interpolation variables', () => {
  const japanese=/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
  const korean=/\p{Script=Hangul}/u;
  for(const [section,byLanguage] of Object.entries(packs)){
    const ja=paths(byLanguage.ja);
    const ko=paths(byLanguage.ko);
    assert.deepEqual([...ja.keys()].sort(),[...ko.keys()].sort(), `${section} language keys differ`);
    for(const key of ja.keys()) assert.deepEqual(placeholders(ja.get(key)!),placeholders(ko.get(key)!),`${section}.${key} placeholder mismatch`);
  }
  const jaLeaves=Object.values(packs).flatMap(section=>leaves(section.ja));
  const koLeaves=Object.values(packs).flatMap(section=>leaves(section.ko));
  assert.ok(jaLeaves.filter(value=>japanese.test(value)).length/jaLeaves.length>0.95,'Japanese pack has too much fallback copy');
  assert.ok(koLeaves.filter(value=>korean.test(value)).length/koLeaves.length>0.95,'Korean pack has too much fallback copy');
});

test('first-wave packs contain no leaked translation tokens and preserve critical terminology', () => {
  const allText=Object.values(packs).flatMap(section=>[
    ...leaves(section.ja), ...leaves(section.ko),
  ]).join('\n');
  assert.doesNotMatch(packSource,/ZX[A-Z0-9_]+|ღ|♥|�/u);
  assert.doesNotMatch(allText,/ZX[A-Z0-9_]+|ღ|♥|�/u);

  assert.equal(packs.home.ja.thongthai_alt,'ทองไทย');
  assert.equal(packs.home.ko.thongthai_alt,'ทองไทย');
  assert.equal(packs.home.ja.hero_sub,'食べて、泊まって、探検して、地域の工芸を生み出す人々に出会う。すべてが一つの場所に。');
  assert.equal(packs.home.ko.hero_sub,'먹고, 머물고, 탐험하며 지역 공예를 만드는 사람들을 만나 보세요. 이 모든 경험이 한곳에 있습니다.');
  assert.equal(packs.home.ja.opt_who_friends,'友人と');
  assert.equal(packs.home.ja.opt_mood_nature,'自然');
  assert.equal(packs.home.ja.flow_s6_t,'また訪れる');
  assert.equal(packs.home.ja.hotspot_stay_title,'Thammachat Huenstay');
  assert.equal(packs.home.ko.time_part_evening,'저녁');
  assert.equal(packs.account.ja.shipping_returned,'返送済み');
  assert.equal(packs.chess.ja.hint,'ヒント');
  assert.equal(packs.chess.ja.winner_pass_title,'Winner Pass');
  assert.equal(packs.chess.ko.winner_pass_title,'Winner Pass');
  assert.equal(packs.otop.ja.free,'無料');
  assert.equal(packs.otop.ko.free,'무료');
  assert.equal(packs.menuIngredients.ja['ไข่ไก่'],'鶏卵');
  assert.equal(packs.menuIngredients.ko['ไข่ไก่'],'달걀');
  assert.equal(packs.menuNames.ko['ข้าวเหนียว'],'찹쌀밥');

  const canonicalProvinceNames=[
    'Chaiyaphum','Khon Kaen','Buriram','Surin','Sisaket','Nakhon Ratchasima',
    'Roi Et','Maha Sarakham','Kalasin','Sakon Nakhon','Nakhon Phanom','Mukdahan',
    'Yasothon','Amnat Charoen','Ubon Ratchathani','Udon Thani','Nong Khai',
    'Bueng Kan','Loei','Nong Bua Lamphu',
  ];
  assert.deepEqual(Object.values(packs.provinceNames.ja),canonicalProvinceNames);
  assert.deepEqual(Object.values(packs.provinceNames.ko),canonicalProvinceNames);
  for(const language of ['ja','ko'] as const){
    for(const product of Object.values(packs.products[language]) as Array<Record<string,string>>){
      if(product.originPlace==='Chaiyaphum') assert.equal(product.originPlace,'Chaiyaphum');
    }
  }
});

test('home interpolation passes variables into the locale kernel before rendering', () => {
  const home=read('index.html');
  assert.match(home,/function t\(key, vars=\{\}\)/u);
  assert.match(home,/translate\(TRANSLATIONS,key,vars,currentLang\)/u);
  assert.match(home,/t\('nearby_distance',\{km:p\.distanceKm\.toFixed\(1\)\}\)/u);
  assert.doesNotMatch(home,/t\('[^']+'\)\.replace\('\{/u);
});

test('Thongthai accepts ja/ko everywhere and final egress removes Thai surface leakage', () => {
  for(const source of [
    read('netlify/functions/_thongthai-brain.ts'),
    read('netlify/functions/_thongthai-brain-v3.ts'),
    read('netlify/functions/_response-composer.ts'),
  ]){
    assert.match(source, /'ja'/u);
    assert.match(source, /'ko'/u);
  }
  assert.equal(normalizeResponseLanguageSurface('ขี่ม้า 30 นาที ราคา 300 บาทครับ','ja'),'ขี่ม้า 30 分 ราคา 300 バーツ');
  assert.equal(normalizeResponseLanguageSurface('ขี่ม้า 30 นาที ราคา 300 บาทครับ','ko'),'ขี่ม้า 30 분 ราคา 300 바트');
  const profile=read('netlify/functions/_thongthai-agent-profile.ts');
  assert.match(profile,/any language the customer uses/iu);
  assert.match(profile,/never infer.*destination|must not infer.*destination/iu);
});
