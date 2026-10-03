const context=process.env.CONTEXT??'';
if(context!=='production'){
  console.log('WW12_GLOBAL_PRODUCTION_CERTIFICATION_SKIPPED:'+String(context||'non-netlify'));
  process.exit(0);
}

const base=(process.env.SUPABASE_URL??'').replace(/\/$/,'');
const key=process.env.SUPABASE_SERVICE_ROLE_KEY??'';
if(!base||!key){
  console.error('WW12_GLOBAL_PRODUCTION_CERTIFICATION_FAIL:production_db_not_configured');
  process.exit(82);
}

async function read(path){
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
  return await response.json();
}

const firstWave=new Set(['KR','JP','US']);
const transactionCaps=new Set(['payments','shipping','customs','checkout','fulfillment']);

try{
  const [markets,capabilities,certifications,paymentMethods,shippingServices]=await Promise.all([
    read('commerce_markets?is_domestic=eq.false&select=market_code,status,country_code,default_currency_code'),
    read('commerce_market_capabilities?select=market_code,capability,state'),
    read('commerce_market_certifications?environment=eq.live&status=eq.certified&valid_until=gt.'+encodeURIComponent(new Date().toISOString())+'&select=market_code,valid_until'),
    read('commerce_market_payment_methods?execution_mode=eq.global_v2&status=eq.live&enabled=eq.true&select=market_code,provider_code,payment_method_code'),
    read('commerce_market_shipping_services?execution_mode=eq.global_v2&status=eq.live&enabled=eq.true&select=market_code,provider_code,service_code'),
  ]);

  const marketByCode=new Map(markets.map(row=>[String(row.market_code),row]));
  const certMarkets=new Set(certifications.map(row=>String(row.market_code)));
  const failures=[];
  const transactionEnvFlags=[
    'TAMMA_WW_GLOBAL_PAYMENTS_ENABLED',
    'TAMMA_WW_GLOBAL_SHIPPING_ENABLED',
    'TAMMA_WW_CUSTOMS_ENABLED',
    'TAMMA_WW_CHECKOUT_ENABLED',
    'TAMMA_WW_FULFILLMENT_ENABLED',
  ];

  if(markets.filter(row=>row.status==='live').length===0){
    for(const name of transactionEnvFlags){
      if(/^(?:1|true|on|yes)$/i.test((process.env[name]??'').trim())){
        failures.push('prelaunch_transaction_env_enabled:'+name);
      }
    }
  }

  for(const market of markets){
    const code=String(market.market_code);
    const status=String(market.status);
    if(status==='live'&&!certMarkets.has(code)){
      failures.push('live_market_without_current_certification:'+code);
    }
  }

  for(const row of capabilities){
    const code=String(row.market_code);
    if(!firstWave.has(code))continue;
    const market=marketByCode.get(code);
    if(!market)failures.push('first_wave_market_missing:'+code);
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

  if(failures.length){
    console.error('WW12_GLOBAL_PRODUCTION_CERTIFICATION_FAIL:'+JSON.stringify(failures));
    process.exit(83);
  }

  console.log('WW12_GLOBAL_PRODUCTION_CERTIFICATION_PASS '+JSON.stringify({
    foreignMarkets:markets.length,
    liveForeignMarkets:markets.filter(row=>row.status==='live').length,
    currentForeignCertifications:certifications.length,
    liveGlobalPaymentMethods:paymentMethods.length,
    liveGlobalShippingServices:shippingServices.length,
    firstWave:[...firstWave].sort(),
    failClosed:firstWave.every(code=>marketByCode.get(code)?.status!=='live'),
  }));
}catch(error){
  console.error('WW12_GLOBAL_PRODUCTION_CERTIFICATION_FAIL:'+(error instanceof Error?error.message:'unknown'));
  process.exit(84);
}
