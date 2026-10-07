import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import {
  extractFinancialEvidence,
  extensionForMime,
  fetchLineImage,
  type FinancialImageExtraction,
} from './_inthanin-daily-close-image';

type PayrollEventType='salary_advance'|'salary_payment'|'advance_deduction';

type PayrollEvent={
  id:string;
  event_type:PayrollEventType;
  employee_label:string;
  employee_key:string;
  amount:number|string;
  event_date:string;
  pay_period:string|null;
  status:string;
  owner_group_hash:string;
  created_by_hash:string|null;
  created_at:string;
};

type PayrollResult={
  ok?:boolean;
  duplicate?:boolean;
  event_id?:string;
  event_type?:PayrollEventType;
  employee_label?:string;
  amount?:number|string;
  slip_amount?:number|string|null;
  status?:string;
  match?:boolean;
  review_reason?:string|null;
};

const BUCKET='owner-payroll-evidence';
const MAX_IMAGE_BYTES=10*1024*1024;

function dbConfig():{url:string;key:string}{
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Payroll database is not configured');
  return {url:url.replace(/\/$/,''),key};
}

async function dbFetch(path:string,init:RequestInit={}):Promise<Response>{
  const c=dbConfig();
  const response=await fetch(c.url+'/rest/v1/'+path,{
    ...init,
    headers:{
      apikey:c.key,
      Authorization:'Bearer '+c.key,
      'Content-Type':'application/json',
      ...(init.headers??{}),
    },
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error('Owner payroll DB request failed '+response.status+': '+body.slice(0,240));
  }
  return response;
}

async function rpc(name:string,payload:Record<string,unknown>):Promise<PayrollResult>{
  const response=await dbFetch('rpc/'+name,{method:'POST',body:JSON.stringify(payload)});
  const raw=await response.json() as PayrollResult|PayrollResult[];
  return Array.isArray(raw)?raw[0]??{}:raw;
}

function bangkokDate(timestamp?:number):string{
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date(Number.isFinite(timestamp)?timestamp:Date.now()));
}

function money(value:unknown):string{
  const n=Number(value);
  return (Number.isFinite(n)?n:0).toLocaleString('th-TH',{
    minimumFractionDigits:0,maximumFractionDigits:2,
  })+' บาท';
}

function employeeKey(label:string):string{
  return label.trim().replace(/\s+/g,' ').toLowerCase();
}

function parseAmount(value:string):number|null{
  const n=Number(value.replace(/,/g,''));
  return Number.isFinite(n)&&n>0?Math.round(n*100)/100:null;
}

export function parseOwnerPayrollCommand(text:string):{
  eventType:PayrollEventType;
  employeeLabel:string;
  amount:number;
  payPeriod:string|null;
}|null{
  const value=text.trim().replace(/\s+/g,' ');
  const patterns:Array<[PayrollEventType,RegExp,boolean?]>=[
    ['salary_advance',/^(?:เบิกเงินเดือน(?:ล่วงหน้า)?|เบิกเงินล่วงหน้า|เงินเดือนล่วงหน้า)\s*(.+?)\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?(?:\s+เดือน\s+(.+))?$/u],
    ['salary_advance',/^([\p{L}\p{M}]{2,40})\s*เบิกเงินเดือน(?:ล่วงหน้า)?\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?(?:\s+เดือน\s+(.+))?$/u,true],
    ['salary_payment',/^(?:จ่ายเงินเดือน|โอนเงินเดือน)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?(?:\s+เดือน\s+(.+))?$/u],
    ['advance_deduction',/^(?:หักเบิก|หักเงินเบิก|หักเงินเดือนล่วงหน้า)\s+(.+?)\s+([\d,]+(?:\.\d+)?)\s*(?:บาท)?(?:\s+เดือน\s+(.+))?$/u],
  ];
  for(const [eventType,pattern,employeeFirst] of patterns){
    const match=value.match(pattern);
    if(!match)continue;
    const amount=parseAmount(match[2]);
    const employeeLabel=match[1]?.trim().slice(0,120)??'';
    if(!amount||!employeeLabel)return null;
    if(employeeFirst&&(/^(?:แม่|คุณแม่|ผม|กู|พ่อ)$/u.test(employeeLabel)
      ||/(?:บอกว่า|ถามว่า|ยังไม่|จะ)/u.test(employeeLabel)))continue;
    return {
      eventType,
      employeeLabel,
      amount,
      payPeriod:match[3]?.trim().slice(0,80)||null,
    };
  }
  return null;
}

function eventLabel(type:PayrollEventType):string{
  if(type==='salary_advance')return 'เบิกเงินเดือนล่วงหน้า';
  if(type==='salary_payment')return 'จ่ายเงินเดือน';
  return 'หักยอดเบิกล่วงหน้าจากเงินเดือน';
}

async function advanceOutstanding(label:string):Promise<number>{
  const response=await dbFetch(
    'financial_employee_advance_owner_v1?employee_key=eq.'
    +encodeURIComponent(employeeKey(label))
    +'&select=advance_outstanding&limit=1'
  );
  const row=(await response.json() as Array<{advance_outstanding:number|string}>)[0];
  return Number(row?.advance_outstanding||0);
}

