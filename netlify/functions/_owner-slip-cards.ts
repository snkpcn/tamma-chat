import { openOwnerEmployeeAdvanceReview } from './_owner-employee-advance';
import { piiHash } from './_operations-db';
import { parseOwnerStaffTurn } from './_owner-staff-intent';
import { boundLineOpsTeam } from './_ops-notifications';
import type { OwnerExpenseProject } from './_owner-expense-intake';
import { OWNER_SLIP_MAINTENANCE_REPLY, ownerSlipMaintenancePaused } from './_owner-slip-maintenance';
import { request, prepareSlipProposal, units, categories, type Review, type SlipProposal, type SlipSelections, type Installment } from './_owner-slip-review';
import { buildOwnerSlipReviewCard, decodeOwnerSlipAction, encodeOwnerSlipAction } from './_owner-slip-review-ui';
import type { LineMessage } from './_ops-line-ui';
import { isAuthorizedOwnerPaymentActor, ownerPaymentDocumentGate, ownerPaymentDocumentClarification, OWNER_NON_PAYMENT_REPLY } from './_owner-payment-document';

type Catalogue={projects:OwnerExpenseProject[];installments:Installment[];loaded?:boolean};
type Context={row:Review;groupHash:string;actorHash:string;catalogue:Catalogue};
const own=(obj:object,key:string)=>Object.prototype.hasOwnProperty.call(obj,key);
const businessChoices=Object.entries(units).filter(([id])=>id!=='other').map(([value,label])=>({label,value,action:'business'}));
const safeAmount=(value:number|null)=>value!==null&&Number.isFinite(value)&&value>0?value:null;
const validCategory=(value:string|undefined)=>!!value && value!=='other' && own(categories,value);
const destinationLabel=(value:string)=>value==='capital_investment'?'ลงทุน':value==='operating_expense'?'ค่าใช้จ่ายดำเนินงาน':null;
const activeInstallments=(catalogue:Catalogue,p:SlipProposal)=>catalogue.installments.filter(i=>i.project_id===p.project_id&&!['cancelled','paid'].includes(i.status));

