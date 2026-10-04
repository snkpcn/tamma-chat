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
