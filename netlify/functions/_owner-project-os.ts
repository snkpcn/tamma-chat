import { createHash } from 'node:crypto';
import { piiHash } from './_operations-db';
import { boundLineOpsTeam, buildTeamScheduleSummary } from './_ops-notifications';

export type OwnerProjectIntent = 'new_project' | 'investment_plan' | 'weekly_task' | 'one_time_task';
export type OwnerProjectMissingField =
  | 'project_name'
  | 'work_title'
  | 'budget'
  | 'counterparty'
  | 'payment_plan'
  | 'schedule'
  | 'responsible';

export type OwnerProjectDraftData = {
  project_name?: string;
  project_purpose?: string;
  work_title?: string;
  description?: string;
  task_kind?: 'pre_opening' | 'one_time' | 'weekly';
  business_unit_code?: string;
  budget_amount?: number;
  counterparty_name?: string;
  responsible_name?: string;
  installment_count?: number;
  payment_method?: 'cash' | 'transfer' | 'card' | 'other';
  due_on?: string;
  first_installment_on?: string;
  schedule_text?: string;
  recurrence_weekdays?: number[];
  unknown_fields?: OwnerProjectMissingField[];
};

type DraftRow = {
  id: string;
  owner_group_hash: string;
  actor_hash: string;
  intent: OwnerProjectIntent;
  status: 'collecting' | 'awaiting_confirmation' | 'confirmed' | 'cancelled' | 'expired';
  data: OwnerProjectDraftData;
  missing_fields: OwnerProjectMissingField[];
  source_message_id: string;
  last_message_id: string;
  updated_at: string;
  expires_at: string;
};

type ConfirmResult = {
  ok?: boolean;
  duplicate?: boolean;
  draft_id?: string;
  project_id?: string;
  project_code?: string;
  project_name?: string;
  task_id?: string;
  task_code?: string;
  installment_count?: number;
};

const DASHBOARD_URL = 'https://tamma-backoffice.netlify.app/investments.html';
const CONTINUATION_WINDOW_MS = 15 * 60 * 1000;
const BUSINESS_UNITS: Array<[RegExp, string]> = [
  [/(?:อินทนิล|inthanin|คาเฟ่|ร้านกาแฟ)/iu, 'inthanin'],
  [/(?:ตำมา-ชาติ|ตำมาชาติ|ตํามา|ร้านอาหาร)/iu, 'tamma_restaurant'],
  [/(?:เฮือนสเตย์|huenstay|ที่พัก|บ้านพัก)/iu, 'huenstay'],
  [/(?:ผจญภัย|adventure|กิจกรรม|atv|ขี่ม้า)/iu, 'adventure'],
  [/(?:otop|โอทอป|สินค้าชุมชน|ของฝาก)/iu, 'otop'],
  [/(?:ส่วนกลาง|ลานจอด|ถนน|รั้ว|ระบบน้ำ|โครงสร้างพื้นฐาน|เฉลียง|ศาลา|ทางเดิน|ลานนั่ง)/iu, 'shared_infrastructure'],
  [/(?:ใช้ร่วม|หลายกิจการ)/iu, 'shared'],
];

const WEEKDAYS: Array<[RegExp, number]> = [
  [/(?:วันอาทิตย์|อาทิตย์)/u, 0],
  [/(?:วันจันทร์|จันทร์)/u, 1],
  [/(?:วันอังคาร|อังคาร)/u, 2],
  [/(?:วันพุธ|พุธ)/u, 3],
  [/(?:วันพฤหัสบดี|วันพฤหัส|พฤหัสบดี|พฤหัส)/u, 4],
  [/(?:วันศุกร์|ศุกร์)/u, 5],
  [/(?:วันเสาร์|เสาร์)/u, 6],
];

const THAI_NUMBER_WORDS: Record<string, number> = {
  หนึ่ง: 1, สอง: 2, สาม: 3, สี่: 4, ห้า: 5, หก: 6,
  เจ็ด: 7, แปด: 8, เก้า: 9, สิบ: 10, สิบเอ็ด: 11, สิบสอง: 12,
};

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Owner Project OS database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const config = dbConfig();
  const response = await fetch(config.url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Owner Project OS request failed ' + response.status + ': ' + body.slice(0, 220));
  }
  return response;
}

async function rpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const response = await dbFetch('rpc/' + name, { method: 'POST', body: JSON.stringify(payload) });
  const raw = await response.json() as T | T[];
  return (Array.isArray(raw) ? raw[0] : raw) as T;
}

function normalizeText(value: string): string {
  return value.trim().replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit))).replace(/\s+/g, ' ');
}

function cleanAnswer(value: string): string {
  return normalizeText(value)
    .replace(/^(?:@?ทองไทย|น้องทองไทย)[,:：\-–—\s]*/iu, '')
    .replace(/^(?:ตอบ|คำตอบ|คือ)\s*/u, '')
    .replace(/[.。]+$/u, '')
    .trim();
}

function isConversationNoise(value: string): boolean {
  return /^(?:โอเค|เค|ได้|ครับ|ค่ะ|คะ|จ้า|จ้ะ|อืม|อือ|ใช่|ไม่ใช่|เดี๋ยว|ไว้ก่อน|รับทราบ|ตกลง)(?:นะ|ครับ|ค่ะ|คะ|จ้า|จ้ะ)*$/u
    .test(cleanAnswer(value));
}