function cleanLegacyMemo(note:string,original:string|null|undefined):string {
 const memo=original?.trim();
 if(!memo || memo.length<3 || /[\d๐-๙]/u.test(memo))return note;
 let clean=note;
 const repeated=memo+' '+memo;
 while(clean.startsWith(repeated) && (clean.length===repeated.length || /\s/u.test(clean[repeated.length])))clean=clean.slice(memo.length+1);
 return clean;
}
function displayMemo(row:Review,p:SlipProposal):string {
 const note=cleanLegacyMemo(p.purpose,row.extraction_data.visible_payment_note);
 const original=row.extraction_data.visible_payment_note?.trim();
 if(!original || !note.startsWith(original))return note;
 const suffix=note.slice(original.length).trim();
 const compact=(value:string)=>value.replace(/[\s\-‐‑–—]/gu,'').toLowerCase();
 // Remove only a repeated known field from presentation, never an added item detail or OCR evidence.
 return suffix && [p.project_name,units[p.business_unit_code??'']].some(value=>value && compact(value)===compact(suffix))?original:note;
}
async function catalogue(groupHash:string):Promise<Catalogue>{
 const projects:OwnerExpenseProject[]=await request('owner_projects?owner_group_hash=eq.'+encodeURIComponent(groupHash)+'&status=neq.cancelled&select=id,name,business_unit_code,purpose,status&limit=500');
 const ids=projects.map(p=>p.id);
 const installments:Installment[]=ids.length?await request('owner_project_installments?project_id=in.('+ids.join(',')+')&status=neq.cancelled&select=id,project_id,task_id,installment_no,title,status,task:owner_project_tasks(title)&limit=1000'):[];
 return {projects,installments,loaded:true};
}
async function loadContext(targetId:string,userId:string|null|undefined,id:string):Promise<Context|null>{
 if(!isAuthorizedOwnerPaymentActor(userId) || await boundLineOpsTeam(targetId)!=='owner_general')return null;
 const groupHash=piiHash(targetId),actorHash=piiHash(userId);
 if(!groupHash||!actorHash)return null;
 const rows:Review[]=await request('financial_owner_expense_intakes?owner_group_hash=eq.'+encodeURIComponent(groupHash)+'&id=eq.'+encodeURIComponent(id)+'&review_state=not.is.null&select=id,source_user_hash,review_state,review_revision,review_data,extraction_data&limit=2');
 const row=rows.find(r=>r.id===id);
 if(!row||row.source_user_hash!==actorHash)return null;
 return {row,groupHash,actorHash,catalogue:{projects:[],installments:[]}};
}
function requiredStep(p:SlipProposal,cat:Catalogue):'business'|'project'|'category'|'destination'|'installment'|'confirm'|'error'{
 if(p.expense_class==='owner_private')return 'error';
 if(!p.business_unit_code || p.business_unit_code==='other')return 'business';
 if(!p.project_id && (!own(p.review_choices??{},'project') || (p.review_choices as any)?.project_pending))return 'project';
 if(p.review_choices?.category_pending || !validCategory(p.expense_category))return 'category';
 if(!destinationLabel(p.expense_class))return 'destination';
 if(p.review_choices?.installment_pending && activeInstallments(cat,p).length)return 'installment';
 if(!p.installment_id && activeInstallments(cat,p).length && !own(p.review_choices??{},'installment') && !/ไม่ผูกงวด|ไม่แบ่งงวด/u.test(p.purpose))return 'installment';
 return p.questions.length?'error':'confirm';
}
function documentReviewCard(ctx:Context,question:string,options:Array<{label:string;action:string;value?:string}>):LineMessage {
 return {type:'flex',altText:'เอกสารรอตรวจ • '+question,contents:{type:'bubble',body:{type:'box',layout:'vertical',spacing:'md',contents:[{type:'text',text:'เอกสารรอตรวจ',weight:'bold',size:'lg'},{type:'text',text:question,wrap:true},{type:'text',text:'ยังไม่บันทึกรายจ่าย',size:'sm',color:'#69796F'}]},footer:{type:'box',layout:'vertical',spacing:'sm',contents:options.map(option=>({type:'button',action:{type:'postback',label:option.label,data:encodeOwnerSlipAction({id:ctx.row.id,revision:ctx.row.review_revision,action:option.action,...(option.value?{value:option.value}:{})})}}))}}} as LineMessage;
}
async function render(ctx:Context,view?:string,page=0,error?:string):Promise<LineMessage>{
 const {row}=ctx,p=row.review_data;
 if(!p)return {type:'text',text:'อ่านข้อมูลสลิปไม่ได้ครับ กรุณาส่งรายละเอียดอีกครั้ง'};
 const documentGate=ownerPaymentDocumentGate(row.extraction_data);
 if(row.review_state==='draft' && documentGate.kind!=='payment_evidence')return documentReviewCard(ctx,ownerPaymentDocumentClarification(documentGate),documentGate.kind==='needs_document_kind'?[{label:'ใบเสนอราคา',action:'document_kind',value:'quotation'},{label:'หลักฐานโอน',action:'document_kind',value:'payment_evidence'},{label:'เอกสารอื่น',action:'document_kind',value:'other'}]:[{label:'เอาออกจากคิวตรวจ',action:'cancel'},{label:'ไว้ก่อน',action:'later'}]);
 const staff=parseOwnerStaffTurn(p.purpose);
 if(row.review_state==='draft'&&((p as any)?.kind==='employee_advance'||staff&&['unknown','salary_advance'].includes(staff.kind)))
   return documentReviewCard(ctx,error||'เลือกเงินเบิกพนักงานเพื่อตรวจชื่อ ส่วนงาน และยอดสะสมครับ',[{label:'เงินเบิกพนักงาน',action:'employee_advance'},{label:'ไว้ก่อน',action:'later'},{label:'ยกเลิกรายการ',action:'cancel'}]);
 if(!ctx.catalogue.loaded)ctx.catalogue=await catalogue(ctx.groupHash);
 const cat=ctx.catalogue;
 const step=row.review_state!=='draft'?'closed':view??requiredStep(p,cat);
 const common={id:row.id,revision:row.review_revision,amount:safeAmount(p.amount),date:p.occurred_on,memo:displayMemo(row,p),
  project:p.project_name??(own(p.review_choices??{},'project')?'ไม่ผูกโครงการ':null),business:units[p.business_unit_code??'']??null,
  category:validCategory(p.expense_category)?p.expense_subcategory||categories[p.expense_category]:null,categorySuggested:!p.review_choices?.category,
  destination:destinationLabel(p.expense_class),installment:p.installment_label,installmentApplicable:!!p.installment_id || activeInstallments(cat,p).length>0,error};
 let choices:Array<{label:string;action:string;value?:string}>=[],question:string|undefined;
 if(step==='business'){question='รายการนี้เป็นของส่วนไหนครับ?';choices=businessChoices;}
 if(step==='project'){
  question='ผูกกับโครงการไหนครับ?';
  const projects=cat.projects.filter(p=>p.status!=='cancelled'&&(!p.business_unit_code||p.business_unit_code===row.review_data!.business_unit_code));
  const start=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(projects.length/6)-1)))*6;
  choices=projects.slice(start,start+6).map(p=>({label:p.name,action:'project',value:p.id}));
  choices.push({label:'ไม่ผูกโครงการ',action:'no_project'});
  if(start>0)choices.push({label:'ก่อนหน้า',action:'page',value:'project:'+((start/6)-1)});
  if(start+6<projects.length)choices.push({label:'โครงการอื่น',action:'page',value:'project:'+((start/6)+1)});
 }
 if(step==='category'){
  question='รายการนี้เป็นค่าอะไรครับ?';
  const priority=['consumables','ingredients','beverages','packaging','staff','transport','maintenance','equipment'];
  const options=Object.entries(categories).filter(([id])=>id!=='other').sort(([a],[b])=>(priority.includes(a)?priority.indexOf(a):100)-(priority.includes(b)?priority.indexOf(b):100));
  const start=Math.max(0,Math.min(Math.floor(page),Math.ceil(options.length/6)-1))*6;
  choices=options.slice(start,start+6).map(([value,label])=>({label,action:'category',value}));
  if(start===0){
    const suggested=prepareSlipProposal({note:p.purpose,extraction:row.extraction_data,...cat});
    if(validCategory(suggested.expense_category)){
      choices=choices.filter(choice=>choice.value!==suggested.expense_category);
      choices.unshift({label:suggested.expense_subcategory??categories[suggested.expense_category],action:'category',value:suggested.expense_category});
    }
  }
  // Put everyday operating categories first without inventing a new stored category.
  if(start>0)choices.push({label:'ก่อนหน้า',action:'page',value:'category:'+((start/6)-1)});
  if(start+6<options.length)choices.push({label:'หมวดอื่น',action:'page',value:'category:'+((start/6)+1)});
 }
 if(step==='destination'){question='บันทึกเป็นรายการแบบไหนครับ?';choices=[{label:'ค่าใช้จ่ายดำเนินงาน',action:'destination',value:'operating_expense'},{label:'ลงทุน',action:'destination',value:'capital_investment'}];}
 if(step==='installment'){
  question='จ่ายงวดไหนครับ?';const rows=activeInstallments(cat,p),start=Math.max(0,Math.min(Math.floor(page),Math.max(0,Math.ceil(rows.length/6)-1)))*6;
  choices=rows.slice(start,start+6).map(i=>({label:`งวด ${i.installment_no} ${i.task?.title??i.title}`,action:'installment',value:i.id}));
  choices.push({label:'ไม่ผูกงวด',action:'no_installment'});
  if(start>0)choices.push({label:'ก่อนหน้า',action:'page',value:'installment:'+((start/6)-1)});
  if(start+6<rows.length)choices.push({label:'งวดอื่น',action:'page',value:'installment:'+((start/6)+1)});
 }
 if(step==='error'){
  question=p.expense_class==='owner_private'?'โน้ตระบุว่าเป็นรายการส่วนตัวครับ หากอ่านผิด พิมพ์ “แก้เป็น” พร้อมรายละเอียดที่ถูกต้อง':p.questions[0]??'กรุณาตรวจรายละเอียดอีกครั้ง';
  choices=p.expense_class==='owner_private'?[{label:'ยกเลิกสลิปนี้',action:'cancel'}]:[{label:'เลือกหมวด',action:'show_category'},{label:'เลือกส่วนงาน',action:'show_business'},{label:'เลือกโครงการ',action:'show_project'}];
 }
 if(step!=='closed' && documentGate.kind!=='payment_evidence'){
  question=ownerPaymentDocumentClarification(documentGate);
  choices=documentGate.kind==='needs_document_kind'?[{label:'ใบเสนอราคา',action:'document_kind',value:'quotation'},{label:'หลักฐานโอน',action:'document_kind',value:'payment_evidence'},{label:'เอกสารอื่น',action:'document_kind',value:'other'}]:[{label:'ยกเลิกรายการรอตรวจ',action:'cancel'}];
 }
 if(view && step!=='closed' && step!=='confirm')choices.push({label:'กลับไปสรุป',action:'show_review'});
 return buildOwnerSlipReviewCard({...common,step:step as any,question,choices,employeeAdvanceAvailable:row.review_state==='draft'&&documentGate.kind==='payment_evidence',
  ...(step==='closed'?{closedText:row.review_state==='confirmed'?'บันทึกแล้วครับ ไม่เพิ่มยอดซ้ำ':'ยกเลิกรายการแล้วครับ'}:{})});
}

