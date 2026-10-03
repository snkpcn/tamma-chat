import type {Config} from '@netlify/functions';
import {authUserFromBearer} from './_operations-db';
import {
  createStripePaymentSessionForMember,
  stripeGlobalReadiness,
} from './_stripe-global-payment';

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
  const auth=req.headers.get('authorization')??undefined;
  const user=await authUserFromBearer(auth);
  if(!user)return json(401,{error:'authentication_required'});

  const readiness=stripeGlobalReadiness();
  if(!readiness.ready){
    return json(503,{error:'stripe_not_configured',missing:readiness.missing});
  }

  let body:Record<string,unknown>;
  try{
    const parsed=await req.json();
    body=parsed&&typeof parsed==='object'?parsed as Record<string,unknown>:{};
  }catch{
    return json(400,{error:'malformed_json'});
  }

  try{
    const session=await createStripePaymentSessionForMember({
      authUserId:user.id,
      intentCode:body.intentCode,
    });
    return json(200,{session});
  }catch(error){
    const code=(error instanceof Error?error.message:'unknown').split(':')[0]!;
    if(code==='payment_intent_not_found')return json(404,{error:code});
    if(code==='member_profile_required'||code==='payment_intent_not_payable')return json(409,{error:code});
    if(code.startsWith('stripe_'))return json(503,{error:code});
    console.error('STRIPE_PAYMENT_SESSION_ERROR',code.slice(0,120));
    return json(503,{error:'stripe_payment_session_temporarily_unavailable'});
  }
};

export const config:Config={path:'/api/payments/stripe/session'};
