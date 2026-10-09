import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { piiHash } from '../netlify/functions/_operations-db';
import {
  handleOwnerExpenseText,
  handleOwnerRecentSlipProjectPurpose,
  handleOwnerPaidExpenseMethodFollowup,
  matchNamedProjectForOwnerPaidExpense,
  parseTypedOwnerPaidExpense,
} from '../netlify/functions/_owner-expense-intake';
import { parseOwnerReportedPaidTotal } from '../netlify/functions/_owner-paid-total';

test('a natural paid expense recognizes the existing restaurant project and equipment category', () => {
  assert.deepEqual(parseTypedOwnerPaidExpense('จ่ายเงินค่าติดตั้งแอร์ ตำมา-ชาติ 15,000'), {
    amount: 15000,
    title: 'ค่าติดตั้งแอร์',
    category: 'equipment',
    businessUnit: 'tamma_restaurant',
    paymentMethod: 'other',
  });
  assert.equal(parseTypedOwnerPaidExpense('จะจ่ายค่าติดตั้งแอร์ ตำมา-ชาติ 15,000'), null);
  assert.equal(parseTypedOwnerPaidExpense('จ่ายค่าแอร์เท่าไหร่ 15,000?'), null);
  assert.equal(parseTypedOwnerPaidExpense('ลงทุนเงินสด 5,000 ซื้อชั้นวาง ตำมา-ชาติ'), null);
  assert.equal(matchNamedProjectForOwnerPaidExpense('จ่ายเงินค่าติดตั้งแอร์ ตำมา-ชาติ 15,000', [
    { id: 'restaurant-project', name: 'ตำมาชาติ', business_unit_code: 'tamma_restaurant', status: 'active' },
    { id: 'wood-project', name: 'เฉลียงไม้', business_unit_code: 'shared_infrastructure', status: 'completed' },
  ]).kind, 'matched');
  assert.equal(matchNamedProjectForOwnerPaidExpense('จ่ายเงินค่าก่อสร้างเฉลียงไม้ 5000', [
    { id:'wood-project',name:'เฉลียงไม้',business_unit_code:null,status:'completed' },
  ]).kind,'matched');
});

test('Owner LINE expense uses the bound group, one source message and a project-linked transaction', async () => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://unit.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const calls: Array<{ path: string; body?: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ path: url.pathname + url.search, body });
    const rows = url.pathname.endsWith('/ops_notification_channels') ? [{ team_code: 'owner_general' }]
      : url.pathname.endsWith('/financial_owner_expense_intakes') ? []
      : url.pathname.endsWith('/owner_projects') ? [{
        id: 'restaurant-project', name: 'ตำมาชาติ', business_unit_code: 'tamma_restaurant', status: 'active',
      }]
      : url.pathname.endsWith('/owner_project_conversation_drafts') && init?.method === 'POST'
        ? [{id:'draft-air',data:body?.data,missing_fields:body?.missing_fields}]
      : url.pathname.endsWith('/rpc/owner_project_record_line_investment_v1')
        ? { ok: true, duplicate: false, id: 'expense-id' }
        : [];
    return new Response(JSON.stringify(rows), { status: 200 });
  }) as typeof fetch;
  try {
    const reply = await handleOwnerExpenseText({
      targetId: 'owner-group', userId: 'owner-user',
      text: 'จ่ายเงินค่าติดตั้งแอร์ ตำมา-ชาติ 15,000',
      messageId: 'line-msg-air-15000', timestamp: Date.parse('2026-10-07T08:14:00Z'),
    });
    assert.match(reply ?? '', /บันทึกรายจ่ายเข้าหลังบ้าน/);
    assert.match(reply ?? '', /โครงการ: ตำมาชาติ/);
    assert.match(reply ?? '', /15,000 บาท/);
    assert.match(reply ?? '', /ตั้งเงินไว้ประมาณเท่าไร/u);
    const projectRead = calls.find(call => call.path.startsWith('/rest/v1/owner_projects'))!;
    assert.match(projectRead.path, new RegExp('owner_group_hash=eq\\.' + piiHash('owner-group')));
    const write = calls.find(call => call.path.endsWith('/rpc/owner_project_record_line_investment_v1'))!;
    assert.deepEqual({
      amount: write.body?.p_amount,
      project: write.body?.p_project_id,
      category: write.body?.p_category,
      payment: write.body?.p_payment_method,
      source: write.body?.p_source_message_id,
    }, {
      amount: 15000,
      project: 'restaurant-project',
      category: 'equipment',
      payment: 'other',
      source: 'line-msg-air-15000',
    });
  } finally {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});