function isUnknown(value: string): boolean {
  return /^(?:ยังไม่รู้|ไม่รู้|ยังไม่แน่ใจ|ไม่แน่ใจ|ยังหาอยู่|กำลังหา|ยังไม่ได้เลือก|ไม่ทราบ|ไว้แจ้งทีหลัง)$/u.test(cleanAnswer(value));
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function addUnknown(data: OwnerProjectDraftData, field: OwnerProjectMissingField): void {
  data.unknown_fields = unique([...(data.unknown_fields ?? []), field]);
}

function removeUnknown(data: OwnerProjectDraftData, field: OwnerProjectMissingField): void {
  data.unknown_fields = (data.unknown_fields ?? []).filter(item => item !== field);
}

function unknown(data: OwnerProjectDraftData, field: OwnerProjectMissingField): boolean {
  return (data.unknown_fields ?? []).includes(field);
}

function parseMoney(raw: string, loose = false): number | null {
  const text = normalizeText(raw).toLowerCase();
  const unitMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(ล้าน|แสน|หมื่น|พัน)(?:\s*บาท)?/u);
  if (unitMatch) {
    const multiplier = unitMatch[2] === 'ล้าน' ? 1_000_000
      : unitMatch[2] === 'แสน' ? 100_000
        : unitMatch[2] === 'หมื่น' ? 10_000 : 1_000;
    const value = Number(unitMatch[1]) * multiplier;
    return value > 0 && value <= 100_000_000 ? value : null;
  }
  const labelled = text.match(/(?:งบ(?:ประมาณ)?|ราคา|ยอด|ลงทุน|ประมาณ)\s*(?:ไว้|รวม|ทั้งหมด|ไม่เกิน|ราว ๆ|ราวๆ)?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/u)
    ?? text.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*บาท/u);
  const whole = loose ? text.match(/^([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s*บาท)?$/u) : null;
  const match = labelled ?? whole;
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 && value <= 100_000_000 ? value : null;
}

function parseInstallmentCount(raw: string, loose = false): number | null {
  const text = normalizeText(raw).toLowerCase();
  if (/(?:จ่ายครั้งเดียว|งวดเดียว|เต็มจำนวน)/u.test(text)) return 1;
  const numeric = text.match(/(?:แบ่ง|จ่าย|ทั้งหมด)?\s*([0-9]{1,3})\s*(?:งวด|ครั้ง)/u)
    ?? (loose ? text.match(/^([0-9]{1,3})$/u) : null);
  if (numeric) {
    const value = Number(numeric[1]);
    return value >= 1 && value <= 120 ? value : null;
  }
  for (const [word, value] of Object.entries(THAI_NUMBER_WORDS)) {
    if (new RegExp('(?:แบ่ง|จ่าย|ทั้งหมด)?\\s*' + word + '\\s*(?:งวด|ครั้ง)', 'u').test(text)) return value;
  }
  return null;
}

function parsePaymentMethod(text: string): OwnerProjectDraftData['payment_method'] | null {
  if (/เงินสด/u.test(text)) return 'cash';
  if (/(?:โอน|พร้อมเพย์|transfer)/iu.test(text)) return 'transfer';
  if (/(?:บัตร|card)/iu.test(text)) return 'card';
  return null;
}

function parseWeekdays(text: string): number[] {
  return unique(WEEKDAYS.filter(([pattern]) => pattern.test(text)).map(([, value]) => value));
}

function parseIsoDate(raw: string, timestamp: number): string | null {
  const text = normalizeText(raw);
  const iso = text.match(/\b(20[0-9]{2})-([01][0-9])-([0-3][0-9])\b/u);
  if (iso) return iso[0];
  const slash = text.match(/\b([0-3]?[0-9])\/([01]?[0-9])\/([0-9]{2,4})\b/u);
  if (slash) {
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    if (year > 2400) year -= 543;
    return `${year}-${String(Number(slash[2])).padStart(2, '0')}-${String(Number(slash[1])).padStart(2, '0')}`;
  }
  if (/พรุ่งนี้/u.test(text)) {
    const current = new Date(timestamp + 7 * 60 * 60 * 1000);
    current.setUTCDate(current.getUTCDate() + 1);
    return current.toISOString().slice(0, 10);
  }
  return null;
}

function detectBusinessUnit(text: string): string | null {
  return BUSINESS_UNITS.find(([pattern]) => pattern.test(text))?.[1] ?? null;
}

