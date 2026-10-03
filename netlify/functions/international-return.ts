import type {Handler,HandlerEvent} from '@netlify/functions';
import {authUserFromBearer} from './_operations-db';
import {createInternationalReturnRequest} from './_global-fulfillment-db';

function json(statusCode:number,body:unknown){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)}}
function header(event:HandlerEvent,name:string){const target=name.toLowerCase();return Object.entries(event.headers??{}).find(([k])=>k.toLowerCase()===target)?.[1]}

export const handler:Handler=async(event)=>{
  if(event.httpMethod!=='POST')return json(405,{error:'method_not_allowed'});
  const user=await authUserFromBearer(header(event,'authorization'));
  if(!user)return json(401,{error:'authentication_required'});
  let body:Record<string,unknown>;
  try{const parsed=JSON.parse(event.body??'{}');body=parsed&&typeof parsed==='object'?parsed:{}}
  catch{return json(400,{error:'malformed_json'})}
  try{
    const request=await createInternationalReturnRequest({
      authUserId:user.id,
      orderId:body.orderId,
      request:body,
      environment:body.environment==='test'?'test':'live',
    });
    return json(201,{returnRequest:request});
  }catch(error){
    const raw=error instanceof Error?error.message:'unknown';
    const code=raw.split(':')[0];
    const bad=new Set(['invalid_return_reason','invalid_return_resolution','idempotency_key_required','order_required','global_fulfillment_not_enabled']);
    const conflict=new Set(['return_requires_delivered_order','return_policy_not_live','return_window_closed','return_resolution_not_allowed','delivered_fulfillment_required','return_idempotency_conflict']);
    if(bad.has(code))return json(400,{error:code});
    if(conflict.has(code))return json(409,{error:code});
    if(code==='order_not_found'||code==='member_profile_required')return json(404,{error:'order_not_found'});
    console.error('INTERNATIONAL_RETURN_ERROR',code.slice(0,120));
    return json(503,{error:'international_return_temporarily_unavailable'});
  }
};
