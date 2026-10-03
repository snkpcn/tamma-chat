export const WW12_GLOBAL_SCALE_VERSION='ww12-global-scale-2026-10-04';

export type WorldwideDbConsistency='strong'|'eventual';
export type WorldwideDbRoute='primary'|'replica';
export type WorldwideDbEnv=Readonly<Record<string,string|undefined>>;

function runtimeValue(name:string):string|undefined{
  const runtime=(globalThis as typeof globalThis&{
    Netlify?:{env?:{get?:(key:string)=>unknown}};
  }).Netlify?.env;
  const netlifyValue=runtime?.get?.(name);
  if(typeof netlifyValue==='string'&&netlifyValue.trim())return netlifyValue.trim();
  const processValue=process.env[name];
  return typeof processValue==='string'&&processValue.trim()?processValue.trim():undefined;
}

export function runtimeWorldwideDbEnv():WorldwideDbEnv{
  return{
    SUPABASE_URL:runtimeValue('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY:runtimeValue('SUPABASE_SERVICE_ROLE_KEY'),
    SUPABASE_READ_URL:runtimeValue('SUPABASE_READ_URL'),
    SUPABASE_READ_SERVICE_ROLE_KEY:runtimeValue('SUPABASE_READ_SERVICE_ROLE_KEY'),
    TAMMA_WW_OBSERVABILITY_ENABLED:runtimeValue('TAMMA_WW_OBSERVABILITY_ENABLED'),
  };
}

function normalizeBaseUrl(value:string|undefined):string|null{
  const text=value?.trim();
  if(!text)return null;
  try{
    const url=new URL(text);
    if(url.protocol!=='https:')return null;
    return url.toString().replace(/\/$/,'');
  }catch{
    return null;
  }
}

function enabled(value:string|undefined):boolean{
  return /^(?:1|true|on|yes)$/i.test(value?.trim()??'');
}

export function resolveWorldwideDbRoute(input:{
  method?:string;
  consistency?:WorldwideDbConsistency;
  env:WorldwideDbEnv;
}):WorldwideDbRoute{
  const method=(input.method??'GET').toUpperCase();
  const consistency=input.consistency??'strong';
  const replicaReady=Boolean(
    normalizeBaseUrl(input.env.SUPABASE_READ_URL)
    &&input.env.SUPABASE_READ_SERVICE_ROLE_KEY?.trim(),
  );
  if((method==='GET'||method==='HEAD')&&consistency==='eventual'&&replicaReady){
    return'replica';
  }
  return'primary';
}

export function worldwideDbScaleSnapshot(env:WorldwideDbEnv=runtimeWorldwideDbEnv()){
  const primaryConfigured=Boolean(
    normalizeBaseUrl(env.SUPABASE_URL)&&env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  const replicaConfigured=Boolean(
    normalizeBaseUrl(env.SUPABASE_READ_URL)&&env.SUPABASE_READ_SERVICE_ROLE_KEY?.trim(),
  );
  return{
    version:WW12_GLOBAL_SCALE_VERSION,
    primaryConfigured,
    replicaConfigured,
    observabilityEnabled:enabled(env.TAMMA_WW_OBSERVABILITY_ENABLED),
    readStrategy:replicaConfigured?'eventual-safe-reads-can-use-replica':'primary-fallback',
    writesAlwaysPrimary:true,
  };
}

function routeConfig(route:WorldwideDbRoute,env:WorldwideDbEnv){
  const primaryUrl=normalizeBaseUrl(env.SUPABASE_URL);
  const primaryKey=env.SUPABASE_SERVICE_ROLE_KEY?.trim()||null;
  if(!primaryUrl||!primaryKey)throw new Error('worldwide_db_primary_not_configured');

  if(route==='replica'){
    const replicaUrl=normalizeBaseUrl(env.SUPABASE_READ_URL);
    const replicaKey=env.SUPABASE_READ_SERVICE_ROLE_KEY?.trim()||null;
    if(replicaUrl&&replicaKey)return{route,url:replicaUrl,key:replicaKey};
  }
  return{route:'primary' as const,url:primaryUrl,key:primaryKey};
}

function resourceName(path:string):string{
  return path.replace(/^\/+/, '').split(/[?\/]/,1)[0]?.slice(0,80)||'unknown';
}

function trace(input:{
  operation:string;
  resource:string;
  method:string;
  route:WorldwideDbRoute;
  fallback:boolean;
  status:number|null;
  durationMs:number;
  error?:string;
  force?:boolean;
  env:WorldwideDbEnv;
}){
  const shouldLog=input.force
    ||enabled(input.env.TAMMA_WW_OBSERVABILITY_ENABLED)
    ||input.fallback
    ||input.status===null
    ||input.status>=500
    ||input.durationMs>=750;
  if(!shouldLog)return;
  console.log('# WW12_GLOBAL_SCALE_TRACE '+JSON.stringify({
    version:WW12_GLOBAL_SCALE_VERSION,
    operation:input.operation,
    resource:input.resource,
    method:input.method,
    route:input.route,
    fallback:input.fallback,
    status:input.status,
    durationMs:input.durationMs,
    error:input.error??null,
  }));
}

async function requestOnce(input:{
  path:string;
  init:RequestInit;
  route:WorldwideDbRoute;
  operation:string;
  env:WorldwideDbEnv;
  fallback:boolean;
}):Promise<Response>{
  const config=routeConfig(input.route,input.env);
  const started=Date.now();
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10_000);
  try{
    const response=await fetch(config.url+'/rest/v1/'+input.path.replace(/^\/+/,''),{
      ...input.init,
      signal:input.init.signal??controller.signal,
      headers:{
        apikey:config.key,
        Authorization:'Bearer '+config.key,
        'Content-Type':'application/json',
        ...(input.init.headers??{}),
      },
    });
    trace({
      operation:input.operation,
      resource:resourceName(input.path),
      method:(input.init.method??'GET').toUpperCase(),
      route:config.route,
      fallback:input.fallback,
      status:response.status,
      durationMs:Date.now()-started,
      env:input.env,
    });
    return response;
  }catch(error){
    trace({
      operation:input.operation,
      resource:resourceName(input.path),
      method:(input.init.method??'GET').toUpperCase(),
      route:config.route,
      fallback:input.fallback,
      status:null,
      durationMs:Date.now()-started,
      error:error instanceof Error?error.name:'request_failed',
      force:true,
      env:input.env,
    });
    throw error;
  }finally{
    clearTimeout(timeout);
  }
}

export async function worldwideDbFetch(
  path:string,
  init:RequestInit={},
  options:{
    consistency?:WorldwideDbConsistency;
    operation?:string;
    env?:WorldwideDbEnv;
    allowReplicaFallback?:boolean;
  }={},
):Promise<Response>{
  if(!path||/^https?:\/\//i.test(path))throw new Error('worldwide_db_invalid_path');
  const env=options.env??runtimeWorldwideDbEnv();
  const method=(init.method??'GET').toUpperCase();
  const route=resolveWorldwideDbRoute({
    method,
    consistency:options.consistency??'strong',
    env,
  });
  const operation=(options.operation??'worldwide_db').slice(0,80);
  const canFallback=route==='replica'
    &&(method==='GET'||method==='HEAD')
    &&options.allowReplicaFallback!==false;

  try{
    const response=await requestOnce({
      path,init,route,operation,env,fallback:false,
    });
    if(canFallback&&response.status>=500){
      return await requestOnce({
        path,init,route:'primary',operation,env,fallback:true,
      });
    }
    return response;
  }catch(error){
    if(canFallback){
      return await requestOnce({
        path,init,route:'primary',operation,env,fallback:true,
      });
    }
    throw error;
  }
}