/** Convert only a verified review response, never an arbitrary memo, to an owner card. */
export async function ownerSlipReplyCard(input:{targetId:string;userId?:string|null;text:string;messageId?:string|null;timestamp?:number}):Promise<LineMessage>{
 const multiple=input.text.startsWith('มีหลายสลิปครับ กรุณาระบุรหัสรายการเดียว: ');
 const header=input.text.match(/^(?:ฉบับนี้ไม่ใช่สรุปล่าสุดครับ\n)?ตรวจสลิป #([a-f0-9]{6}) · ฉบับ (\d+) \(ยังไม่บันทึกรายจ่าย\)\n/iu);
 if(!header&&!multiple)return {type:'text',text:input.text};
 if(ownerSlipMaintenancePaused())return {type:'text',text:OWNER_SLIP_MAINTENANCE_REPLY};
 if(!isAuthorizedOwnerPaymentActor(input.userId))return {type:'text',text:'ยังไม่ได้เปิดสิทธิ์ตรวจและยืนยันรายการจ่ายให้บัญชี LINE นี้ครับ'};
 if(await boundLineOpsTeam(input.targetId)!=='owner_general')return {type:'text',text:input.text};
 const groupHash=piiHash(input.targetId),actorHash=piiHash(input.userId);if(!groupHash||!actorHash)return {type:'text',text:input.text};
 if(multiple){
  const rows:Review[]=await request('financial_owner_expense_intakes?owner_group_hash=eq.'+encodeURIComponent(groupHash)+'&source_user_hash=eq.'+encodeURIComponent(actorHash)+'&review_state=eq.draft&select=id,source_user_hash,review_state,review_revision,review_data,extraction_data&order=created_at.desc&limit=10');
  const drafts=rows.filter(row=>row.review_state==='draft'&&row.source_user_hash===actorHash&&row.review_data).slice(0,10);
  if(!drafts.length)return {type:'text',text:'ยังไม่พบสลิปที่รอตรวจครับ'};
  const contents=drafts.map(row=>{const p=row.review_data!;if(ownerPaymentDocumentGate(row.extraction_data).kind!=='payment_evidence')return (documentReviewCard({row,groupHash,actorHash,catalogue:{projects:[],installments:[]}},'เอกสารนี้ยังไม่พบหลักฐานการจ่ายที่ชัดเจน',[{label:'ตรวจเอกสารนี้',action:'show_review'}]) as any).contents;return (buildOwnerSlipReviewCard({id:row.id,revision:row.review_revision,amount:safeAmount(p.amount),date:p.occurred_on,memo:displayMemo(row,p),project:p.project_name,business:units[p.business_unit_code??'']??null,category:null,destination:null,installment:null,installmentApplicable:false,step:'error',question:'ต้องการตรวจสลิปนี้ไหมครับ?',choices:[{label:'ตรวจสลิปนี้',action:'show_review'}]}) as any).contents;});
  while(contents.length>1 && Buffer.byteLength(JSON.stringify({type:'carousel',contents}),'utf8')>50_000)contents.pop();
  return {type:'flex',altText:'เลือกสลิปที่ต้องการตรวจจากการ์ดล่าสุด',contents:{type:'carousel',contents}} as LineMessage;
 }
 const ref=header![1].toLowerCase(),uuid=(hex:string)=>hex.replace(/^(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})$/,'$1-$2-$3-$4-$5');
 const rows:Review[]=await request('financial_owner_expense_intakes?owner_group_hash=eq.'+encodeURIComponent(groupHash)+'&id=gte.'+uuid(ref.padEnd(32,'0'))+'&id=lte.'+uuid(ref.padEnd(32,'f'))+'&review_state=not.is.null&select=id,source_user_hash,review_state,review_revision,review_data,extraction_data&limit=2');
 const matching=rows.filter(r=>r.id.replace(/-/g,'').startsWith(ref)&&r.source_user_hash===actorHash);
 if(matching.length!==1)return {type:'text',text:'มีหลายรายการที่ใกล้เคียงกันครับ กรุณาเปิดสรุปของสลิปที่ต้องการอีกครั้ง'};
 const row=matching[0];
 const employeeCard=await openOwnerEmployeeAdvanceReview({...input,intakeId:row.id,revision:row.review_revision,entry:'saved_note'});
 if(employeeCard)return employeeCard;
 return render({row,groupHash,actorHash,catalogue:{projects:[],installments:[]}});
}

