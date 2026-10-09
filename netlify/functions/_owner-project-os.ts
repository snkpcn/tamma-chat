import { createHash } from 'node:crypto';
import { piiHash } from './_operations-db';
import { boundLineOpsTeam, buildTeamScheduleSummary } from './_ops-notifications';
import { parseOwnerReportedPaidTotal } from './_owner-paid-total';

export type OwnerProjectIntent = 'new_project' | 'investment_plan' | 'weekly_task' | 'one_time_task';
export type OwnerProjectMissingField =
  | 'project_name'
  | 'work_title'
  | 'budget'
  | 'counterparty'
  | 'payment_plan'
  | 'schedule'
  | 'responsible';

export type OwnerProjectBulkTask = {
  position: number;
  title: string;
};

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
  bulk_tasks?: OwnerProjectBulkTask[];
  unknown_fields?: OwnerProjectMissingField[];
  origin_paid_expense_message_id?: string;
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
  task_count?: number;
  tasks?: Array<{ id: string; task_code: string; title: string; position: number }>;
  installment_count?: number;
};

type TaskStateResult = {
  ok?: boolean;
  duplicate?: boolean;
  task_id?: string;
  task_code?: string;
  task_title?: string;
  task_status?: 'todo' | 'done';
  project_name?: string;
  batch_position?: number | null;
};

type MultiTaskStateResult = {
  ok?: boolean;
  tasks?: TaskStateResult[];
  task_count?: number;
};

type ProjectStateResult = {
  ok?: boolean;
  duplicate?: boolean;
  blocked?: boolean;
  project_name?: string;
  project_status?: string;
  pending_count?: number;
  pending_tasks?: Array<{code:string;title:string}>;
};

const DASHBOARD_URL = 'https://tamma-backoffice.netlify.app/investments.html';
const CONTINUATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
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

function normalizeDigits(value: string): string {
  return value.replace(/[๐-๙]/g, digit => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)));
}

function normalizeText(value: string): string {
  return normalizeDigits(value).trim().replace(/\s+/g, ' ');
}

function cleanAnswer(value: string): string {
  return normalizeText(value)
    .replace(/^(?:@?ทองไทย|น้องทองไทย)[,:：\-–—\s]*/iu, '')
    .replace(/^(?:ตอบ|คำตอบ|คือ)\s*/u, '')
    .replace(/[.。]+$/u, '')
    .trim();
}

const BULK_TASK_SIGNAL = /(?:งาน(?:ที่)?ค้าง(?:สำหรับ|ของ)?(?:อาทิตย์|สัปดาห์)นี้|งาน(?:สำหรับ|ของ)?(?:อาทิตย์|สัปดาห์)นี้|งานอาทิตย์นี้|งานสัปดาห์นี้|รายการงาน|หลายงาน|หลายอัน)/u;

function cleanBulkTaskTitle(value: string): string {
  return normalizeText(value)
    .replace(/^(?:งาน(?:ที่|ลำดับ)\s*|ข้อ\s*)/u, '')
    .replace(/^[\-–—:：.)\s]+/u, '')
    .replace(/[.。]+$/u, '')
    .trim()
    .slice(0, 240);
}

/** Parse a LINE message containing several task lines while preserving their order. */
export function parseOwnerProjectBulkTasks(rawText: string): OwnerProjectBulkTask[] {
  const normalizedRaw = normalizeDigits(rawText.replace(/\r/g, ''));
  const lines = normalizedRaw.split('\n').map(line => line.trim()).filter(Boolean);
  const hasBulkSignal = BULK_TASK_SIGNAL.test(normalizeText(rawText));
  const tasks: OwnerProjectBulkTask[] = [];

  for (const [lineIndex, originalLine] of lines.entries()) {
    const line = originalLine.replace(/^(?:@?ทองไทย|น้องทองไทย)[,:：\-–—\s]*/iu, '').trim();
    if (!line) continue;

    const numbered = line.match(/^(?:งาน\s*)?([0-9]{1,3})(?:\s*[.)\-:：]\s*(.*)|\s+(.+))?$/u);
    if (numbered) {
      const itemNumber = Number(numbered[1]);
      const remainder = (numbered[2] ?? numbered[3] ?? '').trim();
      const title = remainder
        ? cleanBulkTaskTitle(remainder)
        : (/^งาน\s*[0-9]/u.test(line) ? `งาน ${itemNumber}` : '');
      if (title) tasks.push({ position: tasks.length + 1, title });
      continue;
    }

    const bullet = line.match(/^(?:[-*•▪◦]|☐|☑|✅|\[\s?\])\s*(.+)$/u);
    if (bullet) {
      const title = cleanBulkTaskTitle(bullet[1]);
      if (title) tasks.push({ position: tasks.length + 1, title });
      continue;
    }

    if (hasBulkSignal && lineIndex > 0
      && !/^(?:โครงการ|โปรเจ(?:ค|กต์)|กำหนด|ผู้รับผิดชอบ|คนรับผิดชอบ)/iu.test(line)
      && !BULK_TASK_SIGNAL.test(line)) {
      const title = cleanBulkTaskTitle(line);
      if (title) tasks.push({ position: tasks.length + 1, title });
    }
  }

  return tasks.slice(0, 40).map((task, index) => ({ ...task, position: index + 1 }));
}

function parseBulkProjectName(rawText: string): string | null {
  for (const rawLine of rawText.replace(/\r/g, '').split('\n')) {
    const line = normalizeText(rawLine);
    const match = line.match(/(?:ของ\s*)?(?:โครงการ|โปรเจ(?:ค|กต์))\s*(?:ชื่อ\s*)?[:：]?\s*(.+)$/iu);
    if (!match) continue;
    const value = match[1]
      .replace(/\s*(?:มีดังนี้|ดังนี้|งาน(?:สำหรับ|ของ)?(?:อาทิตย์|สัปดาห์)นี้).*$/u, '')
      .replace(/[,:：\-–—]+$/u, '')
      .trim();
    if (value && value.length >= 2 && value.length <= 180) return value;
  }
  return null;
}

function bangkokWeekEnd(timestamp: number): string {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(timestamp);
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + ((7 - date.getUTCDay()) % 7));
  return date.toISOString().slice(0, 10);
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

