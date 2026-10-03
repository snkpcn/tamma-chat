import type {Config} from '@netlify/functions';
import {processStripeWebhook,stripeGlobalReadiness} from './_stripe-global-payment';

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

export default async (req:Request)=>{
  if(req.method!=='POST')return json(405,{error:'method_not_allowed'});
  const readiness=stripeGlobalReadiness();
  if(!readiness.ready)return json(503,{error:'stripe_not_configured'});

  const signature=req.headers.get('stripe-signature')??'';
  if(!signature)return json(400,{error:'stripe_signature_required'});
  const rawBody=await req.text();

  try{
    const result=await processStripeWebhook({rawBody,signatureHeader:signature});
    return json(200,result);
  }catch(error){
    const code=(error instanceof Error?error.message:'unknown').split(':')[0]!;
    if(code==='stripe_webhook_signature_invalid'||code==='stripe_webhook_json_invalid'){
      return json(400,{error:code});
    }
    console.error('STRIPE_WEBHOOK_ERROR',code.slice(0,120));
    return json(503,{error:'stripe_webhook_temporarily_unavailable'});
  }
};

export const config:Config={path:'/api/payments/stripe/webhook'};
