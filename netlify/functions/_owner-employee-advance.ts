import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import { parseOwnerStaffTurn, isOwnerStaffAmbiguousText, isOwnerStaffCorrectionText, type OwnerStaffTurn } from './_owner-staff-intent';
import { isAuthorizedOwnerPaymentActor, ownerPaymentDocumentGate, ownerPaymentDocumentClarification } from './_owner-payment-document';
import { ownerSlipMaintenancePaused, OWNER_SLIP_MAINTENANCE_REPLY } from './_owner-slip-maintenance';
import type { FinancialImageExtraction } from './_inthanin-daily-close-image';
import type { LineMessage } from './_ops-line-ui';
import { ADVANCE_PREFIX, buildOwnerEmployeeAdvanceCard, decodeAdvanceAction, type AdvanceEmployee, type AdvanceProposal } from './_owner-employee-advance-card';

type Intake = {id:string;owner_group_hash:string;source_user_hash:string|null;status:string;amount:number|string|null;
  occurred_on:string;created_at:string;purpose_raw:string|null;review_state:'draft'|'confirmed'|'cancelled'|null;
  review_revision:number;review_data:AdvanceProposal|Record<string,any>|null;extraction_data:FinancialImageExtraction};
type Context = {candidates:AdvanceEmployee[];selected?:AdvanceEmployee|null;month_start?:string;month_end?:string};
type Input = {targetId:string;userId?:string|null;messageId?:string|null;timestamp?:number};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const code = (id:string) => id.replace(/-/g,'').slice(0,6).toUpperCase();
const proposalOf = (row:Intake):AdvanceProposal|null => row.review_data?.kind === 'employee_advance' ? row.review_data as AdvanceProposal : null;
const finiteMoney = (value:unknown):number|null => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value)>=0 ? Number(value) : null;
const validDate = (value:unknown):string|null => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(value+'T00:00:00Z')) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value ? value : null;
function blockedByMaintenance(timestamp?:number):boolean {
  const cutoff=process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER;
  return ownerSlipMaintenancePaused()||!!cutoff&&(!Number.isFinite(timestamp)||!Number.isFinite(Date.parse(cutoff))||timestamp!<=Date.parse(cutoff));
}