const OWNER_PROJECT_QUERY = /(?:สรุปมา|สรุป(?:งาน|โครงการ|โปรเจค)|มี(?:งาน(?:อะไร)?|อะไร)?ค้าง(?:อยู่)?(?:ไหม|มั้ย|หรือเปล่า|รึป่าว|รึเปล่า)?|ตอนนี้ถึงไหนแล้ว|(?:ตอนนี้)?มีอะไรต้องทำ(?:ต่อ)?|งาน(?:ของ)?กลุ่มนี้(?:เป็นไง|เป็นยังไง|ถึงไหนแล้ว)|เหลือ(?:งาน)?อะไร(?:บ้าง)?|มีอะไร(?:ที่)?ต้องตาม(?:บ้าง)?|งานไหน(?:ที่)?รอ(?:กู|ผม|พี่|เจ้าของ)|อันไหน(?:ที่)?(?:เลย|เกิน)กำหนด|ยอดโครงการ.*(?:เท่าไหร่|เท่าไร)|โครงการ.*ยอดจ่าย|จ่ายไปเท่าไหร่(?:แล้ว)?|มีจ่ายอะไรไปแล้ว)/u;
type SummaryProject = { id: string; name: string; project_code: string };
type SummaryTask = {
  id: string;
  project_id: string;
  task_code: string;
  title: string;
  task_kind: string;
  status: string;
  due_on: string | null;
  responsible_name: string | null;
  source_message_id: string | null;
  source_batch_position: number | null;
  confirmed_at: string | null;
  created_at: string;
};
type SummaryInstallment = { id: string; project_id: string; title: string; amount: number | string; due_on: string | null; status: string };

const summaryMoney = (n: number) => n.toLocaleString('th-TH', { maximumFractionDigits: 2 }) + ' บาท';
const normalizeProjectLookup = (value: string) => normalizeText(value).toLocaleLowerCase('th-TH').replace(/[^\p{L}\p{M}\p{N}]+/gu, '');

function expenseSummaryTitle(title: string, projectName?: string): string {
  if (projectName && /^ตำมา[\s-]*ชาติ$/u.test(projectName)) {
    return title.replace(/ตำมา[\s-]*ชาติ/gu, 'ตำมา-ชาติ');
  }
  return title;
}

function projectSpendLines(
  expenses: Array<{ name: string; amount: number; projectId: string | null }>,
  projects: SummaryProject[],
): string[] {
  const withSpend = projects.map(project => ({
    project,
    rows: expenses.filter(row => row.projectId === project.id),
  })).filter(item => item.rows.length);
  const lines = withSpend.slice(0, 5).flatMap(({project, rows}) => [
    `• ${project.name}: ${summaryMoney(rows.reduce((sum, row) => sum + row.amount, 0))}`,
    ...rows.slice(0, 3).map(row => `  - ${expenseSummaryTitle(row.name, project.name)} · ${summaryMoney(row.amount)}`),
  ]);
  if (withSpend.length > 5) lines.push(`• อีก ${withSpend.length - 5} โครงการในยอดรวม`);
  lines.push(...expenses.filter(row => !row.projectId || !projects.some(project => project.id === row.projectId))
    .slice(0, 3).map(row => `• ${row.name} · ${summaryMoney(row.amount)} — ยังไม่ผูกโครงการ`));
  return lines;
}

const TEAM_PROJECT_BUSINESS: Record<string, string> = {
  restaurant: 'tamma_restaurant',
  stay: 'huenstay',
  activity: 'adventure',
  cafe: 'inthanin',
  otop: 'otop',
};

