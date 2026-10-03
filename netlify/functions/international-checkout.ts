import type {Handler,HandlerEvent} from '@netlify/functions';
import {authUserFromBearer} from './_operations-db';
import {checkoutInternationalOtopOrder} from './_international-checkout-db';

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
    const order=await checkoutInternationalOtopOrder({
      authUserId:user.id,
      items:body.items,
      shippingAddressId:body.shippingAddressId,
      shippingQuoteId:body.shippingQuoteId,
      customsSnapshotId:body.customsSnapshotId,
      paymentMethodCode:body.paymentMethodCode,
      checkoutIdempotencyKey:body.checkoutIdempotencyKey,
      paymentIdempotencyKey:body.paymentIdempotencyKey,
      dutiesAcknowledged:body.dutiesAcknowledged,
      customerNote:body.customerNote,
      environment:body.environment==='test'?'test':'live',
    });
    return json(201,{order});
  }catch(error){
    const raw=error instanceof Error?error.message:'unknown';
    const code=raw.split(':')[0];
    const conflict=new Set(['insufficient_stock','shipping_quote_expired','shipping_quote_already_consumed','price_not_available','checkout_idempotency_conflict']);
    const bad=new Set(['invalid_items','shipping_address_required','shipping_quote_required','customs_snapshot_required','duties_acknowledgement_required','customs_documents_not_automated','customs_not_eligible','international_checkout_not_enabled','payment_method_not_ready']);
    if(conflict.has(code))return json(409,{error:code});
    if(bad.has(code))return json(400,{error:code});
    if(code==='member_profile_required')return json(409,{error:code});
    console.error('INTERNATIONAL_CHECKOUT_ERROR',code.slice(0,120));
    return json(503,{error:'international_checkout_temporarily_unavailable'});
  }
};
