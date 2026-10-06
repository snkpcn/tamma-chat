import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyOwnerProjectText,
  classifyOwnerProjectStart,
  handleOwnerProjectQuery,
  handleOwnerProjectText,
  ownerProjectMissingFields,
  parseOwnerProjectBulkTasks,
  parseOwnerProjectTaskStateCommand,
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

test('splits a weekly work list into independent one-time tasks that remain pending until explicitly completed', () => {
  const text = [
    'ทองไทย งานอาทิตย์นี้ของโครงการเฉลียงไม้',
    '1. ตัดไม้ตามขนาด',
    '2. ทาน้ำยารักษาไม้',
    '3. ติดตั้งโครง',
    '4. เก็บรายละเอียด',
  ].join('\n');
  assert.equal(classifyOwnerProjectStart(text), 'one_time_task');
  assert.deepEqual(parseOwnerProjectBulkTasks(text).map(task => task.title), [
    'ตัดไม้ตามขนาด', 'ทาน้ำยารักษาไม้', 'ติดตั้งโครง', 'เก็บรายละเอียด',
  ]);
  const data = applyOwnerProjectText({
    text, intent: 'one_time_task', timestamp: Date.parse('2026-10-06T01:00:00Z'),
  }).data;
  assert.equal(data.project_name, 'เฉลียงไม้');
  assert.equal(data.task_kind, 'one_time');
  assert.equal(data.due_on, '2026-10-11');
  assert.equal(data.bulk_tasks?.length, 4);
  assert.deepEqual(ownerProjectMissingFields('one_time_task', data), []);
  assert.match(renderOwnerProjectDraftSummary('one_time_task', data), /4\. เก็บรายละเอียด/u);
  assert.match(renderOwnerProjectDraftSummary('one_time_task', data), /แต่ละงานจะค้างแยกกัน/u);
});

test('recognizes stable task-number, task-code, and title completion commands', () => {
  assert.deepEqual(parseOwnerProjectTaskStateCommand('งาน 2 จบแล้ว'), {
    state: 'done', referenceKind: 'position', reference: '2', position: 2,
  });
  assert.deepEqual(parseOwnerProjectTaskStateCommand('งาน 3 กับ 4 จบแล้ว'), {
    state: 'done', referenceKind: 'positions', reference: '3, 4', positions: [3, 4],
  });
  assert.deepEqual(parseOwnerProjectTaskStateCommand('งาน 3,4 ของตำมาชาติ จบแล้ว'), {
    state: 'done', referenceKind: 'positions', reference: '3, 4', positions: [3, 4], projectName: 'ตำมาชาติ',
  });
  assert.deepEqual(parseOwnerProjectTaskStateCommand('งาน วัดพื้นที่ครัว กับ แยก station ครัว จบแล้ว'), {
    state: 'done', referenceKind: 'titles', reference: 'วัดพื้นที่ครัว กับ แยก station ครัว', titles: ['วัดพื้นที่ครัว','แยก station ครัว'],
  });
  assert.deepEqual(parseOwnerProjectTaskStateCommand('WK-ABC12345 เสร็จแล้ว'), {
    state: 'done', referenceKind: 'code', reference: 'WK-ABC12345',
  });
  assert.deepEqual(parseOwnerProjectTaskStateCommand('ติดตั้งโครง ยังไม่จบ'), {
    state: 'todo', referenceKind: 'title', reference: 'ติดตั้งโครง',
  });
  assert.equal(parseOwnerProjectTaskStateCommand('งานไหนจบแล้ว'), null);
});

