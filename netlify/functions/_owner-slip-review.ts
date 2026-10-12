import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import { classifyOwnerExpensePurpose, type OwnerExpenseProject } from './_owner-expense-intake';
import type { FinancialImageExtraction } from './_inthanin-daily-close-image';
import { parseOwnerStaffTurn } from './_owner-staff-intent';
import { ownerSlipMaintenancePaused } from './_owner-slip-maintenance';
import { isAuthorizedOwnerPaymentActor, ownerPaymentDocumentGate, ownerPaymentDocumentClarification } from './_owner-payment-document';

export type Installment = { id:string; project_id:string; task_id:string; installment_no:number; title:string; status:string; task?:{title:string}|null };
export type SlipSelections = {business?:string;project?:string|null;category?:string;destination?:string;installment?:string|null;project_pending?:boolean;installment_pending?:boolean;category_pending?:boolean};
export type SlipProposal = {
  purpose:string; amount:number|null; occurred_on:string|null;
  project_id:string|null; project_name:string|null; task_id:string|null;
  installment_id:string|null; installment_label:string|null;
  business_unit_code:string|null; expense_class:string; expense_category:string;
  expense_subcategory:string|null; questions:string[]; review_choices?:SlipSelections;
};
export type Review = { id:string; source_user_hash:string; review_state:'draft'|'confirmed'|'cancelled';
  review_revision:number; review_data:SlipProposal|null; extraction_data:FinancialImageExtraction };
const compact = (s:string) => s.normalize('NFC').toLowerCase().replace(/[\s\-‐‑–—]/gu,'');
/** Merge a restated/extended answer without duplicating its memo; raw OCR remains separate. */
export function mergeSlipReviewNote(previous:string,reply:string):string {
  const before=previous.trim(),after=reply.trim();
  if(!before) return after;
  if(!after) return before;
  const token=(value:string)=>value.normalize('NFC').toLowerCase().replace(/^ตำมา[\-‐‑–—]*ชาติ$/u,'ตำมาชาติ');
  const words=before.split(/\s+/u),incoming=after.split(/\s+/u);
  const starts=(all:string[],prefix:string[])=>all.length>=prefix.length && prefix.every((word,index)=>token(word)===token(all[index]));
  if(starts(incoming,words)) return after;
  // Repair a legacy concatenated repeat only when the owner restates the complete memo.
  const unrepeated=words.filter((word,index)=>index===0 || /[\d๐-๙]/u.test(word) || token(word)!==token(words[index-1]));
  if(unrepeated.length!==words.length && starts(incoming,unrepeated)) return after;
  if(starts(words,incoming) || starts(words.slice(-incoming.length),incoming)) return before;
  for(let n=Math.min(words.length,incoming.length);n>0;n--) {
    if(starts(words.slice(-n),incoming.slice(0,n))) {
      return [before,...incoming.slice(n)].join(' ');
    }
  }
  return before+' '+after;
}
export function visibleSlipDate(raw:string|null):string|null {
  return raw && /^20\d{2}-\d{2}-\d{2}$/.test(raw)
    && !Number.isNaN(Date.parse(raw+'T00:00:00Z'))
    && new Date(raw+'T00:00:00Z').toISOString().slice(0,10)===raw ? raw : null;
}
const code = (id:string) => id.replace(/-/g,'').slice(0,6).toUpperCase();
export const units:Record<string,string> = {inthanin:'Inthanin',tamma_restaurant:'ตำมา-ชาติ',huenstay:'เฮือนสเตย์',adventure:'ผจญภัย',otop:'OTOP',shared_infrastructure:'ส่วนกลาง/โครงสร้างพื้นฐาน',shared:'ใช้ร่วม',other:'อื่น ๆ'};
export const categories:Record<string,string> = {construction:'ก่อสร้าง/ต่อเติม',land_infrastructure:'ที่ดิน/โครงสร้างพื้นฐาน',kitchen_equipment:'อุปกรณ์ครัว',equipment:'อุปกรณ์/เครื่องมือ',furniture_fixtures:'เฟอร์นิเจอร์',activity_assets:'อุปกรณ์กิจกรรม',technology:'เทคโนโลยี',licenses:'ใบอนุญาต',inventory:'สต๊อก',ingredients:'วัตถุดิบ',beverages:'เครื่องดื่ม',packaging:'บรรจุภัณฑ์',consumables:'วัสดุสิ้นเปลือง',cleaning:'ทำความสะอาด',maintenance:'ซ่อมบำรุง',utilities:'สาธารณูปโภค',transport:'ขนส่ง',staff:'ค่าแรง',marketing:'การตลาด',fees:'ค่าธรรมเนียม',professional_services:'บริการวิชาชีพ',tax:'ภาษี',financing:'การเงิน',petty_cash:'เงินสดย่อย',other:'ยังไม่ทราบ'};
const businessPatterns:Array<[RegExp,string]>=[[/ตำมา[\s-]*ชาติ/u,'tamma_restaurant'],[/อินทนิล|inthanin/iu,'inthanin'],[/เฮือนสเตย์|huenstay/iu,'huenstay'],[/ผจญภัย|adventure/iu,'adventure'],[/otop|โอทอป/iu,'otop'],[/ส่วนกลาง|โครงสร้างพื้นฐาน/u,'shared_infrastructure'],[/ใช้ร่วม/u,'shared']];
const investmentDirection=/หน่วยการลงทุน|เข้าการลงทุน|บันทึกเป็นการลงทุน/u;
const operatingDirection=/ค่าใช้จ่ายดำเนินงาน|ไม่ใช่การลงทุน/u;
const owns=(value:object,key:string)=>Object.prototype.hasOwnProperty.call(value,key);