function parseProjectName(raw: string, loose = false): string | null {
  const text = cleanAnswer(raw);
  const explicit = text.match(/(?:โปรเจ(?:ค|กต์)|โครงการ)\s*(?:ใหม่\s*)?(?:ชื่อ\s*)?[“"']?([^,，\n]+?)[”"']?(?=\s+(?:งบ|ราคา|ลงทุน|จะ|ต้อง|ทำ|กับ|จ้าง|แบ่ง|จ่าย|วันที่)|$)/iu);
  let value = explicit?.[1]?.trim() ?? (loose ? text.replace(/^(?:โปรเจ(?:ค|กต์)|โครงการ)\s*/iu, '').trim() : '');
  value = value.replace(/^(?:สร้าง|ทำ)\s*/u, '').trim();
  if (!value || isConversationNoise(value) || /^(?:ใหม่|สร้างใหม่|โปรเจคใหม่|โครงการใหม่)$/u.test(value)) return null;
  return value.slice(0, 180);
}

function parseWorkTitle(raw: string, loose = false): string | null {
  const text = cleanAnswer(raw);
  const explicit = text.match(/(?:ลงทุน(?:เพิ่ม|ใหม่)?(?:เรื่อง|ทำ)?|งาน(?:คือ|ชื่อ)?|ต้องทำ|จะทำ|\sทำ)\s*[“"']?(.+?)[”"']?(?=\s+(?:งบ|ราคา|กับ|จ้าง|แบ่ง|จ่าย|ภายใน|วันที่)|$)/iu);
  let value = explicit?.[1]?.trim() ?? (loose ? text : '');
  value = value
    .replace(/^(?:งาน|ทำ|ลงทุน)\s*/u, '')
    .replace(/(?:งบ|ราคา)\s*[0-9][0-9,]*(?:\.[0-9]+)?.*$/u, '')
    .trim();
  if (!value || isConversationNoise(value)
    || /^(?:ลงทุน|ลงทุนใหม่|สร้างใหม่|โปรเจคใหม่|โครงการใหม่|มีโปรเจคสร้างใหม่|มีโครงการสร้างใหม่)$/u.test(value)) return null;
  return value.slice(0, 240);
}

function parseCounterparty(raw: string, loose = false): string | null {
  const text = cleanAnswer(raw);
  const explicit = text.match(/(?:จ้าง|ซื้อจาก|ทำกับ|กับ)\s*([^,，\n0-9]+?)(?=\s+(?:งบ|ราคา|แบ่ง|จ่าย|ภายใน|วันที่|[0-9])|$)/u);
  const value = explicit?.[1]?.trim() ?? (loose ? text.replace(/^(?:จ้าง|ซื้อจาก|ทำกับ|กับ)\s*/u, '').trim() : '');
  return value && !isConversationNoise(value) && value.length <= 180 ? value : null;
}

function parseResponsible(raw: string, loose = false): string | null {
  const text = cleanAnswer(raw);
  const explicit = text.match(/(?:ผู้รับผิดชอบ|ให้)\s*([^,，\n]+?)(?=\s+(?:รับผิดชอบ|ทำ|งบ|วันที่)|$)/u);
  const value = explicit?.[1]?.trim() ?? (loose ? text.replace(/^ผู้รับผิดชอบ\s*/u, '').trim() : '');
  return value && !isConversationNoise(value) && value.length <= 180 ? value : null;
}

function isMotherConversation(text: string): boolean {
  const normalized = normalizeText(text);
  return /^(?:แม่|คุณแม่|ม๊า|ม้า)(?:\s|,|:|ครับ|คะ|ค่ะ|จ๋า)/u.test(normalized)
    && !/(?:ทองไทย|@ทองไทย)/u.test(normalized);
}

function isReadOnlyQuestion(text: string): boolean {
  return /(?:ยอดขาย|ยอดจ่าย|จ่ายแล้ว|ลงทุนไป|จ่ายไป|ใช้จริง|ใช้ไป|คงเหลือ|เหลือเท่าไหร่|เท่าไหร่แล้ว|สรุป.*ลงทุน|ลงทุน.*อะไรบ้าง)/u.test(text);
}

const OWNER_PROJECT_QUERY = /(?:สรุปมา|สรุป(?:งาน|โครงการ|โปรเจค)|มีอะไรค้าง|มีงานอะไรค้าง|ตอนนี้ถึงไหนแล้ว|มีอะไรต้องทำต่อ|งานกลุ่มนี้เป็นไง|เหลืออะไร|มีอะไรต้องตาม|งานไหนรอกู|งานไหนรอผม|อันไหนเลยกำหนด|ยอดโครงการ.*(?:เท่าไหร่|เท่าไร)|โครงการ.*ยอดจ่าย|จ่ายไปเท่าไหร่แล้ว|มีจ่ายอะไรไปแล้ว)/u;
type SummaryProject = { id: string; name: string; project_code: string };
type SummaryTask = { id: string; project_id: string; title: string; task_kind: string; status: string; due_on: string | null; responsible_name: string | null };
type SummaryInstallment = { id: string; project_id: string; title: string; amount: number | string; due_on: string | null; status: string };

const summaryMoney = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' บาท';

export async function handleOwnerProjectQuery(input: { targetId: string; text: string; timestamp?: number }): Promise<string | null> {
  if (!OWNER_PROJECT_QUERY.test(normalizeText(input.text))) return null;
  const team = await boundLineOpsTeam(input.targetId);
  if (!team) return 'กลุ่มนี้ยังไม่ได้ตั้งค่าขอบเขตข้อมูลครับ ให้ผู้ดูแลผูกกลุ่มกับทีม/โครงการก่อน';
  if (team !== 'owner_general') {
    if (['restaurant','stay','activity','cafe','cafe_test','otop'].includes(team)) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).format(input.timestamp ?? Date.now());
      return 'สรุปข้อมูลของกลุ่มนี้จากหลังบ้านครับ\n' + await buildTeamScheduleSummary(team, today);
    }
    return `กลุ่มนี้ผูกกับทีม ${team} ครับ คำสรุปแบบนี้ยังไม่มีขอบเขตข้อมูลที่ตั้งค่าไว้`;
  }
  const groupHash = piiHash(input.targetId);
  if (!groupHash) return null;
  const projects = await (await dbFetch('owner_projects?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&status=neq.cancelled&select=id,name,project_code&order=created_at.desc&limit=50')).json() as SummaryProject[];
  if (!projects.length) return 'หลังบ้านยังไม่มีโครงการที่ผูกกับกลุ่มนี้ครับ';
  const ids = encodeURIComponent('(' + projects.map(row => row.id).join(',') + ')');
  const [tasks, installments, intakes, ledger] = await Promise.all([
    dbFetch('owner_project_tasks?project_id=in.' + ids + '&status=neq.cancelled&select=id,project_id,title,task_kind,status,due_on,responsible_name&order=due_on.asc.nullslast&limit=300').then(r => r.json() as Promise<SummaryTask[]>),
    dbFetch('owner_project_installments?project_id=in.' + ids + '&status=neq.cancelled&select=id,project_id,title,amount,due_on,status&order=due_on.asc.nullslast&limit=300').then(r => r.json() as Promise<SummaryInstallment[]>),
    dbFetch('financial_owner_expense_intakes?owner_group_hash=eq.' + encodeURIComponent(groupHash) + '&owner_project_id=in.' + ids + '&status=neq.cancelled&select=id,owner_project_id,occurred_on,amount,purpose_raw,status,evidence_message_id&order=occurred_on.desc&limit=300').then(r => r.json() as Promise<Array<{ id:string; owner_project_id:string; occurred_on:string; amount:number|string; purpose_raw:string; status:string; evidence_message_id:string|null }>>),
    dbFetch('financial_investment_entries?owner_group_hash=eq.' + encodeURIComponent(groupHash) + '&owner_project_id=in.' + ids + '&status=eq.recorded&select=id,owner_project_id,occurred_on,amount,title,source_message_id&order=occurred_on.desc&limit=300').then(r => r.json() as Promise<Array<{ id:string; owner_project_id:string; occurred_on:string; amount:number|string; title:string; source_message_id:string|null }>>),
  ]);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).format(input.timestamp ?? Date.now());
  const weekStartDate = new Date(`${today}T00:00:00Z`);
  weekStartDate.setUTCDate(weekStartDate.getUTCDate() - ((weekStartDate.getUTCDay() + 6) % 7));
  const taskIds = encodeURIComponent('(' + tasks.map(row => row.id).join(',') + ')');
  const checkins = tasks.length ? await (await dbFetch('owner_project_task_checkins?week_start=eq.' + weekStartDate.toISOString().slice(0,10)
    + '&task_id=in.' + taskIds + '&select=task_id,state&limit=500')).json() as Array<{task_id:string;state:string}> : [];
  const checked = new Map(checkins.map(row => [row.task_id,row.state]));
  const state = (row:SummaryTask) => row.task_kind === 'weekly' ? checked.get(row.id) ?? row.status : row.status;
  const done = (s:string) => /^(?:done|completed|paid)$/iu.test(s);
  const waiting = tasks.filter(row => /^(?:todo|blocked|waiting|pending)$/iu.test(state(row)));
  const active = tasks.filter(row => /^(?:in_progress|active)$/iu.test(state(row)));
  const complete = tasks.filter(row => done(state(row)));
  const overdue = tasks.filter(row => !done(state(row)) && row.due_on && row.due_on < today);
  const ownerWait = tasks.filter(row => /(?:รอเจ้าของ|รอยืนยัน|รออนุมัติ|owner approval)/iu.test(row.title));
  const due = installments.filter(row => !/^(?:paid|cancelled)$/iu.test(row.status));
  const ledgerSources = new Set(ledger.map(row => row.source_message_id).filter(Boolean));
  const pendingReceipts = intakes.filter(row => row.status !== 'categorized');
  const receipts = intakes.filter(row => row.status === 'categorized' && (!row.evidence_message_id || !ledgerSources.has(row.evidence_message_id)));
  const expenses = [...ledger.map(row => ({name:row.title,amount:Number(row.amount||0),date:row.occurred_on})), ...receipts.map(row => ({name:row.purpose_raw,amount:Number(row.amount||0),date:row.occurred_on}))].sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const total = expenses.reduce((sum,row) => sum + row.amount,0);
  const project = new Map(projects.map(row => [row.id,row.name]));
  const query = normalizeText(input.text);
  const onlyPending = /(?:ค้าง|เลยกำหนด|ต้องตาม)/u.test(query);
  const onlyOwner = /(?:งานไหนรอกู|งานไหนรอผม|รอเจ้าของ|รอพี่ยืนยัน|รออนุมัติ)/u.test(query);
  const onlySpend = /(?:ยอดโครงการ|ยอดจ่าย|จ่ายไป|มีจ่ายอะไร)/u.test(query);
  const lines = ['สรุปจากหลังบ้านตอนนี้ครับ'];
  if (onlyOwner) return [...lines,'','⏳ รอเจ้าของตัดสินใจ',...(ownerWait.length?ownerWait.map(row=>`• ${project.get(row.project_id)}: ${row.title}`):['• หลังบ้านยังไม่มีงานที่ระบุว่ารอเจ้าของตัดสินใจครับ'])].join('\n');
  if (onlyPending) {
    const follow = [...new Map([...waiting,...overdue].map(row=>[row.id,row])).values()];
    if (follow.length) lines.push('','🔴 ค้าง/เลยกำหนด/ต้องตาม',...follow.slice(0,8).map(row=>`• ${project.get(row.project_id)}: ${row.title}${row.due_on?' — กำหนด '+row.due_on:''}`));
  } else if (!onlySpend) {
    for (const [label,rows] of [['✅ เสร็จแล้ว',complete],['🟡 กำลังทำ',active],['⏳ ค้าง/รอดำเนินการ',waiting]] as const) if (rows.length) lines.push('',label,...rows.slice(0,5).map(row=>`• ${project.get(row.project_id)}: ${row.title}${row.responsible_name?' — '+row.responsible_name:''}`));
    if (overdue.length) lines.push('','🔴 เลยกำหนด',...overdue.slice(0,5).map(row=>`• ${project.get(row.project_id)}: ${row.title} — กำหนด ${row.due_on}`));
  }
  if (!onlyPending && !onlyOwner && pendingReceipts.length) lines.push('','⏳ สลิปที่รอจัดหมวด/ตรวจข้อมูล',...pendingReceipts.slice(0,5).map(row=>`• ${row.purpose_raw||'สลิปรอระบุ'} · ${summaryMoney(Number(row.amount||0))}`));
  if (onlyPending) {
    const late = due.filter(row => row.due_on && row.due_on < today);
    if (late.length) lines.push('','💸 งวดเลยกำหนด',...late.slice(0,5).map(row=>`• ${project.get(row.project_id)}: ${row.title} ${summaryMoney(Number(row.amount))}`));
  } else if (due.length) lines.push('','💸 งวดที่ยังจ่าย',...due.slice(0,5).map(row=>`• ${project.get(row.project_id)}: ${row.title} ${summaryMoney(Number(row.amount))}${row.due_on?' — '+row.due_on:''}`));
  if (onlySpend || (!onlyPending && expenses.length)) {
    lines.push('','💰 จ่ายแล้วตามรายการที่บันทึก: '+summaryMoney(total),...expenses.slice(0,5).map(row=>`• ${row.name} · ${summaryMoney(row.amount)}`));
    if (!expenses.length) lines.push('• หลังบ้านยังไม่มีรายการจ่ายที่ยืนยันแล้วผูกกับโครงการนี้ครับ');
    if (pendingReceipts.length) lines.push(`• มีสลิปรอจัดหมวด/ตรวจข้อมูลอีก ${pendingReceipts.length} รายการ ไม่รวมในยอดจ่ายยืนยัน`);
  }
  if (!complete.length && !active.length && !waiting.length && !overdue.length && !due.length && !expenses.length) lines.push('ยังไม่มีงานค้าง งวดจ่าย หรือรายจ่ายที่บันทึกของกลุ่มนี้ครับ');
  return lines.join('\n');
}

export function classifyOwnerProjectStart(rawText: string): OwnerProjectIntent | null {
  const text = normalizeText(rawText);
  if (!text || isMotherConversation(text) || isReadOnlyQuestion(text)) return null;
  if (/^(?:ลงทุน(?:เงินสด)?|เงินสดลงทุน|บันทึกลงทุน)\s+[0-9][0-9,]*(?:\.[0-9]{1,2})?/u.test(text)) return null;

  const directed = /(?:ทองไทย|@ทองไทย|จดให้หน่อย|ช่วยจด|บันทึกให้|เพิ่มงาน|สร้างโครงการ|สร้างโปรเจค)/u.test(text);
  const projectSignal = /(?:จะ|อยาก|ต้อง|มี|ขอ)?\s*(?:ลงทุนใหม่|ลงทุนเพิ่ม|สร้างโครงการ|สร้างโปรเจค|โปรเจคสร้างใหม่|โครงการสร้างใหม่|เปิดร้านใหม่|ทำโครงการใหม่)/u.test(text);
  const weeklySignal = /(?:งานประจำ|งานรายสัปดาห์|ทำทุกอาทิตย์|ทำทุกสัปดาห์|ทุกวัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์))/u.test(text);
  const taskSignal = /(?:งานก่อนเปิดร้าน|งานต้องทำ|เพิ่มงาน|มีงานใหม่|ต้องทำก่อนเปิด)/u.test(text);
  if (!directed && !projectSignal && !weeklySignal && !taskSignal) return null;
  if (weeklySignal) return 'weekly_task';
  if (/(?:สร้างโครงการ|สร้างโปรเจค|โปรเจคสร้างใหม่|โครงการสร้างใหม่|เปิดร้านใหม่|โครงการใหม่|โปรเจคใหม่)/u.test(text)) return 'new_project';
  if (/(?:ลงทุน|งบ|งวด)/u.test(text)) return 'investment_plan';
  return 'one_time_task';
}

