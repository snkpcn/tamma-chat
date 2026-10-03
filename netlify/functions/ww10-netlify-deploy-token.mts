import type { Config } from '@netlify/functions';

const EXPECTED_AUD='ww10-netlify-deploy';
const EXPECTED_REPOSITORY='snkpcn/tamma-chat';
const EXPECTED_WORKFLOW='WW10 Netlify Deploy Kit';
const EXPECTED_PR_REF='refs/pull/552/merge';

type Claims={
  iss?:string;aud?:string|string[];exp?:number;nbf?:number;
  repository?:string;event_name?:string;ref?:string;workflow?:string;
};

function decodeJson(segment:string):Record<string,unknown>{
  const normalized=segment.replace(/-/g,'+').replace(/_/g,'/');
  const padding='='.repeat((4-normalized.length%4)%4);
  return JSON.parse(Buffer.from(normalized+padding,'base64').toString('utf8')) as Record<string,unknown>;
}

function decodeBytes(segment:string):Uint8Array{
  const normalized=segment.replace(/-/g,'+').replace(/_/g,'/');
  const padding='='.repeat((4-normalized.length%4)%4);
  return new Uint8Array(Buffer.from(normalized+padding,'base64'));
}

async function verifyGithubOidc(token:string):Promise<Claims|null>{
  const parts=token.split('.');
  if(parts.length!==3)return null;
  const header=decodeJson(parts[0]!);
  if(header.alg!=='RS256'||typeof header.kid!=='string')return null;
  const claims=decodeJson(parts[1]!) as Claims;
  const now=Math.floor(Date.now()/1000);
  const audiences=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(
    claims.iss!=='https://token.actions.githubusercontent.com'
    ||!audiences.includes(EXPECTED_AUD)
    ||typeof claims.exp!=='number'||claims.exp<=now
    ||(typeof claims.nbf==='number'&&claims.nbf>now+30)
    ||claims.repository!==EXPECTED_REPOSITORY
    ||claims.event_name!=='pull_request'
    ||claims.ref!==EXPECTED_PR_REF
    ||claims.workflow!==EXPECTED_WORKFLOW
  )return null;

  const jwksRes=await fetch('https://token.actions.githubusercontent.com/.well-known/jwks');
  if(!jwksRes.ok)return null;
  const jwks=await jwksRes.json() as {keys?:Array<JsonWebKey&{kid?:string}>};
  const jwk=jwks.keys?.find(key=>key.kid===header.kid);
  if(!jwk)return null;
  const key=await crypto.subtle.importKey(
    'jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify'],
  );
  const data=new TextEncoder().encode(parts[0]+'.'+parts[1]);
  const valid=await crypto.subtle.verify(
    {name:'RSASSA-PKCS1-v1_5'},key,decodeBytes(parts[2]!),data,
  );
  return valid?claims:null;
}

function secretEnv(name:string):string{
  const runtime=(globalThis as typeof globalThis&{
    Netlify?:{env?:{get?:(key:string)=>unknown}};
  }).Netlify?.env;
  const value=runtime?.get?.(name);
  return typeof value==='string'?value.trim():'';
}

export default async (req:Request)=>{
  if(req.method!=='POST')return new Response('method_not_allowed',{status:405});
  const auth=req.headers.get('authorization')??'';
  if(!auth.startsWith('Bearer '))return new Response('unauthorized',{status:401});
  const claims=await verifyGithubOidc(auth.slice(7)).catch(()=>null);
  if(!claims)return new Response('unauthorized',{status:401});
  const proxy=secretEnv('WW10_DEPLOY_PROXY');
  if(!proxy.startsWith('https://netlify-mcp.netlify.app/proxy/')){
    return new Response('proxy_unavailable',{status:503});
  }
  return new Response(proxy,{
    status:200,
    headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'},
  });
};

export const config:Config={path:'/ww10-netlify-deploy-token'};
