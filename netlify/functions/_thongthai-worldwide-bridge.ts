/**
 * Thongthai <-> Worldwide / Backoffice read bridge.
 *
 * Ownership rule:
 * - WW owns country/currency/locale/market/shipping/customs rollout.
 * - Existing domain modules own their live business data.
 * - Thongthai owns ZERO duplicate commerce tables and never invents a quote.
 */
import {
  DOMESTIC_COMMERCE_BASELINE,
  isWorldwideCapabilityEnabled,
  worldwideFeatureSnapshot,
  type WorldwideEnv,
} from './_worldwide-foundation';
import {
  isMarketCapabilityLive,
  type ResolvedMarketContext,
} from './_worldwide-data-core';
import { loadWorldwideMarketContext } from './_worldwide-data-db';
import { loadShippingSettings } from './_member-delivery-db';
import { calculateShippingQuote } from './_member-delivery';

export const THONGTHAI_WORLDWIDE_BRIDGE_VERSION = 'thongthai-worldwide-bridge-v1-2026-10-03';

export const THONGTHAI_BACKOFFICE_READ_LANES = Object.freeze([
  { lane:'restaurant', source:'restaurant live menu + intelligence' },
  { lane:'cafe', source:'Inthanin live menu + branch modifiers' },
  { lane:'activity', source:'service resources + activity offerings + schedules' },
  { lane:'stay', source:'stay resources + schedules' },
  { lane:'otop', source:'OTOP products + inventory + order state' },
  { lane:'promotion', source:'promotion runtime' },
  { lane:'booking', source:'bookings operational state' },
  { lane:'payment', source:'payment requests operational state' },
  { lane:'membership', source:'customer membership state' },
  { lane:'market', source:'WW country/currency/locale/market core' },
  { lane:'shipping', source:'domestic shipping settings or WW shipping capability' },
  { lane:'customs', source:'WW customs capability (when live)' },
  { lane:'weather', source:'live weather provider' },
  { lane:'location', source:'owner-verified canonical navigation source' },
  { lane:'incident', source:'Customer Voice incident store + existing team/owner notification routing' },
] as const);

export type ThongthaiMarketRead =
  | {
      status:'ready';
      source:'domestic_baseline'|'worldwide_data_core';
      context:ResolvedMarketContext;
    }
  | {
      status:'not_available';
      reason:string;
      countryCode:string | null;
      worldwide:ReturnType<typeof worldwideFeatureSnapshot>;
    };

function domesticContext(locale: string | null | undefined): ResolvedMarketContext {
  const requested = typeof locale === 'string' && locale.trim() ? locale.trim() : 'th';
  const supported = new Set(['th','en','zh','lo','vi']);
  const canonical = requested.replace(/_/g,'-').split('-')[0]!.toLowerCase();
  const localeCode = supported.has(canonical) ? canonical : 'th';
  return {
    version: 'ww1-global-data-core-2026-10-03',
    marketCode:'TH',
    countryCode:DOMESTIC_COMMERCE_BASELINE.countryCode,
    currencyCode:DOMESTIC_COMMERCE_BASELINE.currencyCode,
    localeCode,
    status:'live',
    isDomestic:true,
    capabilities:{
      catalog:'live',
      storefront:'live',
      pricing:'live',
      payments:'live',
      shipping:'live',
      customs:'disabled',
      checkout:'live',
      fulfillment:'live',
      thongthai:'live',
    },
  };
}

export async function readThongthaiMarketContext(
  countryCode: unknown,
  requestedLocale?: unknown,
  env?: WorldwideEnv,
): Promise<ThongthaiMarketRead> {
  const normalized = typeof countryCode === 'string' ? countryCode.trim().toUpperCase() : '';
  if (normalized === DOMESTIC_COMMERCE_BASELINE.countryCode) {
    const loaded = await loadWorldwideMarketContext(normalized, requestedLocale, env).catch(() => ({ kind:'disabled' as const }));
    if (loaded.kind === 'ready') {
      return { status:'ready', source:'worldwide_data_core', context:loaded.context };
    }
    return {
      status:'ready',
      source:'domestic_baseline',
      context:domesticContext(typeof requestedLocale === 'string' ? requestedLocale : null),
    };
  }

  const worldwide = worldwideFeatureSnapshot(env);
  const loaded = await loadWorldwideMarketContext(normalized, requestedLocale, env).catch(error => ({
    kind:'unavailable' as const,
    reason:'worldwide_data_error:' + (error instanceof Error ? error.message.slice(0,120) : 'unknown'),
  }));

  if (loaded.kind === 'ready') {
    return { status:'ready', source:'worldwide_data_core', context:loaded.context };
  }
  return {
    status:'not_available',
    reason:loaded.kind === 'disabled' ? 'worldwide_data_core_disabled' : loaded.reason,
    countryCode:normalized || null,
    worldwide,
  };
}

