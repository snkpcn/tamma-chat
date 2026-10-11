import {test} from 'node:test';
import assert from 'node:assert/strict';
import {prepareSlipProposal,reconcileSlipSelections,mergeSlipReviewNote,handleOwnerSlipReviewText,type SlipProposal,type SlipSelections,type Installment} from '../netlify/functions/_owner-slip-review';
import {normalizeFinancialImageExtraction} from '../netlify/functions/_inthanin-daily-close-image';
import {piiHash} from '../netlify/functions/_operations-db';

const projectId='11111111-1111-4111-8111-111111111111';
const secondId='22222222-2222-4222-8222-222222222222';
const taskId='33333333-3333-4333-8333-333333333333';
const projects=[
 {id:projectId,name:'ตำมา-ชาติ',business_unit_code:'tamma_restaurant' as const,status:'active'},
 {id:secondId,name:'เฉลียงไม้',business_unit_code:'shared_infrastructure' as const,status:'active'},
];
const installments:Installment[]=[
 {id:'44444444-4444-4444-8444-444444444444',project_id:projectId,task_id:taskId,installment_no:2,title:'งานไฟ',status:'due'},
 {id:'55555555-5555-4555-8555-555555555555',project_id:secondId,task_id:taskId,installment_no:2,title:'งานไม้',status:'due'},
 {id:'66666666-6666-4666-8666-666666666666',project_id:projectId,task_id:taskId,installment_no:3,title:'งานไฟ',status:'due'},
];
const extraction=normalizeFinancialImageExtraction({document_type:'transfer_slip',document_kind:'transfer_evidence',funds_direction:'outgoing',confidence:0.98,amount_total:475,document_date_local:'2026-10-11',visible_payment_note:'ตัวอย่างเสื้อ'},'fixture');
function draft(note='ตัวอย่างเสื้อ ตำมา-ชาติ',extra:SlipSelections={}):SlipProposal {
 return prepareSlipProposal({note,extraction,projects,installments,choices:{project:projectId,business:'tamma_restaurant',category:'consumables',destination:'operating_expense',installment:null,...extra}});
}
function answer(previous:SlipProposal,reply:string) {
 const choices=reconcileSlipSelections({previous,reply,projects,installments});
 return prepareSlipProposal({note:mergeSlipReviewNote(previous.purpose,reply),extraction:{...extraction,amount_total:previous.amount,document_date_local:previous.occurred_on},projects,installments,choices});
}

test('latest typed destination supersedes a stored card choice while retaining contradictory historical memo evidence',()=>{
 const before=draft('ตัวอย่างเสื้อ ตำมา-ชาติ ค่าใช้จ่ายดำเนินงาน');
 const investment=answer(before,'หน่วยการลงทุน');
 assert.equal(investment.expense_class,'capital_investment');
 assert.equal(investment.review_choices?.destination,'capital_investment');
 assert.match(investment.purpose,/ค่าใช้จ่ายดำเนินงาน.*หน่วยการลงทุน/);
 assert.deepEqual(investment.questions,[]);
 const operating=answer(investment,'ไม่ใช่การลงทุน ค่าใช้จ่ายดำเนินงาน');
 assert.equal(operating.expense_class,'operating_expense');assert.deepEqual(operating.questions,[]);
 const conflicting=answer(before,'หน่วยการลงทุน ค่าใช้จ่ายดำเนินงาน');
 assert.ok(conflicting.questions.some(q=>q.includes('การลงทุนหรือค่าใช้จ่ายดำเนินงาน')));
});

test('personal classification can never be bypassed by category or destination selections',()=>{
 for(const destination of ['operating_expense','capital_investment']) {
  const personal=draft('ตัวอย่างเสื้อ ส่วนตัว ตำมา-ชาติ',{destination});
  assert.equal(personal.expense_class,'owner_private');assert.ok(personal.questions.some(q=>q.includes('ส่วนตัว')));
 }
 const laterPersonal=answer(draft(),'ส่วนตัว');
 assert.equal(laterPersonal.expense_class,'owner_private');assert.ok(laterPersonal.questions.some(q=>q.includes('ส่วนตัว')));
});

