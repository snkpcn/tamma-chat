import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import { parseInthaninDate } from './_inthanin-daily-close-text';

type ReconcileResult = {
  ok?: boolean;
  ready?: boolean;
  ready_to_confirm?: boolean;
  confirmed?: boolean;
  already_confirmed?: boolean;
  daily_close_id?: string;
  local_date?: string;
  status?: string;
  net_sales?: number | string;
  payments_total?: number | string;
  sales_payment_variance?: number | string;
  pos_net_sales?: number | string | null;
  cash_expected_closing?: number | string | null;
  cash_counted_closing?: number | string | null;
  cash_drawer_variance?: number | string | null;
  claim_outstanding_amount?: number | string | null;
  blockers?: Array<{ code?: string; message?: string; amount?: number | string; count?: number }>;
  warnings?: Array<{ code?: string; message?: string; amount?: number | string; count?: number }>;
};

function dbConfig(): { url:string; key:string } {
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key) throw new Error('Financial database is not configured');
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
    const body=await response.text().catch(()=> '');
    throw new Error('Financial close command DB request failed '+response.status+': '+body.slice(0,260));
  }
  return response;
}

function bangkokToday(timestamp?:number):string{
  return new Intl.DateTimeFormat('en-CA',{
    timeZone:'Asia/Bangkok',
    year:'numeric',month:'2-digit',day:'2-digit',
  }).format(new Date(Number.isFinite(timestamp)?timestamp:Date.now()));
}

function money(value:unknown):string{
  const numeric=Number(value);
  return (Number.isFinite(numeric)?numeric:0).toLocaleString('th-TH',{
    minimumFractionDigits:0,maximumFractionDigits:2,
  })+' บาท';
}

function commandKind(text:string):'check'|'confirm'|null{
  const normalized=text.trim().replace(/\s+/g,' ');
  if(/^(?:ตรวจ|เช็ก|เช็ค)\s*ปิดวัน(?:\s|$)/u.test(normalized)) return 'check';
  if(/^ยืนยัน\s*ปิดวัน(?:\s|$)/u.test(normalized)) return 'confirm';
  return null;
}

export function parseDailyCloseCommand(text:string,timestamp?:number):{
  kind:'check'|'confirm';
  localDate:string;
}|null{
  const kind=commandKind(text);
  if(!kind)return null;
  const parsed=parseInthaninDate(text);
  return {kind,localDate:parsed??bangkokToday(timestamp)};
}

async function dailyCloseId(localDate:string,environment:'test'|'live'):Promise<string|null>{
  const branchResponse=await dbFetch(
    'operations_business_branches?code=eq.inthanin_tadtone&active=eq.true&select=id&limit=1'
  );
  const branch=(await branchResponse.json() as Array<{id:string}>)[0];
  if(!branch?.id)return null;

  const closeResponse=await dbFetch(
    'financial_daily_closes?branch_id=eq.'+encodeURIComponent(branch.id)
    +'&local_date=eq.'+encodeURIComponent(localDate)
    +'&environment=eq.'+environment+'&select=id&limit=1'
  );
  return (await closeResponse.json() as Array<{id:string}>)[0]?.id??null;
}

async function callRpc(name:string,payload:Record<string,unknown>):Promise<ReconcileResult>{
  const response=await dbFetch('rpc/'+name,{
    method:'POST',
    body:JSON.stringify(payload),
  });
  const raw=await response.json() as ReconcileResult|ReconcileResult[];
  return Array.isArray(raw)?raw[0]??{}:raw;
}

function bulletItems(items:ReconcileResult['blockers']):string[]{
  return (items??[]).map(item=>{
    const suffix=item.amount!==undefined&&item.amount!==null
      ? ' · '+money(item.amount)
      : item.count!==undefined
        ? ' · '+item.count+' รายการ'
        : '';
    return '• '+(item.message||item.code||'ต้องตรวจเพิ่มเติม')+suffix;
  });
}