async function pendingPayrollEvent(groupHash:string):Promise<PayrollEvent|null>{
  const response=await dbFetch(
    'financial_employee_payroll_events?owner_group_hash=eq.'+encodeURIComponent(groupHash)
    +'&status=in.(awaiting_slip,needs_review)'
    +'&event_type=in.(salary_advance,salary_payment)'
    +'&select=id,event_type,employee_label,employee_key,amount,event_date,pay_period,status,owner_group_hash,created_by_hash,created_at'
    +'&order=created_at.desc&limit=2'
  );
  const rows=await response.json() as PayrollEvent[];
  if(rows.length>1)throw new Error('multiple_owner_payroll_events_pending');
  return rows[0]??null;
}

function encodedObjectPath(path:string):string{
  return path.split('/').map(part=>encodeURIComponent(part)).join('/');
}

async function uploadEvidence(bytes:Buffer,mimeType:string,path:string):Promise<void>{
  if(bytes.length<=0||bytes.length>MAX_IMAGE_BYTES)throw new Error('payroll_evidence_image_size_invalid');
  const c=dbConfig();
  const response=await fetch(c.url+'/storage/v1/object/'+BUCKET+'/'+encodedObjectPath(path),{
    method:'POST',
    headers:{
      apikey:c.key,
      Authorization:'Bearer '+c.key,
      'Content-Type':mimeType,
      'x-upsert':'false',
    },
    body:bytes,
  });
  if(!response.ok){
    const body=await response.text().catch(()=>'');
    throw new Error('payroll_evidence_upload_'+response.status+':'+body.slice(0,160));
  }
}

async function deleteEvidence(path:string):Promise<void>{
  const c=dbConfig();
  await fetch(c.url+'/storage/v1/object/'+BUCKET+'/'+encodedObjectPath(path),{
    method:'DELETE',
    headers:{apikey:c.key,Authorization:'Bearer '+c.key},
  }).catch(()=>undefined);
}

export async function handleOwnerPayrollText(input:{
  targetId:string;
  userId?:string|null;
  text:string;
  messageId?:string|null;
  timestamp?:number;
}):Promise<string|null>{
  const command=parseOwnerPayrollCommand(input.text);
  const summaryCommand=/^(?:สรุปเบิกเงินเดือน|ยอดเบิกเงินเดือน)$/u.test(input.text.trim());
  if(!command&&!summaryCommand)return null;

  const team=await boundLineOpsTeam(input.targetId);
  if(team!=='owner_general'){
    return '🔒 คำสั่งการเงินพนักงานใช้เฉพาะกลุ่ม Owner ครับ';
  }

  if(summaryCommand){
    const response=await dbFetch(
      'financial_employee_advance_owner_v1?advance_outstanding=gt.0'
      +'&select=employee_label,advance_outstanding&order=employee_label.asc'
    );
    const rows=await response.json() as Array<{employee_label:string;advance_outstanding:number|string}>;
    return rows.length
      ?'🔒 Owner Payroll — ยอดเบิกเงินเดือนล่วงหน้าที่ยังค้างหัก\n'
        +rows.map(row=>'• '+row.employee_label+' · '+money(row.advance_outstanding)).join('\n')
      :'🔒 Owner Payroll — ตอนนี้ไม่มียอดเบิกเงินเดือนล่วงหน้าค้างหักครับ';
  }

  if(!input.messageId){
    return '🔒 Owner Payroll — LINE message id หาย จึงยังไม่บันทึกเพื่อกันรายการซ้ำครับ';
  }

  const groupHash=piiHash(input.targetId);
  if(!groupHash)throw new Error('owner_group_hash_unavailable');

  let result:PayrollResult;
  try{
    result=await rpc('financial_create_owner_payroll_event_v1',{
      p_event_type:command!.eventType,
      p_employee_label:command!.employeeLabel,
      p_amount:command!.amount,
      p_event_date:bangkokDate(input.timestamp),
      p_pay_period:command!.payPeriod,
      p_group_hash:groupHash,
      p_user_hash:piiHash(input.userId)??'',
      p_message_id:input.messageId,
    });
  }catch(error){
    if(error instanceof Error&&error.message.includes('payroll_slip_pending')){
      const pending=await pendingPayrollEvent(groupHash);
      if(pending?.event_type===command!.eventType
        && pending.employee_key===employeeKey(command!.employeeLabel)
        && Number(pending.amount)===command!.amount){
        return '🔒 Owner Payroll — รายการ '+command!.employeeLabel+' '+money(command!.amount)
          +' รอสลิปอยู่แล้วครับ ไม่เพิ่มยอดซ้ำ';
      }
      return '🔒 Owner Payroll — ยังมีรายการก่อนหน้ารอสลิปอยู่ครับ ส่งสลิปของรายการนั้นก่อน แล้วค่อยบันทึกรายการใหม่';
    }
    throw error;
  }

  if(command!.eventType==='advance_deduction'){
    const outstanding=await advanceOutstanding(command!.employeeLabel);
    return [
      '🔒 Owner Payroll — บันทึกหักยอดเบิกล่วงหน้าแล้วครับ',
      'พนักงาน: '+command!.employeeLabel,
      'หักจากเงินเดือน: '+money(command!.amount),
      'ยอดเบิกล่วงหน้าคงเหลือ: '+money(outstanding),
      'ข้อมูลนี้ไม่ส่งไปกลุ่มพนักงานครับ',
    ].join('\n');
  }

  return [
    '🔒 Owner Payroll — รับรายการ '+eventLabel(command!.eventType)+' แล้วครับ',
    'พนักงาน: '+command!.employeeLabel,
    'ยอด: '+money(command!.amount),
    command!.payPeriod?'รอบเงินเดือน: '+command!.payPeriod:'',
    '',
    'ส่งรูปสลิปโอนในกลุ่ม Owner นี้ต่อได้เลยครับ',
    command!.eventType==='salary_advance'
      ?'รายการนี้เป็นเงินเดือนล่วงหน้า ไม่ลงเป็นค่าใช้จ่ายร้าน ณ วันที่โอนครับ'
      :'รายการเงินเดือนถูกเก็บใน Payroll ส่วนตัวของ Owner ไม่แสดงในกลุ่มพนักงานครับ',
  ].filter(Boolean).join('\n');
}