test('latest no-installment and installment-number answers replace earlier card allocations without deleting memo evidence',()=>{
 const before=draft('ค่าอุปกรณ์ไฟฟ้า ตำมา-ชาติ งวด 2',{category:'equipment',destination:'capital_investment',installment:installments[0].id});
 const unlinked=answer(before,'ไม่ผูกงวด');
 assert.equal(unlinked.installment_id,null);assert.equal(unlinked.review_choices?.installment,null);assert.deepEqual(unlinked.questions,[]);
 assert.match(unlinked.purpose,/งวด 2.*ไม่ผูกงวด/);
 const third=answer(before,'งวด 3');
 assert.equal(third.installment_id,installments[2].id);assert.deepEqual(third.questions,[]);
 const conflicting=answer(before,'ไม่ผูกงวด งวด 3');
 assert.equal(conflicting.installment_id,null);assert.equal(conflicting.review_choices?.installment_pending,true);assert.ok(conflicting.questions.length);
});

test('latest business correction invalidates incompatible project and pending state survives unrelated replies',()=>{
 const central=answer(draft(),'ส่วนกลาง');
 assert.equal(central.business_unit_code,'shared_infrastructure');assert.equal(central.project_id,null);
 assert.equal(central.review_choices?.project_pending,true);assert.ok(central.questions.some(q=>q.includes('เลือกโครงการใหม่')));
 const later=answer(central,'รับทราบรายละเอียด');
 assert.equal(later.review_choices?.project_pending,true);assert.ok(later.questions.some(q=>q.includes('เลือกโครงการใหม่')));
 const unlinked=answer(central,'ไม่ผูกโครงการ');
 assert.equal(unlinked.project_id,null);assert.equal(unlinked.review_choices?.project_pending,undefined);assert.deepEqual(unlinked.questions,[]);
});

test('latest project correction cannot reinterpret an old installment number on another project',()=>{
 const before=draft('ค่าอุปกรณ์ไฟฟ้า ตำมา-ชาติ งวด 2',{category:'equipment',destination:'capital_investment',installment:installments[0].id});
 const moved=answer(before,'เฉลียงไม้');
 assert.equal(moved.project_id,secondId);assert.equal(moved.business_unit_code,'shared_infrastructure');
 assert.equal(moved.installment_id,null);assert.equal(moved.review_choices?.installment_pending,true);assert.ok(moved.questions.length);
 const selected=answer(moved,'งวด 2');
 assert.equal(selected.installment_id,installments[1].id);assert.equal(selected.review_choices?.installment_pending,undefined);assert.deepEqual(selected.questions,[]);
 const unknown=answer(before,'โครงการใหม่ที่ไม่มี');
 assert.equal(unknown.project_id,null);assert.equal(unknown.review_choices?.project_pending,true);assert.ok(unknown.questions.length);
});

test('amount/date-only and unrelated answers preserve all established selections without mutating the prior proposal',()=>{
 const before=draft();const original=JSON.stringify(before);
 for(const reply of ['ยอด 450','วันที่ 2026-10-10','รับทราบรายละเอียด']) {
  const choices=reconcileSlipSelections({previous:before,reply,projects,installments});
  assert.deepEqual(choices,before.review_choices);
 }
 assert.equal(JSON.stringify(before),original);
});

