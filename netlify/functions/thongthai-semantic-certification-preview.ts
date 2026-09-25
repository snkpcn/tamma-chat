import type { Handler } from '@netlify/functions';
import {
  runSemanticCertification,
  type SemanticCertificationProfile,
} from './_semantic-live-certification';

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

function isDeployPreview():boolean{
  return process.env.CONTEXT === 'deploy-preview'
    || /deploy-preview-/u.test(process.env.DEPLOY_PRIME_URL ?? '');
}

export const handler:Handler=async event=>{
  if(!isDeployPreview()) return json(404,{error:'Not found'});
  if(event.httpMethod!=='GET') return json(405,{error:'Method not allowed'});

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
