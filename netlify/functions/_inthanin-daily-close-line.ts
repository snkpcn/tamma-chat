import { createHash } from 'node:crypto';
import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import {
  looksLikeInthaninDailyCloseText,
  parseInthaninDailyCloseText,
  type ParsedInthaninDailyClose,
} from './_inthanin-daily-close-text';

type RematchResult = {
  ok?: boolean;
  matched_count?: number;
  ambiguous_count?: number;
};

type IngestResult = {
  ok?: boolean;
  duplicate?: boolean;
  daily_close_id?: string;
  local_date?: string;
  gross_sales?: number | string;
  discounts?: number | string;
  refunds?: number | string;
  net_sales?: number | string;
  payments_total?: number | string;
  sales_payment_variance?: number | string;
  payment_cash?: number | string;
  payment_qr?: number | string;
  payment_card?: number | string;
  payment_other?: number | string;
  purchase_cash_outflow?: number | string;
  expense_cash_outflow?: number | string;
  cup_count?: number | string | null;
  bill_count?: number | string | null;
  cash_opening_float?: number | string | null;
  cash_counted_closing?: number | string | null;
  status?: string;
  revision?: number;
};

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Financial database is not configured');
  return { url:url.replace(/\/$/,''), key };
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
    const body=await response.text().catch(()=> '');
    throw new Error('Financial intake DB request failed '+response.status+': '+body.slice(0,260));
  }
  return response;
}

function n(value:unknown):number{
  const numeric=Number(value);
  return Number.isFinite(numeric)?numeric:0;
}

function baht(value:unknown):string{
  return n(value).toLocaleString('th-TH',{minimumFractionDigits:0,maximumFractionDigits:2})+' บาท';
}

function thaiDate(value:string):string{
  try{
    return new Intl.DateTimeFormat('th-TH',{
      timeZone:'Asia/Bangkok',
      day:'numeric',month:'short',year:'numeric',
    }).format(new Date(value+'T12:00:00+07:00'));
  }catch{
    return value;
  }
}

function benefitSummary(parsed:ParsedInthaninDailyClose):string{
  const labels:Record<string,string>={
    kbank_free_drink:'KBank Free Drink',
    ais_25:'AIS 25',
    ais_65:'AIS 65',
    bangchak_points:'แต้มบางจาก',
    bcp_member_discount:'BCP Member',
    other:'สิทธิอื่น',
  };
  const used=Object.entries(parsed.benefits)
    .filter(([,value])=>value.count>0||value.amount>0)
    .map(([key,value])=>{
      const details=[
        value.count>0?value.count+' ครั้ง':'',
        value.amount>0?baht(value.amount):'',
      ].filter(Boolean).join(' / ');
      return (labels[key]??key)+' '+details;
    });
  return used.length?used.join(', '):'ไม่มี';
}

function optionalWarningLines(parsed:ParsedInthaninDailyClose):string[]{
  const out:string[]=[];
  if(parsed.billCount===null)out.push('• ยังไม่ได้ใส่จำนวนบิล');
  if(parsed.cashOpeningFloat===null)out.push('• ยังไม่ได้ใส่เงินสดตั้งต้น');
  if(parsed.cashCountedClosing===null)out.push('• ยังไม่ได้ใส่เงินสดนับจริงปลายวัน');
  if(parsed.expenses.some(exp=>exp.funding==='unknown'))out.push('• มีค่าใช้จ่ายที่ยังไม่รู้ว่าใคร/ช่องทางไหนเป็นคนจ่าย');
  if(parsed.warnings.includes('cash_deduction_does_not_match_itemized_cash_expenses')){
    out.push('• ตัวเลขหักจากเงินสดไม่ตรงกับรายการค่าใช้จ่ายที่แจกแจง');
  }
  return out;
}

function payloadFromParsed(parsed:ParsedInthaninDailyClose,text:string):Record<string,unknown>{
  return {
    gross_sales:parsed.grossSales??0,
    reported_pos_net_sales:parsed.reportedPosNetSales??0,
    discounts:parsed.discounts,
    refunds:parsed.refunds,
    payment_cash:parsed.paymentCash,
    payment_qr:parsed.paymentQr,
    payment_card:parsed.paymentCard,
    payment_delivery:parsed.paymentDelivery,
    payment_other:parsed.paymentOther,
    cup_count:parsed.cupCount===null?'':parsed.cupCount,
    bill_count:parsed.billCount===null?'':parsed.billCount,
    cash_opening_float:parsed.cashOpeningFloat===null?'':parsed.cashOpeningFloat,
    cash_counted_closing:parsed.cashCountedClosing===null?'':parsed.cashCountedClosing,
    notes:parsed.notes??'',
    payment_components:{
      cash:parsed.paymentCash,
      kbank_qr_kplus:parsed.paymentQrKplus,
      qr_manual:parsed.paymentQrManual,
      krungsri:parsed.paymentKrungsri,
      other_named:parsed.paymentOtherNamed,
      card:parsed.paymentCard,
      delivery:parsed.paymentDelivery,
    },
    benefits:parsed.benefits,
    expenses:parsed.expenses,
    warnings:parsed.warnings,
    raw_text_sha256:createHash('sha256').update(text,'utf8').digest('hex'),
  };
}

