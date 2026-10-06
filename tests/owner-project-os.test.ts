import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyOwnerProjectText,
  classifyOwnerProjectStart,
  handleOwnerProjectQuery,
  ownerProjectMissingFields,
  renderOwnerProjectDraftSummary,
} from '../netlify/functions/_owner-project-os';

test('starts a project draft from natural Owner-group Thai but leaves read questions and family chat alone', () => {
  assert.equal(classifyOwnerProjectStart('เดี๋ยวจะลงทุนใหม่ มีโปรเจคสร้างใหม่'), 'new_project');
  assert.equal(classifyOwnerProjectStart('ทองไทย เพิ่มงานที่ต้องทำทุกวันอาทิตย์'), 'weekly_task');
  assert.equal(classifyOwnerProjectStart('แม่ เดี๋ยวเราคุยเรื่องลงทุนกัน'), null);
  assert.equal(classifyOwnerProjectStart('วันนี้ยอดขายเป็นไง'), null);
  assert.equal(classifyOwnerProjectStart('โครงการไม้ยอดจ่ายเท่าไหร่'), null);
  assert.equal(classifyOwnerProjectStart('โครงการเฉลียงไม้จ่ายแล้วเท่าไหร่'), null);
  assert.equal(classifyOwnerProjectStart('ครัวลงทุนไปเท่าไหร่แล้ว'), null);
  assert.equal(classifyOwnerProjectStart('ลงทุนเงินสด 5,000 ซื้อชั้นวาง ตำมา-ชาติ'), null);
});

test('collects project, work, budget, vendor, installments, and schedule one simple answer at a time', () => {
  const intent = 'new_project' as const;
  let data = applyOwnerProjectText({ text: 'ทองไทย สร้างโปรเจคใหม่', intent }).data;
  assert.deepEqual(ownerProjectMissingFields(intent, data), [
    'project_name', 'work_title', 'budget', 'counterparty', 'payment_plan', 'schedule',
  ]);

  data = applyOwnerProjectText({ text: 'ครัวใหม่', intent, data, expectedField: 'project_name' }).data;
  data = applyOwnerProjectText({ text: 'ทำเคาน์เตอร์ครัว', intent, data, expectedField: 'work_title' }).data;
  data = applyOwnerProjectText({ text: '100,000', intent, data, expectedField: 'budget' }).data;
  data = applyOwnerProjectText({ text: 'ช่างสมชาย', intent, data, expectedField: 'counterparty' }).data;
  data = applyOwnerProjectText({ text: 'แบ่ง 2 งวด โอน', intent, data, expectedField: 'payment_plan' }).data;
  data = applyOwnerProjectText({ text: 'ภายในเดือนนี้', intent, data, expectedField: 'schedule' }).data;

  assert.deepEqual(ownerProjectMissingFields(intent, data), []);
  assert.equal(data.project_name, 'ครัวใหม่');
  assert.equal(data.work_title, 'เคาน์เตอร์ครัว');
  assert.equal(data.budget_amount, 100_000);
  assert.equal(data.counterparty_name, 'ช่างสมชาย');
  assert.equal(data.installment_count, 2);
  assert.equal(data.payment_method, 'transfer');
  assert.equal(data.schedule_text, 'ภายในเดือนนี้');
  assert.match(renderOwnerProjectDraftSummary(intent, data), /พิมพ์ “ยืนยัน” เพื่อบันทึกเข้าหลังบ้านทันที/u);
});

test('infers a veranda project belongs to shared infrastructure', () => {
  const data = applyOwnerProjectText({
    text: 'เฉลียงไม้',
    intent: 'new_project',
    expectedField: 'project_name',
  }).data;
  assert.equal(data.project_name, 'เฉลียงไม้');
  assert.equal(data.business_unit_code, 'shared_infrastructure');
});