export function ownerProjectMissingFields(
  intent: OwnerProjectIntent,
  data: OwnerProjectDraftData,
): OwnerProjectMissingField[] {
  const missing: OwnerProjectMissingField[] = [];
  if (!data.project_name) missing.push('project_name');
  if (!data.work_title) missing.push('work_title');
  if (intent === 'weekly_task') {
    if (!(data.recurrence_weekdays?.length || data.schedule_text || unknown(data, 'schedule'))) missing.push('schedule');
    if (!(data.responsible_name || unknown(data, 'responsible'))) missing.push('responsible');
    return missing;
  }
  if (!(typeof data.budget_amount === 'number' || unknown(data, 'budget'))) missing.push('budget');
  if (!(data.counterparty_name || unknown(data, 'counterparty'))) missing.push('counterparty');
  if (!(typeof data.installment_count === 'number' || unknown(data, 'payment_plan'))) missing.push('payment_plan');
  if (!(data.due_on || data.schedule_text || unknown(data, 'schedule'))) missing.push('schedule');
  return missing;
}

export function applyOwnerProjectText(input: {
  text: string;
  intent: OwnerProjectIntent;
  data?: OwnerProjectDraftData;
  expectedField?: OwnerProjectMissingField | null;
  timestamp?: number;
}): { data: OwnerProjectDraftData; changed: boolean } {
  const data: OwnerProjectDraftData = JSON.parse(JSON.stringify(input.data ?? {}));
  const text = normalizeText(input.text);
  const expected = input.expectedField ?? null;
  const before = JSON.stringify(data);
  const timestamp = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();

  if (expected && isUnknown(text) && !['project_name','work_title'].includes(expected)) {
    addUnknown(data, expected);
  }

  const projectName = parseProjectName(text, expected === 'project_name');
  if (projectName) { data.project_name = projectName; removeUnknown(data, 'project_name'); }
  const workTitle = parseWorkTitle(text, expected === 'work_title');
  if (workTitle) { data.work_title = workTitle; removeUnknown(data, 'work_title'); }

  const amount = parseMoney(text, expected === 'budget');
  if (amount !== null) { data.budget_amount = amount; removeUnknown(data, 'budget'); }
  const counterparty = parseCounterparty(text, expected === 'counterparty');
  if (counterparty && !isUnknown(text)) { data.counterparty_name = counterparty; removeUnknown(data, 'counterparty'); }
  const responsible = parseResponsible(text, expected === 'responsible');
  if (responsible && !isUnknown(text)) { data.responsible_name = responsible; removeUnknown(data, 'responsible'); }

  const count = parseInstallmentCount(text, expected === 'payment_plan');
  if (count !== null) { data.installment_count = count; removeUnknown(data, 'payment_plan'); }
  const paymentMethod = parsePaymentMethod(text);
  if (paymentMethod) data.payment_method = paymentMethod;

  const weekdays = parseWeekdays(text);
  if (weekdays.length) {
    data.recurrence_weekdays = weekdays;
    data.task_kind = 'weekly';
    data.schedule_text = cleanAnswer(text).slice(0, 240);
    removeUnknown(data, 'schedule');
  }
  const date = parseIsoDate(text, timestamp);
  if (date) {
    data.due_on = date;
    data.schedule_text = cleanAnswer(text).slice(0, 240);
    if (typeof data.installment_count === 'number' && data.installment_count > 0) data.first_installment_on = date;
    removeUnknown(data, 'schedule');
  } else {
    const schedulePhrase = cleanAnswer(text).match(
      /((?:ภายใน|ก่อน|เริ่ม|กำหนด|เดือนนี้|เดือนหน้า|สัปดาห์นี้|สัปดาห์หน้า)[^,，\n]{0,120})$/u,
    )?.[1]?.trim();
    if (schedulePhrase) {
      data.schedule_text = schedulePhrase.slice(0, 240);
      removeUnknown(data, 'schedule');
    } else if (expected === 'schedule' && !isUnknown(text) && !isConversationNoise(text) && cleanAnswer(text).length >= 2) {
      data.schedule_text = cleanAnswer(text).slice(0, 240);
      removeUnknown(data, 'schedule');
    }
  }

  const business = detectBusinessUnit(text);
  if (business) data.business_unit_code = business;
  if (!data.task_kind) {
    data.task_kind = input.intent === 'weekly_task' ? 'weekly'
      : /ก่อนเปิด/u.test(text) ? 'pre_opening' : 'one_time';
  }
  if (!data.project_purpose && input.intent === 'new_project' && data.work_title) data.project_purpose = data.work_title;
  return { data, changed: JSON.stringify(data) !== before };
}

