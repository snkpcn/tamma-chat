import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  THONGTHAI_BACKOFFICE_READ_LANES,
  readThongthaiMarketContext,
  readThongthaiShippingQuote,
} from '../netlify/functions/_thongthai-worldwide-bridge';
import {
  THONGTHAI_READ_ONLY_TOOLS,
  executeThongthaiReadOnlyTool,
} from '../netlify/functions/_thongthai-agent-tools';
import { buildProductionSemanticInterpreterPrompt, emptySemanticContext } from '../netlify/functions/_semantic-interpreter';

test('Thongthai bridge owns no duplicate WW or shipping database', () => {
  const source=readFileSync(new URL('../netlify/functions/_thongthai-worldwide-bridge.ts',import.meta.url),'utf8');
  assert.doesNotMatch(source,/fetch\s*\(/u);
  assert.doesNotMatch(source,/\b(?:dbFetch|chartDbFetch|publicDbFetch)\b|\/rest\/v1\//u);
  assert.match(source,/loadWorldwideMarketContext/u);
  assert.match(source,/loadShippingSettings/u);
  assert.match(source,/calculateShippingQuote/u);
});

test('Thongthai has a bounded read seam for every customer-facing backoffice lane', () => {
  const lanes=new Set(THONGTHAI_BACKOFFICE_READ_LANES.map(item=>item.lane));
  assert.deepEqual([...lanes].sort(),[
    'activity','booking','cafe','customs','location','market','membership','otop','payment',
    'promotion','restaurant','shipping','stay','weather',
  ]);
  const tools=new Set(THONGTHAI_READ_ONLY_TOOLS.map(tool=>tool.name));
  for(const name of [
    'recommend_restaurant_menu','get_cafe_menu','get_activity_catalog','get_stay_catalog',
    'get_otop_catalog','get_active_promotions','get_booking_status','get_order_status',
    'get_payment_status','get_membership_status','get_current_weather','get_location_info',
    'get_market_context','get_shipping_quote',
  ]) assert.ok(tools.has(name),`missing Thongthai read tool: ${name}`);
});

test('Thailand stays usable when WW flags are off and language does not redefine market', async () => {
  const market=await readThongthaiMarketContext('TH','sv-SE',{});
  assert.equal(market.status,'ready');
  if(market.status!=='ready') return;
  assert.equal(market.context.countryCode,'TH');
  assert.equal(market.context.currencyCode,'THB');
  assert.equal(market.context.isDomestic,true);
  // WW-1 has only five configured presentation locales today. Swedish speech
  // does not silently turn Thailand into another country or currency.
  assert.equal(market.context.localeCode,'th');
});

test('foreign market and shipping fail closed while WW is not enabled', async () => {
  const market=await readThongthaiMarketContext('SE','sv',{});
  assert.equal(market.status,'not_available');

  const shipping=await readThongthaiShippingQuote({
    countryCode:'SE',
    subtotal:1200,
    locale:'sv',
    env:{},
  });
  assert.deepEqual(shipping,{
    status:'not_available',
    reason:'market_not_ready',
    countryCode:'SE',
  });
});

test('Agent market tool never infers country from customer language', async () => {
  const result=JSON.parse(await executeThongthaiReadOnlyTool('get_market_context',{
    country_code:'TH',
    locale:'de-DE',
  },{
    guestDbId:null,
    channel:'facebook',
    environment:'live',
  }));
  assert.equal(result.status,'ready');
  assert.equal(result.context.countryCode,'TH');
  assert.equal(result.context.currencyCode,'THB');
});

test('semantic supervisor is instructed to reply in the current customer language', () => {
  const prompt=buildProductionSemanticInterpreterPrompt(
    emptySemanticContext(),
    'Können Sie nach Schweden liefern?',
  );
  assert.match(prompt,/SAME language as the CURRENT customer message/u);
  assert.match(prompt,/Never infer country, market, currency, shipping destination, or payment method from the language used/u);
});