test('a later meaningful category change clears the old category and blocks until explicitly resolved',()=>{
 for(const reply of ['ค่าแรง','ค่าจ้าง']) {
  const changed=answer(draft(),reply);
  assert.equal(changed.review_choices?.category,undefined);
  assert.equal(changed.review_choices?.category_pending,true);
  assert.ok(changed.questions.some(q=>q.includes('หมวดต่างจากเดิม')));
  assert.match(changed.purpose,/ตัวอย่างเสื้อ/);
  const retained=answer(changed,'ยอด 450');
  assert.equal(retained.review_choices?.category_pending,true);assert.ok(retained.questions.length);
 }
 for(const reply of ['ส่วนกลาง','โครงสร้างพื้นฐาน','ตำมา-ชาติ','หน่วยการลงทุน','รายการยังไม่ชัด']) {
  const choices=reconcileSlipSelections({previous:draft(),reply,projects,installments});
  assert.equal(choices.category,'consumables',reply);assert.equal(choices.category_pending,undefined,reply);
 }
 const replacement=prepareSlipProposal({note:'ค่าแรง ตำมา-ชาติ ไม่ผูกงวด',extraction,projects,installments});
 assert.equal(replacement.expense_category,'staff');assert.deepEqual(replacement.questions,[]);
});

test('text handler stages reconciled choices and preserves unrelated fields for prefixed amount/date corrections',async t=>{
 const old={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY,THONGTHAI_OWNER_SLIP_MODE:process.env.THONGTHAI_OWNER_SLIP_MODE,OWNER_FINANCE_LINE_USER_HASHES:process.env.OWNER_FINANCE_LINE_USER_HASHES};
 process.env.SUPABASE_URL='https://choice-corrections.test';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture';process.env.THONGTHAI_OWNER_SLIP_MODE='active';
 t.after(()=>{for(const [key,value] of Object.entries(old)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
 const sourceUser='fixture-owner';process.env.OWNER_FINANCE_LINE_USER_HASHES=piiHash(sourceUser)!;let previous=draft();const staged:SlipProposal[]=[];
 t.mock.method(globalThis,'fetch',async(input:any,init:any={})=>{
  const url=new URL(String(input));assert.equal(url.hostname,'choice-corrections.test');
  if(url.pathname.endsWith('/ops_notification_channels'))return Response.json([{team_code:'owner_general'}]);
  if(url.pathname.endsWith('/financial_owner_expense_intakes'))return Response.json([{id:projectId,source_user_hash:piiHash(sourceUser),review_state:'draft',review_revision:7,review_data:previous,extraction_data:extraction}]);
  if(url.pathname.endsWith('/owner_projects'))return Response.json(projects);
  if(url.pathname.endsWith('/owner_project_installments'))return Response.json(installments);
  assert.ok(url.pathname.endsWith('/rpc/financial_stage_owner_slip_review_v1'),'Only staging, never confirmation or financial allocation');
  const body=JSON.parse(init.body);assert.equal(body.p_revision,7);staged.push(body.p_proposal);
  return Response.json({revision:8,proposal:body.p_proposal});
 });
 const send=(text:string)=>handleOwnerSlipReviewText({targetId:'fixture-group',userId:sourceUser,text,messageId:'message-'+staged.length});
 await send('หน่วยการลงทุน');assert.equal(staged.at(-1)!.expense_class,'capital_investment');
 await send('ส่วนตัว');assert.equal(staged.at(-1)!.expense_class,'owner_private');assert.ok(staged.at(-1)!.questions.length);
 await send('ค่าแรง');assert.equal(staged.at(-1)!.review_choices?.category_pending,true);assert.ok(staged.at(-1)!.questions.length);
 await send('แก้เป็น ยอด 450');assert.equal(staged.at(-1)!.amount,450);assert.deepEqual(staged.at(-1)!.review_choices,previous.review_choices);assert.equal(staged.at(-1)!.purpose,previous.purpose);
 await send('แก้เป็น วันที่ 2026-10-10');assert.equal(staged.at(-1)!.occurred_on,'2026-10-10');assert.deepEqual(staged.at(-1)!.review_choices,previous.review_choices);
 previous=draft('ค่าอุปกรณ์ไฟฟ้า ตำมา-ชาติ งวด 2',{category:'equipment',destination:'capital_investment',installment:installments[0].id});
 await send('ไม่ผูกงวด');assert.equal(staged.at(-1)!.installment_id,null);assert.equal(staged.at(-1)!.review_choices?.installment,null);
});