function money(value: number | undefined): string {
  return value === undefined
    ? 'ยังไม่รู้'
    : value.toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' บาท';
}

function businessLabel(code?: string): string {
  const labels: Record<string, string> = {
    inthanin:'Inthanin', tamma_restaurant:'ตำมา-ชาติ', huenstay:'เฮือนสเตย์',
    adventure:'ผจญภัย', otop:'OTOP', shared_infrastructure:'ส่วนกลาง',
    shared:'ใช้ร่วมหลายกิจการ', other:'อื่น ๆ',
  };
  return code ? labels[code] ?? code : 'ยังไม่ระบุ';
}

function weekdayLabels(values: number[] | undefined): string {
  const labels = ['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัส','ศุกร์','เสาร์'];
  return values?.length ? values.map(value => labels[value]).join(', ') : '';
}

export function renderOwnerProjectDraftSummary(intent: OwnerProjectIntent, data: OwnerProjectDraftData): string {
  const schedule = data.schedule_text || data.due_on || weekdayLabels(data.recurrence_weekdays) || 'ยังไม่รู้';
  const installments = data.installment_count
    ? `${data.installment_count} งวด${data.first_installment_on ? ' · งวดแรก ' + data.first_installment_on : ''}`
    : 'ยังไม่รู้';
  return [
    'ขอสรุปก่อนบันทึกครับ',
    `โครงการ: ${data.project_name || 'ยังไม่ระบุ'}`,
    `งาน/สิ่งที่จะลงทุน: ${data.work_title || 'ยังไม่ระบุ'}`,
    `กิจการ: ${businessLabel(data.business_unit_code)}`,
    intent === 'weekly_task' ? 'รูปแบบ: งานประจำรายสัปดาห์' : `เงินที่ตั้งไว้: ${money(data.budget_amount)}`,
    intent === 'weekly_task'
      ? `ทำเมื่อไร: ${schedule}`
      : `ซื้อหรือจ้างกับใคร: ${data.counterparty_name || 'ยังไม่รู้'}`,
    intent === 'weekly_task'
      ? `ผู้รับผิดชอบ: ${data.responsible_name || 'ยังไม่รู้'}`
      : `การจ่าย: ${installments}${data.payment_method ? ' · ' + ({cash:'เงินสด',transfer:'โอน',card:'บัตร',other:'อื่น ๆ'} as Record<string,string>)[data.payment_method] : ''}`,
    intent === 'weekly_task' ? '' : `กำหนด: ${schedule}`,
    '',
    'ถ้าถูกต้อง พิมพ์ “ยืนยัน” เพื่อบันทึกเข้าหลังบ้านทันที',
    'ถ้าต้องแก้ พิมพ์ เช่น “แก้งบเป็น 300,000 บาท” หรือ “เปลี่ยนเป็น 3 งวด” ครับ',
  ].filter(Boolean).join('\n');
}