function environmentLabel(environment:'test'|'live'):string{
  return environment==='test'?'🧪 Café TEST':'🏪 Inthanin LIVE';
}

function missingReply(parsed:ParsedInthaninDailyClose,environment:'test'|'live'):string{
  const labels:Record<string,string>={
    date:'วันที่',
    reported_pos_net_sales:'ยอดขายตาม POS',
  };
  return [
    environmentLabel(environment)+' — ทองไทยอ่านฟอร์มปิดยอดได้บางส่วนครับ',
    'แต่ยังขาดข้อมูลสำคัญ: '+parsed.missingCritical.map(key=>labels[key]??key).join(', '),
    '',
    'ยังไม่บันทึกลง Daily Close เพื่อกันยอดผิดครับ',
  ].join('\n');
}

function successReply(
  parsed:ParsedInthaninDailyClose,
  result:IngestResult,
  environment:'test'|'live',
  rematch?:RematchResult|null,
  cashSweepAmount:number|null=null,
):string{
  if(result.duplicate){
    return [
      environmentLabel(environment)+' — รายการนี้รับไว้แล้วครับ',
      'ทองไทยไม่ลง Daily Close ซ้ำจาก LINE message เดิมครับ',
    ].join('\n');
  }

  const variance=n(result.sales_payment_variance);
  const directCashExpense=parsed.expenses
    .filter(exp=>exp.funding==='company_cash')
    .reduce((sum,exp)=>sum+exp.amount,0);
  const cashAfter=n(result.payment_cash)-directCashExpense;
  const cups=n(result.cup_count);
  const averagePerCup=cups>0?n(result.net_sales)/cups:null;
  const warnings=optionalWarningLines(parsed);
  const paymentStatus=Math.abs(variance)<0.01?'✅ ยอดรับเงินตรงกับยอดขาย':'⚠️ ยอดรับเงินต่างจากยอดขาย '+baht(variance);
  const expenseTotal=parsed.expenses.reduce((sum,exp)=>sum+exp.amount,0);

  const lines=[
    environmentLabel(environment)+' — บันทึก Daily Close Draft แล้วครับ',
    'Inthanin Café ตาดโตน · '+thaiDate(parsed.localDate??String(result.local_date??'')),
    '',
    'ยอดขายสุทธิ POS: '+baht(result.net_sales),
    'รับเงิน: เงินสด '+baht(result.payment_cash)+' · QR '+baht(result.payment_qr)+' · บัตร '+baht(result.payment_card)+' · อื่น ๆ '+baht(result.payment_other),
    'รวมรับเงิน: '+baht(result.payments_total)+' '+paymentStatus,
    '',
    'ค่าใช้จ่ายที่แจ้ง: '+baht(expenseTotal),
    directCashExpense>0?'เงินสดจากยอดขายหลังจ่ายรายการเงินสดวันนี้: '+baht(cashAfter):'',
    cashSweepAmount!==null&&cashSweepAmount>0?'💰 ย้ายเงินสดส่วนเกินเข้าถุงรอเจ้าของ: '+baht(cashSweepAmount):'',
    parsed.cupCount!==null?'จำนวนแก้ว: '+parsed.cupCount+' แก้ว'+(averagePerCup!==null?' · เฉลี่ย '+baht(averagePerCup)+'/แก้ว':''):'',
    parsed.billCount!==null?'จำนวนบิล: '+parsed.billCount+' บิล':'',
    'สิทธิ/แต้ม/โปร: '+benefitSummary(parsed),
    '',
    rematch && Number(rematch.matched_count||0)>0
      ? '📎 จับคู่รูป/สลิปที่ส่งมาก่อนหน้าเพิ่มได้ '+Number(rematch.matched_count||0)+' รายการ'
      : '',
    rematch && Number(rematch.ambiguous_count||0)>0
      ? '⚠️ ยังมีหลักฐานยอดซ้ำที่ต้องตรวจ '+Number(rematch.ambiguous_count||0)+' รายการ'
      : '',
    warnings.length?'ยังมีข้อมูลที่ควรเติมก่อนยืนยันปิดวัน:\n'+warnings.join('\n'):'',
    'สถานะ: DRAFT — ยังไม่ใช่การยืนยันปิดวันครับ',
  ].filter(Boolean);

  return lines.join('\n');
}

