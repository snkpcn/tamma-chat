import { boundLineOpsTeam } from './_ops-notifications';

type SalesPeriod = 'today' | 'yesterday' | 'month';
type RevenueUnitType = 'restaurant' | 'stay' | 'activity' | 'cafe' | 'otop' | string;

export type OwnerBusinessQuestion = {
  investment: boolean;
  salesPeriod: SalesPeriod | null;
  businessUnit: string | null;
  investmentTopics: string[];
  projectNameQuery: string | null;
  groupByProject?: boolean;
};

type InvestmentItem = {
  id: string;
  occurred_on: string;
  business_unit_code: string;
  title: string;
  category: string;
  amount: number;
  budget_amount: number | null;
  payment_method: string;
  vendor_name: string | null;
  status: string;
  created_at: string;
  owner_project_id: string | null;
  source_kind: 'manual' | 'slip' | 'legacy_restaurant';
  counted_in_total: boolean;
  pending_confirmation: boolean;
  amount_known: boolean;
  source_message_id: string | null;
  evidence_keys: string[];
  source_channel: string | null;
  confirmation_basis: string;
  currency: string;
  possible_legacy_source_ids: string[];
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
  pending: InvestmentItem[];
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

async function completeInvestmentRows<T>(path: string): Promise<T[]> {
  const result = await rows<T>(path);
  const limit = Number(new URLSearchParams(path.split('?')[1]).get('limit'));
  if (limit > 0 && result.length >= limit) throw new Error('Investment source reached its read limit; completeness is unknown');
  return result;
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

  // A request to group by projects/common costs is not a named-project filter.
  const grouping = /(?:แยก|แบ่ง)(?:ตาม|เป็น)?\s*(?:(?:โครงการ|โปรเจกต์|โปรเจค)(?:\s*(?:และ|กับ|รวมถึง)\s*ส่วนกลาง)?|ส่วนกลาง\s*(?:และ|กับ)\s*โครงการ)/gu;
  const groupByProject = grouping.test(text) || /(?:ภาพรวม.*ลงทุน|สรุป(?:การ)?ลงทุนทั้งหมด)/u.test(text);
  const filterText = text.replace(grouping, '').replace(/(?:ราย|แต่ละ|ทุก)โครงการ(?:\s*(?:และ|กับ)\s*ส่วนกลาง)?/gu, '');
  const projectNameQuery = extractProjectNameQuery(filterText);
  const questionSignal = /(?:ภาพรวม|เท่าไหร่|กี่บาท|เป็นไง|เปนไง|สรุป|อะไรบ้าง|รายการ|ทั้งหมด|ใช้ไป|จ่ายไป|ยอดจ่าย|จ่ายแล้ว|คงเหลือ|เหลือเท่าไหร่|งบ)/u.test(text);
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
    businessUnit: detectBusinessUnit(filterText),
    investmentTopics: detectInvestmentTopics(filterText),
    projectNameQuery,
    groupByProject,
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
  if (/^(?:และ|ทั้งหมด|ต่าง\s*ๆ|แต่ละ|ทุก|ราย|บอก|ที่บันทึก)/u.test(tail.trim())) return null;
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
  confirmed_at?: string | null;
  business_unit_code?: string | null;
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

function itemAmount(item: InvestmentItem): string {
  return item.amount_known ? money(item.amount) : 'ยังไม่มียอดที่ยืนยัน';
}

function provenance(item: InvestmentItem): string {
  return item.confirmation_basis;
}

function renderPending(items: InvestmentItem[], limit = 8): string[] {
  return items.length ? [
    `⏳ รอยืนยัน/ตรวจข้อมูล ${items.length} รายการ · ไม่รวมยอดจ่าย`,
    ...items.slice(0, limit).map(item => `• ${item.title.slice(0, 180)} · ${itemAmount(item)} · ${provenance(item)}${item.reconciliation_note ? ' · ' + item.reconciliation_note : ''}`),
    items.length > limit ? `และอีก ${items.length - limit} รายการรอตรวจในหลังบ้าน` : '',
  ] : [];
}

export function renderOwnerProjectSpend(
  project: OwnerProjectQueryCandidate,
  snapshot: InvestmentSnapshot,
): string {
  const linked = snapshot.items.filter(item => item.owner_project_id === project.id);
  const counted = linked.filter(item => item.counted_in_total);
  const pending = linked.filter(item => item.pending_confirmation);
  const evidence = linked.filter(item => !item.counted_in_total && !item.pending_confirmation);
  const spent = counted.reduce((sum, item) => sum + item.amount, 0);
  const budget = knownNumber(project.budget_amount);
  return [
    `📈 โครงการ ${project.name}`,
    counted.length ? `ยอดจ่ายที่ยืนยันแล้ว: ${money(spent)}` : 'ยอดจ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล',
    budget !== null ? `งบโครงการที่บันทึก: ${money(budget)}` : 'งบโครงการ: ยังไม่มีข้อมูล',
    ...counted.slice(0, 8).map(item => `• ${item.title} · ${money(item.amount)} · ${provenance(item)}`),
    ...renderPending(pending),
    evidence.length ? `หลักฐานประกอบ ${evidence.length} รายการ ไม่บวกซ้ำ` : '',
  ].filter(Boolean).join('\n');
}

// Unknown is deliberately distinct from an explicitly stored zero.
function knownNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function confirmedSlip(row: Record<string, unknown>): boolean {
  if (row.status !== 'categorized') return false;
  if (row.review_state === 'confirmed') return true;
  // Old categorized rows may have been classified by a rule, not a person.
  return row.review_state == null && ['owner', 'backoffice'].includes(String(row.classification_source));
}

function expenseEvidenceKeys(row: Record<string, unknown>): string[] {
  const group = typeof row.owner_group_hash === 'string' ? row.owner_group_hash.trim() : '';
  if (!group) return [];
  return ['reference_number', 'evidence_sha256'].flatMap(field => {
    const value = typeof row[field] === 'string' ? (row[field] as string).replace(/\s/gu, '').toLowerCase() : '';
    return value ? [group + ':' + field + ':' + value] : [];
  });
}

function reconcileDuplicateSlips(slips: InvestmentItem[]): void {
  const parent = slips.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index]!;
    return index;
  };
  const byKey = new Map<string, number>();
  slips.forEach((item, index) => {
    for (const key of item.evidence_keys) {
      const previous = byKey.get(key);
      if (previous !== undefined) parent[root(index)] = root(previous);
      else byKey.set(key, index);
    }
  });
  const groups = new Map<number, InvestmentItem[]>();
  slips.forEach((item, index) => {
    const key = root(index);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  });
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const ordered = [...group].sort((a, b) => Number(b.counted_in_total) - Number(a.counted_in_total));
    const canonical = ordered[0]!;
    const conflict = group.some(item => !item.amount_known || !canonical.amount_known || item.amount !== canonical.amount
      || !item.occurred_on || item.occurred_on !== canonical.occurred_on
      || !item.currency || item.currency !== canonical.currency
      || item.owner_project_id !== canonical.owner_project_id
      || item.business_unit_code !== canonical.business_unit_code);
    for (const item of conflict ? group : ordered.slice(1)) {
      item.counted_in_total = false;
      item.pending_confirmation = conflict;
      item.reconciliation_note = conflict
        ? 'หลักฐานอ้างอิงเดียวกันแต่ยอด/วันที่/สกุลเงิน/การผูกโครงการไม่ครบหรือต่างกัน ต้องตรวจสอบก่อนรวมยอด'
        : 'หลักฐานอ้างอิงเดียวกับ ' + canonical.title + ' · ไม่บวกซ้ำ';
    }
  }
}

