import type { Handler } from '@netlify/functions';
import {
  runSemanticCertification,
  type SemanticCertificationProfile,
} from './_semantic-live-certification';
import {
  emptySemanticContext,
  interpretSemanticTurn,
} from './_semantic-interpreter';

function json(statusCode:number,body:unknown){
  return {
    statusCode,
    headers:{
      'Content-Type':'application/json; charset=utf-8',
      'Cache-Control':'no-store',
      'X-Robots-Tag':'noindex, nofollow',
    },
    body:JSON.stringify(body),
  };
}

export function isDeployPreviewHost(headers:Record<string,string|undefined>):boolean{
  const host=(headers.host ?? headers['x-forwarded-host'] ?? '').toLowerCase();
  return /^deploy-preview-\d+--tamma-chat\.netlify\.app(?::\d+)?$/u.test(host);
}

export const handler:Handler=async event=>{
  if(!isDeployPreviewHost(event.headers ?? {})) return json(404,{error:'Not found'});
  if(event.httpMethod!=='GET') return json(405,{error:'Method not allowed'});

  if(event.queryStringParameters?.probe === '1'){
    try{
      const turn=await interpretSemanticTurn('มีอะไรทำบ้าง',emptySemanticContext());
      return json(200,{ok:true,semantic:{
        domain:turn.domain,
        action:turn.action,
        informationNeed:turn.informationNeed ?? 'none',
        confidence:turn.confidence,
        needsClarification:turn.needsClarification,
      }});
    }catch(error){
      const safe=error as {name?:unknown;message?:unknown;attempts?:unknown};
      return json(200,{ok:false,error:{
        name:typeof safe?.name==='string'?safe.name:'unknown',
        message:typeof safe?.message==='string'?safe.message.slice(0,240):'unknown',
        attempts:Array.isArray(safe?.attempts)?safe.attempts:[],
      }});
    }
  }

  const profile:SemanticCertificationProfile=
    event.queryStringParameters?.profile === 'production-smoke'
      ? 'production-smoke'
      : 'full';

  const startRaw=Number(event.queryStringParameters?.start ?? 0);
  const limitRaw=Number(event.queryStringParameters?.limit ?? 20);

  const result=await runSemanticCertification({
    profile,
    start:Number.isFinite(startRaw)?startRaw:0,
    limit:Number.isFinite(limitRaw)?limitRaw:20,
  });
  return json(200,result);
};
