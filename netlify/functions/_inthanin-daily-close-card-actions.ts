import {resolveInthaninScope} from './_inthanin-weekly-cash';
import {piiHash} from './_operations-db';
import {isAuthorizedOwnerPaymentActor} from './_owner-payment-document';
import {amount} from './_inthanin-weekly-cash-report';
import {buildInthaninDailyCloseCard,buildInthaninMissingCloseCard,decodeInthaninDailyCloseAction,INTHANIN_CLOSE_ACTION_PREFIX,type InthaninDailyCloseCardInput} from './_inthanin-daily-close-card';
import type {RecordedDailyClose} from './_inthanin-daily-close-line';

type Row={id:string;branch_id:string;local_date:string;environment:string;revision:number;status:string;
  net_sales:unknown;payment_cash:unknown;payment_qr:unknown;payments_total:unknown;sales_payment_variance:unknown;
  cash_drawer_outflow_amount:unknown;cash_opening_float:unknown;cash_counted_closing:unknown;};
type Reconciliation={ok?:boolean;ready_to_confirm?:boolean;blockers?:InthaninDailyCloseCardInput['blockers'];warnings?:InthaninDailyCloseCardInput['warnings']};
async function db(path:string,init:RequestInit={}):Promise<Response>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Daily close card database unavailable');
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{
    ...init,headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',...(init.headers??{})},signal:AbortSignal.timeout(7000),
  });
  if(!response.ok)throw new Error('Daily close card request failed: '+response.status);
  return response;
}
async function loadCard(id:string,localDate:string,branchId:string){
  const rows=await(await db('financial_daily_close_effective_v1?id=eq.'+encodeURIComponent(id)+'&branch_id=eq.'+encodeURIComponent(branchId)
    +'&environment=eq.live&local_date=eq.'+encodeURIComponent(localDate)
    +'&select=id,branch_id,local_date,environment,revision,status,net_sales,payment_cash,payment_qr,payments_total,sales_payment_variance,cash_drawer_outflow_amount,cash_opening_float,cash_counted_closing&limit=2')).json() as Row[];
  if(rows.length!==1)throw new Error('Daily close card scope mismatch');
  const row=rows[0];
  const raw=await(await db('rpc/financial_reconcile_daily_close_v1',{method:'POST',body:JSON.stringify({p_daily_close_id:id})})).json();
  const reconcile:Reconciliation=Array.isArray(raw)?raw[0]:raw;
  if(!reconcile?.ok)throw new Error('Daily close reconciliation unavailable');
  const input:InthaninDailyCloseCardInput={id:row.id,localDate:row.local_date,revision:row.revision,status:row.status,
    netSales:amount(row.net_sales),paymentCash:amount(row.payment_cash),paymentQr:amount(row.payment_qr),paymentsTotal:amount(row.payments_total),
    salesVariance:amount(row.sales_payment_variance),drawerOutflow:amount(row.cash_drawer_outflow_amount),
    openingFloat:amount(row.cash_opening_float),countedClosing:amount(row.cash_counted_closing),
    // Deployment alone cannot enable financial confirmation before the atomic wrapper is installed and approved.
    readyToConfirm:reconcile.ready_to_confirm===true&&process.env.INTHANIN_DAILY_CLOSE_CARD_CONFIRM_ENABLED==='true'
      &&['draft','submitted'].includes(row.status)&&amount(row.sales_payment_variance)===0
      &&[row.net_sales,row.payment_cash,row.payment_qr,row.payments_total,row.cash_drawer_outflow_amount,row.cash_opening_float,row.cash_counted_closing].every(v=>amount(v)!==null),
    blockers:reconcile.blockers??[],warnings:reconcile.warnings??[],
    ...(reconcile.ready_to_confirm===true&&process.env.INTHANIN_DAILY_CLOSE_CARD_CONFIRM_ENABLED!=='true'
      ?{confirmationUnavailableReason:'ข้อมูลผ่านการตรวจแล้ว แต่ปุ่มยืนยันใน LINE ยังไม่เปิดใช้งาน กรุณายืนยันผ่านหลังบ้าน'}:{})};
  return {row,input,message:buildInthaninDailyCloseCard(input)};
}
export async function dailyCloseCardForReceipt(input:{targetHash:string|null;close:RecordedDailyClose|null;missingText?:string}):Promise<Record<string,unknown>|null>{
  if(!input.close){
    if(input.missingText
      &&(/ยังไม่บันทึกลง Daily Close|LINE message id หาย/u).test(input.missingText)&&await resolveInthaninScope(input.targetHash))return buildInthaninMissingCloseCard(input.missingText);
    return null;
  }
  if(input.close.environment!=='live')return null;
  const scope=await resolveInthaninScope(input.targetHash);
  if(!scope)return null;
  return (await loadCard(input.close.dailyCloseId,input.close.localDate,scope.branchId)).message;
}
export async function handleDailyCloseCardAction(input:{targetHash:string|null;userId:string|null|undefined;data:string;receivedAt?:number}):Promise<Array<Record<string,unknown>>|null>{
  if(!input.data.startsWith(INTHANIN_CLOSE_ACTION_PREFIX))return null;
  const text=(value:string)=>[{type:'text',text:value}];
  const action=decodeInthaninDailyCloseAction(input.data);
  if(!action)return text('การ์ดปิดยอดไม่ถูกต้อง กรุณาใช้การ์ดล่าสุดครับ');
  if(!isAuthorizedOwnerPaymentActor(input.userId))return text('การตรวจ/แก้ไขและยืนยันจากการ์ดนี้ให้คุณนุ๊กเจ้าของร้านเท่านั้นครับ พนักงานยังส่งรายงานและหลักฐานได้ตามเดิม');
  const receivedAt=input.receivedAt??Date.now();
  if(Date.now()-receivedAt>20000)return text('คำขอนี้ใช้เวลานาน กรุณากดตรวจอีกครั้งเพื่อรับการ์ดล่าสุดครับ ยังไม่ได้ยืนยันปิดวัน');
  const scope=await resolveInthaninScope(input.targetHash);
  if(!scope)return text('กรุณาใช้การ์ดในกลุ่มบัญชีอินทนิลที่ผูกไว้ครับ');
  let current=await loadCard(action.id,action.localDate,scope.branchId);
  if(action.action==='check')return [current.message];
  if(current.row.revision!==action.revision)return [...text('ข้อมูลเปลี่ยนหลังสร้างการ์ด กรุณาตรวจการ์ดล่าสุดก่อนครับ'),current.message];
  if(action.action==='edit')return [...text('ยอดวันที่ '+action.localDate+' · เปิดหลังบ้านเพื่อเติมหรือแก้เฉพาะช่องที่ขาด แล้วกดตรวจอีกครั้งครับ'),
    {type:'template',altText:'เปิดหลังบ้านตรวจยอด '+action.localDate,template:{type:'buttons',text:'Daily Close '+action.localDate,
      actions:[{type:'uri',label:'เปิดหลังบ้าน',uri:'https://tamma-backoffice.netlify.app/'}]}}];
  if(current.row.status==='confirmed')return [current.message];
  if(process.env.INTHANIN_DAILY_CLOSE_CARD_CONFIRM_ENABLED!=='true')return [...text('ปุ่มยืนยันใน LINE ยังไม่เปิดใช้งาน กรุณายืนยันผ่านหลังบ้านก่อนครับ'),current.message];
  if(!current.input.readyToConfirm||current.input.blockers.length)return [...text('ยังยืนยันไม่ได้ ต้องแก้รายการที่ขาดหรือยอดไม่ตรงก่อนครับ'),current.message];
  if(Date.now()-receivedAt>30000)return [...text('ยังไม่ได้ยืนยัน กรุณากดตรวจอีกครั้งก่อนยืนยัน เพื่อให้ตอบกลับด้วยโทเคนที่ยังใช้งานได้ครับ'),current.message];
  const result=await(await db('rpc/financial_confirm_inthanin_daily_close_card_v1',{method:'POST',body:JSON.stringify({
    p_daily_close_id:action.id,p_expected_local_date:action.localDate,p_expected_revision:action.revision,p_actor_hash:piiHash(input.userId),
  })})).json() as {confirmed?:boolean;reason?:string};
  current=await loadCard(action.id,action.localDate,scope.branchId);
  if(result.reason==='stale_revision')return [...text('ข้อมูลเปลี่ยนระหว่างตรวจ ยังไม่ได้ยืนยัน กรุณาตรวจการ์ดล่าสุดครับ'),current.message];
  return [...text(result.confirmed?'ยืนยันปิดยอดวันที่ '+action.localDate+' แล้วครับ':'ยังยืนยันไม่ได้ กรุณาดูรายการที่ต้องตรวจในการ์ดครับ'),current.message];
}