test('the short เงินสด reply updates the same paid entry and continues the existing plan', async () => {
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const calls:Array<{path:string;body?:Record<string,unknown>}>=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));const body=init?.body?JSON.parse(String(init.body)):undefined;
    calls.push({path:url.pathname+url.search,body});
    const rows=url.pathname.endsWith('/ops_notification_channels')?[{team_code:'owner_general'}]
      :url.pathname.endsWith('/owner_project_conversation_drafts')&&init?.method!=='PATCH'?[{
        id:'draft-wood',data:{project_name:'เฉลียงไม้',work_title:'ค่าก่อสร้างเฉลียงไม้'},
        missing_fields:['budget','counterparty','payment_plan','schedule','responsible'],
        source_message_id:'line-paid-wood',expires_at:'2099-01-01T00:00:00Z',
      }]
      :url.pathname.endsWith('/financial_investment_entries')?[{id:'wood-expense',payment_method:'other'}]
      :{ok:true,duplicate:false};
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try{
    const reply=await handleOwnerPaidExpenseMethodFollowup({targetId:'owner-group',userId:'owner-user',
      text:'เงินสด',messageId:'line-cash-reply'});
    assert.match(reply??'',/ไม่เพิ่มยอดซ้ำ/u);
    assert.match(reply??'',/ตั้งเงินไว้ประมาณเท่าไร/u);
    const write=calls.find(call=>call.path.endsWith('/rpc/owner_project_set_line_payment_method_v1'));
    assert.equal(write?.body?.p_entry_id,'wood-expense');
    assert.equal(write?.body?.p_method,'cash');
    assert.equal(calls.filter(call=>call.path.endsWith('/rpc/owner_project_record_line_investment_v1')).length,0);
  }finally{globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});

test('a payment for completed เฉลียงไม้ links the old project and asks for total budget without treating 5,000 as the budget', async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const calls:Array<{path:string;body?:Record<string,unknown>}>=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));const body=init?.body?JSON.parse(String(init.body)):undefined;
    calls.push({path:url.pathname+url.search,body});
    const rows=url.pathname.endsWith('/ops_notification_channels')?[{team_code:'owner_general'}]
      :url.pathname.endsWith('/financial_owner_expense_intakes')?[]
      :url.pathname.endsWith('/owner_projects')?[{id:'wood-project',name:'เฉลียงไม้',business_unit_code:null,status:'completed'}]
      :url.pathname.endsWith('/owner_project_conversation_drafts')&&init?.method==='POST'
        ?[{id:'draft-wood',data:body?.data,missing_fields:body?.missing_fields}]
      :url.pathname.endsWith('/rpc/owner_project_record_line_investment_v1')?{ok:true,duplicate:false,id:'wood-payment'}
      :[];
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try{
    const reply=await handleOwnerExpenseText({targetId:'owner-group',userId:'owner-user',
      text:'จ่ายเงินค่าก่อสร้างเฉลียงไม้ 5000',messageId:'line-wood-5000'});
    assert.match(reply??'',/โครงการ: เฉลียงไม้/u);
    assert.match(reply??'',/ตั้งเงินไว้ประมาณเท่าไร/u);
    const write=calls.find(call=>call.path.endsWith('/rpc/owner_project_record_line_investment_v1'));
    assert.equal(write?.body?.p_project_id,'wood-project');
    assert.equal(write?.body?.p_amount,5000);
    const draft=calls.find(call=>call.path.endsWith('/owner_project_conversation_drafts')&&call.body);
    assert.equal((draft?.body?.data as Record<string,unknown>)?.budget_amount,undefined);
    assert.equal((draft?.body?.data as Record<string,unknown>)?.project_name,'เฉลียงไม้');
  }finally{globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});