export type ThongthaiShippingQuoteRead =
  | {
      status:'ready';
      source:'otop_shipping_settings';
      countryCode:'TH';
      currencyCode:'THB';
      policy:{
        domesticBaseFee:number;
        freeShippingThreshold:number|null;
        estimatedMinDays:number;
        estimatedMaxDays:number;
      };
      quote:{
        subtotal:number;
        shippingFee:number;
        total:number;
        freeShipping:boolean;
        estimatedMinDays:number;
        estimatedMaxDays:number;
      } | null;
    }
  | {
      status:'not_available';
      reason:
        | 'invalid_subtotal'
        | 'market_not_ready'
        | 'thongthai_market_capability_not_live'
        | 'shipping_market_capability_not_live'
        | 'worldwide_thongthai_gate_off'
        | 'worldwide_shipping_gate_off'
        | 'global_shipping_quote_source_not_connected';
      countryCode:string;
      market?:ResolvedMarketContext;
    };

export async function readThongthaiShippingQuote(input:{
  countryCode:unknown;
  subtotal?:unknown;
  locale?:unknown;
  env?:WorldwideEnv;
}):Promise<ThongthaiShippingQuoteRead>{
  const countryCode=typeof input.countryCode==='string' ? input.countryCode.trim().toUpperCase() : '';
  const hasSubtotal=input.subtotal!==undefined&&input.subtotal!==null&&input.subtotal!=='';
  const subtotal=hasSubtotal?Number(input.subtotal):null;
  if(subtotal!==null&&(!Number.isFinite(subtotal)||subtotal<0)){
    return {status:'not_available',reason:'invalid_subtotal',countryCode};
  }

  if(countryCode===DOMESTIC_COMMERCE_BASELINE.countryCode){
    const settings=await loadShippingSettings();
    const quote=subtotal===null?null:calculateShippingQuote(subtotal,settings);
    return {
      status:'ready',
      source:'otop_shipping_settings',
      countryCode:'TH',
      currencyCode:'THB',
      policy:{
        domesticBaseFee:settings.domesticBaseFee,
        freeShippingThreshold:settings.freeShippingThreshold,
        estimatedMinDays:settings.estimatedMinDays,
        estimatedMaxDays:settings.estimatedMaxDays,
      },
      quote,
    };
  }

  const market=await readThongthaiMarketContext(countryCode,input.locale,input.env);
  if(market.status!=='ready'){
    return {status:'not_available',reason:'market_not_ready',countryCode};
  }
  if(!isMarketCapabilityLive(market.context,'thongthai')){
    return {status:'not_available',reason:'thongthai_market_capability_not_live',countryCode,market:market.context};
  }
  if(!isMarketCapabilityLive(market.context,'shipping')){
    return {status:'not_available',reason:'shipping_market_capability_not_live',countryCode,market:market.context};
  }
  if(!isWorldwideCapabilityEnabled('thongthaiWorldwide',input.env)){
    return {status:'not_available',reason:'worldwide_thongthai_gate_off',countryCode,market:market.context};
  }
  if(!isWorldwideCapabilityEnabled('globalShipping',input.env)){
    return {status:'not_available',reason:'worldwide_shipping_gate_off',countryCode,market:market.context};
  }

  // WW owns the future international quote engine. Do not duplicate it here.
  return {
    status:'not_available',
    reason:'global_shipping_quote_source_not_connected',
    countryCode,
    market:market.context,
  };
}
