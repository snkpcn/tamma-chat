import type {Handler,HandlerEvent} from '@netlify/functions';
import {authUserFromBearer} from './_operations-db';
import {getMemberGlobalFulfillment} from './_global-fulfillment-db';

function json(statusCode:number,body:unknown){return{statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},body:JSON.stringify(body)}}
function header(event:HandlerEvent,name:string){const target=name.toLowerCase();return Object.entries(event.headers??{}).find(([k])=>k.toLowerCase()===target)?.[1]}

export const handler:Handler=async(event)=>{
  if(event.httpMethod!=='GET')return json(405,{error:'method_not_allowed'});
  const user=await authUserFromBearer(header(event,'authorization'));
  if(!user)return json(401,{error:'authentication_required'});
  const orderCode=event.queryStringParameters?.orderCode;
  try{
    const fulfillment=await getMemberGlobalFulfillment(user.id,orderCode);
    return json(200,{fulfillment});
  }catch(error){
    const raw=error instanceof Error?error.message:'unknown';
    const code=raw.split(':')[0];
    if(code==='invalid_order_code')return json(400,{error:code});
    if(code==='order_not_found'||code==='member_profile_required')return json(404,{error:'order_not_found'});
    console.error('INTERNATIONAL_FULFILLMENT_ERROR',code.slice(0,120));
    return json(503,{error:'international_fulfillment_temporarily_unavailable'});
  }
};
