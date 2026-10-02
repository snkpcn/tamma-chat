import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import { parseInthaninDate } from './_inthanin-daily-close-text';

type ValidationResult = {
  ok?: boolean;
  ready?: boolean;
  confirmed?: boolean;
  already_confirmed?: boolean;
  daily_close_id?: string;
  local_date?: string;
  net_sales?: number | string;
  payments_total?: number | string;
  sales_payment_variance?: number | string;
  cash_expected_closing?: number | string | null;
  cash_counted_closing?: number | string | null;
  cash_variance?: number | string | null;
  blockers?: Array<{code?:string;message?:string;[key:string]:unknown}>;
  warnings?: Array<{code?:string;message?:string;[key:string]:unknown}>;
};

function config(): { url:string; key:string } {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error('Financial database is not configured');
  return{url:url.replace(/\/$/,''),key};
}

async function dbFetch(path:string,init:RequestInit={}):Promise<Response>{
  const c=config();
  const r=await fetch(c.url+'/rest/v1/'+path,{
    ...init,
    headers:{
      apikey:c.key,
      Authorization:'Bearer '+c.key,
      'Content-Type':'application/json',
      ...(init.headers??{}),
    },
  });
  if(!r.ok){
    const body=await r.text().catch(()=> '');
    throw new Error('Financial confirmation DB request failed '+r.status+': '+body.slice(0,260));
  }
  return r;
}

function localDateBangkok(timestamp?:number):string{
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date(Number.isFinite(timestamp)?timestamp:Date.now()));
}

function baht(value:unknown):string{
  const n=Number(value);
  return (Number.isFinite(n)?n:0).toLocaleString('th-TH',{
    minimumFractionDigits:0,maximumFractionDigits:2,
  })+' บาท';
}

export function parseDailyCloseConfirmCommand(text:string,timestamp?:number):
  {kind:'validate'|'confirm';localDate:string}|null {
  const normalized=text.trim();
  const match=normalized.match(/^(ตรวจปิดวัน|เช็กปิดวัน|เช็คปิดวัน|ยืนยันปิดวัน|ยืนยันปิดยอด)(?:\s+(.+))?$/u);
  if(!match)return null;
  const kind=/^ยืนยัน/u.test(match[1])?'confirm':'validate';
  const supplied=match[2]?.trim()||'';
  const localDate=supplied?parseInthaninDate(supplied):localDateBangkok(timestamp);
  if(!localDate)return null;
  return{kind,localDate};
}

async function dailyCloseId(localDate:string):Promise<string|null>{
  const branchResponse=await dbFetch(
    'operations_business_branches?code=eq.inthanin_tadtone&active=eq.true&select=id&limit=1'
  );
  const branch=(await branchResponse.json() as Array<{id:string}>)[0];
  if(!branch?.id)return null;
  const closeResponse=await dbFetch(
    'financial_daily_closes?branch_id=eq.'+branch.id
    +'&local_date=eq.'+encodeURIComponent(localDate)
    +'&environment=eq.test&select=id,status&limit=1'
  );
  return (await closeResponse.json() as Array<{id:string}>)[0]?.id??null;
}

async function rpc(name:string,body:Record<string,unknown>):Promise<ValidationResult>{
  const r=await dbFetch('rpc/'+name,{method:'POST',body:JSON.stringify(body)});
  const raw=await r.json() as ValidationResult|ValidationResult[];
  return Array.isArray(raw)?raw[0]??{}:raw;
}

function blockerText(result:ValidationResult):string{
  const blockers=Array.isArray(result.blockers)?result.blockers:[];
  const warnings=Array.isArray(result.warnings)?result.warnings:[];
  const lines=[
    '🧪 Café TEST — ยังยืนยันปิดวันไม่ได้ครับ',
    result.local_date?'วันที่: '+result.local_date:'',
    '',
    ...blockers.map(item=>'❌ '+String(item.message||item.code||'ต้องตรวจ')),
  ];
  if(warnings.length){
    lines.push('', 'คำเตือนที่ไม่บล็อกการปิดวัน:');
    lines.push(...warnings.map(item=>'• '+String(item.message||item.code||'คำเตือน')));
  }
  lines.push('', 'แก้ข้อมูล/ส่งหลักฐานให้ครบ แล้วพิมพ์ “ตรวจปิดวัน” อีกครั้งครับ');
  return lines.filter(Boolean).join('\n');
}

function readyText(result:ValidationResult):string{
  const warnings=Array.isArray(result.warnings)?result.warnings:[];
  const lines=[
    '🧪 Café TEST — Daily Close พร้อมยืนยันแล้วครับ ✅',
    result.local_date?'วันที่: '+result.local_date:'',
    'Net Sales: '+baht(result.net_sales),
    'Payments: '+baht(result.payments_total),
    'Variance: '+baht(result.sales_payment_variance),
    result.cash_expected_closing!=null?'เงินสดที่ควรเหลือ: '+baht(result.cash_expected_closing):'',
    result.cash_counted_closing!=null?'เงินสดนับจริง: '+baht(result.cash_counted_closing):'',
  ];
  if(warnings.length){
    lines.push('', 'คำเตือน:');
    lines.push(...warnings.map(item=>'• '+String(item.message||item.code||'คำเตือน')));
  }
  lines.push('', 'ถ้าถูกต้อง พิมพ์ “ยืนยันปิดวัน” ครับ');
  return lines.filter(Boolean).join('\n');
}

function confirmedText(result:ValidationResult):string{
  return [
    '🧪 Café TEST — ยืนยันปิดวันเรียบร้อยแล้วครับ 🔒',
    result.local_date?'วันที่: '+result.local_date:'',
    'Net Sales: '+baht(result.net_sales),
    'Payments: '+baht(result.payments_total),
    'สถานะ: CONFIRMED / LOCKED',
    '',
    'หลังจากนี้ห้ามแก้ยอดเดิมตรง ๆ ถ้าพบผิดต้องลง Adjustment พร้อมเหตุผลครับ',
  ].filter(Boolean).join('\n');
}

export async function handleCafeTestDailyCloseConfirmText(input:{
  targetId:string;
  userId?:string|null;
  text:string;
  timestamp?:number;
}):Promise<string|null>{
  const command=parseDailyCloseConfirmCommand(input.text,input.timestamp);
  if(!command)return null;

  const team=await boundLineOpsTeam(input.targetId);
  if(team!=='cafe_test')return null;

  const id=await dailyCloseId(command.localDate);
  if(!id){
    return [
      '🧪 Café TEST — ยังไม่มี Daily Close TEST ของวันที่ '+command.localDate+' ครับ',
      'ส่งฟอร์มปิดยอดของวันนั้นก่อน แล้วค่อยตรวจ/ยืนยันครับ',
    ].join('\n');
  }

  if(command.kind==='validate'){
    const result=await rpc('financial_validate_cafe_test_daily_close_v1',{
      p_daily_close_id:id,
    });
    return result.ready?readyText(result):blockerText(result);
  }

  const result=await rpc('financial_confirm_cafe_test_daily_close_v1',{
    p_daily_close_id:id,
    p_actor_hash:piiHash(input.userId)??'',
    p_source:'line',
  });

  if(result.confirmed)return confirmedText(result);
  return blockerText(result);
}
