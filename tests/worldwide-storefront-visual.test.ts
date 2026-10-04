import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read=(path:string)=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('otop.html');
const css=read('assets/styles/worldwide-storefront.css');
const runtime=read('assets/scripts/worldwide-storefront.js');

function loadRuntime(search='?country=JP'){
  let lang='th';
  const events:unknown[]=[];
  const storage=new Map<string,string>();
  const context={
    window:{
      OTOP_I18N:{lang:()=>lang},
      dispatchEvent:(event:unknown)=>events.push(event),
    } as Record<string,unknown>,
    location:{search,href:'https://tamma-chat.netlify.app/otop.html'+search},
    history:{replaceState:()=>{}},
    localStorage:{getItem:(key:string)=>storage.get(key)||null,setItem:(key:string,value:string)=>storage.set(key,value)},
    URL,URLSearchParams,
    CustomEvent:class {type:string;detail:unknown;constructor(type:string,init:{detail:unknown}){this.type=type;this.detail=init.detail}},
    fetch:async()=>new Response(JSON.stringify({
      ok:true,foreignMarkets:3,liveForeignMarkets:0,currentForeignCertifications:0,
      liveGlobalPaymentMethods:0,liveGlobalShippingServices:0,
      firstWave:[{marketCode:'JP',status:'certification',certified:false}],
    }),{status:200,headers:{'Content-Type':'application/json'}}),
    Response,
  };
  vm.runInNewContext(runtime,context,{filename:'worldwide-storefront.js'});
  return{
    api:(context.window as any).TAMMA_WORLDWIDE_STOREFRONT,
    setLanguage:(value:string)=>{lang=value},
  };
}

test('OTOP storefront visibly exposes destination, currency and global commerce journey',()=>{
  assert.match(html,/id="marketSelect"/);
  for(const tuple of [['TH','THB'],['JP','JPY'],['KR','KRW'],['US','USD']]){
    assert.match(html,new RegExp(`<option value="${tuple[0]}">[^<]*${tuple[1]}`));
  }
  assert.match(html,/id="globalCommerce"/);
  assert.match(html,/id="detailMarket"/);
  assert.match(html,/id="internationalPreviewView"/);
  assert.match(html,/\$\('closeDrawer'\)\.textContent='×';[\s\S]*setAttribute\('aria-label',tr\('close'\)\)/);
  assert.match(html,/\.sheetHead \.close\{[^}]*white-space:nowrap/);
  assert.match(html,/assets\/styles\/worldwide-storefront\.css/);
  assert.match(html,/assets\/scripts\/worldwide-storefront\.js/);
});

test('foreign checkout is a complete five-stage preview and cannot create an uncertified order',()=>{
  assert.match(html,/const keys=\['step_cart','step_address','step_shipping','step_duties','step_payment'\]/);
  assert.match(html,/function renderInternationalCheckoutPreview\(\)/);
  assert.match(html,/lockedCheckout[^`]*disabled/);
  assert.match(html,/async function beginCheckout\(\)\{if\(internationalMarket\(\)\)\{renderInternationalCheckoutPreview\(\);return\}/);
  const previewStart=html.indexOf('function renderInternationalCheckoutPreview()');
  const checkoutStart=html.indexOf('async function beginCheckout()',previewStart);
  const previewBlock=html.slice(previewStart,checkoutStart);
  assert.match(previewBlock,/dhl_express/);
  assert.match(previewBlock,/customs_review/);
  assert.match(previewBlock,/payment_method/);
  assert.doesNotMatch(previewBlock,/memberFetch\(|method:'POST'/);
});

test('WW-12 live status requires certification, payment and shipping evidence together',async()=>{
  const {api}=loadRuntime();
  assert.equal(api.currentMarket().countryCode,'JP');
  assert.equal(api.currentMarket().currencyCode,'JPY');
  assert.equal(api.currentMarket().status,'certification');
  await api.refreshCertification();
  assert.equal(api.currentMarket().status,'certification');
  assert.match(runtime,/remote\?\.certified === true/);
  assert.match(runtime,/liveGlobalPaymentMethods > 0/);
  assert.match(runtime,/liveGlobalShippingServices > 0/);
  assert.doesNotMatch(runtime,/method\s*:\s*['"]POST['"]/);
});

test('new global storefront copy is native across all seven public languages',()=>{
  const {api,setLanguage}=loadRuntime('?country=US');
  const seen=new Set<string>();
  for(const lang of ['th','en','zh','lo','vi','ja','ko']){
    setLanguage(lang);
    const title=api.t('global_title');
    const status=api.t('status_cert');
    assert.ok(title.length>4,`${lang} global title missing`);
    assert.ok(status.length>2,`${lang} certification label missing`);
    assert.notEqual(title,'global_title');
    seen.add(title);
  }
  assert.equal(seen.size,7);
});

test('worldwide storefront stays compact and single-rail on mobile',()=>{
  assert.match(css,/@media \(max-width: 680px\)[\s\S]*\.site-page--store \.top \.nav[\s\S]*flex-wrap:\s*nowrap/);
  assert.match(css,/\.globalCapabilities[\s\S]*grid-template-columns:\s*repeat\(4/);
  assert.match(css,/@media \(max-width: 680px\)[\s\S]*\.globalCapabilities\s*\{\s*grid-template-columns:\s*repeat\(2/);
  assert.match(css,/\.marketPicker\s*\{[\s\S]*border-radius:\s*999px/);
  assert.match(css,/\.globalCommerce\s*\{[\s\S]*border-radius:\s*26px/);
});
