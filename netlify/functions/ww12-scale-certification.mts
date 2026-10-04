import type {Config} from '@netlify/functions';

type Row=Record<string,unknown>;

function json(status:number,body:unknown){
  return new Response(JSON.stringify(body),{
    status,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff',
    },
  });
}

function truthy(value:string|undefined){
  return /^(?:1|true|on|yes)$/i.test(value?.trim()??'');
}

export default async (req:Request)=>{
  if(req.method!=='GET')return json(405,{error:'method_not_allowed'});

  const base=Netlify.env.get('SUPABASE_URL')?.replace(/\/$/,'')??'';
  const key=Netlify.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
  if(!base||!key)return json(503,{ok:false,error:'production_db_not_configured'});

  const read=async(path:string):Promise<Row[]>=>{
    const response=await fetch(base+'/rest/v1/'+path,{
      headers:{
        apikey:key,
        Authorization:'Bearer '+key,
        'Content-Type':'application/json',
      },
    });
    if(!response.ok){
      const body=await response.text().catch(()=>'');
      throw new Error('production_read_'+response.status+':'+body.slice(0,160));
    }
    return await response.json() as Row[];
  };

  try{
    const [markets,capabilities,certifications,paymentMethods,shippingServices]=await Promise.all([
      read('commerce_markets?is_domestic=eq.false&select=market_code,status'),
      read('commerce_market_capabilities?select=market_code,capability,state'),
      read('commerce_market_certifications?environment=eq.live&status=eq.certified&valid_until=gt.'+encodeURIComponent(new Date().toISOString())+'&select=market_code,valid_until'),
      read('commerce_market_payment_methods?execution_mode=eq.global_v2&status=eq.live&enabled=eq.true&select=market_code'),
      read('commerce_market_shipping_services?execution_mode=eq.global_v2&status=eq.live&enabled=eq.true&select=market_code'),
    ]);

    const firstWave=new Set(['KR','JP','US']);
    const transactionCaps=new Set(['payments','shipping','customs','checkout','fulfillment']);
    const marketByCode=new Map(markets.map(row=>[String(row.market_code),row]));
    const certMarkets=new Set(certifications.map(row=>String(row.market_code)));
    const failures:string[]=[];

    if(markets.filter(row=>row.status==='live').length===0){
      for(const name of [
        'TAMMA_WW_GLOBAL_PAYMENTS_ENABLED',
        'TAMMA_WW_GLOBAL_SHIPPING_ENABLED',
        'TAMMA_WW_CUSTOMS_ENABLED',
        'TAMMA_WW_CHECKOUT_ENABLED',
        'TAMMA_WW_FULFILLMENT_ENABLED',
      ]){
        if(truthy(Netlify.env.get(name))){
          failures.push('prelaunch_transaction_env_enabled:'+name);
        }
      }
    }

    for(const market of markets){
      const code=String(market.market_code);
      if(String(market.status)==='live'&&!certMarkets.has(code)){
        failures.push('live_market_without_current_certification:'+code);
      }
    }

    for(const row of capabilities){
      const code=String(row.market_code);
      if(!firstWave.has(code))continue;
      const market=marketByCode.get(code);
      if(String(market?.status)==='certification'
        &&transactionCaps.has(String(row.capability))
        &&String(row.state)!=='disabled'){
        failures.push('prelaunch_transaction_capability_exposed:'+code+':'+String(row.capability));
      }
    }

    for(const row of paymentMethods){
      const code=String(row.market_code);
      if(String(marketByCode.get(code)?.status)!=='live'){
        failures.push('live_payment_method_on_nonlive_market:'+code);
      }
    }
    for(const row of shippingServices){
      const code=String(row.market_code);
      if(String(marketByCode.get(code)?.status)!=='live'){
        failures.push('live_shipping_service_on_nonlive_market:'+code);
      }
    }
    for(const code of firstWave){
      if(!marketByCode.has(code))failures.push('first_wave_market_missing:'+code);
    }

    const firstWaveState=[...firstWave].sort().map(marketCode=>({
      marketCode,
      status:String(marketByCode.get(marketCode)?.status??'missing'),
      certified:certMarkets.has(marketCode),
    }));

    const result={
      ok:failures.length===0,
      version:'ww12-runtime-certification-2026-10-04',
      foreignMarkets:markets.length,
      liveForeignMarkets:markets.filter(row=>row.status==='live').length,
      currentForeignCertifications:certifications.length,
      liveGlobalPaymentMethods:paymentMethods.length,
      liveGlobalShippingServices:shippingServices.length,
      firstWave:firstWaveState,
      failures,
    };
    return json(failures.length?409:200,result);
  }catch(error){
    console.error('WW12_RUNTIME_CERTIFICATION_ERROR',error instanceof Error?error.message.slice(0,240):'unknown');
    return json(503,{ok:false,error:'runtime_certification_unavailable'});
  }
};

export const config:Config={
  path:'/api/ww12/certification',
};
