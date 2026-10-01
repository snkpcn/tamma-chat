import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read=(path:string)=>readFileSync(path,'utf8');

test('FINAL CERT: homepage five-language dictionaries are complete and non-Thai modes do not leak Thai script',()=>{
  const html=read('index.html');
  const attrKeys=new Set<string>();
  for(const m of html.matchAll(/data-i18n(?:-html|-placeholder|-aria|-alt)?="([^"]+)"/g)) attrKeys.add(m[1]);

  const markers=[
    ['th','\nth: {','\nen: {'],
    ['en','\nen: {','\nzh: {'],
    ['zh','\nzh: {','\nlo: {'],
    ['lo','\nlo: {','\nvi: {'],
    ['vi','\nvi: {','\n};'],
  ] as const;
  for(const [lang,startMarker,endMarker] of markers){
    const start=html.indexOf(startMarker,html.indexOf('const TRANSLATIONS'));
    const end=html.indexOf(endMarker,start+startMarker.length);
    assert.ok(start>=0&&end>start,`missing ${lang} dictionary`);
    const block=html.slice(start,end);
    for(const key of attrKeys) assert.match(block,new RegExp(`\\b${key}:`),`${lang} missing ${key}`);
    if(lang!=='th') assert.doesNotMatch(block.replaceAll('฿',''),/[ก-๙]/,`${lang} contains Thai-script leakage`);
  }

  for(const marker of [
    'data-i18n="hotspot_inthanin_label"',
    'data-i18n="hotspot_reception_label"',
    'data-i18n="hotspot_dining_label"',
    'data-i18n="hotspot_stay_label"',
    'data-i18n="hotspot_adventure_label"',
    'data-i18n="hotspot_journal_label"',
    'data-i18n="hotspot_return_label"',
    'data-i18n="otop_empty_kicker"',
    'data-i18n="otop_empty_heading"',
    'data-i18n="otop_empty_body"',
    'data-i18n="otop_ask"',
    'data-i18n="otop_view_journey"',
  ]) assert.ok(html.includes(marker),marker);
});

test('FINAL CERT: OTOP map and store are clean five-language surfaces',()=>{
  const i18n=read('assets/scripts/otop-i18n.js');
  const store=read('otop.html');
  const map=read('otop-map.html');
  const mapJs=read('assets/scripts/otop-map.js');
  const products=read('assets/scripts/otop-product-translations.js');
  const provinces=read('assets/scripts/otop-province-translations.js');

  assert.equal((store.match(/id="storeLanguage"/g)||[]).length,1);
  assert.equal((map.match(/id="mapLanguage"/g)||[]).length,1);
  assert.match(i18n,/thammachat-lang-v1/);

  const markers=[
    ['en','    en:{','    zh:{'],
    ['zh','    zh:{','    lo:{'],
    ['lo','    lo:{','    vi:{'],
    ['vi','    vi:{','  };'],
  ] as const;
  for(const [lang,startMarker,endMarker] of markers){
    const start=i18n.indexOf(startMarker);
    const end=i18n.indexOf(endMarker,start+startMarker.length);
    assert.ok(start>=0&&end>start,`missing OTOP ${lang}`);
    assert.doesNotMatch(i18n.slice(start,end).replaceAll('฿',''),/[ก-๙]/,`OTOP ${lang} leaks Thai script`);
  }
  assert.doesNotMatch(mapJs,/zh:'[^']*[ก-๙]/);
  assert.doesNotMatch(mapJs,/lo:'[^']*[ก-๙]/);

  for(let i=1;i<=10;i++){
    const id=`chaiyaphum-otop-${String(i).padStart(3,'0')}`;
    assert.equal(products.split(id).length-1,4,`${id} needs EN/ZH/LO/VI`);
  }
  const provinceIds=['chaiyaphum','khonkaen','buriram','surin','sisaket','nakhonratchasima','roiet','mahasarakham','kalasin','sakonnakhon','nakhonphanom','mukdahan','yasothon','amnatcharoen','ubonratchathani','udonthani','nongkhai','buengkan','loei','nongbualamphu'];
  for(const id of provinceIds) assert.equal(provinces.split(`${id}:{title:`).length-1,4,`${id} needs EN/ZH/LO/VI story copy`);
});

test('FINAL CERT: every public page uses the locked typography contract',()=>{
  for(const page of ['index.html','account.html','chess.html','menu.html','otop-map.html','otop.html']){
    const html=read(page);
    assert.match(html,/assets\/styles\/site-typography\.css/,`${page} missing shared typography`);
    assert.doesNotMatch(html,/Noto Serif Thai|font-family\s*:\s*Georgia|-apple-system|BlinkMacSystemFont|"Segoe UI"/,`${page} has font drift`);
  }
  const css=read('assets/styles/site-typography.css');
  assert.match(css,/--site-font-th:\s*"IBM Plex Sans Thai"/);
  assert.match(css,/--site-font-en:\s*"Noto Sans"/);
});
