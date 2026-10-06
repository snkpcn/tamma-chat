import { boundLineOpsTeam } from './_ops-notifications';

type SalesPeriod = 'today' | 'yesterday' | 'month';
type RevenueUnitType = 'restaurant' | 'stay' | 'activity' | 'cafe' | 'otop' | string;

export type OwnerBusinessQuestion = {
  investment: boolean;
  salesPeriod: SalesPeriod | null;
  businessUnit: string | null;
  investmentTopics: string[];
  projectNameQuery: string | null;
};

type InvestmentItem = {
  id: string;
  occurred_on: string;
  business_unit_code: string;
  title: string;
  category: string;
  amount: number;
  budget_amount: number;
  payment_method: string;
  vendor_name: string | null;
  status: string;
  created_at: string;
  owner_project_id: string | null;
  source_kind: 'manual' | 'slip' | 'legacy_restaurant';
  counted_in_total: boolean;
  linked_legacy_source_id: string | null;
  reconciliation_note: string | null;
};

type InvestmentAdjustment = {
  legacy_investment_id: string;
  source: string;
  previous_actual_amount: number | string | null;
  new_actual_amount: number | string;
  created_at: string;
};

export type InvestmentSnapshot = {
  items: InvestmentItem[];
  counted: InvestmentItem[];
  evidenceOnly: InvestmentItem[];
  spent: number;
  budget: number;
  remaining: number;
};

type BusinessUnitRow = {
  code: string;
  name: string;
  unit_type: RevenueUnitType;
  sort_order: number;
};

type CafeRevenueRow = {
  local_date: string;
  net_sales: number | string | null;
  status: string;
  updated_at?: string | null;
};

type RestaurantRevenueRow = {
  sale_date: string;
  net_total: number | string | null;
  updated_at?: string | null;
};

type PaymentRevenueRow = {
  team_code: string;
  amount: number | string | null;
  verified_at: string;
};

type RevenueState = 'recorded' | 'no_record' | 'unavailable' | 'not_connected';

export type SalesBusinessSnapshot = {
  code: string;
  name: string;
  unitType: RevenueUnitType;
  amount: number;
  records: number;
  state: RevenueState;
  source: string;
  statuses: string[];
};

export type SalesSnapshot = {
  period: SalesPeriod;
  startDate: string;
  endDate: string;
  label: string;
  businesses: SalesBusinessSnapshot[];
  total: number;
  complete: boolean;
  generatedAt: number;
};

const FALLBACK_BUSINESSES: BusinessUnitRow[] = [
  { code: 'tamma-food', name: 'ตำมา-ชาติ', unit_type: 'restaurant', sort_order: 10 },
  { code: 'tamma-stay', name: 'ทำมา-ชาติ เฮือนสเตย์', unit_type: 'stay', sort_order: 20 },
  { code: 'tamma-adventure', name: 'ทำมา-ชาติ ผจญภัย', unit_type: 'activity', sort_order: 30 },
  { code: 'inthanin', name: 'Inthanin Café', unit_type: 'cafe', sort_order: 40 },
  { code: 'otop', name: 'OTOP / สินค้าชุมชน', unit_type: 'otop', sort_order: 50 },
];