export async function handleCafeTestDailyCloseText(input:{
  targetId:string;
  userId:string|null;
  text:string;
  messageId:string|null;
  timestamp?:number;
}):Promise<string|null>{
  if(!looksLikeInthaninDailyCloseText(input.text))return null;

  const team=await boundLineOpsTeam(input.targetId);
  if(team!=='cafe_test'&&team!=='cafe')return null;
  const environment:'test'|'live'=team==='cafe'?'live':'test';

  const parsed=parseInthaninDailyCloseText(input.text);
  if(!parsed.matched)return null;
  if(parsed.missingCritical.length)return missingReply(parsed,environment);
  if(!input.messageId){
    return environmentLabel(environment)+' — อ่านฟอร์มได้แล้วครับ แต่ LINE message id หาย จึงยังไม่บันทึกเพื่อกันรายการซ้ำครับ';
  }

  const payload=payloadFromParsed(parsed,input.text);
  const ingestRpc=environment==='live'
    ?'financial_ingest_inthanin_live_text_v1'
    :'financial_ingest_cafe_test_text_v1';
  const response=await dbFetch('rpc/'+ingestRpc,{
    method:'POST',
    body:JSON.stringify({
      p_message_id:input.messageId,
      p_user_hash:piiHash(input.userId)??'',
      p_local_date:parsed.localDate,
      p_payload:payload,
    }),
  });
  const raw=await response.json() as IngestResult|IngestResult[];
  const result=Array.isArray(raw)?raw[0]:raw;
  if(!result?.ok)throw new Error('financial_daily_close_text_ingest_failed');

  let cashSweepAmount:number|null=null;
  if(environment==='live'&&result.daily_close_id){
    const hasCashCounts=result.cash_opening_float!==null&&result.cash_opening_float!==undefined
      &&result.cash_counted_closing!==null&&result.cash_counted_closing!==undefined;
    const candidate=hasCashCounts
      ?n(result.cash_opening_float)+n(result.payment_cash)
        -n(result.purchase_cash_outflow)-n(result.expense_cash_outflow)-n(result.cash_counted_closing)
      :0;
    const keepFloat=hasCashCounts
      &&Math.abs(n(result.cash_opening_float)-n(result.cash_counted_closing))<0.01;
    const desiredSweep=keepFloat&&candidate>0.009?Math.round(candidate*100)/100:0;
    try{
      await dbFetch('rpc/financial_record_cash_sweep_live_v1',{
        method:'POST',
        body:JSON.stringify({
          p_daily_close_id:result.daily_close_id,
          p_amount:desiredSweep,
          p_actor_hash:piiHash(input.userId)??'',
          p_source:'line',
        }),
      });
      cashSweepAmount=desiredSweep>0?desiredSweep:null;
    }catch(error){
      console.error(
        'INTHANIN_LIVE_CASH_SWEEP_ERROR',
        error instanceof Error?error.message.slice(0,220):'unknown',
      );
    }
  }

  let rematch:RematchResult|null=null;
  if(result.daily_close_id){
    try{
      const rematchRpc=environment==='live'
        ?'financial_rematch_inthanin_live_day_evidence_v1'
        :'financial_rematch_cafe_test_day_evidence_v1';
      const rematchResponse=await dbFetch('rpc/'+rematchRpc,{
        method:'POST',
        body:JSON.stringify({p_daily_close_id:result.daily_close_id}),
      });
      const rematchRaw=await rematchResponse.json() as RematchResult|RematchResult[];
      rematch=Array.isArray(rematchRaw)?rematchRaw[0]??null:rematchRaw;
    }catch(error){
      console.error(
        'INTHANIN_DAILY_CLOSE_EVIDENCE_REMATCH_ERROR',
        error instanceof Error?error.message.slice(0,220):'unknown',
      );
    }
  }

  console.log('INTHANIN_DAILY_CLOSE_TEXT_INGESTED',JSON.stringify({
    environment,
    localDate:parsed.localDate,
    duplicate:Boolean(result.duplicate),
    dailyCloseId:result.daily_close_id??null,
    variance:n(result.sales_payment_variance),
    expenseCount:parsed.expenses.length,
    cupCount:parsed.cupCount,
    hasBillCount:parsed.billCount!==null,
    rematchedEvidence:Number(rematch?.matched_count||0),
    ambiguousEvidence:Number(rematch?.ambiguous_count||0),
  }));

  return successReply(parsed,result,environment,rematch,cashSweepAmount);
}