export function ownerProjectQuestion(field: OwnerProjectMissingField): string {
  const questions: Record<OwnerProjectMissingField, string> = {
    project_name: 'เป็นของโครงการไหนครับ? ถ้าเป็นโครงการใหม่ บอกชื่อที่ต้องการใช้ได้เลยครับ',
    work_title: 'จะทำอะไรหรือลงทุนเรื่องอะไรครับ?',
    budget: 'ตั้งเงินไว้ประมาณเท่าไรครับ? ถ้ายังไม่รู้ ตอบ “ยังไม่รู้” ได้ครับ',
    counterparty: 'ซื้อหรือจ้างกับใครครับ? ถ้ายังไม่ได้เลือก ตอบ “ยังหาอยู่” ได้ครับ',
    payment_plan: 'จะจ่ายครั้งเดียวหรือแบ่งกี่งวดครับ? ถ้ายังไม่รู้ ตอบ “ยังไม่รู้” ได้ครับ',
    schedule: 'ต้องทำหรือเริ่มจ่ายเมื่อไรครับ? บอกเป็นวันที่หรือคำง่าย ๆ เช่น “ภายในเดือนนี้” ได้ครับ',
    responsible: 'ใครเป็นคนรับผิดชอบงานนี้ครับ? ถ้ายังไม่กำหนด ตอบ “ยังไม่รู้” ได้ครับ',
  };
  return questions[field];
}