/** Exactly one configured finance approver: group membership or a second owner is insufficient. */
export function isAuthorizedEmployeeAdvanceActor(userId:string|null|undefined, env:Record<string,string|undefined> = process.env):boolean {
  const hashes = (env.OWNER_FINANCE_LINE_USER_HASHES??'').split(',').map(s=>s.trim()).filter(Boolean);
  return hashes.length === 1 && isAuthorizedOwnerPaymentActor(userId,env);
}
async function request(path:string, body?:Record<string,unknown>):Promise<any> {
  const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key}=process.env;
  if(!url||!key)throw new Error('employee_advance_database_unconfigured');
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw new Error('employee_advance_request_failed_'+response.status);
  return response.json();
}
async function identity(input:Input):Promise<{groupHash:string;actorHash:string}|null> {
  if(!isAuthorizedEmployeeAdvanceActor(input.userId) || await boundLineOpsTeam(input.targetId)!=='owner_general')return null;
  const groupHash=piiHash(input.targetId),actorHash=piiHash(input.userId);
  return groupHash&&actorHash?{groupHash,actorHash}:null;
}
const SELECT = '&select=id,owner_group_hash,source_user_hash,status,amount,occurred_on,created_at,purpose_raw,review_state,review_revision,review_data,extraction_data';
export function employeeAdvancePurchaseCorrection(text:string,employeeLabel:string):string {
  const corrected=text.replace(/(?:ไม่ใช่|ไม่ได้(?:เบิก)?)(?:เบิก)?เงินเดือน(?:ล่วงหน้า)?\s*(?:แต่(?:เป็น)?|เป็น)?\s*/gu,'');
  const detail=corrected.match(/(?:เบิก(?:เงิน)?(?:ไป)?ซื้อ|(?:ไป)?ซื้อ|สำรองจ่าย)[\s\S]*$/u)?.[0]??'ซื้อของ';
  return employeeLabel+'เบิกไปซื้อของ '+detail;
}
async function load(id:string, owner:{groupHash:string;actorHash:string}):Promise<Intake|null> {
  const rows:Intake[]=await request('financial_owner_expense_intakes?id=eq.'+encodeURIComponent(id)+'&owner_group_hash=eq.'+encodeURIComponent(owner.groupHash)+'&source_user_hash=eq.'+encodeURIComponent(owner.actorHash)+SELECT+'&limit=2');
  return rows.length === 1 && rows[0].id===id && rows[0].owner_group_hash===owner.groupHash && rows[0].source_user_hash===owner.actorHash ? rows[0] : null;
}
async function employeeContext(groupHash:string, query:string, id:string|null, date:string|null):Promise<Context> {
  if(!validDate(date))return {candidates:[]};
  const raw=await request('rpc/owner_employee_advance_context_v1',{p_group_hash:groupHash,p_employee_query:query||null,p_employee_id:id,p_event_date:date});
  const candidates=Array.isArray(raw?.candidates)?raw.candidates.filter((e:any)=>e&&UUID.test(e.employee_id)&&typeof e.full_name==='string'):[];
  return {...raw,candidates,selected:raw?.selected&&candidates.some((e:AdvanceEmployee)=>e.employee_id===raw.selected.employee_id)?raw.selected:null};
}
function selected(context:Context,id:string|null):AdvanceEmployee|null {
  return id?context.candidates.find(e=>e.employee_id===id)??null:null;
}
function snapshotEmployee(p:AdvanceProposal,fallback:AdvanceEmployee|null):AdvanceEmployee|null {
  if(!Object.hasOwn(p,'employee'))return fallback;
  const e=p.employee;
  return e&&e.employee_id===p.employee_id&&UUID.test(e.employee_id)&&typeof e.full_name==='string'?e:null;
}
async function render(row:Intake,owner:{groupHash:string;actorHash:string},options:{error?:string;view?:'employee'|'funding';page?:number}={}):Promise<LineMessage> {
  const p=proposalOf(row);
  if(!p)return {type:'text',text:'รายการนี้ยังไม่มีการ์ดเงินเบิกครับ กรุณาระบุพนักงานและประเภทการเบิก'};
  const context=await employeeContext(owner.groupHash,options.view==='employee'?'':p.employee_query,options.view==='employee'?null:p.employee_id,p.occurred_on);
  const currentEmployee=selected(context,p.employee_id);
  const employee=row.review_state==='confirmed'?currentEmployee:snapshotEmployee(p,currentEmployee);
  return buildOwnerEmployeeAdvanceCard({id:row.id,revision:row.review_revision,proposal:p,employee,candidates:context.candidates,
    state:row.review_state==='confirmed'?'confirmed':row.review_state==='cancelled'?'cancelled':'draft',
    ...(row.review_state==='confirmed'?{monthlySum:finiteMoney(employee?.month_paid_advance),duplicate:true}:{}),...options});
}
async function stage(row:Intake,owner:{groupHash:string;actorHash:string},messageId:string,changes:Partial<AdvanceProposal>,notice?:string):Promise<LineMessage> {
  const previous=proposalOf(row);
  const p:AdvanceProposal={kind:'employee_advance',event_type:'unknown',employee_query:'',employee_id:null,business_unit_code:null,funding_source:'unknown',
    amount:finiteMoney(row.extraction_data?.amount_total??row.amount),occurred_on:validDate(row.extraction_data?.document_date_local),
    purpose:'พนักงานเบิก',questions:[],monthly_sum_before:null,...previous,...changes};
  const gate=ownerPaymentDocumentGate(row.extraction_data,{fundsDirection:'outgoing'});
  if(gate.kind!=='payment_evidence')return {type:'text',text:ownerPaymentDocumentClarification(gate)};
  const context=await employeeContext(owner.groupHash,p.employee_query,p.employee_id,p.occurred_on);
  const employee=selected(context,p.employee_id)??(!p.employee_id&&!!p.employee_query.trim()&&context.candidates.length===1?context.candidates[0]:null);
  p.employee_id=employee?.employee_id??null;
  p.business_unit_code=employee?.business_unit_code??null;
  p.monthly_sum_before=finiteMoney(employee?.month_paid_advance);
  p.questions=[];
  if(!employee)p.questions.push(context.candidates.length?'พบพนักงานหลายคน กรุณาเลือกคนที่ถูกต้อง':'ยังไม่พบพนักงานที่ผูกไว้กับกลุ่มนี้');
  if(employee&&!p.business_unit_code)p.questions.push('กรุณาระบุส่วนงานของพนักงานในหลังบ้านก่อนครับ');
  if(p.event_type!=='salary_advance')p.questions.push('กรุณาระบุประเภทการเบิก');
  if(p.amount===null||p.amount<=0)p.questions.push('ยอดจากหลักฐานยังไม่ชัดครับ กรุณาตรวจสลิป');
  if(!p.occurred_on)p.questions.push('วันที่จ่ายจากหลักฐานยังไม่ชัดครับ');
  if(employee&&p.monthly_sum_before===null)p.questions.push('ยังอ่านยอดสะสมจากฐานข้อมูลไม่ได้');
  const result=await request('rpc/financial_stage_owner_employee_advance_v1',{p_intake_id:row.id,p_group_hash:owner.groupHash,p_actor_hash:owner.actorHash,p_message_id:messageId,p_revision:row.review_revision,p_proposal:p});
  if(result.conflict){const fresh=await load(row.id,owner);return fresh?render(fresh,owner,{error:'ข้อมูลเปลี่ยนแล้วครับ กรุณาตรวจการ์ดล่าสุด'}):{type:'text',text:'ยังไม่บันทึกครับ กรุณาตรวจรายการล่าสุด'};}
  if(!result.ok||!Number.isSafeInteger(result.revision)||result.proposal?.kind!=='employee_advance')throw new Error('employee_advance_stage_unverified');
  return buildOwnerEmployeeAdvanceCard({id:row.id,revision:result.revision,proposal:result.proposal,
    employee:snapshotEmployee(result.proposal,employee),candidates:context.candidates,error:notice});
}
async function confirm(row:Intake,owner:{groupHash:string;actorHash:string},revision:number,messageId:string):Promise<LineMessage> {
  const p=proposalOf(row);
  if(!p)return {type:'text',text:'ยังไม่มีสรุปเงินเบิกให้ยืนยันครับ'};
  if(row.review_state==='cancelled')return render(row,owner);
  if(row.review_revision!==revision)return render(row,owner,{error:'ฉบับนี้มีการแก้ไขแล้วครับ กรุณาใช้การ์ดล่าสุด'});
  if(row.review_state!=='confirmed' && (p.event_type!=='salary_advance'||!p.employee_id||!p.business_unit_code||!p.amount||!p.occurred_on||p.questions.length
    ||ownerPaymentDocumentGate(row.extraction_data,{fundsDirection:'outgoing'}).kind!=='payment_evidence'))return render(row,owner);
  const result=await request('rpc/financial_confirm_owner_employee_advance_v1',{p_intake_id:row.id,p_group_hash:owner.groupHash,p_actor_hash:owner.actorHash,p_revision:revision,p_message_id:messageId});
  if(result.conflict||result.changed){
    const fresh=await load(row.id,owner);
    if(!fresh)return {type:'text',text:'ข้อมูลเปลี่ยนแล้วครับ ยังไม่บันทึกยอด'};
    // Re-stage only the review, so a changed monthly balance is visible before another approval.
    if(result.changed&&fresh.review_state==='draft')return stage(fresh,owner,messageId+':refresh',{},'ยอดสะสมหรือข้อมูลพนักงานเปลี่ยนแล้วครับ ยังไม่บันทึก กรุณาตรวจยอดล่าสุดแล้วยืนยันอีกครั้ง');
    return render(fresh,owner,{error:'ข้อมูลเปลี่ยนแล้วครับ กรุณาตรวจและยืนยันการ์ดล่าสุด'});
  }
  if(result.duplicate_transaction && !result.event_id)return {type:'text',text:'พบหลักฐานธุรกรรมนี้ในรายการอื่นแล้วครับ ไม่เพิ่มยอดซ้ำ กรุณาตรวจรายการเดิม'};
  const monthlySum=finiteMoney(result.monthly_sum);
  if(!result.ok||!result.event_id||!result.employee?.employee_id||monthlySum===null){
    return {type:'text',text:'ยังยืนยันผลบันทึกหรือยอดสะสมจากฐานข้อมูลไม่ได้ครับ กรุณาตรวจรายการเดิมก่อนส่งซ้ำ'};
  }
  return buildOwnerEmployeeAdvanceCard({id:row.id,revision,proposal:{...p,amount:finiteMoney(result.amount),occurred_on:validDate(result.occurred_on),
    business_unit_code:result.employee.business_unit_code,funding_source:result.funding_source??'unknown'},
    employee:result.employee,state:'confirmed',monthlySum,duplicate:result.duplicate===true});
}