test('extracts a complete project request in one message and accepts unknown optional answers', () => {
  const intent = classifyOwnerProjectStart(
    'ทองไทย สร้างโปรเจคครัวใหม่ ทำครัว งบ 100,000 จ้างช่างสมชาย แบ่ง 2 งวด ภายในเดือนนี้',
  );
  assert.equal(intent, 'new_project');
  const parsed = applyOwnerProjectText({
    text: 'ทองไทย สร้างโปรเจคครัวใหม่ ทำครัว งบ 100,000 จ้างช่างสมชาย แบ่ง 2 งวด ภายในเดือนนี้',
    intent: intent!,
  }).data;
  assert.deepEqual(ownerProjectMissingFields(intent!, parsed), []);

  const unknownVendor = applyOwnerProjectText({
    text: 'ยังหาอยู่', intent: 'investment_plan', data: {}, expectedField: 'counterparty',
  }).data;
  assert.deepEqual(unknownVendor.unknown_fields, ['counterparty']);
});

test('project route is Owner-only, confirmation-gated, idempotent, and before read-only intelligence', () => {
  const webhook = readFileSync('netlify/functions/line-webhook.ts', 'utf8');
  const project = webhook.lastIndexOf('handleOwnerProjectText');
  const intelligence = webhook.lastIndexOf('handleOwnerBusinessQuestion');
  const expense = webhook.lastIndexOf('handleOwnerExpenseText');
  assert.ok(project >= 0 && intelligence > project && expense > intelligence);

  const implementation = readFileSync('netlify/functions/_owner-project-os.ts', 'utf8');
  assert.match(implementation, /team !== 'owner_general'/u);
  assert.match(implementation, /owner_project_confirm_draft_v1/u);
  assert.match(implementation, /resolution=ignore-duplicates/u);
  assert.match(implementation, /status: 'cancelled'/u);
  assert.match(implementation, /พิมพ์ “ยืนยัน”/u);
});

test('pending slip answers are scoped to the sender unless an explicit item code is used', () => {
  const intake = readFileSync('netlify/functions/_owner-expense-intake.ts', 'utf8');
  assert.match(intake, /source_user_hash === actorHash/u);
  assert.match(intake, /reference\.code\s*\?\s*allRows/u);
});

test('group summary reads current project task and receipt data from its group binding', async () => {
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const paths:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const url=String(input),path=new URL(url).pathname;paths.push(url);
    const rows=path.endsWith('/ops_notification_channels')?[{team_code:'owner_general'}]
      :path.endsWith('/owner_projects')?[{id:'p1',name:'เฉลียงไม้',project_code:'PJ-1'}]
      :path.endsWith('/owner_project_tasks')?[{id:'t1',project_id:'p1',title:'แปรรูปไม้',task_kind:'one_time',status:'todo',due_on:null,responsible_name:'ช่างชล'}]
      :path.endsWith('/financial_owner_expense_intakes')?[{id:'e1',owner_project_id:'p1',occurred_on:'2026-10-06',amount:'1000',purpose_raw:'ค่าแปรรูปไม้',evidence_message_id:'m1'}]
      :[];
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try{
    const summary=await handleOwnerProjectQuery({targetId:'owner-group-1',text:'สรุปมา',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(summary??'',/เฉลียงไม้/u);assert.match(summary??'',/ค่าแปรรูปไม้ · 1,000 บาท/u);
    const pending=await handleOwnerProjectQuery({targetId:'owner-group-1',text:'มีอะไรค้าง',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(pending??'',/ค้าง\/เลยกำหนด\/ต้องตาม/u);assert.match(pending??'',/แปรรูปไม้/u);
    assert.ok(paths.some(path=>path.includes('/owner_project_task_checkins?')));
    assert.ok(paths.some(path=>path.includes('/financial_owner_expense_intakes?owner_group_hash=')));
  }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey}
});

test('configured cafe group summary uses only cafe records, not owner project data',async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const paths:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const path=new URL(String(input)).pathname;paths.push(path);
    return new Response(JSON.stringify(path.endsWith('/ops_notification_channels')?[{team_code:'cafe'}]:[]),{status:200});
  }) as typeof fetch;
  try{
    const result=await handleOwnerProjectQuery({targetId:'cafe-group',text:'งานกลุ่มนี้เป็นไง',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(result??'',/ไม่มีรายการค้างที่ต้องติดตาม/u);
    assert.ok(paths.some(path=>path.endsWith('/cafe_inquiries')));
    assert.ok(!paths.some(path=>path.endsWith('/owner_projects')));
  }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey}
});