export async function handleOwnerSlipPostback(input:{targetId:string;userId?:string|null;data:string;messageId?:string|null;timestamp?:number}):Promise<LineMessage|null>{
 if(!input.data.startsWith('owner-slip:'))return null;
 const cutoff=process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER;
 if(ownerSlipMaintenancePaused() || (cutoff && (!Number.isFinite(input.timestamp)||!Number.isFinite(Date.parse(cutoff))||input.timestamp!<=Date.parse(cutoff))))return {type:'text',text:OWNER_SLIP_MAINTENANCE_REPLY};
 const action=decodeOwnerSlipAction(input.data);
 if(!action||!input.messageId)return {type:'text',text:'ปุ่มนี้ไม่พร้อมใช้งานครับ กรุณาใช้การ์ดล่าสุด'};
 const ctx=await loadContext(input.targetId,input.userId,action.id);
 if(!ctx)return {type:'text',text:'กรุณาให้ผู้ส่งสลิปเลือกจากการ์ดในกลุ่มเดิมครับ'};
 const {row}=ctx;
 if((row.review_data as any)?.kind==='employee_advance')return await openOwnerEmployeeAdvanceReview({...input,intakeId:row.id,revision:action.revision,entry:'saved_note'})??render(ctx);
 if(row.review_state!=='draft')return render(ctx);
 if(row.review_revision!==action.revision)return render(ctx,undefined,0,'รายการนี้มีการแก้ไขแล้ว กรุณาใช้การ์ดล่าสุด');
 if(action.action==='employee_advance')return await openOwnerEmployeeAdvanceReview({...input,intakeId:row.id,revision:action.revision,entry:'manual_button'})??render(ctx);
 if(!['later','cancel','document_kind'].includes(action.action)){
   const employeeCard=await openOwnerEmployeeAdvanceReview({...input,intakeId:row.id,revision:action.revision,entry:'saved_note'});
   if(employeeCard)return employeeCard;
 }
 if(!ctx.catalogue.loaded)ctx.catalogue=await catalogue(ctx.groupHash);
 if(action.action==='document_kind'){
  if(action.value==='quotation'||action.value==='other')return documentReviewCard(ctx,action.value==='quotation'?'รับว่าเป็นใบเสนอราคาครับ ไม่ใช่หลักฐานจ่าย ต้องการเอารายการนี้ออกจากคิวตรวจไหมครับ?':'รับว่าเป็นเอกสารอื่นครับ ยังไม่ใช้บันทึกรายจ่าย ต้องการเอาออกจากคิวตรวจไหมครับ?',[{label:'เอาออกจากคิวตรวจ',action:'cancel'},{label:'ไว้ก่อน',action:'later'}]);
  return {type:'text',text:'กรุณาตอบกลับรูปหลักฐานการชำระที่ชัดเจนด้วย “ตรวจสลิป” ครับ เอกสารเดิมยังไม่ใช้บันทึกยอด'};
 }
 if(action.action==='later')return {type:'text',text:'เก็บไว้ตรวจต่อแล้วครับ ยังไม่บันทึกรายจ่าย'};
 if(action.action==='show_review')return render(ctx);
 if(action.action.startsWith('show_'))return render(ctx,action.action.slice(5));
 if(action.action==='page'){
  const page=action.value?.match(/^(project|category|installment):(\d{1,3})$/);
  return page?render(ctx,page[1],Number(page[2])):render(ctx,undefined,0,'ปุ่มนี้ไม่พร้อมใช้งานครับ');
 }
 if(action.action==='confirm'||action.action==='cancel'){
  if(action.action==='confirm' && (ownerPaymentDocumentGate(row.extraction_data).kind!=='payment_evidence'||!row.review_data||requiredStep(row.review_data,ctx.catalogue)!=='confirm'))return render(ctx);
  const result=await request('rpc/financial_confirm_owner_slip_review_v1',{p_intake_id:row.id,p_group_hash:ctx.groupHash,p_actor_hash:ctx.actorHash,p_revision:action.revision,p_message_id:input.messageId,p_cancel:action.action==='cancel'});
  if(result.changed||result.conflict){const fresh=await loadContext(input.targetId,input.userId,row.id);const view=result.changed?(String(result.reason).includes('installment')||String(result.reason).includes('task')?'installment':'project'):undefined;return fresh?render(fresh,view,0,'ข้อมูลโครงการหรืองวดเปลี่ยนแล้วครับ กรุณาเลือกข้อมูลปัจจุบัน ยังไม่บันทึก'):{type:'text',text:'ข้อมูลเปลี่ยนแล้วครับ ยังไม่บันทึก'};}
  if(action.action==='cancel'&&ownerPaymentDocumentGate(row.extraction_data).kind!=='payment_evidence')return {type:'text',text:'เอาเอกสารนี้ออกจากคิวตรวจแล้วครับ ไม่มีการบันทึกรายจ่าย'};
  if(result.duplicate_transaction)return {type:'text',text:'รายการนี้มีอยู่แล้วครับ ไม่เพิ่มยอดซ้ำ'};
  return buildOwnerSlipReviewCard({id:row.id,revision:row.review_revision,amount:row.review_data?.amount??null,date:row.review_data?.occurred_on??null,memo:row.review_data?.purpose??'',project:row.review_data?.project_name??null,business:units[row.review_data?.business_unit_code??'']??null,category:row.review_data?.expense_subcategory??null,destination:destinationLabel(row.review_data?.expense_class??''),installment:row.review_data?.installment_label??null,step:'closed',closedText:result.state==='cancelled'?'ยกเลิกรายการแล้วครับ':'บันทึกแล้วครับ ไม่เพิ่มยอดซ้ำ'});
 }
 if(ownerPaymentDocumentGate(row.extraction_data).kind!=='payment_evidence')return render(ctx);
 const p=row.review_data;if(!p)return render(ctx);
 const choices:SlipSelections & {project_pending?:boolean}={...p.review_choices};
 if(p.project_id&&!own(choices,'project'))choices.project=p.project_id;
 if(p.business_unit_code&&!choices.business)choices.business=p.business_unit_code;
 const value=action.value;
 if(action.action==='business' && value && value!=='other'&&own(units,value)){
  choices.business=value;
  const linked=ctx.catalogue.projects.find(project=>project.id===p.project_id);
  if(linked?.business_unit_code && linked.business_unit_code!==value){choices.project=null;choices.project_pending=true;delete choices.installment;delete choices.installment_pending;}
 }else if(action.action==='project'){
  const project=ctx.catalogue.projects.find(project=>project.id===value&&project.status!=='cancelled');
  if(!project)return render(ctx,'project',0,'โครงการนี้ไม่พร้อมใช้งานแล้วครับ');
  const changedProject=p.project_id!==project.id;
  choices.project=project.id;delete choices.project_pending;
  if(changedProject){
   const eligible=activeInstallments(ctx.catalogue,{...p,project_id:project.id});
   if(eligible.length){delete choices.installment;choices.installment_pending=true;}
   else {choices.installment=null;delete choices.installment_pending;}
  }
  if(project.business_unit_code)choices.business=project.business_unit_code;
 }else if(action.action==='no_project'){choices.project=null;delete choices.project_pending;choices.installment=null;delete choices.installment_pending;}
 else if(action.action==='category'&&validCategory(value)){choices.category=value;delete choices.category_pending;}
 else if(action.action==='destination'&&['capital_investment','operating_expense'].includes(value??'')){choices.destination=value;}
 else if(action.action==='installment'){
  if(!activeInstallments(ctx.catalogue,p).some(i=>i.id===value))return render(ctx,'installment',0,'งวดนี้ไม่พร้อมใช้งานแล้วครับ');
  choices.installment=value;delete choices.installment_pending;
 }else if(action.action==='no_installment'){choices.installment=null;delete choices.installment_pending;}
 else return render(ctx,undefined,0,'ปุ่มนี้ไม่พร้อมใช้งานครับ');
 const proposal=prepareSlipProposal({note:cleanLegacyMemo(p.purpose,row.extraction_data.visible_payment_note),extraction:{...row.extraction_data,amount_total:p.amount,document_date_local:p.occurred_on},...ctx.catalogue,choices});
 const result=await request('rpc/financial_stage_owner_slip_review_v1',{p_intake_id:row.id,p_group_hash:ctx.groupHash,p_actor_hash:ctx.actorHash,p_message_id:input.messageId,p_revision:action.revision,p_proposal:proposal});
 if(result.conflict){const fresh=await loadContext(input.targetId,input.userId,row.id);return fresh?render(fresh,undefined,0,'รายการนี้มีการแก้ไขแล้ว กรุณาใช้การ์ดล่าสุด'):render(ctx);}
 return render({...ctx,row:{...row,review_revision:result.revision,review_data:result.proposal??proposal}});
}
