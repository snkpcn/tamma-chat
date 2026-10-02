import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import { expenseCategory, looksLikeInthaninDailyCloseText, type InthaninExpenseCategory } from './_inthanin-daily-close-text';

type FollowupRow={
  id:string;
  evidence_id:string;
  daily_close_id:string;
  environment:'test'|'live';
  target_hash:string;
  amount:number|string;
  status:string;
  created_at:string;
};

type OpenFollowupResult={
  ok?:boolean;
  opened?:boolean;
  followup_id?:string|null;
  amount?:number|string|null;
  pending_count?:number|string|null;
  oldest_amount?:number|string|null;
  reason?:string|null;
};

type ResolveResult={
  ok?:boolean;
  duplicate?:boolean;
  resolved?:boolean;
  followup_id?:string;
  ledger_entry_id?:string;
  amount?:number|string;
  description?:string;
  category?:InthaninExpenseCategory;
};

function config():{url:string;key:string}{
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Financial database is not configured');
  return {url:url.replace(/\/$/,''),key};
}

async function dbFetch(path:string,init:RequestInit={}):Promise<Response>{
  const c=config();
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
    throw new Error('Transfer follow-up DB request failed '+response.status+': '+body.slice(0,220));
  }
  return response;
}

async function rpc<T>(name:string,payload:Record<string,unknown>):Promise<T>{
  const response=await dbFetch('rpc/'+name,{method:'POST',body:JSON.stringify(payload)});
  const raw=await response.json() as T|T[];
  return (Array.isArray(raw)?raw[0]:raw) as T;
}

function money(value:unknown):string{
  const n=Number(value);
  return (Number.isFinite(n)?n:0).toLocaleString('th-TH',{
    minimumFractionDigits:0,maximumFractionDigits:2,
  })+' บาท';
}

const CATEGORY_LABELS:Record<InthaninExpenseCategory,string>={
  ingredients:'วัตถุดิบ',
  beverages:'เครื่องดื่ม',
  packaging:'บรรจุภัณฑ์',
  consumables:'ของใช้สิ้นเปลือง',
  cleaning:'ทำความสะอาด',
  maintenance:'ซ่อมบำรุง',
  utilities:'ค่าสาธารณูปโภค',
  transport:'ขนส่ง/เดินทาง',
  staff:'ค่าใช้จ่ายพนักงาน',
  equipment:'อุปกรณ์',
  marketing:'การตลาด',
  fees:'ค่าธรรมเนียม',
  petty_cash:'เงินสดย่อย',
  other:'อื่น ๆ',
};

function isProtectedCommand(text:string):boolean{
  const value=text.trim();
  return looksLikeInthaninDailyCloseText(value)
    || /^(?:ตรวจ|เช็ก|เช็ค)\s*ปิดวัน(?:\s|$)/u.test(value)
    || /^ยืนยัน\s*ปิดวัน(?:\s|$)/u.test(value)
    || /^ผูกทีม\s+/u.test(value)
    || /^(?:ทีมอะไร|เช็กทีม|เช็คทีม|สถานะทีม)$/u.test(value)
    || /^ตาราง(?:วันนี้|พรุ่งนี้)$/u.test(value)
    || /^(?:สรุปค่า\s*AI|สรุปค่า\s*เอไอ|ai\s*cost)/iu.test(value);
}

function isPayrollPurpose(text:string):boolean{
  return /เงินเดือน|เบิกเงิน|ค่าแรง|ค่าจ้าง|payroll|salary/iu.test(text);
}

function cleanPurpose(text:string):string{
  return text
    .trim()
    .replace(/^สลิป(?:นี้)?\s*(?:คือ|เป็น|จ่าย)?\s*/u,'')
    .replace(/^จ่าย(?:ค่า)?\s*/u,'')
    .replace(/\s+/g,' ')
    .slice(0,240);
}

async function pendingFollowups(targetHash:string):Promise<FollowupRow[]>{
  const since=new Date(Date.now()-72*60*60*1000).toISOString();
  const response=await dbFetch(
    'financial_transfer_followups?target_hash=eq.'+encodeURIComponent(targetHash)
    +'&status=eq.awaiting_description'
    +'&created_at=gte.'+encodeURIComponent(since)
    +'&select=id,evidence_id,daily_close_id,environment,target_hash,amount,status,created_at'
    +'&order=created_at.asc&limit=20'
  );
  return await response.json() as FollowupRow[];
}