function reconcileText(result:ReconcileResult,localDate:string,environment:'test'|'live'):string{
  const prefix=environment==='test'?'🧪 Café TEST':'🔒 Owner · Inthanin LIVE';
  const ready=Boolean(result.ready_to_confirm??result.ready);
  const blockers=bulletItems(result.blockers);
  const warnings=bulletItems(result.warnings);
  const lines=[
    prefix+' — ตรวจปิดวัน '+localDate,
    '',
    'ยอดขายสุทธิ: '+money(result.net_sales),
    'รับเงินรวม: '+money(result.payments_total),
    'ส่วนต่างรับเงิน: '+money(result.sales_payment_variance),
    result.pos_net_sales!==null&&result.pos_net_sales!==undefined
      ? 'ยอดจากรูป POS: '+money(result.pos_net_sales)
      : 'ยอดจากรูป POS: ยังไม่มี/อ่านไม่ได้',
    result.cash_expected_closing!==null&&result.cash_expected_closing!==undefined
      ? 'เงินสดที่ควรเหลือ: '+money(result.cash_expected_closing)
      : '',
    result.cash_counted_closing!==null&&result.cash_counted_closing!==undefined
      ? 'เงินสดนับจริง: '+money(result.cash_counted_closing)
      : '',
    result.cash_drawer_variance!==null&&result.cash_drawer_variance!==undefined
      ? 'ส่วนต่างเงินสด: '+money(result.cash_drawer_variance)
      : '',
    '',
    ready?'✅ พร้อมยืนยันปิดวันครับ':'⛔ ยังยืนยันปิดวันไม่ได้ครับ',
    blockers.length?'สิ่งที่ต้องแก้ก่อน:\n'+blockers.join('\n'):'',
    warnings.length?'หมายเหตุ:\n'+warnings.join('\n'):'',
  ].filter(Boolean);
  return lines.join('\n');
}

export async function handleCafeTestDailyCloseConfirmText(input:{
  targetId:string;
  userId?:string|null;
  text:string;
  timestamp?:number;
}):Promise<string|null>{
  const command=parseDailyCloseCommand(input.text,input.timestamp);
  if(!command)return null;

  const team=await boundLineOpsTeam(input.targetId);
  if(team!=='cafe_test'&&team!=='cafe'&&team!=='owner_general')return null;
  const environment:'test'|'live'=team==='cafe_test'?'test':'live';
  const prefix=environment==='test'?'🧪 Café TEST':'🔒 Owner · Inthanin LIVE';

  if(team==='cafe'&&command.kind==='confirm'){
    return '🔒 กลุ่ม Inthanin พนักงานใช้ตรวจยอดได้ครับ แต่การยืนยันปิดวัน LIVE ให้ทำในกลุ่ม Owner หรือ Backoffice เท่านั้นครับ';
  }

  const closeId=await dailyCloseId(command.localDate,environment);
  if(!closeId){
    return [
      prefix+' — ยังไม่มี Daily Close '+command.localDate+' ครับ',
      environment==='live'
        ?'ให้พนักงานส่งฟอร์มปิดยอดในกลุ่ม Inthanin ก่อนครับ'
        :'ส่งฟอร์มปิดยอดของวันนั้นก่อน แล้วค่อยพิมพ์ “ตรวจปิดวัน” หรือ “ยืนยันปิดวัน” ครับ',
    ].join('\n');
  }

  if(command.kind==='check'){
    const result=await callRpc('financial_reconcile_daily_close_v1',{
      p_daily_close_id:closeId,
    });
    return reconcileText(result,command.localDate,environment);
  }

  const confirmRpc=environment==='live'
    ?'financial_confirm_inthanin_live_daily_close_v1'
    :'financial_confirm_cafe_test_daily_close_v1';
  const result=await callRpc(confirmRpc,{
    p_daily_close_id:closeId,
    p_actor_hash:piiHash(input.userId)??'',
    p_source:'line',
  });

  if(result.confirmed){
    return [
      prefix+' — ✅ ยืนยันปิดวัน '+command.localDate+' แล้วครับ',
      'Daily Close ถูกล็อกแล้ว แก้ยอดตรง ๆ ไม่ได้',
      result.already_confirmed?'รายการนี้ยืนยันไว้ก่อนแล้วครับ':'หากพบตัวเลขผิดภายหลัง ต้องแก้ผ่าน Adjustment พร้อมเหตุผลครับ',
    ].join('\n');
  }

  return reconcileText(result,command.localDate,environment);
}