function matchingProjects(note:string,projects:OwnerExpenseProject[]) {
  const normalized=compact(note);
  const matches=projects.filter(p=>p.status!=='cancelled' && compact(p.name).length>=3 && normalized.includes(compact(p.name)));
  const best=matches.filter(p=>{
    let remaining=normalized;
    for(const other of matches) if(compact(other.name)!==compact(p.name) && compact(other.name).includes(compact(p.name))) remaining=remaining.split(compact(other.name)).join('');
    return remaining.includes(compact(p.name));
  });
  return {matches,best};
}

/** Interpret only the latest typed answer; old memo text remains evidence, not a newer instruction. */
export function reconcileSlipSelections(input:{previous:SlipProposal|null|undefined;reply:string;projects:OwnerExpenseProject[];installments:Installment[]}):SlipSelections {
  const {previous,reply,projects,installments}=input;
  const choices:SlipSelections={...previous?.review_choices};
  const priorProject=owns(choices,'project')?choices.project:previous?.project_id;
  const {matches,best}=matchingProjects(reply,projects);
  const businesses=businessPatterns.filter(([pattern])=>pattern.test(reply)).map(([,business])=>business);
  const noProject=/ไม่ผูกโครงการ/u.test(reply);
  let changedProject=false;
  if(noProject) {
    choices.project=null;delete choices.project_pending;
    choices.installment=null;delete choices.installment_pending;
  } else if(best.length===1) {
    choices.project=best[0].id;delete choices.project_pending;
    changedProject=priorProject!==best[0].id;
    if(best[0].business_unit_code)choices.business=best[0].business_unit_code;
  } else if(best.length>1 || /โครงการ|โปรเจกต์|project/iu.test(reply)) {
    choices.project=null;choices.project_pending=true;
    delete choices.installment;delete choices.installment_pending;
  }
  if(businesses.length===1) {
    choices.business=businesses[0];
    const project=projects.find(p=>p.id===(owns(choices,'project')?choices.project:previous?.project_id));
    if(project?.business_unit_code && project.business_unit_code!==choices.business) {
      choices.project=null;choices.project_pending=true;
      delete choices.installment;delete choices.installment_pending;
    }
  } else if(businesses.length>1)delete choices.business;
  const investment=investmentDirection.test(reply),operating=operatingDirection.test(reply);
  if(investment&&operating)delete choices.destination;
  else if(investment||operating)choices.destination=investment?'capital_investment':'operating_expense';
  let currentPurpose=reply;
  for(const project of matches) {
    const pattern=project.name.split(/[\s\-‐‑–—]+/u).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s\\-‐‑–—]*');
    currentPurpose=currentPurpose.replace(new RegExp(pattern,'giu'),' ');
  }
  for(const [pattern] of businessPatterns)currentPurpose=currentPurpose.replace(pattern,' ');
  const currentCategory=classifyOwnerExpensePurpose(currentPurpose).expenseCategory;
  if(previous && currentCategory!=='other' && previous.expense_category!=='other' && currentCategory!==previous.expense_category) {
    delete choices.category;choices.category_pending=true;
  }
  const numbers=[...reply.replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-0x0e50)).matchAll(/งวด(?:ที่)?\s*(\d+)/gu)].map(m=>Number(m[1]));
  const noInstallment=/ไม่ผูกงวด|ไม่แบ่งงวด/u.test(reply);
  const projectId=owns(choices,'project')?choices.project:previous?.project_id;
  const available=installments.filter(i=>i.project_id===projectId&&!['cancelled','paid'].includes(i.status));
  if(noInstallment&&!numbers.length) {
    choices.installment=null;delete choices.installment_pending;
  } else if(numbers.length) {
    let found=available.filter(i=>i.installment_no===numbers[0]);
    if(found.length>1)found=found.filter(i=>i.task?.title&&compact(reply).includes(compact(i.task.title)));
    if(!noInstallment&&new Set(numbers).size===1&&found.length===1) {
      choices.installment=found[0].id;delete choices.installment_pending;
    } else {delete choices.installment;choices.installment_pending=true;}
  } else if(changedProject) {
    if(available.length){delete choices.installment;choices.installment_pending=true;}
    else {choices.installment=null;delete choices.installment_pending;}
  }
  return choices;
}