test('continuation RPC keeps group, sender, amount and audit boundaries',()=>{
  const sql=readFileSync('supabase/migrations/20261008070000_owner_paid_expense_continuation_v1.sql','utf8');
  assert.match(sql,/status<>'cancelled'/u);
  assert.match(sql,/business_unit_code is null or business_unit_code=p_business_unit_code/u);
  assert.match(sql,/source_user_hash is distinct from trim\(p_actor_hash\)/u);
  assert.match(sql,/financial_investment_entry_audit_events/u);
  assert.match(sql,/to service_role/u);
  assert.doesNotMatch(sql,/delete\s+from|drop\s+table/iu);
});

test('LINE RPC is service-role-only and checks group binding before writing', () => {
  const migration = readFileSync('supabase/migrations/20261007083000_owner_paid_expense_line_v1.sql', 'utf8');
  assert.match(migration, /owner_group_hash=trim\(p_owner_group_hash\)/);
  assert.match(migration, /source_message_id=trim\(p_source_message_id\)/);
  assert.match(migration, /source_channel='line'/);
  assert.match(migration, /owner_project_link_financial_v1/);
  assert.match(migration, /from public, anon, authenticated/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /delete\s+from|drop\s+table/iu);
});

test('a kitchen slip description without the word โครงการ links only the bound Owner project', async () => {
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const calls:Array<{path:string;body?:Record<string,unknown>}>=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));
    const body=init?.body?JSON.parse(String(init.body)):undefined;
    calls.push({path:url.pathname+url.search,body});
    const rows=url.pathname.endsWith('/ops_notification_channels')?[{team_code:'owner_general'}]
      :url.pathname.endsWith('/financial_owner_expense_intakes')?[{
        id:'kitchen-slip-3',source_user_hash:piiHash('owner-user'),status:'awaiting_purpose',
        amount:50000,occurred_on:'2026-10-07',document_type:'transfer_slip',purpose_raw:null,
        owner_project_id:null,owner_project_task_id:null,owner_project_installment_id:null,
      }]
      :url.pathname.endsWith('/owner_projects')?[{
        id:'restaurant-project',name:'ตำมา-ชาติ',business_unit_code:'tamma_restaurant',status:'active',
      }]
      :url.pathname.endsWith('/rpc/financial_resolve_owner_expense_intake_v1')?{
        ok:true,amount:50000,business_unit_code:'tamma_restaurant',expense_class:'capital_investment',
        expense_category:'construction',status:'categorized',
      }
      :{ok:true};
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try{
    const reply=await handleOwnerExpenseText({targetId:'owner-group',userId:'owner-user',
      text:'ค่าก่อสร้างครัว ตำมา-ชาติ งวดสาม',messageId:'line-classify-3'});
    assert.match(reply??'',/โครงการ: ตำมา-ชาติ/u);
    assert.ok(calls.some(call=>call.path.includes('/owner_projects?owner_group_hash=eq.'+piiHash('owner-group'))));
    const link=calls.find(call=>call.path.endsWith('/rpc/owner_project_link_financial_v1'));
    assert.equal(link?.body?.p_project_id,'restaurant-project');
    assert.equal(link?.body?.p_financial_id,'kitchen-slip-3');
  }finally{
    globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
});

