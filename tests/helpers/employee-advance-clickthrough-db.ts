import { readFileSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { piiHash } from '../../netlify/functions/_operations-db';
import { prepareSlipProposal } from '../../netlify/functions/_owner-slip-review';
import { reviewDatabase } from './owner-slip-review-db';

// All identities, references, evidence and amounts in this fixture are invented.
export const SYNTHETIC = {
  intakeId: '51000000-0000-4000-8000-000000000001',
  employeeId: '52000000-0000-4000-8000-000000000001',
  secondEmployeeId: '52000000-0000-4000-8000-000000000002',
  restaurantId: '53000000-0000-4000-8000-000000000001',
  date: '2026-10-09',
  timestamp: Date.parse('2026-10-09T07:00:00Z'),
  targetId: 'synthetic-clickthrough-owner-group',
  userId: 'synthetic-clickthrough-owner',
  alias: 'ตัวอย่างเอเบิก',
  amount: 125,
  before: 640,
};
export const eventInput = {
  targetId: SYNTHETIC.targetId, userId: SYNTHETIC.userId,
  timestamp: SYNTHETIC.timestamp, messageId: 'synthetic-owner-review-1',
};

export async function employeeClickthroughDatabase(t: TestContext) {
  const envKeys = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'OWNER_FINANCE_LINE_USER_HASHES',
    'THONGTHAI_OWNER_SLIP_MODE', 'THONGTHAI_OWNER_SLIP_RESUME_AFTER', 'LINE_CHANNEL_SECRET',
    'LINE_CHANNEL_ACCESS_TOKEN', 'GEMINI_API_KEY', 'OPENAI_API_KEY'] as const;
  const old = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const groupHash = piiHash(SYNTHETIC.targetId)!;
  const actorHash = piiHash(SYNTHETIC.userId)!;
  process.env.SUPABASE_URL = 'https://synthetic-clickthrough.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-test-key';
  process.env.OWNER_FINANCE_LINE_USER_HASHES = actorHash;
  process.env.THONGTHAI_OWNER_SLIP_MODE = 'active';
  delete process.env.THONGTHAI_OWNER_SLIP_RESUME_AFTER;
  process.env.LINE_CHANNEL_SECRET = 'synthetic-document-card-signing-key';
  process.env.LINE_CHANNEL_ACCESS_TOKEN = 'synthetic-line-read-token';
  process.env.GEMINI_API_KEY = 'synthetic-ocr-token';
  delete process.env.OPENAI_API_KEY;
  t.after(() => { for (const key of envKeys) {
    if (old[key] === undefined) delete process.env[key]; else process.env[key] = old[key];
  } });

  // Real expense, project and slip-review migrations, plus just the pre-existing
  // employee/payroll prerequisites needed by the real employee-advance proposal.
  const db = await reviewDatabase();
  t.after(() => db.close());
  await db.exec(`
    create schema tamma_chart_os;
    create table tamma_chart_os.employees(id uuid primary key,restaurant_id uuid,full_name text,
      nickname text,wage_amount numeric,status text,updated_at timestamptz);
    create table public.financial_employee_payroll_events(
      id uuid primary key default gen_random_uuid(),event_type text not null,employee_label text not null,
      employee_key text not null,amount numeric not null check(amount>0),event_date date not null,pay_period text,
      funding_source text not null default 'owner_personal'
        constraint financial_employee_payroll_events_funding_source_check
        check(funding_source in ('owner_personal','business_account','cash','other')),
      status text not null,source_channel text not null default 'line',source_message_id text,
      owner_group_hash text not null,created_by_hash text,slip_message_id text,slip_sha256 text,
      storage_bucket text,storage_path text,mime_type text,slip_amount numeric,slip_confidence numeric,
      slip_extracted_data jsonb not null default '{}',metadata jsonb not null default '{}',review_reason text,
      created_at timestamptz default now(),updated_at timestamptz default now());
  `);
  await db.exec(readFileSync(new URL('../../supabase/proposals/owner_employee_advance_v1.sql', import.meta.url), 'utf8'));
  for (const [id, fullName, nickname, key, business] of [
    [SYNTHETIC.employeeId, 'ตัวอย่างเอ ทดสอบ', 'ตัวอย่างเอ', 'synthetic-worker-a', 'shared'],
    [SYNTHETIC.secondEmployeeId, 'ตัวอย่างบี ทดสอบ', 'ตัวอย่างบี', 'synthetic-worker-b', 'adventure'],
  ]) {
    await db.query(`insert into tamma_chart_os.employees values($1,$2,$3,$4,12000,'ทำงานอยู่','2026-09-01T00:00:00Z')`,
      [id, SYNTHETIC.restaurantId, fullName, nickname]);
    await db.query(`insert into public.financial_owner_employee_profiles
      (owner_group_hash,employee_id,employee_key,business_unit_code,role_label,approval_ref)
      values($1,$2,$3,$4,'ฝ่ายตัวอย่าง','synthetic-profile-approval')`, [groupHash, id, key, business]);
  }
  await db.query(`insert into public.financial_employee_payroll_events
    (employee_id,owner_group_hash,event_type,employee_key,employee_label,amount,event_date,status,funding_source)
    values($1,$2,'salary_advance','synthetic-worker-a','ตัวอย่างเอ ทดสอบ',$3,'2026-10-02','paid','unknown')`,
    [SYNTHETIC.employeeId, groupHash, SYNTHETIC.before]);

  const calls: Array<{ path: string; body: any; result?: any }> = [];
  const faults = { catalogue: false, loseConfirmResponse: false };
  const document = { extraction: null as Record<string, unknown> | null, imageReads: 0, ocrReads: 0, uploads: [] as Array<{ path: string; bytes: number }> };
  const allowedTables = new Set(['financial_owner_expense_intakes', 'owner_projects', 'owner_project_installments']);
  t.mock.method(globalThis, 'fetch', async (raw: any, init: any = {}) => {
    const url = new URL(String(raw));
    // Read-only image/OCR providers and evidence storage are synthetic I/O.
    // The financial RPCs below always execute the actual SQL implementation.
    if (document.extraction && url.hostname === 'api-data.line.me' && /^\/v2\/bot\/message\/\d+\/content$/.test(url.pathname)) {
      document.imageReads++;
      return new Response(Buffer.from('synthetic-image-bytes'), { headers: { 'Content-Type': 'image/png' } });
    }
    if (document.extraction && url.hostname === 'generativelanguage.googleapis.com' && url.pathname.endsWith(':generateContent')) {
      document.ocrReads++;
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(document.extraction) }] } }] });
    }
    assertSyntheticHost(url);
    if (document.extraction && url.pathname.startsWith('/storage/v1/object/owner-expense-evidence/') && init.method === 'POST') {
      document.uploads.push({ path: url.pathname, bytes: init.body.length });
      return Response.json({ Key: url.pathname });
    }
    const path = url.pathname.replace('/rest/v1/', '');
    const body = init.body ? JSON.parse(init.body) : undefined;
    const call: typeof calls[number] = { path, body };
    calls.push(call);
    if (path === 'ops_notification_channels') {
      return Response.json(url.searchParams.get('target_id_hash') === 'eq.' + groupHash ? [{ team_code: 'owner_general' }] : []);
    }
    if (path.startsWith('rpc/')) {
      const name = path.slice(4);
      if (!/^(owner_employee_advance_context_v1|financial_(stage|confirm)_owner_(employee_advance|slip_review)_v1|financial_capture_owner_slip_review_v1)$/.test(name)) {
        throw new Error('Unexpected financial RPC: ' + name);
      }
      const entries = Object.entries(body);
      if (entries.some(([key]) => !/^p_[a-z_0-9]+$/.test(key))) throw new Error('Unsafe RPC parameter');
      try {
        const result = await db.query<{ result: any }>(`select public.${name}(${entries.map(([key], i) => key + ' => $' + (i + 1)).join(',')}) as result`,
          entries.map(([, value]) => value !== null && typeof value === 'object' ? JSON.stringify(value) : value));
        call.result = result.rows[0].result;
      } catch (error) {
        return Response.json({ message: (error as Error).message }, { status: 400 });
      }
      // Model an actual successful DB commit whose HTTP response is lost, never
      // manufacture a financial success or a made-up authoritative total.
      if (faults.loseConfirmResponse && name === 'financial_confirm_owner_employee_advance_v1') {
        faults.loseConfirmResponse = false;
        throw new TypeError('Synthetic lost confirmation response');
      }
      return Response.json(call.result);
    }
    if (!allowedTables.has(path) || init.method && init.method !== 'GET') throw new Error('Unexpected REST access: ' + path);
    if (faults.catalogue && path === 'owner_projects') return Response.json({ message: 'Synthetic catalogue unavailable' }, { status: 503 });
    const values: any[] = [];
    const clauses: string[] = [];
    for (const [key, filter] of url.searchParams.entries()) {
      if (['select', 'order', 'limit'].includes(key)) continue;
      if (!/^[a-z_][a-z_0-9]*$/.test(key)) throw new Error('Unsafe table parameter');
      if (filter === 'not.is.null') { clauses.push(key + ' is not null'); continue; }
      const condition = filter.match(/^(eq|neq|gte|lte|in)\.(.*)$/);
      if (!condition) throw new Error('Unhandled REST filter: ' + filter);
      const [, operator, value] = condition;
      if (operator === 'in') {
        const items = value.slice(1, -1).split(',');
        clauses.push(key + ' in (' + items.map(item => { values.push(item); return '$' + values.length; }).join(',') + ')');
      } else {
        values.push(value);
        clauses.push(key + ({ eq: '=', neq: '<>', gte: '>=', lte: '<=' } as Record<string, string>)[operator] + '$' + values.length);
      }
    }
    let sql = 'select * from public.' + path + (clauses.length ? ' where ' + clauses.join(' and ') : '');
    const order = url.searchParams.get('order');
    if (order) {
      if (!/^[a-z_]+\.(asc|desc)$/.test(order)) throw new Error('Unhandled order');
      sql += ' order by ' + order.replace('.', ' ');
    }
    const limit = url.searchParams.get('limit');
    if (limit) {
      if (!/^\d+$/.test(limit)) throw new Error('Invalid limit');
      sql += ' limit ' + limit;
    }
    return Response.json((await db.query(sql, values)).rows);
  });

  async function seedDraft(options: { id?: string; note?: string; extraction?: Record<string, unknown>; proposal?: Record<string, unknown>; evidenceMessageId?: string } = {}) {
    const id = options.id ?? SYNTHETIC.intakeId;
    const note = options.note ?? 'รายการตัวอย่างจาก OCR';
    const extraction = {
      document_type: 'transfer_slip', document_kind: 'transfer_evidence', funds_direction: 'outgoing',
      payment_document_count: 1, confidence: 0.99, amount_total: SYNTHETIC.amount,
      document_date_local: SYNTHETIC.date, reference_number: 'SYNTHETIC-REF-' + id,
      visible_payment_note: note, ...options.extraction,
    };
    const proposal = { ...prepareSlipProposal({ note, extraction: extraction as any, projects: [], installments: [],
      choices: { business: 'shared', category: 'consumables', destination: 'operating_expense' } }), ...options.proposal };
    await db.query(`insert into public.financial_owner_expense_intakes
      (id,owner_group_hash,source_user_hash,evidence_message_id,evidence_sha256,occurred_on,amount,document_type,
       reference_number,purpose_raw,status,extraction_confidence,extraction_data,storage_bucket,storage_path,mime_type,
       review_state,review_revision,review_data,review_message_id,created_at,updated_at)
      values($1,$2,$3,$4,$5,$6,null,'transfer_slip',$7,$8,'awaiting_purpose',0.99,$9,
       'owner-expense-evidence',$10,'image/jpeg','draft',2,$11,'synthetic-generic-review-2',$12,$12)`,
      [id, groupHash, actorHash, options.evidenceMessageId ?? 'synthetic-evidence-' + id, id.replace(/-/g, '').padEnd(64, '0'), SYNTHETIC.date,
        extraction.reference_number, note, JSON.stringify(extraction), 'synthetic-evidence/' + id + '.jpg',
        JSON.stringify(proposal), new Date(SYNTHETIC.timestamp - 60000).toISOString()]);
    return getIntake(id);
  }
  async function getIntake(id = SYNTHETIC.intakeId) {
    return (await db.query<any>('select * from public.financial_owner_expense_intakes where id=$1', [id])).rows[0];
  }
  async function moneyCounts() {
    const result = await db.query<any>(`select
      (select count(*) from public.financial_employee_payroll_events where status='paid') as paid,
      (select count(*) from public.financial_investment_entries) as investments,
      (select count(*) from public.financial_owner_expense_intakes where status in ('categorized','needs_review')) as expenses`);
    return result.rows[0];
  }
  return { db, calls, faults, document, groupHash, actorHash, seedDraft, getIntake, moneyCounts };
}
function assertSyntheticHost(url: URL) {
  if (url.hostname !== 'synthetic-clickthrough.test') throw new Error('External networking forbidden in synthetic click-through tests');
}

export function evidenceSnapshot(row: Record<string, unknown>) {
  return Object.fromEntries(['id', 'owner_group_hash', 'source_user_hash', 'source_channel', 'evidence_message_id',
    'evidence_sha256', 'extraction_data', 'storage_bucket', 'storage_path', 'mime_type', 'reference_number',
    'purpose_raw', 'amount', 'occurred_on'].map(key => [key, row[key]]));
}