function isConfirm(text: string): boolean {
  const normalized = normalizeText(text);
  return /^(?:@?ทองไทย\s*)?(?:ยืนยัน|ถูกต้อง\s*ยืนยัน)(?:ครับ|ค่ะ|คับ)?$/iu.test(normalized)
    || /^(?:@?ทองไทย\s*)(?:ตกลง|โอเค\s*ทำเลย|บันทึกเลย)(?:ครับ|ค่ะ|คับ)?$/iu.test(normalized);
}

function isCancel(text: string): boolean {
  return /^(?:@?ทองไทย\s*)?(?:ยกเลิกร่าง|ยกเลิกรายการนี้|ไม่ต้องจด|หยุดรายการ)(?:ครับ|ค่ะ|คับ)?$/iu.test(normalizeText(text));
}

function isResume(text: string): boolean {
  return /(?:ทองไทย).*(?:ทำต่อ|รายการค้าง|กรอกต่อ|คุยต่อ)/u.test(text);
}

function correctionSignal(text: string): boolean {
  return /(?:แก้|เปลี่ยน|งบ|บาท|งวด|จ้าง|ซื้อจาก|ผู้รับผิดชอบ|วันที่|ภายใน|เงินสด|โอน)/u.test(text);
}

async function activeDraft(groupHash: string, actorHash: string): Promise<DraftRow | null> {
  const response = await dbFetch(
    'owner_project_conversation_drafts?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&actor_hash=eq.' + encodeURIComponent(actorHash)
    + '&status=in.(collecting,awaiting_confirmation)'
    + '&select=id,owner_group_hash,actor_hash,intent,status,data,missing_fields,source_message_id,last_message_id,updated_at,expires_at'
    + '&order=updated_at.desc&limit=1',
  );
  const draft = (await response.json() as DraftRow[])[0] ?? null;
  if (draft && new Date(draft.expires_at).getTime() <= Date.now()) {
    await dbFetch('owner_project_conversation_drafts?id=eq.' + draft.id, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'expired', updated_at: new Date().toISOString() }),
    });
    return null;
  }
  return draft;
}

async function claimMessage(input: {
  groupHash: string;
  actorHash: string;
  messageId: string;
  text: string;
}): Promise<{ claimed: boolean; reply: string | null }> {
  const response = await dbFetch(
    'owner_project_conversation_messages?on_conflict=source_channel,message_id',
    {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({
        source_channel: 'line',
        message_id: input.messageId,
        owner_group_hash: input.groupHash,
        actor_hash: input.actorHash,
        message_sha256: createHash('sha256').update(input.text, 'utf8').digest('hex'),
      }),
    },
  );
  const inserted = await response.json() as Array<{ message_id: string }>;
  if (inserted.length) return { claimed: true, reply: null };
  const prior = await dbFetch(
    'owner_project_conversation_messages?source_channel=eq.line&message_id=eq.' + encodeURIComponent(input.messageId)
    + '&select=reply_text&limit=1',
  );
  const row = (await prior.json() as Array<{ reply_text: string | null }>)[0];
  return { claimed: false, reply: row?.reply_text ?? 'ทองไทยรับข้อความนี้ไว้แล้ว กำลังตรวจรายการเดิมอยู่ครับ' };
}

async function storeReply(messageId: string, draftId: string | null, reply: string): Promise<void> {
  await dbFetch(
    'owner_project_conversation_messages?source_channel=eq.line&message_id=eq.' + encodeURIComponent(messageId),
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ draft_id: draftId, reply_text: reply.slice(0, 5000) }),
    },
  );
}

async function createDraft(input: {
  groupHash: string;
  actorHash: string;
  messageId: string;
  intent: OwnerProjectIntent;
  data: OwnerProjectDraftData;
  missing: OwnerProjectMissingField[];
}): Promise<DraftRow> {
  const response = await dbFetch('owner_project_conversation_drafts', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      owner_group_hash: input.groupHash,
      actor_hash: input.actorHash,
      intent: input.intent,
      status: input.missing.length ? 'collecting' : 'awaiting_confirmation',
      data: input.data,
      missing_fields: input.missing,
      source_message_id: input.messageId,
      last_message_id: input.messageId,
    }),
  });
  return (await response.json() as DraftRow[])[0]!;
}

async function updateDraft(
  draft: DraftRow,
  patch: Partial<Pick<DraftRow, 'status' | 'data' | 'missing_fields' | 'last_message_id'>>,
): Promise<DraftRow> {
  const response = await dbFetch('owner_project_conversation_drafts?id=eq.' + draft.id, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
  });
  return (await response.json() as DraftRow[])[0]!;
}

function nextDraftReply(draft: DraftRow): string {
  return draft.missing_fields.length
    ? ownerProjectQuestion(draft.missing_fields[0]!)
    : renderOwnerProjectDraftSummary(draft.intent, draft.data);
}