test('LINE flow previews and confirms four tasks once, then completes only the selected task', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://unit.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  let draft: any = null;
  const paths: string[] = [];
  const tasks = [1, 2, 3, 4].map(position => ({
    id: `t${position}`, project_id: 'p1', task_code: `WK-TASK000${position}`,
    title: `งานจริง ${position}`, task_kind: 'one_time', status: 'todo', due_on: '2026-10-11',
    responsible_name: null, source_message_id: 'confirm-bulk', source_batch_position: position,
    confirmed_at: '2026-10-06T08:00:00Z', created_at: '2026-10-06T08:00:00Z',
  }));
  globalThis.fetch = (async(input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname;
    const method = init?.method ?? 'GET';
    paths.push(`${method} ${path}`);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    let rows: any = [];
    if (path.endsWith('/ops_notification_channels')) rows = [{ team_code: 'owner_general' }];
    else if (path.endsWith('/owner_project_conversation_messages') && method === 'POST') rows = [{ message_id: body.message_id }];
    else if (path.endsWith('/owner_project_conversation_messages') && method === 'PATCH') rows = [];
    else if (path.endsWith('/owner_project_conversation_drafts') && method === 'GET') rows = draft ? [draft] : [];
    else if (path.endsWith('/owner_project_conversation_drafts') && method === 'POST') {
      draft = {
        id: 'draft-bulk', ...body, updated_at: '2026-10-06T08:00:00Z',
        expires_at: '2026-10-13T08:00:00Z',
      };
      rows = [draft];
    } else if (path.endsWith('/owner_projects')) rows = [{ id: 'p1', name: 'เฉลียงไม้', project_code: 'PJ-WOOD' }];
    else if (path.endsWith('/owner_project_tasks')) rows = tasks;
    else if (path.endsWith('/rpc/owner_project_confirm_bulk_tasks_v1')) {
      draft = null;
      rows = [{ ok: true, duplicate: false, project_id: 'p1', project_code: 'PJ-WOOD', project_name: 'เฉลียงไม้', task_count: 4,
        tasks: tasks.map(task => ({ id: task.id, task_code: task.task_code, title: task.title, position: task.source_batch_position })) }];
    } else if (path.endsWith('/rpc/owner_project_set_task_state_from_line_v1')) {
      rows = [{ ok: true, duplicate: false, task_id: 't2', task_code: 'WK-TASK0002', task_title: 'งานจริง 2', task_status: 'done', project_name: 'เฉลียงไม้', batch_position: 2 }];
    } else if (path.endsWith('/rpc/owner_project_set_task_states_from_line_v1')) {
      assert.deepEqual(body.p_task_ids, ['t3','t4']);
      rows = [{ ok: true, task_count: 2, tasks: [3,4].map(position => ({
        task_id: `t${position}`, task_code: `WK-TASK000${position}`, task_title: `งานจริง ${position}`,
        task_status: 'done', batch_position: position, duplicate: false,
      })) }];
    }
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  try {
    const list = ['ทองไทย งานอาทิตย์นี้ของโครงการเฉลียงไม้', '1. งานจริง 1', '2. งานจริง 2', '3. งานจริง 3', '4. งานจริง 4'].join('\n');
    const preview = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: list, messageId: 'start-bulk', timestamp: Date.parse('2026-10-06T08:00:00Z') });
    assert.match(preview ?? '', /รวม 4 งาน/u);
    assert.match(preview ?? '', /4\. งานจริง 4/u);

    const beforeConfirmation = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: 'งาน 3 กับ 4 จบแล้ว', messageId: 'too-early', timestamp: Date.parse('2026-10-06T08:00:30Z') });
    assert.match(beforeConfirmation ?? '', /ยังเป็นร่าง.*ยืนยัน/u);
    const beforeConfirmationByName = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: 'งาน งานจริง 3 กับ งานจริง 4 จบแล้ว', messageId: 'too-early-by-name', timestamp: Date.parse('2026-10-06T08:00:45Z') });
    assert.match(beforeConfirmationByName ?? '', /ยังเป็นร่าง.*ยืนยัน/u);
    assert.ok(!paths.includes('POST /rest/v1/rpc/owner_project_set_task_states_from_line_v1'));

    const confirmed = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: 'ยืนยัน', messageId: 'confirm-bulk', timestamp: Date.parse('2026-10-06T08:01:00Z') });
    assert.match(confirmed ?? '', /บันทึก 4 งาน/u);
    assert.match(confirmed ?? '', /งาน 2: งานจริง 2/u);

    const multiple = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: 'งาน 3 กับ 4 จบแล้ว', messageId: 'complete-3-4', timestamp: Date.parse('2026-10-06T08:02:00Z') });
    assert.match(multiple ?? '', /ติ๊กว่าเสร็จ 2 งาน/u);
    assert.match(multiple ?? '', /งาน 3 — งานจริง 3/u);
    assert.match(multiple ?? '', /งาน 4 — งานจริง 4/u);

    const byNames = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: 'งาน งานจริง 3 กับ งานจริง 4 จบแล้ว', messageId: 'complete-by-names', timestamp: Date.parse('2026-10-06T08:02:30Z') });
    assert.match(byNames ?? '', /งาน 3 — งานจริง 3/u);
    assert.match(byNames ?? '', /งาน 4 — งานจริง 4/u);

    const completed = await handleOwnerProjectText({ targetId: 'bulk-owner-group', userId: 'owner-1', text: 'งาน 2 จบแล้ว', messageId: 'complete-2', timestamp: Date.parse('2026-10-06T08:02:00Z') });
    assert.match(completed ?? '', /✅ ติ๊กว่าเสร็จแล้ว/u);
    assert.match(completed ?? '', /งาน 2 — งานจริง 2/u);
    assert.ok(paths.includes('POST /rest/v1/rpc/owner_project_confirm_bulk_tasks_v1'));
    assert.ok(paths.includes('POST /rest/v1/rpc/owner_project_set_task_state_from_line_v1'));
    assert.ok(paths.includes('POST /rest/v1/rpc/owner_project_set_task_states_from_line_v1'));
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
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
      :path.endsWith('/financial_owner_expense_intakes')?[
        {id:'e1',owner_project_id:'p1',occurred_on:'2026-10-06',amount:'1000',purpose_raw:'ค่าแปรรูปไม้',status:'categorized',evidence_message_id:'m1'},
        {id:'e2',owner_project_id:null,occurred_on:'2026-10-06',amount:'50000',purpose_raw:'ค่าก่อสร้างครัว ตำมาชาติ',status:'categorized',evidence_message_id:'m2'},
        {id:'e3',owner_project_id:null,occurred_on:'2026-10-06',amount:'50000',purpose_raw:'ค่าก่อสร้างงวดสอง',status:'categorized',evidence_message_id:'m3'},
      ]
      :[];
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try{
    const summary=await handleOwnerProjectQuery({targetId:'owner-group-1',text:'สรุปมา',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(summary??'',/เฉลียงไม้/u);assert.match(summary??'',/ค่าแปรรูปไม้ · 1,000 บาท/u);
    assert.match(summary??'',/รายจ่ายที่บันทึกในกลุ่ม: 101,000 บาท/u);
    assert.match(summary??'',/ค่าก่อสร้างครัว ตำมาชาติ · 50,000 บาท — ยังไม่ผูกโครงการ/u);
    const projectSpend=await handleOwnerProjectQuery({targetId:'owner-group-1',text:'ยอดโครงการเท่าไหร่แล้ว',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(projectSpend??'',/จ่ายแล้วที่ผูกกับโครงการ: 1,000 บาท/u);
    assert.doesNotMatch(projectSpend??'',/50,000|101,000/u);
    const pending=await handleOwnerProjectQuery({targetId:'owner-group-1',text:'มีอะไรค้าง',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(pending??'',/ค้าง\/เลยกำหนด\/ต้องตาม/u);assert.match(pending??'',/แปรรูปไม้/u);
    for(const text of ['มีงานค้างไหม','มีงานค้างมั้ย','มีงานอะไรค้างรึป่าว','ตอนนี้มีอะไรต้องทำ','เหลืองานอะไรบ้าง']){
      const natural=await handleOwnerProjectQuery({targetId:'owner-group-1',text,timestamp:Date.parse('2026-10-06T06:00:00Z')});
      assert.match(natural??'',/แปรรูปไม้/u,`must understand natural owner query: ${text}`);
    }
    assert.ok(paths.some(path=>path.includes('/owner_project_task_checkins?')));
    assert.ok(paths.some(path=>path.includes('/financial_owner_expense_intakes?owner_group_hash=')));
  }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey}
});

test('configured cafe group summary reads only cafe-scoped backend records',async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const paths:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const path=new URL(String(input)).pathname;paths.push(String(input));
    return new Response(JSON.stringify(path.endsWith('/ops_notification_channels')?[{team_code:'cafe'}]:[]),{status:200});
  }) as typeof fetch;
  try{
    const result=await handleOwnerProjectQuery({targetId:'cafe-group',text:'งานกลุ่มนี้เป็นไง',timestamp:Date.parse('2026-10-06T06:00:00Z')});
    assert.match(result??'',/ไม่มีรายการค้างที่ต้องติดตาม/u);
    assert.ok(paths.some(path=>path.includes('/cafe_inquiries?')));
    assert.ok(paths.some(path=>path.includes('business_unit_code=eq.inthanin')));
    assert.ok(!paths.some(path=>path.includes('owner_group_hash=')));
  }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey}
});