export async function handleOwnerPayrollImage(input:{
  targetId:string;
  userId?:string|null;
  messageId:string;
  timestamp?:number;
}):Promise<string|null>{
  const team=await boundLineOpsTeam(input.targetId);
  if(team!=='owner_general')return null;

  const groupHash=piiHash(input.targetId);
  if(!groupHash)return null;
  const pending=await pendingPayrollEvent(groupHash);
  if(!pending)return null;

  const image=await fetchLineImage(input.messageId);
  let extraction:FinancialImageExtraction;
  try{
    extraction=await extractFinancialEvidence(image.bytes,image.mimeType);
  }catch{
    extraction={
      document_type:'other',
      amount_total:null,
      document_date_local:null,
      merchant:null,
      reference_number:null,
      bank:null,
      expense_category:null,
      pos_net_sales:null,
      pos_cash:null,
      pos_qr:null,
      pos_card:null,
      pos_other:null,
      confidence:0,
      note:'Payroll slip extraction unavailable; owner review required',
      extraction_model:'none',
    };
  }

  const date=bangkokDate(input.timestamp);
  const path=[
    'owner-only',date,pending.id,
    image.sha256.slice(0,20)+'-'+input.messageId.replace(/[^A-Za-z0-9_-]/g,'').slice(0,60)+'.'+extensionForMime(image.mimeType),
  ].join('/');

  await uploadEvidence(image.bytes,image.mimeType,path);
  let result:PayrollResult;
  try{
    result=await rpc('financial_attach_owner_payroll_slip_v1',{
      p_event_id:pending.id,
      p_slip_message_id:input.messageId,
      p_slip_sha256:image.sha256,
      p_storage_bucket:BUCKET,
      p_storage_path:path,
      p_mime_type:image.mimeType,
      p_document_type:extraction.document_type,
      p_slip_amount:extraction.amount_total,
      p_confidence:extraction.confidence,
      p_extracted_data:extraction,
    });
  }catch(error){
    await deleteEvidence(path);
    throw error;
  }

  if(result.status==='paid'){
    const outstanding=pending.event_type==='salary_advance'
      ?await advanceOutstanding(pending.employee_label)
      :null;
    return [
      '🔒 Owner Payroll — ✅ จับคู่สลิปสำเร็จครับ',
      eventLabel(pending.event_type)+' · '+pending.employee_label,
      'ยอด: '+money(pending.amount),
      outstanding!==null?'ยอดเบิกล่วงหน้าค้างหักของ '+pending.employee_label+': '+money(outstanding):'',
      pending.event_type==='salary_advance'
        ?'ไม่ลงเป็นค่าใช้จ่ายร้าน และรอหักจากเงินเดือนภายหลังครับ'
        :'เก็บเป็นรายการ Payroll ฝั่ง Owner เท่านั้นครับ',
    ].filter(Boolean).join('\n');
  }

  return [
    '🔒 Owner Payroll — ⚠️ เก็บสลิปไว้แล้ว แต่ยังไม่ยืนยันรายการอัตโนมัติครับ',
    'พนักงาน: '+pending.employee_label,
    'ยอดที่รอ: '+money(pending.amount),
    extraction.amount_total!==null?'ยอดที่อ่านจากสลิป: '+money(extraction.amount_total):'ยอดจากสลิป: อ่านไม่ชัด',
    'เหตุผล: '+(result.review_reason||'ต้องตรวจ'),
    'ส่งสลิปที่ถูกต้องใหม่ได้ หรือให้ตรวจใน Owner Payroll ครับ',
  ].join('\n');
}