export async function handleOwnerProjectText(input: {
  targetId: string;
  userId?: string | null;
  text: string;
  messageId?: string | null;
  timestamp?: number;
}): Promise<string | null> {
  const team = await boundLineOpsTeam(input.targetId);
  if (team !== 'owner_general' || !input.messageId || !input.userId) return null;
  const text = normalizeText(input.text);
  const groupHash = piiHash(input.targetId);
  const actorHash = piiHash(input.userId);
  if (!groupHash || !actorHash) return null;

  let draft = await activeDraft(groupHash, actorHash);
  const startIntent = classifyOwnerProjectStart(text);
  const now = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();
  const recent = draft ? now - new Date(draft.updated_at).getTime() <= CONTINUATION_WINDOW_MS : false;
  const explicitlyAddressed = /(?:ทองไทย|@ทองไทย)/u.test(text);

  if (isMotherConversation(text) && !explicitlyAddressed) return null;
  if (isReadOnlyQuestion(text)) return null;

  let preview: { data: OwnerProjectDraftData; changed: boolean } | null = null;
  if (draft?.status === 'collecting' && (recent || explicitlyAddressed || isResume(text))) {
    preview = applyOwnerProjectText({
      text,
      intent: draft.intent,
      data: draft.data,
      expectedField: draft.missing_fields[0] ?? null,
      timestamp: now,
    });
  } else if (draft?.status === 'awaiting_confirmation' && correctionSignal(text)) {
    preview = applyOwnerProjectText({ text, intent: draft.intent, data: draft.data, timestamp: now });
  }

  const shouldHandle = Boolean(
    startIntent
    || (draft && (isConfirm(text) || isCancel(text) || isResume(text)))
    || (preview?.changed && (recent || explicitlyAddressed))
  );
  if (!shouldHandle) return null;

  const claim = await claimMessage({ groupHash, actorHash, messageId: input.messageId, text });
  if (!claim.claimed) return claim.reply;

  if (draft && startIntent && !isConfirm(text) && !isCancel(text)) {
    const reply = [
      'มีรายการเดิมที่ยังกรอกไม่จบครับ เพื่อไม่ให้ข้อมูลสองงานปนกัน ผมยังไม่ได้ทับรายการเดิม',
      nextDraftReply(draft),
      'ถ้าจะทิ้งรายการเดิม พิมพ์ “ยกเลิกร่าง” แล้วส่งงานใหม่อีกครั้งครับ',
    ].join('\n');
    await storeReply(input.messageId, draft.id, reply);
    return reply;
  }

  if (draft && isCancel(text)) {
    draft = await updateDraft(draft, { status: 'cancelled', last_message_id: input.messageId });
    const reply = 'ยกเลิกร่างรายการนี้แล้วครับ ยังไม่มีงานหรืองบถูกบันทึกเป็นรายการจริง';
    await storeReply(input.messageId, draft.id, reply);
    return reply;
  }

  if (draft && isConfirm(text)) {
    if (draft.missing_fields.length) {
      const reply = 'ยังบันทึกไม่ได้ครับ ขาดข้อมูลอีกเล็กน้อย\n' + ownerProjectQuestion(draft.missing_fields[0]!);
      await storeReply(input.messageId, draft.id, reply);
      return reply;
    }
    const result = await rpc<ConfirmResult>('owner_project_confirm_draft_v1', {
      p_draft_id: draft.id,
      p_message_id: input.messageId,
      p_actor_hash: actorHash,
    });
    const reply = [
      result.duplicate ? 'รายการนี้บันทึกไว้แล้วครับ' : '✅ บันทึกเข้าหลังบ้านแล้วครับ',
      `โครงการ: ${result.project_name ?? draft.data.project_name} (${result.project_code ?? '—'})`,
      `งาน: ${draft.data.work_title} (${result.task_code ?? '—'})`,
      result.installment_count ? `สร้างแผนจ่าย ${result.installment_count} งวดแล้ว` : '',
      'ข้อมูลนี้จะอยู่ในสรุปรายสัปดาห์ทันที',
      `ดูหลังบ้าน: ${DASHBOARD_URL}`,
    ].filter(Boolean).join('\n');
    await storeReply(input.messageId, draft.id, reply);
    return reply;
  }

  if (!draft && startIntent) {
    const parsed = applyOwnerProjectText({ text, intent: startIntent, timestamp: now });
    const missing = ownerProjectMissingFields(startIntent, parsed.data);
    try {
      draft = await createDraft({
        groupHash, actorHash, messageId: input.messageId,
        intent: startIntent, data: parsed.data, missing,
      });
    } catch (error) {
      draft = await activeDraft(groupHash, actorHash);
      if (!draft) throw error;
    }
    const reply = nextDraftReply(draft);
    await storeReply(input.messageId, draft.id, reply);
    return reply;
  }

  if (!draft) {
    const reply = 'ยังไม่พบรายการที่กำลังคุยอยู่ครับ พิมพ์ “ทองไทย สร้างโครงการใหม่” เพื่อเริ่มได้เลย';
    await storeReply(input.messageId, null, reply);
    return reply;
  }

  if (isResume(text) && !preview?.changed) {
    const reply = nextDraftReply(draft);
    await storeReply(input.messageId, draft.id, reply);
    return reply;
  }

  if (preview?.changed) {
    const missing = ownerProjectMissingFields(draft.intent, preview.data);
    draft = await updateDraft(draft, {
      data: preview.data,
      missing_fields: missing,
      status: missing.length ? 'collecting' : 'awaiting_confirmation',
      last_message_id: input.messageId,
    });
    const reply = nextDraftReply(draft);
    await storeReply(input.messageId, draft.id, reply);
    return reply;
  }

  const reply = nextDraftReply(draft);
  await storeReply(input.messageId, draft.id, reply);
  return reply;
}