const BUSINESS_LABELS: Record<string, string> = {
  inthanin: 'Inthanin',
  tamma_restaurant: 'ตำมา-ชาติ',
  huenstay: 'เฮือนสเตย์',
  adventure: 'ผจญภัย',
  otop: 'OTOP',
  shared_infrastructure: 'ส่วนกลาง',
  shared: 'ใช้ร่วมหลายกิจการ',
  other: 'อื่น ๆ',
};

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Owner intelligence database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, schema = 'public'): Promise<Response> {
  const config = dbConfig();
  const response = await fetch(config.url + '/rest/v1/' + path, {
    headers: {
      apikey: config.key,
      Authorization: 'Bearer ' + config.key,
      'Content-Type': 'application/json',
      'Accept-Profile': schema,
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Owner intelligence DB request failed ' + response.status + ': ' + body.slice(0, 180));
  }
  return response;
}

async function rows<T>(path: string, schema = 'public'): Promise<T[]> {
  const response = await dbFetch(path, schema);
  return await response.json() as T[];
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('th-TH').replace(/[?!？]+/gu, '').replace(/\s+/g, ' ');
}

function detectBusinessUnit(text: string): string | null {
  if (/(?:อินทนิล|inthanin|ร้านกาแฟ|คาเฟ่)/iu.test(text)) return 'inthanin';
  if (/(?:ตำมา-ชาติ|ตำมาชาติ|ตํามา|ร้านอาหาร)/iu.test(text)) return 'tamma_restaurant';
  if (/(?:เฮือนสเตย์|huenstay|ที่พัก|บ้านพัก)/iu.test(text)) return 'huenstay';
  if (/(?:ผจญภัย|adventure|กิจกรรม|ขี่ม้า|atv|ยิงธนู|เป็ดน้ำ)/iu.test(text)) return 'adventure';
  if (/(?:otop|โอทอป|สินค้าชุมชน|ของฝาก)/iu.test(text)) return 'otop';
  if (/(?:ส่วนกลาง|ลานจอด|โครงสร้างพื้นฐาน)/iu.test(text)) return 'shared_infrastructure';
  return null;
}

function detectInvestmentTopics(text: string): string[] {
  const topics: Array<[string, RegExp]> = [
    ['construction', /(?:ก่อสร้าง|ต่อเติม|รีโนเวท|construction)/iu],
    ['kitchen', /(?:ครัว|kitchen)/iu],
    ['land', /(?:ที่ดิน|ถมที่|ถมดิน|ลานจอด|ถนน|รั้ว)/iu],
    ['equipment', /(?:อุปกรณ์|เครื่องมือ|ครุภัณฑ์|equipment)/iu],
    ['furniture', /(?:เฟอร์นิเจอร์|โต๊ะ|เก้าอี้|ชั้นวาง|เคาน์เตอร์)/iu],
    ['technology', /(?:เทคโนโลยี|คอมพิวเตอร์|ซอฟต์แวร์|ระบบ|pos|technology)/iu],
  ];
  return topics.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

export function classifyOwnerBusinessQuestion(rawText: string): OwnerBusinessQuestion | null {
  const text = normalize(rawText);
  if (!text) return null;

  // Explicit write commands must keep flowing to the investment intake handler.
  if (/^(?:ลงทุน(?:เงินสด)?|เงินสดลงทุน|บันทึกลงทุน)\s+[0-9][0-9,]*(?:\.[0-9]{1,2})?/iu.test(text)) {
    return null;
  }

  const projectNameQuery = extractProjectNameQuery(text);
  const questionSignal = /(?:เท่าไหร่|กี่บาท|เป็นไง|เปนไง|สรุป|อะไรบ้าง|รายการ|ทั้งหมด|ใช้ไป|จ่ายไป|ยอดจ่าย|จ่ายแล้ว|คงเหลือ|เหลือเท่าไหร่|งบ)/u.test(text);
  const explicitInvestment = /(?:ลงทุน|เงินลงทุน|งบลงทุน|investment)/iu.test(text) && questionSignal;
  const topicInvestment = detectInvestmentTopics(text).length > 0
    && /(?:เท่าไหร่|กี่บาท|ใช้จริง|ใช้ไป|จ่ายไป|ยอดจ่าย|จ่ายแล้ว|งบ|คงเหลือ|เหลือ)/u.test(text);
  const investment = explicitInvestment || topicInvestment || projectNameQuery !== null;

  const salesSignal = /(?:ยอดขาย|ขายได้|ขายไป|รายได้)/u.test(text);
  let salesPeriod: SalesPeriod | null = null;
  if (salesSignal) {
    if (/(?:เมื่อวาน|วานนี้)/u.test(text)) salesPeriod = 'yesterday';
    else if (/(?:เดือนนี้|ประจำเดือน|เดือนปัจจุบัน)/u.test(text)) salesPeriod = 'month';
    else salesPeriod = 'today';
  }

  if (!investment && !salesPeriod) return null;
  return {
    investment,
    salesPeriod,
    businessUnit: detectBusinessUnit(text),
    investmentTopics: detectInvestmentTopics(text),
    projectNameQuery,
  };
}

function compactProjectName(value: string): string {
  return value.toLocaleLowerCase('th-TH').replace(/[\s"'“”‘’()[\]{}:：,，.。!?！？]/gu, '');
}

function extractProjectNameQuery(text: string): string | null {
  const marker = /(?:โครงการ|โปรเจกต์|โปรเจค)\s*(?:ชื่อ\s*)?/gu;
  let last: RegExpExecArray | null = null;
  for (let match = marker.exec(text); match; match = marker.exec(text)) last = match;
  if (!last) return null;

  const tail = text.slice(last.index + last[0].length);
  const end = tail.search(/(?:ยอดจ่าย|จ่ายแล้ว|ยอดที่จ่าย|จ่ายไป|ใช้ไป|ใช้จริง|ยอดลงทุน|ลงทุนไป|เงินลงทุน|คงเหลือ|เหลือ|เท่าไหร่|กี่บาท|งบ|ทั้งหมด|สรุป)/u);
  if (end < 0) return null;
  const query = compactProjectName(tail.slice(0, end).replace(/^(?:ของ|คือ|ชื่อ)/u, '').trim());
  if (!query || ['นี้', 'นั้น', 'นี้เอง', 'นั้นเอง'].includes(query) || Array.from(query).length < 2) return null;
  return query;
}

export type OwnerProjectQueryCandidate = {
  id: string;
  name: string;
  status: string;
  budget_amount?: number | string | null;
};

export function matchOwnerProjectQuery(
  query: string,
  projects: OwnerProjectQueryCandidate[],
): { kind: 'matched'; project: OwnerProjectQueryCandidate }
  | { kind: 'ambiguous'; projects: OwnerProjectQueryCandidate[] }
  | { kind: 'not_found' } {
  const compact = compactProjectName(query);
  const active = projects.filter(project => project.status !== 'cancelled');
  const exact = active.filter(project => compactProjectName(project.name) === compact);
  if (exact.length === 1) return { kind: 'matched', project: exact[0] };
  if (exact.length > 1) return { kind: 'ambiguous', projects: exact };
  const partial = active.filter(project => compactProjectName(project.name).includes(compact));
  if (partial.length === 1) return { kind: 'matched', project: partial[0] };
  if (partial.length > 1) return { kind: 'ambiguous', projects: partial };
  return { kind: 'not_found' };
}

export function renderOwnerProjectSpend(
  project: OwnerProjectQueryCandidate,
  snapshot: InvestmentSnapshot,
): string {
  const linked = snapshot.items.filter(item => item.owner_project_id === project.id);
  const counted = linked.filter(item => item.counted_in_total);
  const evidence = linked.filter(item => !item.counted_in_total);
  const spent = counted.reduce((sum, item) => sum + item.amount, 0);
  const budget = number(project.budget_amount);
  const lines = [
    `📈 โครงการ ${project.name}`,
    `ยอดจ่ายแล้ว: ${money(spent)}`,
    budget > 0 ? `งบโครงการ: ${money(budget)} · เหลือตามงบ: ${money(budget - spent)}` : '',
    counted.length ? '' : 'ยังไม่มีรายการจ่ายที่ผูกกับโครงการนี้ครับ',
    ...counted.slice(0, 8).map(item => `• ${item.title} · ${money(item.amount)}${item.status === 'needs_review' ? ' · รอตรวจหมวด/กิจการ' : ''}`),
    evidence.length ? `หลักฐานประกอบ ${evidence.length} รายการ ไม่บวกซ้ำ` : '',
  ];
  return lines.filter(Boolean).join('\n');
}

function number(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value: unknown): string {
  return number(value).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' บาท';
}

function itemTopics(item: Pick<InvestmentItem, 'title' | 'category'>): string[] {
  return detectInvestmentTopics(item.title + ' ' + item.category);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a + 'T12:00:00Z').getTime() - new Date(b + 'T12:00:00Z').getTime()) / 86_400_000;
}

function reconcileLegacyEvidence(
  slips: InvestmentItem[],
  legacy: InvestmentItem[],
  adjustments: InvestmentAdjustment[],
): void {
  const claimed = new Set<string>();
  const legacyById = new Map(legacy.map(item => [item.id, item]));
  const ordered = [...adjustments].sort((a, b) => a.created_at.localeCompare(b.created_at));
  for (const adjustment of ordered) {
    if (adjustment.source !== 'owner_instruction') continue;
    const canonical = legacyById.get(adjustment.legacy_investment_id);
    const delta = number(adjustment.new_actual_amount) - number(adjustment.previous_actual_amount);
    if (!canonical || delta <= 0) continue;
    const canonicalTopics = new Set(itemTopics(canonical));
    const candidates = slips.filter(slip =>
      !claimed.has(slip.id)
      && slip.business_unit_code === canonical.business_unit_code
      && Math.abs(slip.amount - delta) < 0.01
      && daysBetween(slip.occurred_on, canonical.occurred_on) <= 45
      && itemTopics(slip).some(topic => canonicalTopics.has(topic))
    );
    if (candidates.length !== 1) continue;
    const evidence = candidates[0]!;
    claimed.add(evidence.id);
    evidence.counted_in_total = false;
    evidence.linked_legacy_source_id = canonical.id;
    evidence.reconciliation_note = 'ยอดนี้รวมอยู่ใน ' + canonical.title + ' ' + money(adjustment.new_actual_amount) + ' แล้ว';
  }
}

export function buildInvestmentSnapshot(input: {
  manual: Array<Record<string, unknown>>;
  slips: Array<Record<string, unknown>>;
  legacy: Array<Record<string, unknown>>;
  adjustments: InvestmentAdjustment[];
}): InvestmentSnapshot {
  const manual: InvestmentItem[] = input.manual
    .filter(row => String(row.status || '') === 'recorded')
    .map(row => ({
      id: String(row.id || ''),
      occurred_on: String(row.occurred_on || ''),
      business_unit_code: String(row.business_unit_code || 'other'),
      title: String(row.title || 'รายการลงทุน'),
      category: String(row.category || 'other'),
      amount: number(row.amount),
      budget_amount: 0,
      payment_method: String(row.payment_method || 'other'),
      vendor_name: typeof row.vendor_name === 'string' ? row.vendor_name : null,
      status: String(row.status || ''),
      created_at: String(row.created_at || ''),
      owner_project_id: typeof row.owner_project_id === 'string' ? row.owner_project_id : null,
      source_kind: 'manual',
      counted_in_total: true,
      linked_legacy_source_id: null,
      reconciliation_note: null,
    }));
  const slips: InvestmentItem[] = input.slips
    .filter(row => row.amount !== null && row.amount !== undefined && String(row.status || '') !== 'cancelled')
    .map(row => ({
      id: String(row.id || ''),
      occurred_on: String(row.occurred_on || ''),
      business_unit_code: String(row.business_unit_code || 'other'),
      title: String(row.purpose_raw || 'สลิปลงทุนรอระบุ'),
      category: String(row.expense_category || 'other'),
      amount: number(row.amount),
      budget_amount: 0,
      payment_method: 'transfer',
      vendor_name: typeof row.vendor_label === 'string' ? row.vendor_label : null,
      status: String(row.status || ''),
      created_at: String(row.created_at || ''),
      owner_project_id: typeof row.owner_project_id === 'string' ? row.owner_project_id : null,
      source_kind: 'slip',
      counted_in_total: true,
      linked_legacy_source_id: null,
      reconciliation_note: null,
    }));
  const legacy: InvestmentItem[] = input.legacy.map(row => ({
    id: String(row.source_id || ''),
    occurred_on: String(row.occurred_on || ''),
    business_unit_code: String(row.business_unit_code || 'other'),
    title: String(row.title || 'ข้อมูลลงทุนเดิม'),
    category: String(row.category || 'other'),
    amount: number(row.amount),
    budget_amount: number(row.budget_amount),
    payment_method: String(row.payment_method || 'other'),
    vendor_name: typeof row.vendor_name === 'string' ? row.vendor_name : null,
    status: String(row.status || ''),
    created_at: String(row.created_at || ''),
    owner_project_id: typeof row.owner_project_id === 'string' ? row.owner_project_id : null,
    source_kind: 'legacy_restaurant',
    counted_in_total: true,
    linked_legacy_source_id: null,
    reconciliation_note: null,
  }));

  reconcileLegacyEvidence(slips, legacy, input.adjustments);
  const items = [...manual, ...slips, ...legacy]
    .sort((a, b) => (b.occurred_on + b.created_at).localeCompare(a.occurred_on + a.created_at));
  const counted = items.filter(item => item.counted_in_total);
  const evidenceOnly = items.filter(item => !item.counted_in_total);
  const spent = counted.reduce((sum, item) => sum + item.amount, 0);
  const budget = counted.reduce((sum, item) => sum + item.budget_amount, 0);
  return { items, counted, evidenceOnly, spent, budget, remaining: budget - spent };
}

function matchesInvestment(item: InvestmentItem, intent: OwnerBusinessQuestion): boolean {
  if (intent.businessUnit && item.business_unit_code !== intent.businessUnit) return false;
  if (!intent.investmentTopics.length) return true;
  const topics = new Set(itemTopics(item));
  return intent.investmentTopics.every(topic => topics.has(topic));
}

function selectInvestmentSnapshot(snapshot: InvestmentSnapshot, intent: OwnerBusinessQuestion): InvestmentSnapshot {
  if (!intent.businessUnit && !intent.investmentTopics.length) return snapshot;
  const direct = snapshot.items.filter(item => matchesInvestment(item, intent));
  const canonicalIds = new Set(direct.filter(item => item.counted_in_total).map(item => item.id));
  const items = snapshot.items.filter(item =>
    direct.includes(item)
    || (!item.counted_in_total && item.linked_legacy_source_id !== null && canonicalIds.has(item.linked_legacy_source_id))
  );
  const counted = items.filter(item => item.counted_in_total);
  const evidenceOnly = items.filter(item => !item.counted_in_total);
  const spent = counted.reduce((sum, item) => sum + item.amount, 0);
  const budget = counted.reduce((sum, item) => sum + item.budget_amount, 0);
  return { items, counted, evidenceOnly, spent, budget, remaining: budget - spent };
}

export function renderInvestmentSnapshot(snapshot: InvestmentSnapshot, intent: OwnerBusinessQuestion): string {
  const selected = selectInvestmentSnapshot(snapshot, intent);
  if (!selected.counted.length) {
    return '📈 การลงทุน — ยังไม่พบรายการที่ตรงกับคำถามในข้อมูลหลังบ้านครับ';
  }
  const lines = [
    '📈 สรุปการลงทุน · ข้อมูลที่บันทึกในหลังบ้าน',
    'ใช้จริงรวม: ' + money(selected.spent),
    selected.budget > 0 ? 'งบที่บันทึก: ' + money(selected.budget) + ' · คงเหลือตามงบ: ' + money(selected.remaining) : '',
    '',
    ...selected.counted.slice(0, 8).map(item => {
      const budget = item.budget_amount > 0 ? ' / งบ ' + money(item.budget_amount) : '';
      return '• ' + item.title + ' · ' + (BUSINESS_LABELS[item.business_unit_code] || item.business_unit_code) + ' · ใช้จริง ' + money(item.amount) + budget;
    }),
    selected.counted.length > 8 ? '• และอีก ' + (selected.counted.length - 8) + ' รายการในหลังบ้าน' : '',
    selected.evidenceOnly.length
      ? '🔎 หลักฐานประกอบ ' + selected.evidenceOnly.length + ' รายการ รวม ' + money(selected.evidenceOnly.reduce((sum, item) => sum + item.amount, 0)) + ' — ไม่บวกยอดซ้ำ'
      : '',
    ...selected.evidenceOnly.slice(0, 3).map(item => '• ' + item.title + ' ' + money(item.amount) + ' · ' + (item.reconciliation_note || 'รวมในยอดหลักแล้ว')),
    '',
    'ข้อมูลเดิมยังอยู่ครบ และยอดหลักไม่รวมหลักฐานซ้ำครับ',
  ];
  return lines.filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n').trim();
}

async function loadInvestmentSnapshot(includeAllProjectLinkedExpenses = false): Promise<InvestmentSnapshot> {
  const expenseFilter = includeAllProjectLinkedExpenses
    ? 'status=neq.cancelled&'
    : 'expense_class=eq.capital_investment&status=neq.cancelled&';
  const [manual, slips, legacy, adjustments] = await Promise.all([
    rows<Record<string, unknown>>(
      'financial_investment_entries?status=eq.recorded&select=id,occurred_on,business_unit_code,title,category,amount,payment_method,vendor_name,notes,status,created_at,owner_project_id&order=occurred_on.desc&limit=1000'
    ),
    rows<Record<string, unknown>>(
      'financial_owner_expense_intakes?' + expenseFilter
      + 'select=id,occurred_on,business_unit_code,purpose_raw,expense_category,amount,vendor_label,status,created_at,owner_project_id&order=occurred_on.desc&limit=1000'
    ),
    rows<Record<string, unknown>>(
      'financial_investment_legacy_v1?select=source_id,occurred_on,business_unit_code,title,category,amount,budget_amount,payment_method,vendor_name,notes,status,created_at,source_kind&order=occurred_on.desc&limit=1000'
    ),
    rows<InvestmentAdjustment>(
      'financial_investment_legacy_adjustment_audit_events?select=legacy_investment_id,source,previous_actual_amount,new_actual_amount,created_at&order=created_at.asc&limit=1000'
    ),
  ]);
  return buildInvestmentSnapshot({ manual, slips, legacy, adjustments });
}

async function loadOwnerProjects(): Promise<OwnerProjectQueryCandidate[]> {
  return rows<OwnerProjectQueryCandidate>(
    'owner_projects?status=neq.cancelled&select=id,name,status,budget_amount&order=updated_at.desc&limit=500',
  );
}

function bangkokDate(timestamp: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(timestamp));
}

function addDays(date: string, days: number): string {
  const value = new Date(date + 'T12:00:00Z');
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function salesBounds(period: SalesPeriod, timestamp: number): { startDate: string; endDate: string; label: string } {
  const today = bangkokDate(timestamp);
  if (period === 'yesterday') {
    const startDate = addDays(today, -1);
    return { startDate, endDate: today, label: 'เมื่อวาน · ' + thaiDate(startDate) };
  }
  if (period === 'month') {
    const startDate = today.slice(0, 7) + '-01';
    const [year, month] = startDate.split('-').map(Number);
    const endDate = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
    return { startDate, endDate, label: 'เดือนนี้ · ' + thaiMonth(startDate) };
  }
  return { startDate: today, endDate: addDays(today, 1), label: 'วันนี้ · ' + thaiDate(today) };
}

function thaiDate(date: string): string {
  return new Intl.DateTimeFormat('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
    .format(new Date(date + 'T12:00:00+07:00'));
}

function thaiMonth(date: string): string {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' })
    .format(new Date(date + 'T12:00:00+07:00'));
}

function bangkokTime(timestamp: number): string {
  return new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Bangkok' })
    .format(new Date(timestamp));
}

function revenueUnavailable(unit: BusinessUnitRow, source: string): SalesBusinessSnapshot {
  return { code: unit.code, name: unit.name, unitType: unit.unit_type, amount: 0, records: 0, state: 'unavailable', source, statuses: [] };
}

export function buildSalesSnapshot(input: {
  period: SalesPeriod;
  timestamp: number;
  businesses: BusinessUnitRow[];
  cafe: CafeRevenueRow[] | null;
  restaurant: RestaurantRevenueRow[] | null;
  payments: PaymentRevenueRow[] | null;
}): SalesSnapshot {
  const bounds = salesBounds(input.period, input.timestamp);
  const businesses = [...input.businesses].sort((a, b) => a.sort_order - b.sort_order).map(unit => {
    if (unit.unit_type === 'cafe') {
      if (input.cafe === null) return revenueUnavailable(unit, 'POS Daily Close');
      const statuses = [...new Set(input.cafe.map(row => row.status).filter(Boolean))];
      return {
        code: unit.code, name: unit.name, unitType: unit.unit_type,
        amount: input.cafe.reduce((sum, row) => sum + number(row.net_sales), 0),
        records: input.cafe.length,
        state: input.cafe.length ? 'recorded' as const : 'no_record' as const,
        source: 'POS Daily Close', statuses,
      };
    }
    if (unit.unit_type === 'restaurant') {
      if (input.restaurant === null) return revenueUnavailable(unit, 'Sales Ledger');
      return {
        code: unit.code, name: unit.name, unitType: unit.unit_type,
        amount: input.restaurant.reduce((sum, row) => sum + number(row.net_total), 0),
        records: input.restaurant.length,
        state: input.restaurant.length ? 'recorded' as const : 'no_record' as const,
        source: 'Sales Ledger', statuses: [],
      };
    }
    if (['stay', 'activity', 'otop'].includes(unit.unit_type)) {
      if (input.payments === null) return revenueUnavailable(unit, 'Verified Payments');
      const teamCode = unit.unit_type === 'stay' ? 'stay' : unit.unit_type === 'activity' ? 'activity' : 'otop';
      const matches = input.payments.filter(row => row.team_code === teamCode);
      return {
        code: unit.code, name: unit.name, unitType: unit.unit_type,
        amount: matches.reduce((sum, row) => sum + number(row.amount), 0),
        records: matches.length,
        state: matches.length ? 'recorded' as const : 'no_record' as const,
        source: 'Verified Payments', statuses: matches.length ? ['verified'] : [],
      };
    }
    return { code: unit.code, name: unit.name, unitType: unit.unit_type, amount: 0, records: 0, state: 'not_connected' as const, source: 'No revenue source', statuses: [] };
  });
  const total = businesses.filter(row => row.state === 'recorded' || row.state === 'no_record').reduce((sum, row) => sum + row.amount, 0);
  return {
    period: input.period,
    startDate: bounds.startDate,
    endDate: bounds.endDate,
    label: bounds.label,
    businesses,
    total,
    complete: businesses.every(row => row.state !== 'unavailable' && row.state !== 'not_connected'),
    generatedAt: input.timestamp,
  };
}

function salesNoRecordText(row: SalesBusinessSnapshot): string {
  if (row.unitType === 'cafe') return 'ยังไม่มีการปิดยอดประจำวัน';
  if (row.unitType === 'restaurant') return 'ยังไม่มีรายการขาย';
  return 'ยังไม่มียอดชำระที่ตรวจแล้ว';
}

export function renderSalesSnapshot(snapshot: SalesSnapshot, businessUnit: string | null = null): string {
  const typeByInvestmentBusiness: Record<string, RevenueUnitType> = {
    inthanin: 'cafe', tamma_restaurant: 'restaurant', huenstay: 'stay', adventure: 'activity', otop: 'otop',
  };
  const requestedType = businessUnit ? typeByInvestmentBusiness[businessUnit] : null;
  const visible = requestedType ? snapshot.businesses.filter(row => row.unitType === requestedType) : snapshot.businesses;
  if (!visible.length) return '📊 ยอดขาย — ยังไม่พบกิจการที่ถามในระบบครับ';
  const visibleComplete = visible.every(row => row.state !== 'unavailable' && row.state !== 'not_connected');
  const visibleTotal = visible.filter(row => row.state === 'recorded' || row.state === 'no_record').reduce((sum, row) => sum + row.amount, 0);
  const lines = [
    '📊 ยอดขาย · ' + snapshot.label,
    visibleComplete ? 'ยอดที่เข้าระบบแล้ว: ' + money(visibleTotal) : 'ยังรวมยอดทั้งหมดไม่ได้ เพราะบางแหล่งข้อมูลไม่พร้อม',
    '',
    ...visible.map(row => {
      if (row.state === 'unavailable') return '• ' + row.name + ' — ดึงข้อมูลไม่สำเร็จ';
      if (row.state === 'not_connected') return '• ' + row.name + ' — ยังไม่ได้เชื่อมแหล่งยอดขายจริง';
      if (row.state === 'no_record') return '• ' + row.name + ' — ' + salesNoRecordText(row);
      const draft = row.unitType === 'cafe' && row.statuses.some(status => status !== 'confirmed')
        ? ' · ยอดปิดร้านยังเป็นฉบับร่าง/ยังไม่ยืนยัน'
        : '';
      return '• ' + row.name + ' · ' + money(row.amount) + ' (' + row.records + ' รายการ)' + draft;
    }),
    '',
    'นับเฉพาะยอดขายที่บันทึกแล้วหรือยอดชำระที่ตรวจยืนยันแล้ว ไม่ใช่ประมาณการ',
    'ข้อมูล ณ ' + bangkokTime(snapshot.generatedAt) + ' น. ครับ',
  ];
  return lines.filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== '')).join('\n').trim();
}

async function loadSalesSnapshot(period: SalesPeriod, timestamp: number): Promise<SalesSnapshot> {
  const bounds = salesBounds(period, timestamp);
  const startIso = encodeURIComponent(bounds.startDate + 'T00:00:00+07:00');
  const endIso = encodeURIComponent(bounds.endDate + 'T00:00:00+07:00');
  const [businessResult, cafeResult, restaurantResult, paymentResult] = await Promise.allSettled([
    rows<BusinessUnitRow>('ops_business_units_v2?active=eq.true&select=code,name,unit_type,sort_order&order=sort_order.asc'),
    rows<CafeRevenueRow>(
      'financial_daily_close_owner_v2?business_unit_code=eq.inthanin&environment=eq.live'
      + '&local_date=gte.' + bounds.startDate + '&local_date=lt.' + bounds.endDate
      + '&status=neq.void&select=local_date,net_sales,status,updated_at&order=local_date.asc'
    ),
    rows<RestaurantRevenueRow>(
      'sales?sale_date=gte.' + bounds.startDate + '&sale_date=lt.' + bounds.endDate
      + '&voided_at=is.null&select=sale_date,net_total,updated_at&order=sale_date.asc',
      'tamma_chart_os',
    ),
    rows<PaymentRevenueRow>(
      'payment_requests?environment=eq.live&status=eq.verified&team_code=in.(stay,activity,otop)'
      + '&verified_at=gte.' + startIso + '&verified_at=lt.' + endIso
      + '&select=team_code,amount,verified_at&order=verified_at.asc'
    ),
  ]);
  const businesses = businessResult.status === 'fulfilled' && businessResult.value.length
    ? businessResult.value
    : FALLBACK_BUSINESSES;
  return buildSalesSnapshot({
    period,
    timestamp,
    businesses,
    cafe: cafeResult.status === 'fulfilled' ? cafeResult.value : null,
    restaurant: restaurantResult.status === 'fulfilled' ? restaurantResult.value : null,
    payments: paymentResult.status === 'fulfilled' ? paymentResult.value : null,
  });
}

export async function handleOwnerBusinessQuestion(input: {
  targetId: string;
  text: string;
  timestamp?: number;
}): Promise<string | null> {
  const intent = classifyOwnerBusinessQuestion(input.text);
  if (!intent) return null;
  const team = await boundLineOpsTeam(input.targetId);
  if (team !== 'owner_general') return null;
  const timestamp = Number.isFinite(input.timestamp) ? Number(input.timestamp) : Date.now();
  const replies: string[] = [];

  if (intent.investment) {
    try {
      const snapshot = await loadInvestmentSnapshot(Boolean(intent.projectNameQuery));
      if (intent.projectNameQuery) {
        const match = matchOwnerProjectQuery(intent.projectNameQuery, await loadOwnerProjects());
        if (match.kind === 'matched') replies.push(renderOwnerProjectSpend(match.project, snapshot));
        else if (match.kind === 'ambiguous') {
          const names = match.projects.slice(0, 5).map(project => project.name).join(' / ');
          replies.push(`ผมพบหลายโครงการที่ชื่อใกล้ “${intent.projectNameQuery}” ครับ (${names}) ช่วยบอกชื่อโครงการให้ครบอีกนิดครับ`);
        } else {
          replies.push(`ยังไม่พบโครงการชื่อ “${intent.projectNameQuery}” ในหลังบ้านครับ ช่วยบอกชื่อโครงการให้ตรงอีกครั้งครับ`);
        }
      } else {
        replies.push(renderInvestmentSnapshot(snapshot, intent));
      }
    } catch (error) {
      console.error('OWNER_INVESTMENT_READ_ERROR', error instanceof Error ? error.message.slice(0, 180) : 'unknown');
      replies.push(intent.projectNameQuery
        ? '📈 ข้อมูลการจ่ายของโครงการ — ดึงข้อมูลไม่ครบ จึงยังไม่สรุปยอดเพื่อป้องกันตัวเลขผิดครับ'
        : '📈 การลงทุน — ดึงข้อมูลจาก Investment OS ไม่ครบ จึงยังไม่สรุปยอดเพื่อป้องกันตัวเลขผิดครับ');
    }
  }
  if (intent.salesPeriod) {
    try {
      replies.push(renderSalesSnapshot(await loadSalesSnapshot(intent.salesPeriod, timestamp), intent.businessUnit));
    } catch (error) {
      console.error('OWNER_SALES_READ_ERROR', error instanceof Error ? error.message.slice(0, 180) : 'unknown');
      replies.push('📊 ยอดขาย — ดึงข้อมูลยอดขายไม่ครบ จึงยังไม่สรุปยอดเพื่อป้องกันตัวเลขผิดครับ');
    }
  }
  return replies.length ? replies.join('\n\n────────\n\n') : null;
}