export async function request(path:string, body?:Record<string,unknown>):Promise<any> {
  const {SUPABASE_URL:url,SUPABASE_SERVICE_ROLE_KEY:key}=process.env;
  if(!url||!key) throw new Error('owner_slip_review_database_unconfigured');
  const response=await fetch(url.replace(/\/$/,'')+'/rest/v1/'+path,{
    method:body?'POST':'GET',headers:{apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'},
    ...(body?{body:JSON.stringify(body)}:{}),
  });
  if(!response.ok) {
    const error=await response.json().catch(()=>null);
    if(path==='rpc/financial_confirm_owner_slip_review_v1' && ['owner_review_project_changed','owner_review_installment_changed','owner_project_task_mismatch','owner_review_incomplete'].includes(error?.message)) return {changed:true,reason:error.message};
    throw new Error('owner_slip_review_request_failed_'+response.status);
  }
  return response.json();
}

/** Only names present in the existing catalogue can become foreign keys. */
export function prepareSlipProposal(input:{note:string; extraction:FinancialImageExtraction; projects:OwnerExpenseProject[]; installments:Installment[]; choices?:SlipSelections}):SlipProposal {
  const {note,extraction}=input;
  const choices=input.choices??{};
  const explicitProject=Object.prototype.hasOwnProperty.call(choices,'project');
  const questions:string[]=[];
  const documentGate=ownerPaymentDocumentGate(extraction);
  if(documentGate.kind!=='payment_evidence')questions.push(ownerPaymentDocumentClarification(documentGate));
  if(choices.category_pending)questions.push('รายละเอียดล่าสุดมีหมวดต่างจากเดิม กรุณาเลือกหมวดที่ถูกต้องอีกครั้งครับ');
  const normalized=compact(note);
  const {matches,best}=matchingProjects(note,input.projects);
  // Contained names (e.g. restaurant and its named extension) are resolved by the longest name,
  // but disjoint project names and duplicate alias records remain ambiguous.
  const project=explicitProject?input.projects.find(p=>p.id===choices.project && p.status!=='cancelled')??null:best.length===1?best[0]:null;
  if(choices.project_pending)questions.push('เลือกโครงการใหม่ หรือเลือกไม่ผูกโครงการครับ');
  if(explicitProject && choices.project!==null && !project) questions.push('โครงการนี้ไม่พร้อมใช้งานแล้วครับ กรุณาเลือกโครงการใหม่');
  if(!explicitProject && best.length>1) questions.push('ระบุโครงการเดียวให้ชัดเจน: '+best.map(p=>p.name).join(' / '));
  else if(!explicitProject && !project && /โครงการ|โปรเจกต์|project/iu.test(note)) questions.push('ยังไม่พบชื่อโครงการนี้ กรุณาระบุชื่อโครงการที่มีอยู่ในหลังบ้าน');
  let purpose=note;
  for(const p of matches) {
    const pattern=p.name.split(/[\s\-‐‑–—]+/u).map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[\\s\\-‐‑–—]*');
    purpose=purpose.replace(new RegExp(pattern,'giu'),' ');
  }
  purpose=purpose.replace(/(?:ตำมา[\s-]*ชาติ|อินทนิล|inthanin|เฮือนสเตย์|huenstay|ผจญภัย|adventure|otop|โอทอป|โครงการ|โปรเจกต์)/giu,' ')
    .replace(/งวด(?:ที่)?\s*[0-9๐-๙]+|ไม่ผูกงวด|ไม่แบ่งงวด/gu,' ').trim();
  const staffAdvance=parseOwnerStaffTurn(note);
  // A person's name and a negated salary label are not the purchased category.
  const classificationPurpose=staffAdvance?.kind==='purchase'
    ?purpose.match(/(?:ไป)?ซื้อ[\s\S]*$/u)?.[0]??purpose:purpose;
  const classification=classifyOwnerExpensePurpose(classificationPurpose);
  const employeeAdvance=!!staffAdvance && ['unknown','salary_advance'].includes(staffAdvance.kind);
  if(choices.category && choices.category!=='other' && categories[choices.category]) {
    const sameCategory=classification.expenseCategory===choices.category;
    classification.expenseCategory=choices.category as typeof classification.expenseCategory;
    if(!sameCategory || !classification.expenseSubcategory) classification.expenseSubcategory=categories[choices.category];
    if(classification.expenseClass!=='owner_private' && !choices.destination) classification.expenseClass=['construction','land_infrastructure','kitchen_equipment','equipment','furniture_fixtures','activity_assets','technology','licenses'].includes(choices.category)?'capital_investment':'operating_expense';
  }
  // Explicit owner direction belongs to this draft, never a new global equipment rule.
  const investmentRequested=investmentDirection.test(note);
  const operatingRequested=operatingDirection.test(note);
  if(investmentRequested && operatingRequested && !choices.destination) questions.push('ระบุว่าจะบันทึกเป็นการลงทุนหรือค่าใช้จ่ายดำเนินงานครับ');
  else if(classification.expenseClass!=='owner_private') {
    if(investmentRequested) classification.expenseClass='capital_investment';
    else if(operatingRequested) classification.expenseClass='operating_expense';
  }
  if(classification.expenseClass!=='owner_private' && ['capital_investment','operating_expense'].includes(choices.destination??'')) classification.expenseClass=choices.destination as typeof classification.expenseClass;
  // Business names only: do not infer the restaurant from the word "ครัว" or "ชาติ".
  const businesses=businessPatterns.filter(([p])=>p.test(note)).map(([,b])=>b);
  const selectedBusiness=choices.business && choices.business!=='other' && units[choices.business]?choices.business:null;
  const business=project?.business_unit_code ?? selectedBusiness ?? (businesses.length===1?businesses[0]:null);
  if((!selectedBusiness && businesses.length>1) || (project?.business_unit_code && (selectedBusiness?selectedBusiness!==project.business_unit_code:businesses.some(b=>b!==project.business_unit_code)))) questions.push('กิจการที่ระบุไม่ตรงกัน กรุณาแก้ชื่อกิจการ/โครงการ');
  if(business==='other') questions.push('โครงการนี้ระบุกิจการเป็น “อื่น ๆ” ครับ กรุณาแก้กิจการของโครงการในหลังบ้านก่อนตรวจสลิปอีกครั้ง');
  else if(!business) {
    if(project) questions.push('พบโครงการ “'+project.name+'” แล้วครับ แต่ยังไม่ระบุกิจการ รายการนี้เป็นของกิจการไหนครับ: ตำมา-ชาติ / Inthanin / เฮือนสเตย์ / ผจญภัย / OTOP / ส่วนกลาง / ใช้ร่วม');
    else if(best.length===0) questions.push('เป็นของโครงการไหนครับ ระบุชื่อโครงการที่มีอยู่ หรือกิจการหากไม่ผูกโครงการ');
  }
  else if(investmentRequested && !project && !explicitProject && best.length===0) questions.push('ผูกกับโครงการลงทุนที่มีอยู่โครงการไหนครับ');
  if((!purpose && !choices.category) || classification.expenseCategory==='other') questions.push('จ่ายค่าอะไรครับ (โน้ตยังไม่ชัดพอที่จะจัดหมวด)');
  if(classification.expenseClass==='owner_private') questions.push('โน้ตระบุว่าเป็นรายการส่วนตัว กรุณายืนยันว่าเป็นค่าใช้จ่ายธุรกิจใด หรือยกเลิกสลิปนี้');
  const purposeParts=purpose.split(/\s*(?:และ|กับ|รวมทั้ง|\+|\/)\s*/u);
  const partCategories=new Set(purposeParts.map(part=>classifyOwnerExpensePurpose(part).expenseCategory).filter(c=>c!=='other'));
  if(partCategories.size>1 && !choices.category) questions.push('โน้ตมีหลายหมวด กรุณาระบุยอดและหมวดที่จะผูกกับสลิปนี้ให้ชัดเจน');
  if(/หรือ|อาจจะ|ไม่แน่ใจ|\?/u.test(note)) questions.push('กรุณายืนยันความหมายของโน้ตที่ยังไม่แน่ใจ');
  const digits=note.replace(/[๐-๙]/g,c=>String(c.charCodeAt(0)-0x0e50));
  const numbers=[...digits.matchAll(/งวด(?:ที่)?\s*(\d+)/gu)].map(m=>Number(m[1]));
  let installment:Installment|null=null;
  const available=input.installments.filter(i=>i.project_id===project?.id && !['cancelled','paid'].includes(i.status));
  if(choices.installment_pending)questions.push('เลือกงวดใหม่ หรือเลือกไม่ผูกงวดครับ');
  else if(Object.prototype.hasOwnProperty.call(choices,'installment')) {
    installment=available.find(i=>i.id===choices.installment && i.status!=='paid')??null;
    if(choices.installment!==null && !installment) questions.push('งวดนี้ไม่พร้อมใช้งานแล้วครับ กรุณาเลือกงวดใหม่');
  } else if(numbers.length) {
    let found=available.filter(i=>i.installment_no===numbers[0]);
    if(found.length>1) found=found.filter(i=>i.task?.title && normalized.includes(compact(i.task.title)));
    if(!project || new Set(numbers).size!==1 || found.length!==1) questions.push('ระบุงวดและงานที่มีอยู่ให้ชัดเจน (ไม่พบงวดเดียวที่ตรงกัน)');
    else installment=found[0];
  } else if(available.length && !/ไม่ผูกงวด|ไม่แบ่งงวด/u.test(note)) questions.push('เป็นงวดไหนครับ หรือระบุว่า “ไม่ผูกงวด”');
  const amount=extraction.amount_total;
  if(amount===null || !Number.isFinite(amount) || amount<=0) questions.push('ยอดเงินเท่าไรครับ ระบุ “ยอด 1234.56”');
  const date=visibleSlipDate(extraction.document_date_local);
  if(!date) questions.push('วันที่ในสลิปอ่านไม่ชัด ระบุวันที่ YYYY-MM-DD ครับ');
  // OCR or a later category tap must never route an employee advance into the
  // expense/investment ledger. Only the employee review can confirm this evidence.
  if(employeeAdvance){
    classification.expenseClass='uncategorized';classification.expenseCategory='staff';
    questions.push('รายการนี้เป็นเงินเบิกพนักงานครับ กรุณาระบุชื่อพนักงานและตรวจการ์ดเงินเบิกก่อนยืนยัน');
  }
  return {purpose:note || (choices.category?categories[choices.category]??'':''),amount,occurred_on:date,project_id:project?.id??null,project_name:project?.name??null,
    task_id:installment?.task_id??null,installment_id:installment?.id??null,
    installment_label:installment?`งวด ${installment.installment_no} · ${installment.task?.title??installment.title}`:null,
    business_unit_code:business,expense_class:classification.expenseClass,expense_category:classification.expenseCategory,
    expense_subcategory:classification.expenseSubcategory,questions,...(input.choices?{review_choices:choices}:{})};
}

export function slipReviewReply(row:Pick<Review,'id'|'review_revision'|'review_data'>):string {
  const p=row.review_data;
  if(!p) return 'รับหลักฐานแล้วครับ พิมพ์ #'+code(row.id)+' พร้อมรายละเอียดเพื่อเตรียมสรุปครับ';
  return [
    'ตรวจสลิป #'+code(row.id)+' · ฉบับ '+row.review_revision+' (ยังไม่บันทึกรายจ่าย)',
    'โน้ต: '+(p.purpose||'อ่านไม่พบ/ไม่ชัด'),
    'ยอด: '+(p.amount===null?'อ่านไม่ชัด':p.amount.toLocaleString('th-TH')+' บาท')+' · วันที่: '+(p.occurred_on||'อ่านไม่ชัด'),
    'โครงการ: '+(p.project_name||'ไม่ได้ระบุ')+' · กิจการ: '+(units[p.business_unit_code??'']||'ยังไม่ทราบ'),
    'หมวด: '+(p.expense_category==='consumables' && p.expense_subcategory ? p.expense_subcategory : categories[p.expense_category]||p.expense_category)+' · '+(p.expense_class==='capital_investment'?'ลงทุน':p.expense_class==='operating_expense'?'ค่าใช้จ่ายดำเนินงาน':'รอตรวจ'),
    'ปลายทาง: '+(p.expense_class==='capital_investment'?'หน่วยการลงทุน (รายการจากสลิป Owner)':p.expense_class==='operating_expense'?'ค่าใช้จ่ายดำเนินงาน':'รอตรวจ'),
    'งวด: '+(p.installment_label||'ไม่ผูกงวด'),
    ...p.questions,
    p.questions.length?'ตอบข้อมูลที่ถามได้เลยครับ':`กดปุ่ม “ยืนยัน” ด้านล่างเพื่อบันทึกครับ หรือพิมพ์ “ยืนยัน #${code(row.id)} v${row.review_revision}”`,
    `แก้ไข: #${code(row.id)} แก้เป็น [รายละเอียดที่ถูกต้อง] · ยกเลิก: ยกเลิก #${code(row.id)}`,
  ].join('\n');
}

/** The one-tap label stays simple; the action retains the exact reviewed slip/version. */
export function slipReviewLineMessage(text:string) {
  const header=text.match(/^(?:ฉบับนี้ไม่ใช่สรุปล่าสุดครับ\n)?ตรวจสลิป #([A-F0-9]{6}) · ฉบับ (\d+) \(ยังไม่บันทึกรายจ่าย\)\n/u);
  if(!header) return {type:'text' as const,text};
  const command=`ยืนยัน #${header[1]} v${header[2]}`;
  const lines=text.split('\n');
  if(lines.at(-2)!==`กดปุ่ม “ยืนยัน” ด้านล่างเพื่อบันทึกครับ หรือพิมพ์ “${command}”`) return {type:'text' as const,text};
  return {type:'text' as const,text,quickReply:{items:[{type:'action' as const,
    action:{type:'message' as const,label:'ยืนยัน',text:command}}]}};
}

export async function stageSlipReview(input:{id:string;groupHash:string;actorHash:string;messageId:string;revision:number;note:string;extraction:FinancialImageExtraction;choices?:SlipSelections;replyText?:string;previous?:SlipProposal|null}):Promise<string> {
  const staff=parseOwnerStaffTurn(input.note);
  const employeeReview=!!staff&&['unknown','salary_advance'].includes(staff.kind)
    ||await (await import('./_owner-employee-advance')).isApprovedOwnerEmployeeAdvanceNote({groupHash:input.groupHash,actorHash:input.actorHash,note:input.note,date:visibleSlipDate(input.extraction.document_date_local)});
  // Employee review does not depend on choosing or loading a construction project.
  const projects:OwnerExpenseProject[]=employeeReview?[]:await request('owner_projects?owner_group_hash=eq.'+encodeURIComponent(input.groupHash)+'&status=neq.cancelled&select=id,name,business_unit_code,purpose,status&limit=500');
  const projectIds=projects.map(p=>p.id);
  const installments:Installment[]=projectIds.length?await request('owner_project_installments?project_id=in.('+projectIds.join(',')+')&status=neq.cancelled&select=id,project_id,task_id,installment_no,title,status,task:owner_project_tasks(title)&limit=1000'):[];
  const choices=input.replyText===undefined?input.choices:reconcileSlipSelections({previous:input.previous,reply:input.replyText,projects,installments});
  const proposal=prepareSlipProposal({note:input.note,extraction:input.extraction,projects,installments,choices});
  const result=await request('rpc/financial_stage_owner_slip_review_v1',{p_intake_id:input.id,p_group_hash:input.groupHash,p_actor_hash:input.actorHash,p_message_id:input.messageId,p_revision:input.revision,p_proposal:proposal});
  if(result.conflict) return 'รายละเอียดเปลี่ยนแล้วครับ กรุณาขอสรุปล่าสุดด้วย #'+code(input.id);
  return slipReviewReply({id:input.id,review_revision:result.revision,review_data:result.proposal??proposal});
}

/** Runs before project/payroll handlers, so a slip confirmation cannot confirm an old plan. */
export async function handleOwnerSlipReviewText(input:{targetId:string;userId?:string|null;text:string;messageId?:string|null}):Promise<string|null> {
  // Webhook preflight already rejected affected turns with a delivered notice.
  // Other owner routes must work in the paused, pre-migration deployment too.
  if(ownerSlipMaintenancePaused() || !isAuthorizedOwnerPaymentActor(input.userId))return null;
  if(!input.messageId || await boundLineOpsTeam(input.targetId)!=='owner_general') return null;
  const groupHash=piiHash(input.targetId),actorHash=piiHash(input.userId);
  if(!groupHash||!actorHash) return null;
  const references=[...input.text.matchAll(/#([a-f0-9]{6,32})\b/giu)];
  if(references.length>1) return 'กรุณาตรวจและยืนยันทีละสลิป โดยระบุรหัสรายการเดียวครับ';
  const ref=references[0]?.[1]?.toLowerCase();
  const uuid=(hex:string)=>hex.replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5');
  const scope=ref?'&id=gte.'+uuid(ref.padEnd(32,'0'))+'&id=lte.'+uuid(ref.padEnd(32,'f'))
    :'&review_state=eq.draft&source_user_hash=eq.'+encodeURIComponent(actorHash);
  const fetched:Review[]=await request('financial_owner_expense_intakes?owner_group_hash=eq.'+encodeURIComponent(groupHash)+'&review_state=not.is.null'+scope+'&select=id,source_user_hash,review_state,review_revision,review_data,extraction_data&order=created_at.desc&limit=101');
  if(fetched.length>100) return 'มีหลายรายการครับ กรุณาระบุรหัสสลิปให้ยาวขึ้นเพื่อเลือกเพียงรายการเดียว';
  const rows:Review[]=fetched
    .filter((r:Review)=>r.review_state && (ref?r.id.replace(/-/g,'').startsWith(ref):r.review_state==='draft'&&r.source_user_hash===actorHash));
  if(!rows.length) return ref && /ยืนยัน|ยกเลิก/u.test(input.text)?'ไม่พบสลิปรหัสนี้ในกลุ่มครับ ยังไม่เปลี่ยนข้อมูล':null;
  if(rows.length!==1) return 'มีหลายสลิปครับ กรุณาระบุรหัสรายการเดียว: '+rows.map(r=>'#'+code(r.id)).join(' / ');
  const row=rows[0];
  if(row.source_user_hash!==actorHash) return 'กรุณาให้ผู้ส่งสลิปตรวจและยืนยันรายการนี้ครับ';
  if((row.review_data as any)?.kind==='employee_advance')return 'ตรวจสลิป #'+code(row.id)+' · ฉบับ '+row.review_revision+' (ยังไม่บันทึกรายจ่าย)\nเปิดการ์ดเงินเบิกล่าสุด';
  const existingStaff=parseOwnerStaffTurn(row.review_data?.purpose??'');
  if(existingStaff&&['unknown','salary_advance'].includes(existingStaff.kind))return slipReviewReply(row);
  if(row.review_state!=='draft') return row.review_state==='confirmed'?'รายการ #'+code(row.id)+' บันทึกแล้วครับ ไม่เพิ่มยอดซ้ำ':'รายการ #'+code(row.id)+' ยกเลิกแล้วครับ';
  const text=input.text.replace(/#[a-f0-9]{6,32}\b/giu,'').trim();
  const documentGate=ownerPaymentDocumentGate(row.extraction_data);
  if(documentGate.kind!=='payment_evidence' && !/^ยกเลิก$/u.test(text))return slipReviewReply(row);
  // A previously unclassified upload may belong to the existing payroll flow.
  // Hand off evidence only; never classify an employee advance as a project expense.
  const staff=parseOwnerStaffTurn(text);
  if(staff && (staff.kind==='unknown'||staff.kind==='salary_advance')
    && !row.review_data?.project_id && !row.review_data?.purpose) {
    const result=await request('rpc/financial_handoff_owner_slip_payroll_v1',{
      p_intake_id:row.id,p_group_hash:groupHash,p_actor_hash:actorHash,p_revision:row.review_revision,
    });
    return result.conflict?'รายละเอียดเปลี่ยนแล้วครับ กรุณาตรวจสรุปสลิปนี้อีกครั้ง':null;
  }
  const confirm=text.match(/^ยืนยัน\s+v(\d+)$/iu);
  if(confirm && ref) {
    if(row.review_data?.questions.length || !row.review_data) return slipReviewReply(row);
    const result=await request('rpc/financial_confirm_owner_slip_review_v1',{p_intake_id:row.id,p_group_hash:groupHash,p_actor_hash:actorHash,p_revision:Number(confirm[1]),p_message_id:input.messageId,p_cancel:false});
    if(result.changed) return 'โครงการ/งวดหรือข้อมูลที่ต้องใช้เปลี่ยนไปแล้วครับ ยังไม่บันทึก กรุณาส่ง #'+code(row.id)+' แก้เป็น [รายละเอียดล่าสุด] เพื่อตรวจสรุปใหม่';
    if(result.conflict) return 'ฉบับนี้ไม่ใช่สรุปล่าสุดครับ\n'+slipReviewReply(row);
    if(result.duplicate_transaction) return 'เลขอ้างอิงธุรกรรมนี้มีอยู่แล้วครับ ไม่บันทึกยอดซ้ำ';
    if(result.state==='cancelled') return 'รายการนี้ยกเลิกแล้วครับ ไม่บันทึกรายจ่าย';
    return result.duplicate?'รายการนี้บันทึกแล้วครับ ไม่เพิ่มยอดซ้ำ':'✅ บันทึกสลิป #'+code(row.id)+' ตามสรุปที่ยืนยันแล้วครับ';
  }
  if(/^ยกเลิก$/u.test(text) && ref) {
    const result=await request('rpc/financial_confirm_owner_slip_review_v1',{p_intake_id:row.id,p_group_hash:groupHash,p_actor_hash:actorHash,p_revision:row.review_revision,p_message_id:input.messageId,p_cancel:true});
    if(result.conflict) return 'รายละเอียดเปลี่ยนแล้วครับ กรุณาตรวจสรุปล่าสุดก่อนยกเลิก';
    if(result.state==='confirmed') return 'รายการนี้ยืนยันและบันทึกแล้วครับ ไม่ได้ยกเลิกยอดที่บันทึก';
    return 'ยกเลิกสลิป #'+code(row.id)+' แล้วครับ ไม่บันทึกรายจ่าย';
  }
  if(!text || /^(?:ยืนยัน(?:\s+v\d+)?|ตกลง|ใช่|ครับ|ค่ะ|สรุป|ยกเลิก)$/iu.test(text)) return slipReviewReply(row);
  const corrected=/^(?:แก้เป็น|แก้ไขเป็น|แก้ไข|แก้)\s*/u.test(text);
  const content=text.replace(/^(?:แก้เป็น|แก้ไขเป็น|แก้ไข|แก้)\s*/u,'');
  const amount=content.match(/(?:ยอด|จำนวนเงิน)\s*(?:เป็น|คือ)?\s*([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)(?=\s|บาท|$)/u);
  const date=content.match(/\b(20\d{2}-\d{2}-\d{2})\b/u)?.[1];
  const previous=row.review_data;
  const extraction={...row.extraction_data,amount_total:amount?Number(amount[1].replace(/,/g,'')):previous?.amount??row.extraction_data.amount_total,document_date_local:date??previous?.occurred_on??row.extraction_data.document_date_local};
  const amountOrDateOnly=!!(amount||date) && !content.replace(amount?.[0]??'','').replace(date??'','').replace(/บาท|วันที่|เป็น|คือ/gu,'').trim();
  const note=amountOrDateOnly?(previous?.purpose??row.extraction_data.visible_payment_note??'')
    :corrected?content:mergeSlipReviewNote(previous?.purpose??row.extraction_data.visible_payment_note??'',content);
  return stageSlipReview({id:row.id,groupHash,actorHash,messageId:input.messageId,revision:row.review_revision,note,extraction,
    choices:amountOrDateOnly?previous?.review_choices:corrected?undefined:previous?.review_choices,
    ...(!corrected&&!amountOrDateOnly?{replyText:content,previous}:{})});
}