export async function openTransferPurposeFollowup(input:{
  targetId:string;
  evidenceId:string;
}):Promise<{reply:string|null;opened:boolean}>{
  const targetHash=piiHash(input.targetId);
  if(!targetHash)return {reply:null,opened:false};

  const result=await rpc<OpenFollowupResult>('financial_open_transfer_followup_v1',{
    p_evidence_id:input.evidenceId,
    p_target_hash:targetHash,
  });

  if(!result?.opened)return {reply:null,opened:false};

  const amount=money(result.amount);
  const pending=Number(result.pending_count||1);
  const oldestAmount=money(result.oldest_amount??result.amount);

  if(pending<=1){
    return {
      opened:true,
      reply:[
        '🏷️ สลิป '+amount+' นี้จ่ายค่าอะไรครับ?',
        'ตอบสั้น ๆ ได้เลย เช่น “ค่านมเมจิ”, “สั่งแก้ว”, “ค่าซ่อมเครื่อง”',
        'ทองไทยจะจัด Category และผูกสลิปให้เองครับ',
      ].join('\n'),
    };
  }

  return {
    opened:true,
    reply:[
      '🏷️ รับสลิป '+amount+' ไว้แล้วครับ ตอนนี้มี '+pending+' สลิปรอระบุรายการ',
      'ขอเคลียร์รายการแรกก่อน: สลิป '+oldestAmount+' จ่ายค่าอะไรครับ?',
      'ตอบสั้น ๆ ได้เลย เดี๋ยวทองไทยจัด Category ให้เองครับ',
    ].join('\n'),
  };
}

export async function handleTransferPurposeText(input:{
  targetId:string;
  userId?:string|null;
  text:string;
  messageId?:string|null;
}):Promise<string|null>{
  const team=await boundLineOpsTeam(input.targetId);
  if(team!=='cafe'&&team!=='cafe_test')return null;

  const targetHash=piiHash(input.targetId);
  if(!targetHash)return null;
  const pending=await pendingFollowups(targetHash);
  if(!pending.length)return null;

  const raw=input.text.trim();
  if(!raw||isProtectedCommand(raw))return null;

  if(isPayrollPurpose(raw)){
    return [
      '🔒 ถ้าเป็นเงินเดือน/เบิกเงินพนักงาน ให้ส่งและบันทึกในกลุ่ม Owner เท่านั้นครับ',
      'สลิปนี้ยังไม่ถูกลงเป็นค่าใช้จ่ายร้าน',
    ].join('\n');
  }

  if(!input.messageId){
    return 'สลิปยังรอระบุรายการอยู่ครับ แต่ LINE message id ของคำตอบหาย จึงยังไม่บันทึกเพื่อกันรายการซ้ำ';
  }

  const description=cleanPurpose(raw);
  if(!description||description.length<2)return 'สลิปนี้จ่ายค่าอะไรครับ? บอกชื่อรายการสั้น ๆ ได้เลย เช่น “ค่านมเมจิ”';

  const category=expenseCategory(description);
  const current=pending[0];

  const result=await rpc<ResolveResult>('financial_resolve_transfer_followup_v1',{
    p_followup_id:current.id,
    p_description:description,
    p_category:category,
    p_user_hash:piiHash(input.userId)??'',
    p_message_id:input.messageId,
  });

  const remaining=(await pendingFollowups(targetHash)).filter(row=>row.id!==current.id);
  const lines=[
    '✅ ลงรายการและผูกสลิปแล้วครับ',
    'รายการ: '+description,
    'ยอด: '+money(result.amount??current.amount),
    'Category: '+CATEGORY_LABELS[category]+' ('+category+')',
    'ช่องทางจ่าย: เจ้าของโอน',
    'ไม่ลงซ้ำจากสลิปเดิมครับ',
  ];

  if(remaining.length){
    lines.push('');
    lines.push('ยังเหลือ '+remaining.length+' สลิปรอระบุครับ');
    lines.push('สลิป '+money(remaining[0].amount)+' จ่ายค่าอะไรครับ?');
  }

  return lines.join('\n');
}