function flagUnresolvedLegacyOverlap(entries: InvestmentItem[], legacy: InvestmentItem[]): void {
  for (const item of entries) {
    if (!item.counted_in_total) continue;
    // This legacy view has no coverage dates or transaction-level links. Different
    // titles/categories cannot prove a newer payment is outside its aggregate.
    const possible = legacy.filter(canonical => canonical.counted_in_total
      && canonical.business_unit_code === item.business_unit_code);
    if (!possible.length) continue;
    item.counted_in_total = false;
    item.pending_confirmation = true;
    item.possible_legacy_source_ids = possible.map(canonical => canonical.id);
    item.reconciliation_note = 'อาจรวมอยู่ในยอดบัญชีลงทุนเดิมแล้ว ต้องกระทบยอดก่อนรวมเพิ่ม';
  }
}

function uniqueRows(rows: Array<Record<string, unknown>>, key: string): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return rows.filter(row => {
    const id = String(row[key] || '');
    if (!id) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
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

export function buildInvestmentSnapshot(input: {
  manual: Array<Record<string, unknown>>;
  slips: Array<Record<string, unknown>>;
  legacy: Array<Record<string, unknown>>;
  adjustments: InvestmentAdjustment[];
}): InvestmentSnapshot {
  const manual: InvestmentItem[] = uniqueRows(input.manual, 'id')
    .filter(row => String(row.status || '') === 'recorded')
    .map(row => ({
      id: String(row.id || ''),
      occurred_on: String(row.occurred_on || ''),
      business_unit_code: String(row.business_unit_code || 'other'),
      title: String(row.title || 'รายการลงทุน'),
      category: String(row.category || 'other'),
      amount: number(row.amount),
      budget_amount: null,
      payment_method: String(row.payment_method || 'other'),
      vendor_name: typeof row.vendor_name === 'string' ? row.vendor_name : null,
      status: String(row.status || ''),
      created_at: String(row.created_at || ''),
      owner_project_id: typeof row.owner_project_id === 'string' ? row.owner_project_id : null,
      source_kind: 'manual',
      counted_in_total: knownNumber(row.amount) !== null,
      pending_confirmation: knownNumber(row.amount) === null,
      amount_known: knownNumber(row.amount) !== null,
      source_message_id: typeof row.source_message_id === 'string' ? row.source_message_id : null,
      evidence_keys: [],
      source_channel: typeof row.source_channel === 'string' ? row.source_channel : null,
      currency: 'THB',
      confirmation_basis: 'บัญชีลงทุน · สถานะ recorded',
      possible_legacy_source_ids: [],
      reconciliation_note: null,
    }));
  const slips: InvestmentItem[] = uniqueRows(input.slips, 'id')
    .filter(row => row.status !== 'cancelled' && row.review_state !== 'cancelled')
    .map(row => ({
      id: String(row.id || ''),
      occurred_on: String(row.occurred_on || ''),
      business_unit_code: String(row.business_unit_code || 'other'),
      title: String(row.purpose_raw || 'สลิปลงทุนรอระบุ'),
      category: String(row.expense_category || 'other'),
      amount: number(row.amount),
      budget_amount: null,
      payment_method: 'transfer',
      vendor_name: typeof row.vendor_label === 'string' ? row.vendor_label : null,
      status: String(row.status || ''),
      created_at: String(row.created_at || ''),
      owner_project_id: typeof row.owner_project_id === 'string' ? row.owner_project_id : null,
      source_kind: 'slip',
      counted_in_total: confirmedSlip(row) && knownNumber(row.amount) !== null,
      pending_confirmation: !confirmedSlip(row) || knownNumber(row.amount) === null,
      amount_known: knownNumber(row.amount) !== null,
      source_message_id: typeof row.evidence_message_id === 'string' ? row.evidence_message_id : null,
      evidence_keys: expenseEvidenceKeys(row),
      source_channel: typeof row.source_channel === 'string' ? row.source_channel : null,
      currency: typeof row.currency === 'string' ? row.currency : '',
      confirmation_basis: row.review_state === 'confirmed' ? 'หลักฐานรายจ่าย · ยืนยันสรุปแล้ว'
        : row.review_state == null && ['owner', 'backoffice'].includes(String(row.classification_source))
          ? 'หลักฐานรายจ่ายเดิม · จัดหมวดโดย ' + String(row.classification_source) : 'หลักฐานรายจ่าย · ยังไม่พบการยืนยัน',
      possible_legacy_source_ids: [],
      reconciliation_note: null,
    }));
  const legacy: InvestmentItem[] = uniqueRows(input.legacy, 'source_id').filter(row => !['cancelled', 'ยกเลิก'].includes(String(row.status))).map(row => ({
    id: String(row.source_id || ''),
    occurred_on: String(row.occurred_on || ''),
    business_unit_code: String(row.business_unit_code || 'other'),
    title: String(row.title || 'ข้อมูลลงทุนเดิม'),
    category: String(row.category || 'other'),
    amount: number(row.amount),
    budget_amount: knownNumber(row.budget_amount),
    payment_method: String(row.payment_method || 'other'),
    vendor_name: typeof row.vendor_name === 'string' ? row.vendor_name : null,
    status: String(row.status || ''),
    created_at: String(row.created_at || ''),
    owner_project_id: typeof row.owner_project_id === 'string' ? row.owner_project_id : null,
    source_kind: 'legacy_restaurant',
    counted_in_total: row.status === 'ชำระแล้ว' && knownNumber(row.amount) !== null,
    pending_confirmation: row.status !== 'ชำระแล้ว' || knownNumber(row.amount) === null,
    amount_known: knownNumber(row.amount) !== null,
    source_message_id: null,
    evidence_keys: [],
    source_channel: null,
    currency: 'THB',
    confirmation_basis: 'บัญชีลงทุนเดิม · สถานะ ' + String(row.status || 'ยังไม่มี'),
    possible_legacy_source_ids: [],
    reconciliation_note: null,
  }));

  reconcileDuplicateSlips(slips);
  // Explicit source identity takes precedence over amount/topic matching.
  const ledgerByMessage = new Map(manual.filter(item => item.counted_in_total && item.source_message_id && item.source_channel)
    .map(item => [item.source_channel + ':' + item.source_message_id, item]));
  for (const slip of slips) {
    const canonical = slip.source_message_id && slip.source_channel ? ledgerByMessage.get(slip.source_channel + ':' + slip.source_message_id) : undefined;
    if (!canonical) continue;
    if (!slip.amount_known || slip.amount !== canonical.amount
      || slip.owner_project_id !== canonical.owner_project_id
      || slip.business_unit_code !== canonical.business_unit_code) {
      for (const conflict of [slip, canonical]) {
        conflict.counted_in_total = false;
        conflict.pending_confirmation = true;
        conflict.reconciliation_note = 'ข้อความต้นทางเดียวกันแต่ยอด/การผูกโครงการต่างกัน ต้องตรวจสอบก่อนรวมยอด';
      }
      continue;
    }
    if (slip.reconciliation_note?.includes('ต้องตรวจสอบ')) {
      canonical.counted_in_total = false;
      canonical.pending_confirmation = true;
      canonical.reconciliation_note = slip.reconciliation_note;
      continue;
    }
    slip.counted_in_total = false;
    slip.pending_confirmation = false;
    slip.reconciliation_note = `อ้างอิงข้อความเดียวกับ ${canonical.title} ในบัญชีลงทุน · ไม่บวกซ้ำ`;
  }
  // Legacy adjustment audits do not identify a slip. Amount/topic/date similarity
  // cannot prove that evidence is already included in an aggregate.
  flagUnresolvedLegacyOverlap([...manual, ...slips], legacy);
  const items = [...manual, ...slips, ...legacy]
    .sort((a, b) => (b.occurred_on + b.created_at).localeCompare(a.occurred_on + a.created_at));
  const counted = items.filter(item => item.counted_in_total);
  const evidenceOnly = items.filter(item => !item.counted_in_total && !item.pending_confirmation);
  const pending = items.filter(item => item.pending_confirmation);
  const spent = counted.reduce((sum, item) => sum + item.amount, 0);
  const budget = counted.reduce((sum, item) => sum + (item.budget_amount ?? 0), 0);
  return { items, counted, evidenceOnly, pending, spent, budget, remaining: budget - spent };
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
    || (item.pending_confirmation && item.possible_legacy_source_ids.some(id => canonicalIds.has(id)))
  );
  const counted = items.filter(item => item.counted_in_total);
  const evidenceOnly = items.filter(item => !item.counted_in_total && !item.pending_confirmation);
  const pending = items.filter(item => item.pending_confirmation);
  const spent = counted.reduce((sum, item) => sum + item.amount, 0);
  const budget = counted.reduce((sum, item) => sum + (item.budget_amount ?? 0), 0);
  return { items, counted, evidenceOnly, pending, spent, budget, remaining: budget - spent };
}

export function renderInvestmentSnapshot(snapshot: InvestmentSnapshot, intent: OwnerBusinessQuestion): string {
  const selected = selectInvestmentSnapshot(snapshot, intent);
  const completeBudget = selected.counted.length > 0 && selected.counted.every(item => item.budget_amount !== null);
  return [
    '📈 สรุปการลงทุน · ตามข้อมูลที่บันทึก',
    selected.counted.length ? 'ยอดจ่ายที่ยืนยันแล้ว: ' + money(selected.spent) : 'ยอดจ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล',
    completeBudget ? 'งบที่บันทึก: ' + money(selected.budget) + ' · เหลือตามงบ: ' + money(selected.remaining)
      : 'งบรวม: ยังไม่มีข้อมูลครบ',
    ...selected.counted.slice(0, 8).map(item => '• ' + item.title + ' · '
      + (BUSINESS_LABELS[item.business_unit_code] || item.business_unit_code) + ' · ' + money(item.amount) + ' · ' + provenance(item)),
    selected.counted.length > 8 ? 'และอีก ' + (selected.counted.length - 8) + ' รายการในหลังบ้าน' : '',
    ...renderPending(selected.pending),
    ...renderEvidence(selected.evidenceOnly),
    'ยอดนี้เฉพาะรายการที่ยืนยันแล้วและข้อมูลเดิมที่ระบุชำระแล้ว ไม่ใช่ยอดลงทุนทั้งหมดหากข้อมูลยังไม่ครบ',
  ].filter(Boolean).join('\n');
}

function renderEvidence(items: InvestmentItem[]): string[] {
  return items.length ? [
    `🔎 หลักฐานประกอบ ${items.length} รายการ — ไม่บวกยอดซ้ำ`,
    ...items.slice(0, 3).map(item => `• ${item.title.slice(0, 180)} · ${itemAmount(item)} · ${item.reconciliation_note || 'รวมในยอดหลักแล้ว'}`),
  ] : [];
}

export type OwnerInvestmentInstallment = {
  id: string;
  project_id: string;
  title: string;
  amount: number | string | null;
  paid_amount: number | string | null;
  due_on: string | null;
  status: string;
};

function installmentBalance(item: OwnerInvestmentInstallment): number | null {
  const amount = knownNumber(item.amount);
  const paid = knownNumber(item.paid_amount);
  return amount !== null && paid !== null && paid <= amount ? amount - paid : null;
}

export function renderInvestmentOverview(
  snapshot: InvestmentSnapshot,
  intent: OwnerBusinessQuestion,
  projects: OwnerProjectQueryCandidate[],
  installments: OwnerInvestmentInstallment[],
): string {
  const selected = selectInvestmentSnapshot(snapshot, intent);
  const projectById = new Map(projects.map(project => [project.id, project]));
  const groups = new Map<string, { title: string; project?: OwnerProjectQueryCandidate; items: InvestmentItem[] }>();
  for (const item of selected.items) {
    const project = item.owner_project_id ? projectById.get(item.owner_project_id) : undefined;
    const key = item.owner_project_id ? 'project:' + item.owner_project_id : 'business:' + item.business_unit_code;
    const title = project ? 'โครงการ ' + project.name : item.owner_project_id ? 'โครงการที่ยังไม่มีรายละเอียด'
      : (BUSINESS_LABELS[item.business_unit_code] || item.business_unit_code) + ' · ยังไม่ผูกโครงการ';
    if (!groups.has(key)) groups.set(key, { title, project, items: [] });
    groups.get(key)!.items.push(item);
  }
  // Include confirmed plans even before a payment exists. Never infer spending = zero.
  for (const project of projects) {
    if (intent.businessUnit && project.business_unit_code !== intent.businessUnit) continue;
    if (intent.investmentTopics.length || !project.confirmed_at) continue;
    const key = 'project:' + project.id;
    if (!groups.has(key)) groups.set(key, { title: 'โครงการ ' + project.name, project, items: [] });
  }
  const lines = [
    '📈 ภาพรวมการลงทุน · แยกตามโครงการและกิจการ',
    selected.counted.length ? `ยอดจ่ายที่ยืนยันแล้ว: ${money(selected.spent)}` : 'ยอดจ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล',
    'ยอดนี้เฉพาะข้อมูลที่ยืนยัน/ระบุชำระแล้ว ไม่รวมรายการรอตรวจ',
    'งบรวมทุกโครงการ: ยังไม่มีข้อมูลครบและไม่รวมงบต่างแหล่งซ้ำ',
    selected.pending.length ? `ยังยืนยันยอดลงทุนทั้งหมดไม่ได้ มีรายการรอตรวจ/กระทบยอดรวม ${selected.pending.length} รายการ` : '',
  ];
  let shownGroups = 0;
  let detailCharacters = 0;
  for (const group of groups.values()) {
    const counted = group.items.filter(item => item.counted_in_total);
    const pending = group.items.filter(item => item.pending_confirmation);
    const spent = counted.reduce((sum, item) => sum + item.amount, 0);
    const projectBudget = group.project?.confirmed_at ? knownNumber(group.project.budget_amount) : null;
    const legacyBudgets = group.items.filter(item => item.source_kind === 'legacy_restaurant' && item.budget_amount !== null);
    const budgetLabel = projectBudget !== null ? `งบโครงการที่ยืนยัน: ${money(projectBudget)}`
      : !group.project && legacyBudgets.length ? `งบที่บันทึกเฉพาะรายการเดิม: ${money(legacyBudgets.reduce((sum, item) => sum + item.budget_amount!, 0))} · ยังไม่ใช่งบรวม`
        : 'งบที่ยืนยัน: ยังไม่มีข้อมูล';
    const plan = group.project?.confirmed_at ? installments.filter(item => item.project_id === group.project!.id && item.status !== 'cancelled') : [];
    const unpaid = plan.filter(item => item.status !== 'paid');
    const balances = unpaid.map(installmentBalance);
    const planConsistent = plan.every(item => {
      const balance = installmentBalance(item);
      return balance !== null && ['planned', 'due', 'paid'].includes(item.status)
        && (item.status !== 'paid' || balance === 0);
    });
    const balanceKnown = plan.length > 0 && planConsistent;
    const dated = unpaid.filter(item => item.due_on).sort((a, b) => a.due_on!.localeCompare(b.due_on!));
    const next = dated[0];
    const detail = [group.title,
      budgetLabel,
      counted.length ? `จ่ายที่ยืนยันแล้ว: ${money(spent)}` : 'จ่ายที่ยืนยันแล้ว: ยังไม่มีข้อมูล',
      balanceKnown ? `ยอดคงค้างตามงวดที่บันทึก: ${money(balances.reduce<number>((sum, amount) => sum + amount!, 0))}`
        : 'ยอดคงค้างตามงวด: ยังไม่มีข้อมูลครบ',
      plan.length && !planConsistent ? 'ข้อมูลยอด/สถานะงวดยังไม่ครบหรือต่างกัน ต้องกระทบยอดก่อนสรุปค้างจ่าย' : '',
      next ? `งวดที่ยังไม่ปิดและครบกำหนดก่อน: ${next.title} · ${next.due_on}` : 'กำหนดงวดถัดไป: ยังไม่มีข้อมูล',
      unpaid.some(item => !item.due_on) ? 'มีงวดที่ยังไม่ระบุวันครบกำหนด จึงยืนยันลำดับงวดถัดไปไม่ได้' : '',
      ...counted.slice(0, 5).map(item => `• ${item.title.slice(0, 180)} · ${money(item.amount)} · ${provenance(item)}`),
      counted.length > 5 ? `และอีก ${counted.length - 5} รายการในกลุ่มนี้` : '',
      ...renderPending(pending, 3)].filter(Boolean).join('\n');
    if (shownGroups < 12 && detailCharacters + detail.length <= 12000) {
      lines.push(detail);
      detailCharacters += detail.length;
      shownGroups += 1;
    }
  }
  if (shownGroups < groups.size) lines.push(`ยังไม่ได้แสดงรายละเอียดอีก ${groups.size - shownGroups} กลุ่ม ถามชื่อโครงการหรือกิจการเพื่อดูรายละเอียดได้ ยอดด้านบนรวมทุกกลุ่มที่ผ่านการตรวจแล้ว`);
  if (!groups.size) lines.push('ยังไม่มีข้อมูลโครงการหรือรายการลงทุนที่ตรงกับคำถาม');
  lines.push(...renderEvidence(selected.evidenceOnly),
    'งบคงเหลือไม่ใช่ยอดค้างจ่าย และยอดตามงวดอาจไม่ครอบคลุมหนี้ทั้งหมด',
    'รายการที่ยังไม่ผูกโครงการแสดงตามกิจการเดิม ไม่เดาว่าเป็นส่วนกลาง');
  return lines.filter(Boolean).join('\n');
}

async function loadInvestmentSnapshot(includeAllProjectLinkedExpenses = false): Promise<InvestmentSnapshot> {
  const expenseFilter = includeAllProjectLinkedExpenses
    ? 'status=neq.cancelled&'
    : 'or=(expense_class.eq.capital_investment,review_state.eq.draft)&status=neq.cancelled&';
  const [manual, slips, legacy] = await Promise.all([
    completeInvestmentRows<Record<string, unknown>>(
      'financial_investment_entries?status=eq.recorded&select=id,occurred_on,business_unit_code,title,category,amount,payment_method,vendor_name,notes,status,created_at,owner_project_id,source_channel,source_message_id&order=occurred_on.desc&limit=1000'
    ),
    completeInvestmentRows<Record<string, unknown>>(
      'financial_owner_expense_intakes?' + expenseFilter
      + 'select=id,occurred_on,business_unit_code,purpose_raw,expense_category,amount,vendor_label,status,review_state,classification_source,created_at,owner_project_id,source_channel,evidence_message_id,owner_group_hash,reference_number,evidence_sha256,currency&order=occurred_on.desc&limit=1000'
    ),
    completeInvestmentRows<Record<string, unknown>>(
      'financial_investment_legacy_v1?select=source_id,occurred_on,business_unit_code,title,category,amount,budget_amount,payment_method,vendor_name,notes,status,created_at,source_kind&order=occurred_on.desc&limit=1000'
    ),
  ]);
  return buildInvestmentSnapshot({ manual, slips, legacy, adjustments: [] });
}

async function loadOwnerProjects(): Promise<OwnerProjectQueryCandidate[]> {
  return completeInvestmentRows<OwnerProjectQueryCandidate>(
    'owner_projects?status=neq.cancelled&select=id,name,status,budget_amount,confirmed_at,business_unit_code&order=updated_at.desc&limit=500',
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
      } else if (intent.groupByProject) {
        const [projects, installments] = await Promise.all([
          loadOwnerProjects(),
          completeInvestmentRows<OwnerInvestmentInstallment>('owner_project_installments?status=neq.cancelled&select=id,project_id,title,amount,paid_amount,due_on,status&order=due_on.asc.nullslast&limit=1000'),
        ]);
        replies.push(renderInvestmentOverview(snapshot, intent, projects, installments));
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