/** Intercepts salary advances before legacy text/slip paths; never creates a money event. */
export async function handleOwnerEmployeeAdvanceText(input:Input&{text:string}):Promise<LineMessage|null> {
  const refs=[...input.text.matchAll(/#([a-f0-9]{6,32})\b/giu)];
  const text=input.text.replace(/#[a-f0-9]{6,32}\b/giu,'').trim();
  if(/^(?:สรุปเบิกเงินเดือน|ยอดเบิกเงินเดือน|หักเบิก|หักเงินเบิก|หักเงินเดือน)/u.test(text))return null;
  const direct=parseOwnerStaffTurn(text);
  const approval=text.match(/^ยืนยันเบิก\s+v(\d+)$/u);
  const showReview=refs.length===1&&/^(?:สรุป(?:เงินเบิก)?|ตรวจเงินเบิก|ดูเงินเบิก)?$/u.test(text);
  const continuation=/^(?:เงินเดือน(?:ล่วงหน้า)?|ล่วงหน้า|พนักงาน|[\p{L}\p{M} .-]{1,60})$/u.test(text);
  if(!approval&&!showReview&&!direct&&!continuation&&!isOwnerStaffCorrectionText(text))return null;
  if(direct?.kind==='salary_payment')return null;
  const owner=await identity(input);if(!owner)return null;
  if(blockedByMaintenance(input.timestamp))return direct||approval||showReview||refs.length||/เบิก|เงินเดือน|ล่วงหน้า/u.test(text)
    ?{type:'text',text:OWNER_SLIP_MAINTENANCE_REPLY}:null;
  if(!input.messageId)return {type:'text',text:'ยังไม่บันทึกครับ ขาดรหัสข้อความสำหรับป้องกันรายการซ้ำ'};
  if(refs.length>1||isOwnerStaffAmbiguousText(text))return {type:'text',text:'มีหลายคนหรือหลายรายการครับ กรุณาระบุพนักงานและสลิปทีละรายการ'};
  const uuid=(hex:string)=>hex.replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5');
  const ref=refs[0]?.[1]?.toLowerCase();
  const scope=ref?'&id=gte.'+uuid(ref.padEnd(32,'0'))+'&id=lte.'+uuid(ref.padEnd(32,'f')):'&status=in.(awaiting_purpose,awaiting_business,needs_review)';
  const rows:Intake[]=await request('financial_owner_expense_intakes?owner_group_hash=eq.'+encodeURIComponent(owner.groupHash)+'&source_user_hash=eq.'+encodeURIComponent(owner.actorHash)+scope+SELECT+'&order=created_at.desc&limit=101');
  const now=Number.isFinite(input.timestamp)?Number(input.timestamp):Date.now();
  let candidates=rows.filter(row=>row.owner_group_hash===owner.groupHash&&row.source_user_hash===owner.actorHash)
    .filter(row=>refs[0]?row.id.replace(/-/g,'').startsWith(refs[0][1].toLowerCase()):['awaiting_purpose','awaiting_business','needs_review'].includes(row.status)
      && row.review_state!=='confirmed'&&row.review_state!=='cancelled'&&now-Date.parse(row.created_at)>=-60000&&now-Date.parse(row.created_at)<=86400000)
    .filter(row=>{
      const staff=parseOwnerStaffTurn(row.review_data?.purpose||row.purpose_raw||'');
      return proposalOf(row)||(!(row.review_data as any)?.project_id&&!row.review_data?.purpose&&!row.purpose_raw)
        ||!!staff&&['unknown','salary_advance'].includes(staff.kind);
    });
  if(direct?.kind==='purchase'&&!candidates.some(proposalOf))return null;
  if(showReview){
    const advanceRows=candidates.filter(proposalOf);
    if(advanceRows.length===1)return render(advanceRows[0],owner);
    if(!advanceRows.length)return null;
  }
  if(!direct&&!approval&&!showReview){
    candidates=candidates.filter(row=>!!parseOwnerStaffTurn(text,proposalOf(row)?.purpose??row.review_data?.purpose??row.purpose_raw));
    if(!candidates.length)return null;
  }
  if(rows.length>100)return {type:'text',text:'มีหลายสลิปครับ กรุณาเลือกจากการ์ดเงินเบิกล่าสุด'};
  const amountMatches=direct?.amount==null?candidates:candidates.filter(row=>finiteMoney(proposalOf(row)?.amount??row.extraction_data?.amount_total??row.amount)===direct.amount);
  if(candidates.length && amountMatches.length!==1)return {type:'text',text:amountMatches.length>1?'มีหลายสลิปครับ กรุณาระบุรหัสรายการเดียว: '+amountMatches.map(row=>'#'+code(row.id)).join(' / '):'ยอดที่ระบุไม่ตรงกับสลิปครับ กรุณาระบุสลิปที่ถูกต้อง ยังไม่บันทึกยอด'};
  if(!amountMatches.length)return direct?{type:'text',text:'รับว่าเป็นรายการเบิกของ '+(direct.employeeLabel??'พนักงาน')+'ครับ ส่งสลิปแล้วตอบกลับรูปว่า “ตรวจสลิป” จากนั้นระบุชื่อพนักงาน ผมจะแสดงยอดสะสมให้ตรวจก่อนยืนยัน ยังไม่บันทึกยอดครับ'}:null;
  const row=amountMatches[0];
  if(approval)return refs.length===1?confirm(row,owner,Number(approval[1]),input.messageId):render(row,owner);
  if(row.review_state==='confirmed'||row.review_state==='cancelled')return proposalOf(row)?render(row,owner):{type:'text',text:'รายการนี้ปิดแล้วครับ ไม่เพิ่มหรือย้ายยอดซ้ำ'};
  const previous=proposalOf(row);
  const turn:OwnerStaffTurn|null=parseOwnerStaffTurn(text,previous?.purpose??row.review_data?.purpose??row.purpose_raw);
  if(!turn||turn.kind==='salary_payment')return null;
  if(turn.kind==='purchase'){
    if(!previous)return null;
    // An explicit correction returns to the existing evidence-review flow;
    // it does not create payroll, a vendor expense, or a financial event.
    const {stageSlipReview}=await import('./_owner-slip-review');
    const {ownerSlipReplyCard}=await import('./_owner-slip-cards');
    const reply=await stageSlipReview({id:row.id,groupHash:owner.groupHash,actorHash:owner.actorHash,messageId:input.messageId,
      revision:row.review_revision,note:employeeAdvancePurchaseCorrection(text,turn.employeeLabel??previous.employee_query),extraction:row.extraction_data});
    return ownerSlipReplyCard({targetId:input.targetId,userId:input.userId,text:reply});
  }
  const renamed=!!turn.employeeLabel&&turn.employeeLabel!==previous?.employee_query;
  return stage(row,owner,input.messageId,{employee_query:turn.employeeLabel??previous?.employee_query??'',
    employee_id:renamed?null:previous?.employee_id??null,event_type:turn.kind==='salary_advance'?'salary_advance':'unknown',
    purpose:(turn.employeeLabel??'พนักงาน')+'เบิก'+(turn.kind==='salary_advance'?'เงินเดือนล่วงหน้า':'')});
}

export async function handleOwnerEmployeeAdvancePostback(input:Input&{data:string}):Promise<LineMessage|null> {
  if(!input.data.startsWith(ADVANCE_PREFIX))return null;
  const action=decodeAdvanceAction(input.data);
  if(!action||!input.messageId)return {type:'text',text:'ปุ่มนี้ใช้ไม่ได้ครับ กรุณาใช้การ์ดล่าสุด'};
  const owner=await identity(input);if(!owner)return {type:'text',text:'เฉพาะเจ้าของที่มีสิทธิ์เท่านั้นที่ตรวจและยืนยันเงินเบิกได้ครับ'};
  if(blockedByMaintenance(input.timestamp))return {type:'text',text:OWNER_SLIP_MAINTENANCE_REPLY};
  const row=await load(action.id,owner);if(!row||!proposalOf(row))return {type:'text',text:'ไม่พบการ์ดเงินเบิกนี้ในกลุ่มและผู้ส่งเดิมครับ'};
  if(row.review_state!=='draft')return action.action==='confirm'&&row.review_state==='confirmed'?confirm(row,owner,action.revision,input.messageId):render(row,owner);
  if(row.review_revision!==action.revision)return render(row,owner,{error:'ข้อมูลเปลี่ยนแล้วครับ กรุณาใช้การ์ดล่าสุด'});
  if(action.action==='confirm')return confirm(row,owner,action.revision,input.messageId);
  if(action.action==='later')return {type:'text',text:'เก็บการ์ดนี้ไว้แล้วครับ ยังไม่บันทึกยอด'};
  if(action.action==='cancel'){
    const result=await request('rpc/financial_confirm_owner_slip_review_v1',{p_intake_id:row.id,p_group_hash:owner.groupHash,p_actor_hash:owner.actorHash,p_revision:action.revision,p_message_id:input.messageId,p_cancel:true});
    const fresh=await load(row.id,owner);return fresh?render(fresh,owner,{...(result.conflict?{error:'ข้อมูลเปลี่ยนแล้วครับ ยังไม่ยกเลิก'}:{})}):{type:'text',text:'กรุณาตรวจสถานะรายการล่าสุดครับ'};
  }
  if(action.action==='review')return render(row,owner);
  if(action.action==='show_employee'||action.action==='page')return render(row,owner,{view:'employee',page:Number(action.value??0)});
  if(action.action==='show_funding')return render(row,owner,{view:'funding'});
  if(action.action==='salary')return stage(row,owner,input.messageId,{event_type:'salary_advance',purpose:(proposalOf(row)!.employee_query||'พนักงาน')+'เบิกเงินเดือนล่วงหน้า'});
  if(action.action==='funding')return stage(row,owner,input.messageId,{funding_source:action.value});
  if(action.action==='employee'){
    const context=await employeeContext(owner.groupHash,'',action.value!,proposalOf(row)!.occurred_on);
    const employee=selected(context,action.value!);
    if(!employee)return render(row,owner,{error:'พนักงานนี้ไม่พร้อมใช้งานในกลุ่มนี้ครับ',view:'employee'});
    return stage(row,owner,input.messageId,{employee_id:employee.employee_id,employee_query:employee.nickname||employee.full_name});
  }
  return render(row,owner);
}