test('restaurant group sees confirmed restaurant project tasks from Owner without leaking the wood project',async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const paths:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const url=new URL(String(input));paths.push(String(input));
    const rows=url.pathname.endsWith('/ops_notification_channels')?[{team_code:'restaurant'}]
      :url.pathname.endsWith('/bookings')?[]
      :url.pathname.endsWith('/owner_projects')?[{id:'p-restaurant',name:'ตำมาชาติ',project_code:'PJ-REST'}]
      :url.pathname.endsWith('/financial_owner_expense_intakes')?[
        {owner_project_id:null,amount:50000,purpose_raw:'ค่าก่อสร้างครัว ตำมาชาติ',evidence_message_id:'slip-one'},
        {owner_project_id:null,amount:50000,purpose_raw:'ค่าก่อสร้างงวดสอง',evidence_message_id:'slip-two'},
      ]
      :url.pathname.endsWith('/owner_project_tasks')?[
        {id:'t1',project_id:'p-restaurant',task_code:'WK-ONE',title:'รายการหลัก Menu พร้อม',task_kind:'one_time',status:'todo',due_on:'2026-10-11',source_batch_position:1,source_message_id:'batch-1',confirmed_at:'2026-10-06T10:44:00Z'},
        {id:'t3',project_id:'p-restaurant',task_code:'WK-THREE',title:'แยก Station ครัวครบ',task_kind:'one_time',status:'done',due_on:'2026-10-11',source_batch_position:3,source_message_id:'batch-1',confirmed_at:'2026-10-06T10:44:00Z'},
      ]:[];
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try{
    const summary=await handleOwnerProjectQuery({targetId:'restaurant-group',text:'สรุปมา',timestamp:Date.parse('2026-10-06T10:50:00Z')});
    assert.match(summary??'',/งาน 1 — ตำมาชาติ: รายการหลัก Menu พร้อม/u);
    assert.match(summary??'',/งาน 3 — ตำมาชาติ: แยก Station ครัวครบ/u);
    assert.match(summary??'',/รายจ่ายหมวดนี้ที่บันทึก: 100,000 บาท/u);
    assert.doesNotMatch(summary??'',/เฉลียงไม้|ยังไม่มีงานในตาราง/u);
    const pending=await handleOwnerProjectQuery({targetId:'restaurant-group',text:'มีอะไรค้าง',timestamp:Date.parse('2026-10-06T10:50:00Z')});
    assert.match(pending??'',/รายการหลัก Menu พร้อม/u);
    assert.doesNotMatch(pending??'',/แยก Station ครัวครบ/u);
    assert.doesNotMatch(pending??'',/100,000/u);
    const spend=await handleOwnerProjectQuery({targetId:'restaurant-group',text:'มีจ่ายอะไรไปแล้ว',timestamp:Date.parse('2026-10-06T10:50:00Z')});
    assert.match(spend??'',/100,000 บาท/u);
    const projectSpend=await handleOwnerProjectQuery({targetId:'restaurant-group',text:'ยอดโครงการเท่าไหร่แล้ว',timestamp:Date.parse('2026-10-06T10:50:00Z')});
    assert.match(projectSpend??'',/ยังไม่มีรายการจ่ายที่ยืนยันแล้วผูกกับโครงการ/u);
    assert.ok(paths.some(path=>path.includes('business_unit_code=eq.tamma_restaurant')));
    assert.ok(paths.some(path=>path.includes('status=eq.categorized')));
    assert.ok(!paths.some(path=>path.includes('owner_group_hash=')));
  }finally{globalThis.fetch=oldFetch;if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey}
});