test('a paid-total statement is reconciliation, not a new transaction or purpose for a 200 baht slip', async () => {
  assert.equal(parseOwnerReportedPaidTotal('จ่ายไปแล้ว 6200'), 6200);
  assert.equal(parseOwnerReportedPaidTotal('ยอดจ่ายไปแล้ว 6,200 บาท'), 6200);
  assert.equal(parseOwnerReportedPaidTotal('จ่ายเงินค่าก่อสร้าง 6200'), null);
  const oldFetch=globalThis.fetch, oldUrl=process.env.SUPABASE_URL, oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const paths:string[]=[];
  globalThis.fetch=(async(input:string|URL|Request)=>{
    const path=new URL(String(input)).pathname;paths.push(path);
    return new Response(JSON.stringify(path.endsWith('/ops_notification_channels')?[{team_code:'owner_general'}]
      :path.endsWith('/financial_owner_expense_intakes')?[{
        id:'slip-200',source_user_hash:piiHash('owner-user'),amount:200,status:'awaiting_purpose',
        occurred_on:'2026-10-09',document_type:'transfer_slip',created_at:new Date().toISOString(),
      }]:[]),{status:200});
  }) as typeof fetch;
  try {
    const reply=await handleOwnerExpenseText({targetId:'owner-group',userId:'owner-user',
      text:'จ่ายไปแล้ว 6200',messageId:'total-6200'});
    assert.match(reply??'',/ยังไม่เพิ่มรายการจ่ายซ้ำ/u);
    assert.ok(!paths.some(path=>path.includes('/rpc/financial_stage_owner_expense_purpose_v1')));
    assert.ok(!paths.some(path=>path.includes('/rpc/financial_record_investment_v1')));
  } finally {globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});

test('fresh 200 baht slip description wins over the draft and links a completed wood project', async()=>{
  const oldFetch=globalThis.fetch,oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL='https://unit.test';process.env.SUPABASE_SERVICE_ROLE_KEY='service-key';
  const calls:Array<{path:string;body?:Record<string,unknown>}>=[];
  globalThis.fetch=(async(input:string|URL|Request,init?:RequestInit)=>{
    const url=new URL(String(input));const body=init?.body?JSON.parse(String(init.body)):undefined;
    calls.push({path:url.pathname+url.search,body});
    const rows=url.pathname.endsWith('/ops_notification_channels')?[{team_code:'owner_general'}]
      :url.pathname.endsWith('/financial_owner_expense_intakes')?[{
        id:'slip-200',source_user_hash:piiHash('owner-user'),status:'awaiting_purpose',
        amount:200,occurred_on:'2026-10-09',document_type:'transfer_slip',purpose_raw:null,
        owner_project_id:null,owner_project_task_id:null,owner_project_installment_id:null,
        created_at:new Date().toISOString(),
      }]
      :url.pathname.endsWith('/owner_projects')?[{
        id:'wood-project',name:'เฉลียงไม้',business_unit_code:null,
        purpose:'เฉลียงไม้ให้ลูกค้านั่ง',status:'completed',
      }]
      :url.pathname.endsWith('/rpc/financial_resolve_owner_expense_intake_v1')?{
        ok:true,amount:200,business_unit_code:'shared_infrastructure',
        expense_class:'capital_investment',expense_category:'construction',status:'categorized',
      }:{ok:true};
    return new Response(JSON.stringify(rows),{status:200});
  }) as typeof fetch;
  try {
    const reply=await handleOwnerRecentSlipProjectPurpose({targetId:'owner-group',userId:'owner-user',
      text:'ค่าน้ำมันตัดไม้ โครงการเฉลียงไม้',messageId:'slip-description'});
    assert.match(reply??'',/โครงการ: เฉลียงไม้/u);
    assert.match(reply??'',/200 บาท/u);
    const link=calls.find(call=>call.path.endsWith('/rpc/owner_project_link_financial_v1'));
    assert.equal(link?.body?.p_financial_id,'slip-200');
    assert.equal(link?.body?.p_project_id,'wood-project');
    const classify=calls.find(call=>call.path.endsWith('/rpc/financial_resolve_owner_expense_intake_v1'));
    assert.equal(classify?.body?.p_purpose,'ค่าน้ำมันตัดไม้ โครงการเฉลียงไม้');
    assert.equal(classify?.body?.p_expense_category,'construction');
    assert.ok(!calls.some(call=>call.path.includes('owner_project_conversation_drafts')));
    assert.ok(!calls.some(call=>call.path.includes('financial_record_investment_v1')));
    assert.ok(calls.some(call=>call.path.includes('source_user_hash=eq.'+piiHash('owner-user'))));
  } finally {globalThis.fetch=oldFetch;
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;}
});