async function domainProjectSummary(team: string, query: string, today: string): Promise<string> {
  const business = TEAM_PROJECT_BUSINESS[team];
  const schedule = await buildTeamScheduleSummary(team as Parameters<typeof buildTeamScheduleSummary>[0], today);
  if (!business) return schedule;
  const projects = await (await dbFetch('owner_projects?business_unit_code=eq.' + business
    + '&status=neq.cancelled&select=id,name,project_code&order=created_at.desc&limit=50')).json() as SummaryProject[];
  const onlyPending = /(?:ค้าง|เลยกำหนด|เกินกำหนด|ต้องตาม)/u.test(query);
  const onlyOwner = /(?:งานไหนรอกู|งานไหนรอผม|รอเจ้าของ|รอพี่ยืนยัน|รออนุมัติ)/u.test(query);
  const onlySpend = /(?:ยอดโครงการ|ยอดจ่าย|จ่ายไป|มีจ่ายอะไร)/u.test(query);
  const spendRows = onlySpend || (!onlyPending && !onlyOwner) ? await (async () => {
    const [intakes, ledger] = await Promise.all([
      dbFetch('financial_owner_expense_intakes?business_unit_code=eq.' + business + '&status=eq.categorized&select=owner_project_id,amount,purpose_raw,evidence_message_id&order=occurred_on.desc&limit=300')
        .then(r => r.json() as Promise<Array<{ owner_project_id:string; amount:number|string; purpose_raw:string; evidence_message_id:string|null }>>),
      dbFetch('financial_investment_entries?business_unit_code=eq.' + business + '&status=eq.recorded&select=owner_project_id,amount,title,source_message_id&order=occurred_on.desc&limit=300')
        .then(r => r.json() as Promise<Array<{ owner_project_id:string; amount:number|string; title:string; source_message_id:string|null }>>),
    ]);
    const ledgerMessages = new Set(ledger.map(row => row.source_message_id).filter(Boolean));
    return [
      ...ledger.map(row => ({ project_id:row.owner_project_id, title:row.title, amount:Number(row.amount||0) })),
      ...intakes.filter(row => !row.evidence_message_id || !ledgerMessages.has(row.evidence_message_id))
        .map(row => ({ project_id:row.owner_project_id, title:row.purpose_raw, amount:Number(row.amount||0) })),
    ];
  })() : [];
  if (!projects.length) {
    if (/(?:ยอดโครงการ|โครงการ.*ยอดจ่าย)/u.test(query)) return 'หลังบ้านยังไม่มีโครงการของทีมนี้ให้ตรวจยอดจ่ายครับ';
    const lines = ['สรุปข้อมูลของกลุ่มนี้จากหลังบ้านครับ',schedule];
    if (spendRows.length) lines.push(`💰 รายจ่ายหมวดนี้ที่บันทึก: ${summaryMoney(spendRows.reduce((sum,row) => sum+row.amount,0))}`,
      ...spendRows.slice(0,4).map(row => `• ${row.title} · ${summaryMoney(row.amount)} — ยังไม่ผูกโครงการ`));
    return lines.join('\n');
  }
  const ids = encodeURIComponent('(' + projects.map(row => row.id).join(',') + ')');
  if (onlySpend) {
    const projectTotal = /(?:ยอดโครงการ|โครงการ.*ยอดจ่าย)/u.test(query);
    const projectIds = new Set(projects.map(row => row.id));
    const entries = projectTotal ? spendRows.filter(row => projectIds.has(row.project_id)) : spendRows;
    const names = new Map(projects.map(row => [row.id,row.name]));
    if (!entries.length) return projectTotal
      ? 'หลังบ้านยังไม่มีรายการจ่ายที่ยืนยันแล้วผูกกับโครงการของทีมนี้ครับ จึงยังยืนยันยอดจ่ายโครงการไม่ได้'
      : 'หลังบ้านยังไม่มีรายการจ่ายที่ยืนยันแล้วในหมวดของทีมนี้ครับ';
    const total = entries.reduce((sum,row) => sum + row.amount,0);
    return [
      `${projectTotal ? 'ยอดจ่ายโครงการที่ผูกกับรายการจริง' : 'รายจ่ายหมวดของกลุ่มนี้ที่บันทึก'}: ${summaryMoney(total)}`,
      ...entries.slice(0,8).map(row => `• ${names.get(row.project_id) ?? 'ยังไม่ผูกโครงการ'}: ${row.title} · ${summaryMoney(row.amount)}`),
      ...(projectTotal && spendRows.length > entries.length ? ['มีรายจ่ายหมวดนี้ที่ยังไม่ผูกโครงการ ไม่รวมในยอดโครงการครับ'] : []),
    ].join('\n');
  }

  const tasks = await (await dbFetch('owner_project_tasks?project_id=in.' + ids
    + '&status=neq.cancelled&select=id,project_id,task_code,title,task_kind,status,due_on,responsible_name,source_message_id,source_batch_position,confirmed_at,created_at'
    + '&order=confirmed_at.desc.nullslast,source_batch_position.asc.nullslast,created_at.desc&limit=300')).json() as SummaryTask[];
  const weekly = tasks.filter(row => row.task_kind === 'weekly');
  const weekStart = new Date(`${today}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - ((weekStart.getUTCDay() + 6) % 7));
  const checkins = weekly.length ? await (await dbFetch('owner_project_task_checkins?week_start=eq.' + weekStart.toISOString().slice(0,10)
    + '&task_id=in.' + encodeURIComponent('(' + weekly.map(row => row.id).join(',') + ')')
    + '&select=task_id,state&limit=300')).json() as Array<{task_id:string;state:string}> : [];
  const checked = new Map(checkins.map(row => [row.task_id,row.state]));
  const state = (row: SummaryTask) => row.task_kind === 'weekly' ? checked.get(row.id) ?? row.status : row.status;
  const names = new Map(projects.map(row => [row.id,row.name]));
  const latestBatch = tasks.find(row => row.source_batch_position && row.source_message_id)?.source_message_id;
  const taskLine = (row: SummaryTask) => {
    const label = row.source_batch_position && row.source_message_id === latestBatch ? `งาน ${row.source_batch_position}` : row.task_code;
    return `• ${label} — ${names.get(row.project_id)}: ${row.title}${row.due_on ? ` — กำหนด ${row.due_on}` : ''}`;
  };
  const overdue = tasks.filter(row => state(row) !== 'done' && row.due_on && row.due_on < today);
  const waiting = tasks.filter(row => ['todo','blocked'].includes(state(row)) && !overdue.includes(row));
  const active = tasks.filter(row => state(row) === 'in_progress' && !overdue.includes(row));
  const complete = tasks.filter(row => state(row) === 'done');
  const ownerWait = tasks.filter(row => state(row) !== 'done' && /(?:รอเจ้าของ|รอยืนยัน|รออนุมัติ|owner approval)/iu.test(row.title));
  const lines = ['สรุปข้อมูลของกลุ่มนี้จากหลังบ้านครับ'];
  if (onlyOwner) {
    lines.push('', '⏳ รอเจ้าของตัดสินใจ', ...(ownerWait.length ? ownerWait.slice(0,8).map(taskLine) : ['• ยังไม่มีงานที่ระบุว่ารอเจ้าของตัดสินใจครับ']));
  } else if (onlyPending) {
    const pending = [...overdue,...waiting,...active];
    lines.push('', '🔴 งานค้าง/ต้องตาม', ...(pending.length ? pending.slice(0,10).map(taskLine) : ['• ยังไม่มีงานค้างในโครงการของทีมนี้ครับ']));
  } else {
    for (const [label,rows] of [['🔴 เลยกำหนด',overdue],['⏳ ค้าง/รอดำเนินการ',waiting],['🟡 กำลังทำ',active],['✅ เสร็จแล้ว',complete]] as const) {
      if (rows.length) lines.push('',label,...rows.slice(0,6).map(taskLine));
    }
    if (!tasks.length) lines.push('', 'ยังไม่มีงานโครงการที่บันทึกไว้ของทีมนี้ครับ');
    if (!schedule.includes('\nยังไม่มีงานในตาราง\n') && !schedule.includes('\nไม่มีรายการค้างที่ต้องติดตาม\n')
      && !schedule.includes('\nไม่มีออเดอร์ค้างที่ต้องจัดการ\n')) lines.push('',schedule);
    if (spendRows.length) lines.push('',`💰 รายจ่ายหมวดนี้ที่บันทึก: ${summaryMoney(spendRows.reduce((sum,row) => sum + row.amount,0))}`,
      ...spendRows.slice(0,4).map(row => `• ${row.title} · ${summaryMoney(row.amount)}${row.project_id ? '' : ' — ยังไม่ผูกโครงการ'}`));
  }
  return lines.join('\n');
}

export async function handleOwnerProjectQuery(input: { targetId: string; text: string; timestamp?: number }): Promise<string | null> {
  if (!OWNER_PROJECT_QUERY.test(normalizeText(input.text))) return null;
  const team = await boundLineOpsTeam(input.targetId);
  if (!team) return 'กลุ่มนี้ยังไม่ได้ตั้งค่าขอบเขตข้อมูลครับ ให้ผู้ดูแลผูกกลุ่มกับทีม/โครงการก่อน';
  if (team !== 'owner_general') {
    if (['restaurant','stay','activity','cafe','cafe_test','otop'].includes(team)) {
      const today = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Bangkok', year:'numeric', month:'2-digit', day:'2-digit' }).format(input.timestamp ?? Date.now());
      return domainProjectSummary(team, normalizeText(input.text), today);
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
    dbFetch('owner_project_tasks?project_id=in.' + ids + '&status=neq.cancelled&select=id,project_id,task_code,title,task_kind,status,due_on,responsible_name,source_message_id,source_batch_position,confirmed_at,created_at&order=confirmed_at.desc.nullslast,source_batch_position.asc.nullslast,created_at.desc&limit=300').then(r => r.json() as Promise<SummaryTask[]>),
    dbFetch('owner_project_installments?project_id=in.' + ids + '&status=neq.cancelled&select=id,project_id,title,amount,due_on,status&order=due_on.asc.nullslast&limit=300').then(r => r.json() as Promise<SummaryInstallment[]>),
    dbFetch('financial_owner_expense_intakes?owner_group_hash=eq.' + encodeURIComponent(groupHash) + '&status=neq.cancelled&select=id,owner_project_id,occurred_on,amount,purpose_raw,status,evidence_message_id&order=occurred_on.desc&limit=300').then(r => r.json() as Promise<Array<{ id:string; owner_project_id:string|null; occurred_on:string; amount:number|string; purpose_raw:string; status:string; evidence_message_id:string|null }>>),
    dbFetch('financial_investment_entries?owner_group_hash=eq.' + encodeURIComponent(groupHash) + '&status=eq.recorded&select=id,owner_project_id,occurred_on,amount,title,source_message_id&order=occurred_on.desc&limit=300').then(r => r.json() as Promise<Array<{ id:string; owner_project_id:string|null; occurred_on:string; amount:number|string; title:string; source_message_id:string|null }>>),
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
  const expenses = [...ledger.map(row => ({name:row.title,amount:Number(row.amount||0),date:row.occurred_on,projectId:row.owner_project_id})), ...receipts.map(row => ({name:row.purpose_raw,amount:Number(row.amount||0),date:row.occurred_on,projectId:row.owner_project_id}))].sort((a,b) => (b.date||'').localeCompare(a.date||''));
  const project = new Map(projects.map(row => [row.id,row.name]));
  const latestBatchSource = tasks.find(row => row.source_batch_position && row.source_message_id)?.source_message_id ?? null;
  const taskLabel = (row: SummaryTask) => row.source_batch_position && row.source_message_id === latestBatchSource
    ? `งาน ${row.source_batch_position}`
    : row.task_code || 'งาน';
  const taskLine = (row: SummaryTask, suffix = '') => `• ${taskLabel(row)} — ${project.get(row.project_id)}: ${row.title}${suffix}`;
  const query = normalizeText(input.text);
  const onlyPending = /(?:ค้าง|เลยกำหนด|เกินกำหนด|ต้องตาม)/u.test(query);
  const onlyOwner = /(?:งานไหนรอกู|งานไหนรอผม|รอเจ้าของ|รอพี่ยืนยัน|รออนุมัติ)/u.test(query);
  const onlySpend = /(?:ยอดโครงการ|ยอดจ่าย|จ่ายไป|มีจ่ายอะไร)/u.test(query);
  const normalizedQuery = normalizeProjectLookup(query);
  const namedProjects = onlySpend ? projects.filter(row => {
    const name = normalizeProjectLookup(row.name);
    return name.length >= 3 && normalizedQuery.includes(name);
  }) : [];
  const projectSpend = namedProjects.length > 0 || /(?:ยอดโครงการ|โครงการ.*ยอดจ่าย)/u.test(query);
  const selectedExpenses = projectSpend ? expenses.filter(row => row.projectId && project.has(row.projectId)
    && (!namedProjects.length || namedProjects.some(project => project.id === row.projectId))) : expenses;
  const total = selectedExpenses.reduce((sum,row) => sum + row.amount,0);
  const lines = ['สรุปจากหลังบ้านตอนนี้ครับ'];
  if (onlyOwner) return [...lines,'','⏳ รอเจ้าของตัดสินใจ',...(ownerWait.length?ownerWait.map(row=>taskLine(row)):['• หลังบ้านยังไม่มีงานที่ระบุว่ารอเจ้าของตัดสินใจครับ'])].join('\n');
  if (onlyPending) {
    const follow = [...new Map([...waiting,...overdue].map(row=>[row.id,row])).values()];
    if (follow.length) lines.push('','🔴 ค้าง/เลยกำหนด/ต้องตาม',...follow.slice(0,8).map(row=>taskLine(row,row.due_on?' — กำหนด '+row.due_on:'')));
  } else if (!onlySpend) {
    for (const [label,rows] of [['✅ เสร็จแล้ว',complete],['🟡 กำลังทำ',active],['⏳ ค้าง/รอดำเนินการ',waiting]] as const) if (rows.length) lines.push('',label,...rows.slice(0,5).map(row=>taskLine(row,row.responsible_name?' — '+row.responsible_name:'')));
    if (overdue.length) lines.push('','🔴 เลยกำหนด',...overdue.slice(0,5).map(row=>taskLine(row,` — กำหนด ${row.due_on}`)));
  }
  if (!onlyPending && !onlyOwner && pendingReceipts.length) lines.push('','⏳ สลิปที่รอจัดหมวด/ตรวจข้อมูล',...pendingReceipts.slice(0,5).map(row=>`• ${row.purpose_raw||'สลิปรอระบุ'} · ${summaryMoney(Number(row.amount||0))}`));
  if (onlyPending) {
    const late = due.filter(row => row.due_on && row.due_on < today);
    if (late.length) lines.push('','💸 งวดเลยกำหนด',...late.slice(0,5).map(row=>`• ${project.get(row.project_id)}: ${row.title} ${summaryMoney(Number(row.amount))}`));
  } else if (due.length) lines.push('','💸 งวดที่ยังจ่าย',...due.slice(0,5).map(row=>`• ${project.get(row.project_id)}: ${row.title} ${summaryMoney(Number(row.amount))}${row.due_on?' — '+row.due_on:''}`));
  if (onlySpend || (!onlyPending && expenses.length)) {
    const namedProject = namedProjects.length === 1 ? namedProjects[0] : null;
    if (selectedExpenses.length) lines.push('',`💰 ${namedProject ? `จ่ายแล้วของโครงการ${namedProject.name}` : projectSpend ? 'จ่ายแล้วที่ผูกกับโครงการ' : 'รายจ่ายที่บันทึกในกลุ่ม'}: `+summaryMoney(total),
      ...projectSpendLines(selectedExpenses, namedProjects.length ? namedProjects : projects));
    else lines.push('',projectSpend ? 'หลังบ้านยังไม่มีรายการจ่ายที่ยืนยันแล้วผูกกับโครงการนี้ครับ' : 'หลังบ้านยังไม่มีรายจ่ายที่ยืนยันแล้วในกลุ่มนี้ครับ');
    if (pendingReceipts.length) lines.push(`• มีสลิปรอจัดหมวด/ตรวจข้อมูลอีก ${pendingReceipts.length} รายการ ไม่รวมในยอดจ่ายยืนยัน`);
  }
  if (!complete.length && !active.length && !waiting.length && !overdue.length && !due.length && !expenses.length) lines.push('ยังไม่มีงานค้าง งวดจ่าย หรือรายจ่ายที่บันทึกของกลุ่มนี้ครับ');
  return lines.join('\n');
}

export function classifyOwnerProjectStart(rawText: string): OwnerProjectIntent | null {
  const text = normalizeText(rawText);
  if (!text || isMotherConversation(text) || isReadOnlyQuestion(text)) return null;
  if (/^(?:ลงทุน(?:เงินสด)?|เงินสดลงทุน|บันทึกลงทุน)\s+[0-9][0-9,]*(?:\.[0-9]{1,2})?/u.test(text)) return null;

  const bulkTasks = parseOwnerProjectBulkTasks(rawText);
  const directed = /(?:ทองไทย|@ทองไทย|จดให้หน่อย|ช่วยจด|บันทึกให้|เพิ่มงาน|สร้างโครงการ|สร้างโปรเจค)/u.test(text);
  const projectSignal = /(?:จะ|อยาก|ต้อง|มี|ขอ)?\s*(?:ลงทุนใหม่|ลงทุนเพิ่ม|สร้างโครงการ|สร้างโปรเจค|โปรเจคสร้างใหม่|โครงการสร้างใหม่|เปิดร้านใหม่|ทำโครงการใหม่)/u.test(text);
  const weeklySignal = /(?:งานประจำ|งานรายสัปดาห์|ทำทุกอาทิตย์|ทำทุกสัปดาห์|ทุกวัน(?:จันทร์|อังคาร|พุธ|พฤหัส|ศุกร์|เสาร์|อาทิตย์))/u.test(text);
  const taskSignal = /(?:งานก่อนเปิดร้าน|งานต้องทำ|เพิ่มงาน|มีงานใหม่|ต้องทำก่อนเปิด|งาน(?:สำหรับ|ของ)?(?:อาทิตย์|สัปดาห์)นี้|รายการงาน)/u.test(text);
  const explicitNumberedWorkList = /^\s*งาน\s*[0-9๐-๙]{1,3}(?:\s|[.)\-:：]|$)/mu.test(rawText);
  if (bulkTasks.length >= 2 && (directed || taskSignal || BULK_TASK_SIGNAL.test(text) || explicitNumberedWorkList)) return 'one_time_task';
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
  const bulkTasks = data.bulk_tasks?.filter(task => task.title.trim()) ?? [];
  if (!data.work_title && !bulkTasks.length) missing.push('work_title');
  if (bulkTasks.length >= 2) return missing;
  if (intent === 'weekly_task') {
    if (!(data.recurrence_weekdays?.length || data.schedule_text || unknown(data, 'schedule'))) missing.push('schedule');
    if (!(data.responsible_name || unknown(data, 'responsible'))) missing.push('responsible');
    return missing;
  }
  if (!(typeof data.budget_amount === 'number' || unknown(data, 'budget'))) missing.push('budget');
  if (!(data.counterparty_name || unknown(data, 'counterparty'))) missing.push('counterparty');
  if (!(typeof data.installment_count === 'number' || unknown(data, 'payment_plan'))) missing.push('payment_plan');
  if (!(data.due_on || data.schedule_text || unknown(data, 'schedule'))) missing.push('schedule');
  if (!(data.responsible_name || unknown(data, 'responsible'))) missing.push('responsible');
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
  const bulkTasks = parseOwnerProjectBulkTasks(input.text);

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
  if (bulkTasks.length >= 2) {
    data.bulk_tasks = bulkTasks;
    data.work_title = `ชุดงานสัปดาห์นี้ ${bulkTasks.length} งาน`;
    data.task_kind = 'one_time';
    delete data.recurrence_weekdays;
    data.schedule_text = 'ภายในสัปดาห์นี้';
    data.due_on = bangkokWeekEnd(timestamp);
    const bulkProjectName = parseBulkProjectName(input.text);
    if (bulkProjectName) {
      data.project_name = bulkProjectName;
      removeUnknown(data, 'project_name');
    }
  }
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
  const bulkTasks = data.bulk_tasks?.filter(task => task.title.trim()) ?? [];
  if (bulkTasks.length >= 2) {
    return [
      'ขอสรุปชุดงานก่อนบันทึกครับ',
      `โครงการ: ${data.project_name || 'ยังไม่ระบุ'}`,
      `กำหนด: ${data.schedule_text || data.due_on || 'ภายในสัปดาห์นี้'}`,
      '',
      ...bulkTasks.map(task => `${task.position}. ${task.title}`),
      '',
      `รวม ${bulkTasks.length} งาน — แต่ละงานจะค้างแยกกันจนกว่าคุณจะแจ้งว่า “งาน 1 จบแล้ว” หรือบอกชื่องานครับ`,
      'ถ้าถูกต้อง พิมพ์ “ยืนยัน” เพื่อบันทึกทุกงานเข้าหลังบ้านพร้อมกัน',
    ].join('\n');
  }
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
    intent === 'weekly_task' ? '' : `ผู้รับผิดชอบ: ${data.responsible_name || 'ยังไม่รู้'}`,
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

export type OwnerProjectTaskStateCommand = {
  state: 'done' | 'todo';
  referenceKind: 'position' | 'positions' | 'code' | 'title' | 'titles';
  reference: string;
  position?: number;
  positions?: number[];
  titles?: string[];
  projectName?: string;
  explicitTask?: boolean;
};

export function parseOwnerProjectTaskStateCommand(rawText: string): OwnerProjectTaskStateCommand | null {
  const text = cleanAnswer(rawText).replace(/(?:ครับ|ค่ะ|คะ|คับ)$/u, '').trim();
  let state: 'done' | 'todo';
  let reference = '';
  const reopen = text.match(/^(.+?)\s*(?:ยังไม่จบ|ยังไม่เสร็จ|เอากลับมาค้าง|กลับมาค้าง|เปิดกลับเป็นงานค้าง)$/u);
  const done = text.match(/^(?:ติ๊ก(?:ว่า)?\s*)?(.+?)\s*(?:จบแล้ว|เสร็จแล้ว|เสร็จ|เรียบร้อยแล้ว|ติ๊กจบ)$/u)
    ?? text.match(/^(?:ปิดงาน|ติ๊กงาน)\s*(.+)$/u);
  if (reopen) {
    state = 'todo';
    reference = reopen[1].trim();
  } else if (done) {
    state = 'done';
    reference = done[1].trim();
  } else {
    return null;
  }
  if (!reference || /(?:งานไหน|อะไร|อันไหน)/u.test(reference)) return null;

  // A project qualifier selects that project's latest numbered batch. It is
  // never used to widen the search beyond the LINE group's binding.
  const scoped = reference.match(/^(.+?)\s+ของ(?:โครงการ|โปรเจ(?:ค|กต์))?\s*(.+)$/u);
  const projectName = scoped?.[2]?.trim();
  if (scoped) reference = scoped[1]!.trim();

  const numericList = reference.replace(/^งาน\s*/u, '').trim();
  if (/^[0-9]{1,3}(?:\s*(?:,|，|กับ|และ|&|\+|\/)\s*(?:งาน\s*)?[0-9]{1,3})+$/u.test(numericList)) {
    const positions = [...new Set((numericList.match(/[0-9]{1,3}/g) ?? []).map(Number))];
    if (positions.length >= 2 && positions.length <= 20 && positions.every(value => value >= 1 && value <= 100)) {
      return { state, referenceKind: 'positions', reference: positions.join(', '), positions, ...(projectName ? { projectName } : {}) };
    }
  }

  const code = reference.match(/\b(WK-[A-Z0-9]{4,16})\b/iu)?.[1];
  if (code) return { state, referenceKind: 'code', reference: code.toUpperCase(), ...(projectName ? { projectName } : {}) };
  const numbered = reference.match(/^(?:งาน\s*)?([0-9]{1,3})$/u);
  if (numbered) {
    const position = Number(numbered[1]);
    if (position >= 1 && position <= 100) {
      return { state, referenceKind: 'position', reference: String(position), position, ...(projectName ? { projectName } : {}) };
    }
  }
  const titleList = reference.replace(/^งาน(?:ชื่อ)?\s*/u, '').split(/\s+(?:กับ|และ)\s+/u).map(value => value.trim()).filter(Boolean);
  if (titleList.length >= 2 && titleList.length <= 10 && titleList.every(value => value.length >= 2)) {
    return { state, referenceKind: 'titles', reference: titleList.join(' กับ '), titles: titleList, ...(projectName ? { projectName } : {}) };
  }
  const title = reference.replace(/^งาน(?:ชื่อ)?\s*/u, '').trim();
  return title ? { state, referenceKind: 'title', reference: title,
    ...(/^งาน(?:ชื่อ)?\s*/u.test(reference) ? { explicitTask: true } : {}),
    ...(projectName ? { projectName } : {}) } : null;
}

type TaskLookup = SummaryTask & { project_name: string };

function normalizeTaskLookup(value: string): string {
  return normalizeText(value).toLocaleLowerCase('th-TH').replace(/[^\p{L}\p{N}]+/gu, '');
}

async function resolveOwnerProjectTask(
  groupHash: string,
  command: OwnerProjectTaskStateCommand,
): Promise<{ tasks: TaskLookup[]; project?: {id:string;name:string}; reply?: string }> {
  const projects = await (await dbFetch('owner_projects?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&status=neq.cancelled&select=id,name&order=created_at.desc&limit=100')).json() as Array<{id:string;name:string}>;
  if (!projects.length) return { tasks: [], reply: 'หลังบ้านยังไม่มีโครงการที่ผูกกับกลุ่มนี้ครับ' };
  let allowedProjects = projects;
  if (command.projectName) {
    const needle = normalizeTaskLookup(command.projectName);
    allowedProjects = projects.filter(row => normalizeTaskLookup(row.name) === needle);
    if (allowedProjects.length !== 1) return { tasks: [], reply: `ยังไม่พบโครงการ “${command.projectName}” ในกลุ่มนี้ครับ` };
  }
  if (command.referenceKind === 'title' && !command.explicitTask) {
    const projectReference = command.reference.replace(/^(?:โครงการ|โปรเจ(?:ค|กต์))\s*/u,'');
    const exactProject = allowedProjects.filter(row => normalizeTaskLookup(row.name) === normalizeTaskLookup(projectReference));
    if (exactProject.length === 1) return { tasks: [], project: exactProject[0] };
  }
  const ids = encodeURIComponent('(' + projects.map(row => row.id).join(',') + ')');
  const rows = await (await dbFetch('owner_project_tasks?project_id=in.' + ids
    + '&status=neq.cancelled&select=id,project_id,task_code,title,task_kind,status,due_on,responsible_name,source_message_id,source_batch_position,confirmed_at,created_at'
    + '&order=confirmed_at.desc.nullslast,source_batch_position.asc.nullslast,created_at.desc&limit=500')).json() as SummaryTask[];
  const names = new Map(projects.map(row => [row.id, row.name]));
  const allowedIds = new Set(allowedProjects.map(row => row.id));
  const tasks = rows.filter(row => allowedIds.has(row.project_id))
    .map(row => ({ ...row, project_name: names.get(row.project_id) ?? 'ไม่ทราบโครงการ' }));
  let matches: TaskLookup[] = [];

  if (command.referenceKind === 'code') {
    matches = tasks.filter(row => row.task_code?.toUpperCase() === command.reference);
  } else if (command.referenceKind === 'position' || command.referenceKind === 'positions') {
    const latestBatch = tasks.find(row => row.source_batch_position && row.source_message_id)?.source_message_id;
    const requested = command.positions ?? [command.position!];
    matches = latestBatch
      ? requested.map(position => tasks.find(row => row.source_message_id === latestBatch && row.source_batch_position === position)).filter((row): row is TaskLookup => Boolean(row))
      : [];
    if (matches.length !== requested.length) {
      const found = new Set(matches.map(row => row.source_batch_position));
      return { tasks: [], reply: `ยังไม่พบงาน ${requested.filter(position => !found.has(position)).join(', ')} ในชุดงานล่าสุดของกลุ่มนี้ครับ\nพิมพ์ “มีงานค้างไหม” เพื่อดูรายการล่าสุด` };
    }
  } else if (command.referenceKind === 'titles') {
    const selected: TaskLookup[] = [];
    for (const title of command.titles ?? []) {
      const needle = normalizeTaskLookup(title);
      const exact = tasks.filter(row => normalizeTaskLookup(row.title) === needle);
      const candidates = exact.length ? exact : tasks.filter(row => normalizeTaskLookup(row.title).includes(needle));
      if (candidates.length !== 1 || selected.some(row => row.id === candidates[0]!.id)) {
        return { tasks: [], reply: `ยังจับคู่งาน “${title}” ได้ไม่ชัดครับ พิมพ์ “มีงานค้างไหม” แล้วระบุเลขงานหรือรหัสงาน` };
      }
      selected.push(candidates[0]!);
    }
    matches = selected;
  } else {
    const needle = normalizeTaskLookup(command.reference);
    const exact = tasks.filter(row => normalizeTaskLookup(row.title) === needle);
    matches = exact.length ? exact : tasks.filter(row => normalizeTaskLookup(row.title).includes(needle));
  }

  if (matches.length === 1 || (command.referenceKind === 'positions' && matches.length === command.positions?.length)
    || (command.referenceKind === 'titles' && matches.length === command.titles?.length)) return { tasks: matches };
  if (!matches.length) {
    return {
      tasks: [],
      reply: `ยังไม่พบงาน “${command.reference}” ในหลังบ้านของกลุ่มนี้ครับ\nพิมพ์ “มีงานค้างไหม” เพื่อดูรายการล่าสุด`,
    };
  }
  return {
    tasks: [],
    reply: [
      `พบชื่องานใกล้กัน ${matches.length} รายการครับ กรุณาระบุรหัสงาน`,
      ...matches.slice(0, 5).map(row => `• ${row.task_code} — ${row.project_name}: ${row.title}`),
    ].join('\n'),
  };
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

async function fillSoleProjectForBulk(groupHash: string, data: OwnerProjectDraftData): Promise<OwnerProjectDraftData> {
  if (data.project_name || (data.bulk_tasks?.length ?? 0) < 2) return data;
  const response = await dbFetch(
    'owner_projects?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&status=in.(planning,approved,active,paused)&select=name,business_unit_code&order=updated_at.desc&limit=2',
  );
  const projects = await response.json() as Array<{ name: string; business_unit_code: string | null }>;
  if (projects.length !== 1) return data;
  return {
    ...data,
    project_name: projects[0]!.name,
    business_unit_code: data.business_unit_code ?? projects[0]!.business_unit_code ?? undefined,
  };
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

// A recorded payment is evidence, not the total budget. Keep the payment in
// the ledger and collect a separate confirmed plan for the same project.
export async function startOwnerProjectPlanAfterPaidExpense(input: {
  targetId: string; userId: string | null | undefined; messageId: string;
  projectName: string | null; workTitle: string; businessUnit: string | null;
  paymentMethod: 'cash' | 'transfer' | 'card' | 'other';
}): Promise<string> {
  const groupHash = piiHash(input.targetId);
  const actorHash = piiHash(input.userId);
  if (!groupHash || !actorHash) return '';
  const current = await activeDraft(groupHash, actorHash);
  if (current) return `มีแผนที่กำลังถามค้างอยู่ครับ\n${nextDraftReply(current)}`;
  const data: OwnerProjectDraftData = {
    project_name: input.projectName ?? undefined,
    work_title: input.workTitle,
    business_unit_code: input.businessUnit ?? undefined,
    payment_method: input.paymentMethod === 'other' ? undefined : input.paymentMethod,
    task_kind: 'one_time',
    origin_paid_expense_message_id: input.messageId,
  };
  const missing = ownerProjectMissingFields('investment_plan', data);
  const draft = await createDraft({groupHash, actorHash, messageId: input.messageId,
    intent: 'investment_plan', data, missing});
  return nextDraftReply(draft);
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
  const now = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();
  const explicitlyAddressed = /(?:ทองไทย|@ทองไทย)/u.test(text);

  if (isMotherConversation(text) && !explicitlyAddressed) return null;
  const reportedTotal = parseOwnerReportedPaidTotal(text);
  if (reportedTotal !== null) {
    const active = await activeDraft(groupHash, actorHash);
    if (!active?.data.project_name) return null;
    const projects = await (await dbFetch('owner_projects?owner_group_hash=eq.'
      + encodeURIComponent(groupHash) + '&name=eq.'
      + encodeURIComponent(active.data.project_name) + '&status=neq.cancelled&select=id,name&limit=2'
    )).json() as Array<{ id: string; name: string }>;
    if (projects.length !== 1) {
      return 'ยังจับคู่โครงการของร่างนี้กับหลังบ้านได้ไม่ชัดครับ ผมยังไม่บันทึกยอดซ้ำ กรุณาระบุชื่อโครงการอีกครั้ง';
    }
    const project = projects[0]!;
    const [ledger, slips] = await Promise.all([
      dbFetch('financial_investment_entries?owner_group_hash=eq.' + encodeURIComponent(groupHash)
        + '&owner_project_id=eq.' + project.id
        + '&status=eq.recorded&select=amount,source_message_id&limit=500')
        .then(response => response.json() as Promise<Array<{ amount: number | string; source_message_id: string | null }>>),
      dbFetch('financial_owner_expense_intakes?owner_group_hash=eq.' + encodeURIComponent(groupHash)
        + '&owner_project_id=eq.' + project.id
        + '&status=eq.categorized&select=amount,evidence_message_id&limit=500')
        .then(response => response.json() as Promise<Array<{ amount: number | string | null; evidence_message_id: string | null }>>),
    ]);
    const ledgerSources = new Set(ledger.map(row => row.source_message_id).filter(Boolean));
    const confirmed = [...ledger.map(row => Number(row.amount)),
      ...slips.filter(row => !row.evidence_message_id || !ledgerSources.has(row.evidence_message_id))
        .map(row => Number(row.amount || 0))]
      .reduce((sum, amount) => sum + (Number.isFinite(amount) ? amount : 0), 0);
    const claim = await claimMessage({ groupHash, actorHash, messageId: input.messageId, text });
    if (!claim.claimed) return claim.reply;
    const matches = Math.round(confirmed * 100) === Math.round(reportedTotal * 100);
    const reply = [
      `โครงการ${project.name}: หลังบ้านยืนยันจ่ายแล้ว ${summaryMoney(confirmed)} ครับ`,
      matches
        ? `ตรงกับยอดรวม ${summaryMoney(reportedTotal)} ที่แจ้งมา ไม่เพิ่มรายการ ${summaryMoney(reportedTotal)} ซ้ำ`
        : `ยอดที่แจ้ง ${summaryMoney(reportedTotal)} ต่างจากหลังบ้าน ${summaryMoney(Math.abs(reportedTotal - confirmed))} ครับ ยังไม่เพิ่มยอดซ้ำหรือเดาว่ารายการไหนหาย`,
      active.missing_fields[0] === 'schedule' && active.intent === 'investment_plan'
        ? 'งวดถัดไปตั้งใจจ่ายเมื่อไรครับ? ถ้ายังไม่รู้ ตอบ “ยังไม่รู้” ได้ครับ'
        : nextDraftReply(active),
    ].join('\n');
    await storeReply(input.messageId, active.id, reply);
    return reply;
  }
  if (isReadOnlyQuestion(text)) return null;
  // A new paid transaction must go to the expense ledger. It must never be
  // mistaken for the budget answer of an older project draft.
  if (/^(?:จ่าย(?:เงิน|ค่า)|ชำระ(?:เงิน|ค่า)|โอนจ่าย)/u.test(text)) return null;

  const taskStateCommand = parseOwnerProjectTaskStateCommand(text);
  if (taskStateCommand) {
    const claim = await claimMessage({ groupHash, actorHash, messageId: input.messageId, text });
    if (!claim.claimed) return claim.reply;
    if (taskStateCommand.referenceKind === 'position' || taskStateCommand.referenceKind === 'positions'
      || taskStateCommand.referenceKind === 'title' || taskStateCommand.referenceKind === 'titles') {
      const pendingDraft = await activeDraft(groupHash, actorHash);
      const draftTitles = pendingDraft?.data.bulk_tasks?.map(task => normalizeTaskLookup(task.title)) ?? [];
      const requestedTitles = taskStateCommand.titles ?? [taskStateCommand.reference];
      const targetsDraft = taskStateCommand.referenceKind === 'position' || taskStateCommand.referenceKind === 'positions'
        || requestedTitles.some(title => draftTitles.some(draftTitle => draftTitle.includes(normalizeTaskLookup(title))));
      if (pendingDraft?.status === 'awaiting_confirmation' && draftTitles.length >= 2 && targetsDraft) {
        const reply = 'ชุดงานนี้ยังเป็นร่างครับ พิมพ์ “ยืนยัน” เพื่อบันทึกก่อน แล้วค่อยแจ้งว่างานไหนจบครับ';
        await storeReply(input.messageId, pendingDraft.id, reply);
        return reply;
      }
    }
    const resolved = await resolveOwnerProjectTask(groupHash, taskStateCommand);
    if (resolved.project) {
      const result = await rpc<ProjectStateResult>('owner_project_set_project_state_from_line_v1', {
        p_project_id: resolved.project.id,
        p_group_hash: groupHash,
        p_state: taskStateCommand.state === 'done' ? 'completed' : 'active',
        p_actor_hash: actorHash,
        p_message_id: input.messageId,
      });
      const reply = result.blocked
        ? `โครงการ “${resolved.project.name}” ยังมีงานค้าง ${result.pending_count} งานครับ ยังไม่ปิดโครงการ\n${(result.pending_tasks ?? []).map(row => `• ${row.code} — ${row.title}`).join('\n')}\nแจ้งงานที่เสร็จทีละงานก่อนครับ`
        : taskStateCommand.state === 'done'
          ? `${result.duplicate ? 'โครงการนี้ปิดไว้แล้วครับ' : '✅ ปิดโครงการแล้วครับ'}\nโครงการ: ${resolved.project.name}\nงานและประวัติรายจ่ายยังอยู่ในหลังบ้าน`
          : `${result.duplicate ? 'โครงการนี้เปิดอยู่แล้วครับ' : '↩️ เปิดโครงการกลับมาดำเนินการแล้วครับ'}\nโครงการ: ${resolved.project.name}`;
      await storeReply(input.messageId, null, reply);
      return reply;
    }
    if (!resolved.tasks.length) {
      const reply = resolved.reply ?? 'ยังจับคู่งานกับหลังบ้านไม่ได้ครับ';
      await storeReply(input.messageId, null, reply);
      return reply;
    }
    let results: TaskStateResult[];
    if (resolved.tasks.length > 1) {
      const changed = await rpc<MultiTaskStateResult>('owner_project_set_task_states_from_line_v1', {
        p_task_ids: resolved.tasks.map(task => task.id),
        p_group_hash: groupHash,
        p_state: taskStateCommand.state,
        p_actor_hash: actorHash,
        p_message_id: input.messageId,
      });
      results = changed.tasks ?? [];
      if (results.length !== resolved.tasks.length) throw new Error('Owner Project OS bulk task update returned incomplete results');
    } else {
      results = [await rpc<TaskStateResult>('owner_project_set_task_state_from_line_v1', {
        p_task_id: resolved.tasks[0]!.id,
        p_group_hash: groupHash,
        p_state: taskStateCommand.state,
        p_actor_hash: actorHash,
        p_message_id: input.messageId,
      })];
    }
    const lines = results.map((result, index) => {
      const original = resolved.tasks[index]!;
      const label = result.batch_position ? `งาน ${result.batch_position}` : (result.task_code ?? original.task_code);
      return `${label} — ${result.task_title ?? original.title}${result.duplicate ? ' (สถานะเดิม)' : ''}`;
    });
    const allDuplicate = results.every(result => result.duplicate);
    const reply = taskStateCommand.state === 'done'
      ? `${allDuplicate ? 'งานที่ระบุเสร็จอยู่แล้วครับ' : results.length === 1 ? '✅ ติ๊กว่าเสร็จแล้วครับ' : `✅ ติ๊กว่าเสร็จ ${results.length} งานแล้วครับ`}\n${lines.join('\n')}\nประวัติยังอยู่ในหลังบ้าน และ${results.length === 1 ? 'งานนี้' : 'งานที่ระบุ'}จะไม่ถูกรวมในงานค้าง`
      : `${allDuplicate ? 'งานที่ระบุอยู่ในรายการค้างแล้วครับ' : results.length === 1 ? '↩️ ย้ายกลับเป็นงานค้างแล้วครับ' : `↩️ ย้าย ${results.length} งานกลับเป็นงานค้างแล้วครับ`}\n${lines.join('\n')}`;
    await storeReply(input.messageId, null, reply);
    return reply;
  }

  let draft = await activeDraft(groupHash, actorHash);
  const startIntent = classifyOwnerProjectStart(input.text);
  const recent = draft ? now - new Date(draft.updated_at).getTime() <= CONTINUATION_WINDOW_MS : false;

  let preview: { data: OwnerProjectDraftData; changed: boolean } | null = null;
  if (draft?.status === 'collecting' && (recent || explicitlyAddressed || isResume(text))) {
    preview = applyOwnerProjectText({
      text: input.text,
      intent: draft.intent,
      data: draft.data,
      expectedField: draft.missing_fields[0] ?? null,
      timestamp: now,
    });
  } else if (draft?.status === 'awaiting_confirmation' && correctionSignal(text)) {
    preview = applyOwnerProjectText({ text: input.text, intent: draft.intent, data: draft.data, timestamp: now });
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
    const bulkTasks = draft.data.bulk_tasks?.filter(task => task.title.trim()) ?? [];
    const result = await rpc<ConfirmResult>(bulkTasks.length >= 2
      ? 'owner_project_confirm_bulk_tasks_v1'
      : 'owner_project_confirm_draft_v1', {
      p_draft_id: draft.id,
      p_message_id: input.messageId,
      p_actor_hash: actorHash,
    });
    if (draft.data.origin_paid_expense_message_id && result.project_id) {
      // Confirming fresh work on a previously completed project opens it again.
      // The payment record and its amount remain untouched.
      await rpc('owner_project_set_project_state_from_line_v1', {
        p_project_id:result.project_id,p_group_hash:groupHash,p_state:'active',
        p_actor_hash:actorHash,p_message_id:input.messageId + ':reopen',
      });
    }
    if (bulkTasks.length >= 2) {
      const savedTasks = result.tasks?.length
        ? result.tasks
        : bulkTasks.map(task => ({ id: '', task_code: '—', title: task.title, position: task.position }));
      const reply = [
        result.duplicate ? 'ชุดงานนี้บันทึกไว้แล้วครับ' : `✅ บันทึก ${result.task_count ?? savedTasks.length} งานเข้าหลังบ้านแล้วครับ`,
        `โครงการ: ${result.project_name ?? draft.data.project_name} (${result.project_code ?? '—'})`,
        ...savedTasks.map(task => `งาน ${task.position}: ${task.title}${task.task_code ? ` (${task.task_code})` : ''}`),
        '',
        'ทุกงานยังเป็น “งานค้าง” และจะแยกกันอยู่จนกว่าคุณจะแจ้งว่างานนั้นจบแล้ว',
        'ตัวอย่าง: “งาน 2 จบแล้ว” หรือ “ตัดไม้เสร็จแล้ว”',
        `ดูหลังบ้าน: ${DASHBOARD_URL}`,
      ].join('\n');
      await storeReply(input.messageId, draft.id, reply);
      return reply;
    }
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
    const parsed = applyOwnerProjectText({ text: input.text, intent: startIntent, timestamp: now });
    parsed.data = await fillSoleProjectForBulk(groupHash, parsed.data);
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
