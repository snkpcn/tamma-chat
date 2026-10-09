import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';
import { ownerProjectQuestion, startOwnerProjectPlanAfterPaidExpense } from './_owner-project-os';
import { parseOwnerReportedPaidTotal } from './_owner-paid-total';
import {
  extractFinancialEvidence,
  extensionForMime,
  fetchLineImage,
  type FinancialImageExtraction,
} from './_inthanin-daily-close-image';

type BusinessUnit =
  | 'inthanin'
  | 'tamma_restaurant'
  | 'huenstay'
  | 'adventure'
  | 'otop'
  | 'shared_infrastructure'
  | 'shared'
  | 'other';

type ExpenseClass = 'capital_investment' | 'operating_expense' | 'owner_private' | 'uncategorized';

type ExpenseCategory =
  | 'construction'
  | 'land_infrastructure'
  | 'kitchen_equipment'
  | 'equipment'
  | 'furniture_fixtures'
  | 'activity_assets'
  | 'technology'
  | 'licenses'
  | 'inventory'
  | 'ingredients'
  | 'beverages'
  | 'packaging'
  | 'consumables'
  | 'cleaning'
  | 'maintenance'
  | 'utilities'
  | 'transport'
  | 'staff'
  | 'marketing'
  | 'fees'
  | 'professional_services'
  | 'tax'
  | 'financing'
  | 'petty_cash'
  | 'other';

export type OwnerExpenseClassification = {
  businessUnit: BusinessUnit | null;
  expenseClass: ExpenseClass;
  expenseCategory: ExpenseCategory;
  expenseSubcategory: string | null;
  confidence: number;
};

type OwnerExpenseIntake = {
  id: string;
  source_user_hash: string | null;
  status: 'awaiting_purpose' | 'awaiting_business' | 'categorized' | 'needs_review' | 'cancelled';
  amount: number | string | null;
  occurred_on: string;
  document_type: string;
  purpose_raw: string | null;
  business_unit_code: BusinessUnit | null;
  expense_class: ExpenseClass | null;
  expense_category: ExpenseCategory | null;
  expense_subcategory: string | null;
  owner_project_id?: string | null;
  owner_project_task_id?: string | null;
  owner_project_installment_id?: string | null;
  created_at: string;
};

export type OwnerExpenseProject = {
  id: string;
  name: string;
  business_unit_code: BusinessUnit | null;
  purpose?: string | null;
  status: string;
};

export type OwnerProjectMention =
  | { kind: 'not_mentioned' }
  | { kind: 'not_found' }
  | { kind: 'ambiguous' }
  | { kind: 'matched'; project: OwnerExpenseProject };

type CaptureResult = {
  ok?: boolean;
  duplicate?: boolean;
  intake_id?: string;
  status?: OwnerExpenseIntake['status'];
  amount?: number | string | null;
  document_type?: string;
  occurred_on?: string;
  pending_count?: number;
};

type ResolveResult = CaptureResult & {
  business_unit_code?: BusinessUnit;
  expense_class?: ExpenseClass;
  expense_category?: ExpenseCategory;
  expense_subcategory?: string | null;
  confidence?: number;
  purpose?: string;
};

const BUCKET = 'owner-expense-evidence';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const PENDING_STATUSES = 'in.(awaiting_purpose,awaiting_business)';

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Owner expense database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = dbConfig();
  const response = await fetch(c.url + '/rest/v1/' + path, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: 'Bearer ' + c.key,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('Owner expense DB request failed ' + response.status + ': ' + body.slice(0, 240));
  }
  return response;
}

async function rpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const response = await dbFetch('rpc/' + name, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  const raw = await response.json() as T | T[];
  return (Array.isArray(raw) ? raw[0] : raw) as T;
}

function bangkokDate(timestamp?: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Number.isFinite(timestamp) ? timestamp : Date.now()));
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function compactProjectText(value: string): string {
  return normalizeText(value).toLowerCase().replace(/[\s"'“”‘’()[\]{}:：,，.。!?！？\-‐‑–—]/gu, '');
}

export function matchNamedProjectForOwnerPaidExpense(
  rawText: string,
  projects: OwnerExpenseProject[],
): OwnerProjectMention {
  const text = compactProjectText(rawText);
  const matches = projects
    .filter(project => project.status !== 'cancelled' && compactProjectText(project.name).length >= 4)
    .filter(project => text.includes(compactProjectText(project.name)))
    .sort((left, right) => compactProjectText(right.name).length - compactProjectText(left.name).length);
  if (!matches.length) return /(?:โครงการ|โปรเจกต์|project)/iu.test(rawText)
    ? { kind: 'not_found' }
    : { kind: 'not_mentioned' };
  const longest = compactProjectText(matches[0]!.name).length;
  const best = matches.filter(project => compactProjectText(project.name).length === longest);
  return best.length === 1 ? { kind: 'matched', project: best[0]! } : { kind: 'ambiguous' };
}

export function matchOwnerProjectMention(
  rawText: string,
  projects: OwnerExpenseProject[],
): OwnerProjectMention {
  const text = compactProjectText(rawText);
  const markers = ['โครงการ', 'โปรเจกต์', 'project'];
  let markerIndex = -1;
  let marker = '';
  for (const candidate of markers) {
    const index = text.lastIndexOf(candidate);
    if (index > markerIndex) {
      markerIndex = index;
      marker = candidate;
    }
  }
  if (markerIndex < 0) return { kind: 'not_mentioned' };

  const tail = text.slice(markerIndex + marker.length).replace(/^(?:ชื่อ|คือ)/u, '');
  const matches = projects
    .filter(project => project.status !== 'cancelled' && compactProjectText(project.name).length > 0)
    .filter(project => tail.startsWith(compactProjectText(project.name)))
    .sort((left, right) => compactProjectText(right.name).length - compactProjectText(left.name).length);
  if (!matches.length) return { kind: 'not_found' };
  const longest = compactProjectText(matches[0].name).length;
  const bestMatches = matches.filter(project => compactProjectText(project.name).length === longest);
  return bestMatches.length === 1
    ? { kind: 'matched', project: bestMatches[0] }
    : { kind: 'ambiguous' };
}

async function ownerProjectMention(rawText: string, groupHash: string): Promise<OwnerProjectMention> {
  const response = await dbFetch(
    'owner_projects?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&status=neq.cancelled&select=id,name,business_unit_code,purpose,status&order=created_at.desc&limit=500',
  );
  const projects = await response.json() as OwnerExpenseProject[];
  const explicit = matchOwnerProjectMention(rawText, projects);
  return explicit.kind === 'not_mentioned'
    ? matchNamedProjectForOwnerPaidExpense(rawText, projects)
    : explicit;
}

function money(value: unknown): string {
  const numeric = Number(value);
  return (Number.isFinite(numeric) ? numeric : 0).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) + ' บาท';
}

function encodedObjectPath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function uploadEvidence(bytes: Buffer, mimeType: string, path: string): Promise<void> {
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new Error('owner_expense_evidence_image_size_invalid');
  const c = dbConfig();
  const response = await fetch(c.url + '/storage/v1/object/' + BUCKET + '/' + encodedObjectPath(path), {
    method: 'POST',
    headers: {
      apikey: c.key,
      Authorization: 'Bearer ' + c.key,
      'Content-Type': mimeType,
      'x-upsert': 'false',
    },
    body: bytes as unknown as BodyInit,
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('owner_expense_evidence_upload_' + response.status + ':' + body.slice(0, 160));
  }
}

async function deleteOrphanEvidence(path: string): Promise<void> {
  const c = dbConfig();
  await fetch(c.url + '/storage/v1/object/' + BUCKET + '/' + encodedObjectPath(path), {
    method: 'DELETE',
    headers: { apikey: c.key, Authorization: 'Bearer ' + c.key },
  }).catch(() => undefined);
}

async function existingIntakeByMessage(groupHash: string, messageId: string): Promise<OwnerExpenseIntake | null> {
  const response = await dbFetch(
    'financial_owner_expense_intakes?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&source_channel=eq.line&evidence_message_id=eq.' + encodeURIComponent(messageId)
    + '&select=id,source_user_hash,status,amount,occurred_on,document_type,purpose_raw,business_unit_code,expense_class,expense_category,expense_subcategory,created_at&limit=1',
  );
  return (await response.json() as OwnerExpenseIntake[])[0] ?? null;
}

async function existingIntakeByImage(groupHash: string, sha256: string): Promise<OwnerExpenseIntake | null> {
  const response = await dbFetch(
    'financial_owner_expense_intakes?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&evidence_sha256=eq.' + encodeURIComponent(sha256)
    + '&select=id,source_user_hash,status,amount,occurred_on,document_type,purpose_raw,business_unit_code,expense_class,expense_category,expense_subcategory,created_at&limit=1',
  );
  return (await response.json() as OwnerExpenseIntake[])[0] ?? null;
}

async function pendingIntakes(groupHash: string, includeNeedsReview = false): Promise<OwnerExpenseIntake[]> {
  const statuses = includeNeedsReview
    ? 'in.(awaiting_purpose,awaiting_business,needs_review)'
    : PENDING_STATUSES;
  const response = await dbFetch(
    'financial_owner_expense_intakes?owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&status=' + statuses
    + '&select=id,source_user_hash,status,amount,occurred_on,document_type,purpose_raw,business_unit_code,expense_class,expense_category,expense_subcategory,owner_project_id,owner_project_task_id,owner_project_installment_id,created_at'
    + '&order=created_at.asc&limit=12',
  );
  return await response.json() as OwnerExpenseIntake[];
}

function documentLabel(documentType: string | null | undefined): string {
  const labels: Record<string, string> = {
    transfer_slip: 'สลิปโอนเงิน',
    purchase_receipt: 'ใบเสร็จซื้อของ',
    expense_receipt: 'ใบเสร็จค่าใช้จ่าย',
    other: 'รูปหลักฐาน',
  };
  return labels[documentType || 'other'] || 'รูปหลักฐาน';
}

function intakeCode(id: string): string {
  return id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

function businessLabel(value: BusinessUnit | null | undefined): string {
  const labels: Record<BusinessUnit, string> = {
    inthanin: 'Inthanin',
    tamma_restaurant: 'ตำมา-ชาติ',
    huenstay: 'เฮือนสเตย์',
    adventure: 'ผจญภัย',
    otop: 'OTOP',
    shared_infrastructure: 'ส่วนกลาง/โครงสร้างพื้นฐาน',
    shared: 'ใช้ร่วมหลายกิจการ',
    other: 'อื่น ๆ',
  };
  return value ? labels[value] : 'ยังไม่ระบุ';
}

function classLabel(value: ExpenseClass | null | undefined): string {
  const labels: Record<ExpenseClass, string> = {
    capital_investment: 'ลงทุน',
    operating_expense: 'ค่าใช้จ่ายดำเนินงาน',
    owner_private: 'ส่วนตัว Owner',
    uncategorized: 'รอตรวจ',
  };
  return value ? labels[value] : 'รอตรวจ';
}

function categoryLabel(value: ExpenseCategory | null | undefined): string {
  const labels: Record<ExpenseCategory, string> = {
    construction: 'ก่อสร้าง/ต่อเติม',
    land_infrastructure: 'ที่ดิน/ส่วนกลาง',
    kitchen_equipment: 'อุปกรณ์ครัว',
    equipment: 'อุปกรณ์/เครื่องมือ',
    furniture_fixtures: 'เฟอร์นิเจอร์/งานติดตั้ง',
    activity_assets: 'ทรัพย์สินกิจกรรม',
    technology: 'เทคโนโลยี',
    licenses: 'ใบอนุญาต/ลิขสิทธิ์',
    inventory: 'สต๊อกสินค้า',
    ingredients: 'วัตถุดิบ',
    beverages: 'เครื่องดื่ม',
    packaging: 'บรรจุภัณฑ์',
    consumables: 'วัสดุสิ้นเปลือง',
    cleaning: 'ทำความสะอาด',
    maintenance: 'ซ่อมบำรุง',
    utilities: 'ค่าสาธารณูปโภค',
    transport: 'ขนส่ง/เดินทาง',
    staff: 'พนักงาน/ค่าแรง',
    marketing: 'การตลาด',
    fees: 'ค่าธรรมเนียม',
    professional_services: 'บริการวิชาชีพ',
    tax: 'ภาษี',
    financing: 'การเงิน/ดอกเบี้ย',
    petty_cash: 'เงินสดย่อย',
    other: 'อื่น ๆ',
  };
  return value ? labels[value] : 'อื่น ๆ';
}

function includesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some(pattern => pattern.test(text));
}

export function classifyOwnerExpensePurpose(rawText: string): OwnerExpenseClassification {
  const text = normalizeText(rawText).toLowerCase();
  let businessUnit: BusinessUnit | null = null;
  if (includesAny(text, [/อินทนิล/u, /inthanin/u, /ร้านกาแฟ/u])) businessUnit = 'inthanin';
  else if (includesAny(text, [/ตำมา/u, /ทำมา/u, /ตํามา/u, /ชาติ/u, /ร้านอาหาร/u, /ครัว/u])) businessUnit = 'tamma_restaurant';
  else if (includesAny(text, [/เฮือนสเตย์/u, /huenstay/u, /ที่พัก/u, /ห้องพัก/u, /รีสอร์ต/u])) businessUnit = 'huenstay';
  else if (includesAny(text, [/ผจญภัย/u, /adventure/u, /แอดเวนเจอร์/u, /atv/u, /zipline/u, /ล่องแก่ง/u])) businessUnit = 'adventure';
  else if (includesAny(text, [/otop/u, /โอทอป/u, /ของฝาก/u])) businessUnit = 'otop';
  else if (includesAny(text, [
    /ส่วนกลาง/u, /ลานจอด/u, /ถนน/u, /ถมดิน/u, /ที่ดิน/u, /รั้ว/u, /ระบบน้ำ/u, /ประปา/u,
    /ไฟฟ้ากลาง/u, /โครงสร้างพื้นฐาน/u, /เฉลียง/u, /ศาลา/u, /ทางเดิน/u, /ลานนั่ง/u,
  ])) businessUnit = 'shared_infrastructure';
  else if (includesAny(text, [/ใช้ร่วม/u, /หลายกิจการ/u, /กลางโครงการ/u])) businessUnit = 'shared';

  let expenseCategory: ExpenseCategory = 'other';
  let expenseSubcategory: string | null = null;
  if (includesAny(text, [/ก่อสร้าง/u, /ต่อเติม/u, /รีโนเวท/u, /ปรับปรุงอาคาร/u, /แปรรูปไม้/u, /งานไม้/u, /เลื่อยไม้/u, /น้ำมัน(?:สำหรับ)?(?:ตัดไม้|เลื่อยไม้|แปรรูปไม้)/u])) {
    expenseCategory = 'construction';
    expenseSubcategory = includesAny(text, [/แปรรูปไม้/u, /งานไม้/u, /เลื่อยไม้/u])
      ? 'งานไม้/แปรรูปไม้'
      : 'งานก่อสร้าง/ต่อเติม';
  } else if (includesAny(text, [/ถมดิน/u, /ที่ดิน/u, /ลานจอด/u, /ถนน/u, /รั้ว/u, /ระบบน้ำ/u, /ประปา/u, /ระบบไฟ/u, /โครงสร้างพื้นฐาน/u])) {
    expenseCategory = 'land_infrastructure';
    expenseSubcategory = 'ที่ดิน/ส่วนกลาง';
  } else if (includesAny(text, [/เครื่องชง/u, /เครื่องบด/u, /เตา/u, /ตู้เย็น/u, /ตู้แช่/u, /เครื่องดูดควัน/u, /อุปกรณ์ครัว/u])) {
    expenseCategory = 'kitchen_equipment';
    expenseSubcategory = 'อุปกรณ์ครัว';
  } else if (includesAny(text, [/โต๊ะ/u, /เก้าอี้/u, /เฟอร์นิเจอร์/u, /ชั้นวาง/u, /เคาน์เตอร์/u])) {
    expenseCategory = 'furniture_fixtures';
    expenseSubcategory = 'เฟอร์นิเจอร์/งานติดตั้ง';
  } else if (includesAny(text, [/atv/u, /จักรยาน/u, /เรือ/u, /อุปกรณ์กิจกรรม/u, /หมวกกันน็อก/u])) {
    expenseCategory = 'activity_assets';
    expenseSubcategory = 'อุปกรณ์กิจกรรม';
  } else if (includesAny(text, [/คอมพิวเตอร์/u, /โน้ตบุ๊ก/u, /แท็บเล็ต/u, /กล้อง/u, /pos/u, /ซอฟต์แวร์/u, /software/u])) {
    expenseCategory = 'technology';
    expenseSubcategory = 'เทคโนโลยี';
  } else if (includesAny(text, [/ลิขสิทธิ์/u, /license/u, /ใบอนุญาต/u])) {
    expenseCategory = 'licenses';
    expenseSubcategory = 'ใบอนุญาต/ลิขสิทธิ์';
  } else if (includesAny(text, [/สต๊อก/u, /สินค้า/u])) {
    expenseCategory = 'inventory';
    expenseSubcategory = 'สต๊อกสินค้า';
  } else if (includesAny(text, [/วัตถุดิบ/u, /อาหาร/u, /นม/u, /เนื้อ/u, /ผัก/u])) {
    expenseCategory = 'ingredients';
    expenseSubcategory = 'วัตถุดิบ';
  } else if (includesAny(text, [/กาแฟ/u, /ชา(?!ติ)/u, /เครื่องดื่ม/u])) {
    expenseCategory = 'beverages';
    expenseSubcategory = 'เครื่องดื่ม';
  } else if (includesAny(text, [/แก้ว/u, /ถุง/u, /แพ็กเกจ/u, /บรรจุภัณฑ์/u])) {
    expenseCategory = 'packaging';
    expenseSubcategory = 'บรรจุภัณฑ์';
  } else if (includesAny(text, [/ทำความสะอาด/u, /น้ำยา/u])) {
    expenseCategory = 'cleaning';
    expenseSubcategory = 'ทำความสะอาด';
  } else if (includesAny(text, [/ซ่อม/u, /บำรุง/u])) {
    expenseCategory = 'maintenance';
    expenseSubcategory = 'ซ่อมบำรุง';
  } else if (includesAny(text, [/ค่าไฟ/u, /ค่าน้ำ/u, /อินเทอร์เน็ต/u, /internet/u])) {
    expenseCategory = 'utilities';
    expenseSubcategory = 'สาธารณูปโภค';
  } else if (includesAny(text, [/ค่าส่ง/u, /ขนส่ง/u, /น้ำมัน/u, /เดินทาง/u])) {
    expenseCategory = 'transport';
    expenseSubcategory = 'ขนส่ง/เดินทาง';
  } else if (includesAny(text, [/เงินเดือน/u, /ค่าแรง/u, /ค่าจ้าง/u, /พนักงาน/u])) {
    expenseCategory = 'staff';
    expenseSubcategory = 'พนักงาน/ค่าแรง';
  } else if (includesAny(text, [/โฆษณา/u, /การตลาด/u, /marketing/u])) {
    expenseCategory = 'marketing';
    expenseSubcategory = 'การตลาด';
  } else if (includesAny(text, [/ค่าธรรมเนียม/u, /fee/u])) {
    expenseCategory = 'fees';
    expenseSubcategory = 'ค่าธรรมเนียม';
  } else if (includesAny(text, [/บัญชี/u, /ทนาย/u, /ที่ปรึกษา/u, /consult/u])) {
    expenseCategory = 'professional_services';
    expenseSubcategory = 'บริการวิชาชีพ';
  } else if (includesAny(text, [/ภาษี/u])) {
    expenseCategory = 'tax';
    expenseSubcategory = 'ภาษี';
  } else if (includesAny(text, [/ดอกเบี้ย/u, /สินเชื่อ/u, /ผ่อน/u])) {
    expenseCategory = 'financing';
    expenseSubcategory = 'การเงิน/ดอกเบี้ย';
  } else if (includesAny(text, [/เงินสดย่อย/u])) {
    expenseCategory = 'petty_cash';
    expenseSubcategory = 'เงินสดย่อย';
  } else if (includesAny(text, [/วัสดุสิ้นเปลือง/u])) {
    expenseCategory = 'consumables';
    expenseSubcategory = 'วัสดุสิ้นเปลือง';
  } else if (includesAny(text, [/แอร์/u, /เครื่องปรับอากาศ/u, /เครื่อง/u, /อุปกรณ์/u, /เครื่องมือ/u])) {
    expenseCategory = 'equipment';
    expenseSubcategory = 'อุปกรณ์/เครื่องมือ';
  }

  let expenseClass: ExpenseClass = 'uncategorized';
  if (includesAny(text, [/ส่วนตัว/u, /personal/u, /ใช้ส่วนตัว/u])) expenseClass = 'owner_private';
  else if (
    ['construction','land_infrastructure','kitchen_equipment','furniture_fixtures','activity_assets','technology','licenses'].includes(expenseCategory)
    || includesAny(text, [/ลงทุน/u, /ก่อสร้าง/u, /ต่อเติม/u, /รีโนเวท/u, /ปรับปรุง/u, /ติดตั้ง/u, /ซื้อเครื่อง/u, /อุปกรณ์/u, /เฟอร์นิเจอร์/u, /ครุภัณฑ์/u, /ถมดิน/u, /ถมที่/u, /ที่ดิน/u, /ซอฟต์แวร์/u, /license/u])
  ) expenseClass = 'capital_investment';
  else if (expenseCategory !== 'other') expenseClass = 'operating_expense';

  const confidence = Number(Math.min(0.95, (businessUnit ? 0.34 : 0.08) + (expenseCategory !== 'other' ? 0.37 : 0.05) + (expenseClass !== 'uncategorized' ? 0.20 : 0)).toFixed(2));
  return { businessUnit, expenseClass, expenseCategory, expenseSubcategory, confidence };
}

function detailReply(row: Pick<OwnerExpenseIntake, 'id' | 'amount' | 'status'>, prefix: string): string {
  return [
    prefix,
    'รหัสรายการ: #' + intakeCode(row.id),
    row.amount === null ? 'ยอดจากหลักฐาน: อ่านไม่ชัด' : 'ยอด: ' + money(row.amount),
    row.status === 'needs_review' ? '⚠️ เก็บไว้ในคิวตรวจสอบแล้วครับ' : '',
  ].filter(Boolean).join('\n');
}

function pendingChoiceReply(rows: OwnerExpenseIntake[]): string {
  return [
    'มีหลักฐานรอระบุ ' + rows.length + ' รายการ จึงยังไม่เดาว่าคำตอบนี้เป็นของใบไหนครับ',
    ...rows.map(row => '• #' + intakeCode(row.id) + ' · ' + (row.amount === null ? 'ยอดอ่านไม่ชัด' : money(row.amount)) + ' · ' + row.occurred_on),
    'พิมพ์ เช่น #'+intakeCode(rows[0]!.id)+' ซื้อเครื่องชง Inthanin ครับ',
  ].join('\n');
}

function referenceFromText(text: string): { code: string | null; purpose: string } {
  const match = text.match(/#([a-f0-9-]{6,36})\b/iu);
  return {
    code: match?.[1]?.replace(/-/g, '').toLowerCase() ?? null,
    purpose: normalizeText(text.replace(/#[a-f0-9-]{6,36}\b/iu, '')),
  };
}

function isNotExpense(text: string): boolean {
  return /^(?:ไม่ใช่ค่าใช้จ่าย|ไม่ใช่สลิป|ยกเลิกรายการ|ยกเลิก)$/iu.test(normalizeText(text));
}

export function isOwnerExpenseClassificationReply(rawText: string): boolean {
  const text = normalizeText(rawText).replace(/[.!?。！？]+$/u, '').trim();
  return /^(?:(?:เป็น|จัดเป็น)\s*)?(?:(?:หมวด|กิจการ|ของ(?:กิจการ)?)\s*)?(?:ส่วนกลาง|โครงสร้างพื้นฐาน|ใช้ร่วม(?:หลายกิจการ)?|อินทนิล|inthanin|ตำมา[\s-]*ชาติ|ตํามา[\s-]*ชาติ|เฮือนสเตย์|huenstay|ผจญภัย|adventure|otop|โอทอป)\s*(?:ครับ|ค่ะ|คับ|นะครับ|นะคะ)?$/iu.test(text);
}

function isPurposeNoise(text: string): boolean {
  return /^(?:ครับ|ค่ะ|คับ|ok|โอเค|รับทราบ|ขอบคุณ|อืม|ใช่)$/iu.test(normalizeText(text));
}

function storedExtractionFallback(): FinancialImageExtraction {
  return {
    document_type: 'other',
    amount_total: null,
    document_date_local: null,
    merchant: null,
    reference_number: null,
    bank: null,
    expense_category: null,
    pos_net_sales: null,
    pos_cash: null,
    pos_qr: null,
    pos_card: null,
    pos_other: null,
    confidence: 0,
    note: 'Owner expense extraction unavailable; owner clarification required',
    extraction_model: 'none',
  };
}

export async function handleOwnerExpenseImage(input: {
  targetId: string;
  userId?: string | null;
  messageId: string;
  timestamp?: number;
}): Promise<string | null> {
  const team = await boundLineOpsTeam(input.targetId);
  if (team !== 'owner_general') return null;

  const groupHash = piiHash(input.targetId);
  if (!groupHash) throw new Error('owner_expense_group_hash_unavailable');

  const priorMessage = await existingIntakeByMessage(groupHash, input.messageId);
  if (priorMessage) {
    return detailReply(priorMessage, '📁 Owner Expense — รูปนี้เคยรับไว้แล้วครับ');
  }

  const image = await fetchLineImage(input.messageId);
  const priorImage = await existingIntakeByImage(groupHash, image.sha256);
  if (priorImage) {
    return detailReply(priorImage, '📁 Owner Expense — รูปหลักฐานนี้เคยรับไว้แล้ว จึงไม่ลงซ้ำครับ');
  }

  let extraction: FinancialImageExtraction;
  try {
    extraction = await extractFinancialEvidence(image.bytes, image.mimeType);
  } catch {
    extraction = storedExtractionFallback();
  }

  const occurredOn = extraction.document_date_local || bangkokDate(input.timestamp);
  const path = [
    'owner-group',
    occurredOn,
    image.sha256.slice(0, 20) + '-' + input.messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60) + '.' + extensionForMime(image.mimeType),
  ].join('/');

  await uploadEvidence(image.bytes, image.mimeType, path);
  let result: CaptureResult;
  try {
    result = await rpc<CaptureResult>('financial_capture_owner_expense_slip_v1', {
      p_group_hash: groupHash,
      p_message_id: input.messageId,
      p_user_hash: piiHash(input.userId) ?? '',
      p_occurred_on: occurredOn,
      p_image_sha256: image.sha256,
      p_storage_bucket: BUCKET,
      p_storage_path: path,
      p_mime_type: image.mimeType,
      p_extraction: extraction,
    });
  } catch (error) {
    await deleteOrphanEvidence(path);
    throw error;
  }

  if (result.duplicate) {
    await deleteOrphanEvidence(path);
    return [
      '📁 Owner Expense — รูปหลักฐานนี้เคยรับไว้แล้ว จึงไม่ลงซ้ำครับ',
      result.intake_id ? 'รหัสรายการ: #' + intakeCode(result.intake_id) : '',
    ].filter(Boolean).join('\n');
  }

  const amount = result.amount === null || result.amount === undefined ? 'ยอดจากรูป: อ่านไม่ชัด' : 'ยอดที่อ่านได้: ' + money(result.amount);
  return [
    '📁 Owner Expense — รับ' + documentLabel(result.document_type) + 'ไว้แล้วครับ',
    result.intake_id ? 'รหัสรายการ: #' + intakeCode(result.intake_id) : '',
    amount,
    'สลิปนี้จ่ายค่าอะไร และเป็นของกิจการ/ส่วนไหนครับ?',
    'ตัวอย่าง: “ซื้อเครื่องชง Inthanin”, “ค่าก่อสร้างเฮือนสเตย์”, “ถมที่ลานจอดส่วนกลาง” ครับ',
  ].filter(Boolean).join('\n');
}

function resultReply(result: ResolveResult): string {
  return [
    '📁 Owner Expense — บันทึกเข้าหลังบ้านแล้วครับ',
    result.intake_id ? 'รหัสรายการ: #' + intakeCode(result.intake_id) : '',
    result.amount === null || result.amount === undefined ? 'ยอด: รออ่าน/ตรวจจากหลักฐาน' : 'ยอด: ' + money(result.amount),
    'กิจการ: ' + businessLabel(result.business_unit_code),
    'ประเภท: ' + classLabel(result.expense_class) + ' · ' + categoryLabel(result.expense_category),
    result.status === 'needs_review' ? '⚠️ ผมเก็บครบแล้ว แต่ตั้งเป็น “รอตรวจ” เพื่อไม่เดาหมวดผิดครับ' : '✅ พร้อมเข้าแดชบอร์ดสรุปลงทุนครับ',
  ].join('\n');
}

async function resolveExpenseToProject(input: {
  intake: OwnerExpenseIntake;
  project: OwnerExpenseProject;
  purpose: string;
  classification: OwnerExpenseClassification;
  userHash: string;
  messageId: string;
}): Promise<string> {
  const { intake, project } = input;
  if (intake.owner_project_id && intake.owner_project_id !== project.id) {
    return 'รายการนี้ผูกกับโครงการอื่นอยู่แล้วครับ ผมยังไม่เปลี่ยนโครงการให้เพื่อกันยอดย้ายผิดครับ';
  }

  if (!intake.owner_project_id) {
    await rpc('owner_project_link_financial_v1', {
      p_financial_kind: 'owner_expense',
      p_financial_id: intake.id,
      p_project_id: project.id,
      p_task_id: intake.owner_project_task_id ?? null,
      p_installment_id: intake.owner_project_installment_id ?? null,
      p_source: 'line',
      p_actor_hash: input.userHash,
      p_reason: 'ผูกจากข้อความระบุชื่อโครงการในคำอธิบายสลิป',
    });
  }

  const classification = input.classification;
  const businessUnit = classification.businessUnit ?? project.business_unit_code ?? 'other';
  const expenseCategory = classification.expenseCategory !== 'other'
    ? classification.expenseCategory
    : intake.expense_category || classification.expenseCategory;
  const expenseClass = classification.expenseClass !== 'uncategorized'
    ? classification.expenseClass
    : intake.expense_class || classification.expenseClass;
  const confidence = Math.max(classification.confidence, 0.72);
  const result = await rpc<ResolveResult>('financial_resolve_owner_expense_intake_v1', {
    p_intake_id: intake.id,
    p_purpose: intake.status === 'awaiting_business' && intake.purpose_raw
      && parseOwnerReportedPaidTotal(intake.purpose_raw) === null
      ? intake.purpose_raw : input.purpose,
    p_business_unit_code: businessUnit,
    p_expense_class: expenseClass,
    p_expense_category: expenseCategory,
    p_expense_subcategory: classification.expenseSubcategory ?? intake.expense_subcategory,
    p_confidence: confidence,
    p_user_hash: input.userHash,
    p_message_id: input.messageId,
  });

  return [
    result.duplicate
      ? '📁 Owner Expense — รายการนี้มีอยู่ในหลังบ้านแล้วครับ'
      : '📁 Owner Expense — ตรวจรายการและจัดหมวดให้แล้วครับ',
    'รหัสรายการ: #' + intakeCode(intake.id),
    'โครงการ: ' + project.name,
    'รายการ: ' + input.purpose,
    'กิจการ/ส่วน: ' + businessLabel(result.business_unit_code ?? businessUnit),
    'ประเภท: ' + classLabel(result.expense_class ?? expenseClass)
      + ' · ' + categoryLabel(result.expense_category || expenseCategory)
      + (result.expense_subcategory || classification.expenseSubcategory
        ? ' · ' + (result.expense_subcategory || classification.expenseSubcategory)
        : ''),
    result.amount === null || result.amount === undefined ? 'ยอด: รอตรวจจากหลักฐาน' : 'ยอด: ' + money(result.amount),
    result.status === 'needs_review'
      ? 'ผูกหลักฐานกับโครงการแล้ว แต่มีข้อมูลที่ยังไม่ชัด จึงพักรายการเดิมไว้ให้ตรวจในหลังบ้านครับ'
      : 'จัดหมวดและผูกยอดกับโครงการในหลังบ้านแล้วครับ ไม่ได้สร้างยอดหรือรายการซ้ำ',
  ].join('\n');
}

async function stageProjectMentionForClarification(input: {
  intake: OwnerExpenseIntake;
  purpose: string;
  classification: OwnerExpenseClassification;
  userHash: string;
  messageId: string;
}): Promise<void> {
  if (input.intake.status !== 'awaiting_purpose') return;
  await rpc('financial_stage_owner_expense_purpose_v1', {
    p_intake_id: input.intake.id,
    p_purpose: input.purpose,
    p_expense_class: input.classification.expenseClass,
    p_expense_category: input.classification.expenseCategory,
    p_expense_subcategory: input.classification.expenseSubcategory,
    p_confidence: input.classification.confidence,
    p_user_hash: input.userHash,
    p_message_id: input.messageId,
  });
}

function typedInvestmentCommand(text: string): { amount: number; paymentMethod: 'cash' | 'transfer' | 'card' | 'other'; title: string; businessUnit: BusinessUnit | null; category: string } | null {
  if (!/^(?:ลงทุน(?:เงินสด)?|เงินสดลงทุน|บันทึกลงทุน)(?:\s|$)/iu.test(text)) return null;
  const amountMatch = text.match(/(?:^|\s)([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s|บาท|$)/u);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1].replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return null;
  const classification = classifyOwnerExpensePurpose(text);
  const paymentMethod = /เงินสด/u.test(text) ? 'cash' : /โอน|transfer/u.test(text) ? 'transfer' : /บัตร|card/u.test(text) ? 'card' : 'other';
  const title = normalizeText(text
    .replace(/^(?:ลงทุน(?:เงินสด)?|เงินสดลงทุน|บันทึกลงทุน)\s*/iu, '')
    .replace(amountMatch[0], ' ')
    .replace(/\b(?:บาท|เงินสด|โอน|transfer|บัตร|card)\b/giu, ' ')
    .replace(/(?:ตำมา-ชาติ|ตำมาชาติ|inthanin|เฮือนสเตย์|ผจญภัย|otop|ส่วนกลาง|ใช้ร่วม)/giu, ' '));
  return {
    amount,
    paymentMethod,
    title: title || 'รายการลงทุน',
    businessUnit: classification.businessUnit,
    category: classification.expenseCategory,
  };
}

async function recordTypedInvestment(input: { text: string; groupHash: string; userId?: string | null; messageId: string; timestamp?: number }): Promise<string | null> {
  const parsed = typedInvestmentCommand(input.text);
  if (!parsed) return null;
  if (!parsed.businessUnit) {
    return 'บันทึกรายการลงทุนได้ครับ แต่ขอระบุกิจการเพิ่ม เช่น “ลงทุนเงินสด 5,000 ซื้อชั้นวาง ตำมา-ชาติ” ครับ';
  }
  const result = await rpc<{ ok?: boolean; duplicate?: boolean; id?: string }>('financial_record_investment_v1', {
    p_occurred_on: bangkokDate(input.timestamp),
    p_business_unit_code: parsed.businessUnit,
    p_title: parsed.title,
    p_category: parsed.category,
    p_amount: parsed.amount,
    p_payment_method: parsed.paymentMethod,
    p_vendor_name: null,
    p_notes: input.text,
    p_source_channel: 'line',
    p_owner_group_hash: input.groupHash,
    p_source_message_id: input.messageId,
    p_actor_hash: piiHash(input.userId) ?? '',
  });
  if (result.duplicate) return '📈 Investment OS — รายการนี้รับไว้แล้วครับ';
  return [
    '📈 Investment OS — บันทึกรายการเงินสด/พิมพ์แล้วครับ',
    'ยอด: ' + money(parsed.amount),
    'กิจการ: ' + businessLabel(parsed.businessUnit),
    'หมวด: ' + categoryLabel(parsed.category as ExpenseCategory),
    'รายการจะขึ้นใน Investment OS แยกจาก Restaurant OS ครับ',
  ].join('\n');
}

export function parseTypedOwnerPaidExpense(rawText: string): {
  amount: number;
  title: string;
  category: ExpenseCategory;
  businessUnit: BusinessUnit | null;
  paymentMethod: 'cash' | 'transfer' | 'card' | 'other';
} | null {
  const text = normalizeText(rawText);
  if (!/^(?:จ่าย(?:เงิน|ค่า)|ชำระ(?:เงิน|ค่า)|โอนจ่าย)/u.test(text)) return null;
  if (/[?？]|(?:ไหม|หรือยัง|เท่าไหร่|กี่บาท|จะจ่าย|ยังไม่จ่าย)/u.test(text)) return null;
  const amountMatch = text.match(/(?:^|\s)([0-9][0-9,]*(?:\.[0-9]{1,2})?)(?:\s|บาท|$)/u);
  if (!amountMatch) return null;
  const amount = Number(amountMatch[1]!.replace(/,/g, ''));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) return null;
  const classification = classifyOwnerExpensePurpose(text);
  const title = normalizeText(text
    .replace(/^(?:จ่าย(?:เงิน|ค่า)|ชำระ(?:เงิน|ค่า)|โอนจ่าย)\s*/u, '')
    .replace(amountMatch[0], ' ')
    .replace(/(?:โครงการ|โปรเจกต์|project)\s*/giu, ' ')
    .replace(/(?:ตำมา[\s-]*ชาติ|ทำมา[\s-]*ชาติ|inthanin|เฮือนสเตย์|ผจญภัย|otop|ส่วนกลาง|ใช้ร่วม)/giu, ' ')
    .replace(/(?:บาท|เงินสด|โอน|บัตร|transfer|card)/giu, ' '));
  if (title.length < 2) return null;
  return {
    amount,
    title,
    category: classification.expenseCategory,
    businessUnit: classification.businessUnit,
    paymentMethod: /เงินสด/u.test(text) ? 'cash' : /โอน|transfer/u.test(text) ? 'transfer' : /บัตร|card/u.test(text) ? 'card' : 'other',
  };
}

export async function handleOwnerPaidExpenseMethodFollowup(input: {
  targetId: string; userId?: string | null; text: string; messageId?: string | null;
}): Promise<string | null> {
  const method = /^(?:เงินสด|จ่ายเงินสด)$/u.test(input.text.trim()) ? 'cash'
    : /^(?:โอน|โอนเงิน)$/u.test(input.text.trim()) ? 'transfer'
    : /^(?:บัตร|บัตรเครดิต)$/u.test(input.text.trim()) ? 'card' : null;
  if (!method || !input.messageId || !input.userId) return null;
  if (await boundLineOpsTeam(input.targetId) !== 'owner_general') return null;
  const groupHash = piiHash(input.targetId), actorHash = piiHash(input.userId);
  if (!groupHash || !actorHash) return null;
  const draftsResponse = await dbFetch('owner_project_conversation_drafts?owner_group_hash=eq.'
    + encodeURIComponent(groupHash) + '&actor_hash=eq.' + encodeURIComponent(actorHash)
    + '&status=eq.collecting&select=id,data,missing_fields,source_message_id,expires_at'
    + '&order=updated_at.desc&limit=1');
  const draft = (await draftsResponse.json() as Array<{
    id:string; data:Record<string,unknown>; missing_fields:string[];
    source_message_id:string; expires_at:string;
  }>)[0];
  if (!draft || new Date(draft.expires_at).getTime() <= Date.now()) return null;
  const entriesResponse = await dbFetch('financial_investment_entries?source_channel=eq.line'
    + '&source_message_id=eq.' + encodeURIComponent(draft.source_message_id)
    + '&owner_group_hash=eq.' + encodeURIComponent(groupHash)
    + '&source_user_hash=eq.' + encodeURIComponent(actorHash)
    + '&status=eq.recorded&select=id,payment_method&limit=1');
  const entry = (await entriesResponse.json() as Array<{id:string;payment_method:string}>)[0];
  if (!entry || !['other',method].includes(entry.payment_method)) return null;
  await rpc('owner_project_set_line_payment_method_v1', {
    p_entry_id:entry.id,p_group_hash:groupHash,p_actor_hash:actorHash,
    p_method:method,p_message_id:input.messageId,
  });
  await dbFetch('owner_project_conversation_drafts?id=eq.' + draft.id, {
    method:'PATCH',headers:{Prefer:'return=minimal'},
    body:JSON.stringify({data:{...draft.data,payment_method:method},
      last_message_id:input.messageId,updated_at:new Date().toISOString()}),
  });
  const question = draft.missing_fields[0]
    ? ownerProjectQuestion(draft.missing_fields[0] as Parameters<typeof ownerProjectQuestion>[0])
    : 'ถ้าข้อมูลแผนถูกต้อง พิมพ์ “ยืนยัน” ครับ';
  return `รับแล้วครับ รายจ่ายเดิมระบุวิธีจ่ายเป็น ${method==='cash'?'เงินสด':method==='transfer'?'โอน':'บัตร'} ไม่เพิ่มยอดซ้ำ\n${question}`;
}

async function recordTypedOwnerPaidExpense(input: {
  text: string;
  targetId: string;
  groupHash: string;
  userId?: string | null;
  messageId: string;
  timestamp?: number;
}): Promise<string | null> {
  const parsed = parseTypedOwnerPaidExpense(input.text);
  if (!parsed) return null;
  const response = await dbFetch(
    'owner_projects?owner_group_hash=eq.' + encodeURIComponent(input.groupHash)
    + '&status=neq.cancelled&select=id,name,business_unit_code,purpose,status&order=created_at.desc&limit=500',
  );
  const mention = matchNamedProjectForOwnerPaidExpense(input.text, await response.json() as OwnerExpenseProject[]);
  if (mention.kind === 'ambiguous') return 'พบชื่อโครงการที่ตรงกันมากกว่าหนึ่งรายการครับ ช่วยระบุชื่อโครงการให้ชัดอีกครั้งครับ';
  if (mention.kind === 'not_found') return 'ยังไม่พบโครงการที่ระบุในหลังบ้านครับ ช่วยระบุชื่อโครงการที่ยืนยันไว้ครับ';
  const project = mention.kind === 'matched' ? mention.project : null;
  const businessUnit = project?.business_unit_code ?? parsed.businessUnit;
  if (!businessUnit) return 'รายการจ่ายนี้เป็นของกิจการหรือโครงการไหนครับ? ผมจะบันทึกยอดเมื่อทราบส่วนที่ถูกต้องครับ';
  if (project && parsed.businessUnit && project.business_unit_code && parsed.businessUnit !== project.business_unit_code) {
    return 'ชื่อกิจการกับโครงการที่ระบุไม่ตรงกันครับ ช่วยยืนยันชื่อโครงการก่อนบันทึกครับ';
  }
  const result = await rpc<{ ok?: boolean; duplicate?: boolean; id?: string }>('owner_project_record_line_investment_v1', {
    p_occurred_on: bangkokDate(input.timestamp),
    p_business_unit_code: businessUnit,
    p_title: parsed.title,
    p_category: parsed.category,
    p_amount: parsed.amount,
    p_payment_method: parsed.paymentMethod,
    p_vendor_name: null,
    p_notes: input.text,
    p_owner_group_hash: input.groupHash,
    p_source_message_id: input.messageId,
    p_actor_hash: piiHash(input.userId) ?? '',
    p_project_id: project?.id ?? null,
  });
  if (result.duplicate) return '✅ รายจ่ายนี้บันทึกไว้แล้วครับ ไม่ได้เพิ่มยอดซ้ำ';
  const planQuestion = await startOwnerProjectPlanAfterPaidExpense({
    targetId: input.targetId, userId: input.userId, messageId: input.messageId,
    projectName: project?.name ?? null, workTitle: parsed.title,
    businessUnit, paymentMethod: parsed.paymentMethod,
  });
  return [
    '✅ บันทึกรายจ่ายเข้าหลังบ้านแล้วครับ',
    'รายการ: ' + parsed.title,
    'ยอด: ' + money(parsed.amount),
    project ? 'โครงการ: ' + project.name : 'กิจการ: ' + businessLabel(businessUnit),
    'หมวด: ' + categoryLabel(parsed.category),
    parsed.paymentMethod === 'other' ? 'วิธีจ่าย: ยังไม่ระบุ' : '',
    planQuestion ? 'แผนงานและงบยังเป็นร่าง รอคำว่า “ยืนยัน” ก่อนบันทึกครับ' : '',
    planQuestion,
  ].filter(Boolean).join('\n');
}

/** A just-uploaded slip owns its explicit project description, even during an older plan draft. */
export async function handleOwnerRecentSlipProjectPurpose(input: {
  targetId: string; userId?: string | null; text: string;
  messageId?: string | null;
}): Promise<string | null> {
  if (!input.messageId || !input.userId
    || (/^(?:แม่|คุณแม่|ม๊า|ม้า)(?:\s|,|:|ครับ|คะ|ค่ะ|จ๋า)/u.test(normalizeText(input.text))
      && !/(?:ทองไทย|@ทองไทย)/u.test(input.text))
    || !/(?:โครงการ|โปรเจกต์|project)/iu.test(input.text)
    || /(?:สร้างโครงการใหม่|โปรเจคใหม่|เริ่มโครงการใหม่|เพิ่มงาน|ยืนยัน)/u.test(input.text)
    || parseOwnerReportedPaidTotal(input.text) !== null) return null;
  if (await boundLineOpsTeam(input.targetId) !== 'owner_general') return null;
  const groupHash = piiHash(input.targetId), actorHash = piiHash(input.userId);
  if (!groupHash || !actorHash) return null;
  const response = await dbFetch('financial_owner_expense_intakes?owner_group_hash=eq.'
    + encodeURIComponent(groupHash) + '&source_user_hash=eq.' + encodeURIComponent(actorHash)
    + '&status=' + PENDING_STATUSES
    + '&select=id,source_user_hash,status,amount,occurred_on,document_type,purpose_raw,business_unit_code,expense_class,expense_category,expense_subcategory,owner_project_id,owner_project_task_id,owner_project_installment_id,created_at'
    + '&order=created_at.desc&limit=5');
  const recent = (await response.json() as OwnerExpenseIntake[])
    .filter(row => Date.now() - new Date(row.created_at).getTime() <= 10 * 60 * 1000);
  if (!recent.length) return null;
  const mention = await ownerProjectMention(input.text, groupHash);
  if (mention.kind !== 'matched') return null;
  if (recent.length !== 1) return pendingChoiceReply(recent);
  const classification = classifyOwnerExpensePurpose(normalizeText([
    input.text, mention.project.purpose ?? '',
  ].filter(Boolean).join(' ')));
  return resolveExpenseToProject({
    intake: recent[0]!, project: mention.project, purpose: normalizeText(input.text),
    classification, userHash: actorHash, messageId: input.messageId,
  });
}

export async function handleOwnerExpenseText(input: {
  targetId: string;
  userId?: string | null;
  text: string;
  messageId?: string | null;
  timestamp?: number;
}): Promise<string | null> {
  const team = await boundLineOpsTeam(input.targetId);
  if (team !== 'owner_general') return null;

  const text = normalizeText(input.text);
  const groupHash = piiHash(input.targetId);
  if (!groupHash) throw new Error('owner_expense_group_hash_unavailable');
  if (!input.messageId) return null;

  const typedReply = await recordTypedInvestment({
    text,
    groupHash,
    userId: input.userId,
    messageId: input.messageId,
    timestamp: input.timestamp,
  });
  if (typedReply) return typedReply;

  const paidExpense = parseTypedOwnerPaidExpense(text);
  if (parseOwnerReportedPaidTotal(text) !== null) {
    return 'รับยอดรวมที่แจ้งแล้วครับ แต่ยังไม่ทราบว่าเป็นของโครงการไหน กรุณาบอกชื่อโครงการเพื่อเทียบกับยอดหลังบ้าน ผมยังไม่เพิ่มรายการจ่ายซ้ำครับ';
  }

  const reference = referenceFromText(text);
  const classificationReply = isOwnerExpenseClassificationReply(text);
  const allRows = await pendingIntakes(groupHash, classificationReply);
  if (!allRows.length) return paidExpense
    ? recordTypedOwnerPaidExpense({ text, targetId: input.targetId, groupHash, userId: input.userId, messageId: input.messageId, timestamp: input.timestamp })
    : null;
  const actorHash = piiHash(input.userId) ?? '';
  // Without an explicit #code, only continue the sender's own pending slip.
  // This prevents two family members in the Owner group crossing answers.
  const ownRows = reference.code
    ? allRows
    : allRows.filter(row => row.source_user_hash === actorHash
      && Date.now() - new Date(row.created_at).getTime() <= 10 * 60 * 1000);
  const rows = paidExpense && !reference.code
    ? ownRows.filter(row => row.amount !== null && Number(row.amount) === paidExpense.amount)
    : ownRows;
  if (!rows.length) return paidExpense
    ? recordTypedOwnerPaidExpense({ text, targetId: input.targetId, groupHash, userId: input.userId, messageId: input.messageId, timestamp: input.timestamp })
    : null;

  let intake: OwnerExpenseIntake | undefined;
  if (reference.code) {
    intake = rows.find(row => row.id.replace(/-/g, '').toLowerCase().startsWith(reference.code!));
    if (!intake) return pendingChoiceReply(rows);
  } else if (rows.length === 1) {
    intake = rows[0];
  } else {
    return pendingChoiceReply(rows);
  }

  const purpose = reference.purpose || text;
  if (!purpose || isPurposeNoise(purpose)) {
    return 'รบกวนบอกว่าเป็นค่าอะไรและของกิจการ/ส่วนไหนครับ เช่น “ซื้อเครื่องชง Inthanin” ครับ';
  }

  if (isNotExpense(purpose)) {
    await rpc<CaptureResult>('financial_mark_owner_expense_not_expense_v1', {
      p_intake_id: intake.id,
      p_reason: purpose,
      p_user_hash: piiHash(input.userId) ?? '',
      p_message_id: input.messageId,
    });
    return [
      '📁 Owner Expense — ทำเครื่องหมายว่าไม่ใช่ค่าใช้จ่ายแล้วครับ',
      'หลักฐานและประวัติเดิมยังเก็บอยู่ในหลังบ้าน ไม่ลบข้อมูลครับ',
    ].join('\n');
  }

  if (intake.status === 'needs_review' && classificationReply) {
    const classification = classifyOwnerExpensePurpose(
      normalizeText([intake.purpose_raw, purpose].filter(Boolean).join(' ')),
    );
    if (!classification.businessUnit) {
      return 'ยังจับคู่หมวดกิจการไม่ได้ครับ ช่วยพิมพ์ชื่อให้ชัด เช่น “ส่วนกลาง” ครับ';
    }
    const expenseClass = intake.expense_class ?? classification.expenseClass;
    const expenseCategory = intake.expense_category ?? classification.expenseCategory;
    const expenseSubcategory = intake.expense_subcategory ?? classification.expenseSubcategory;
    const result = await rpc<ResolveResult>('financial_reclassify_owner_expense_from_line_v1', {
      p_intake_id: intake.id,
      p_business_unit_code: classification.businessUnit,
      p_expense_class: expenseClass,
      p_expense_category: expenseCategory,
      p_expense_subcategory: expenseSubcategory,
      p_user_hash: actorHash,
      p_message_id: input.messageId,
    });
    if (result.duplicate) return '📁 คำยืนยันหมวดนี้บันทึกไว้แล้วครับ ไม่ได้เพิ่มยอดซ้ำ';
    return [
      '✅ รับทราบครับ อัปเดตรายการเดิมแล้ว ไม่ได้เพิ่มยอดซ้ำ',
      'รายการ: ' + (intake.purpose_raw || 'ค่าใช้จ่าย'),
      'ยอด: ' + (intake.amount === null ? 'รอตรวจจากหลักฐาน' : money(intake.amount)),
      'กิจการ/ส่วน: ' + businessLabel(result.business_unit_code ?? classification.businessUnit),
      'หมวดค่าใช้จ่าย: ' + classLabel(result.expense_class ?? expenseClass)
        + ' · ' + categoryLabel(result.expense_category ?? expenseCategory),
      result.status === 'needs_review'
        ? 'รายการยังอยู่ในคิวตรวจหมวดค่าใช้จ่ายครับ'
        : 'หลักฐานเดิมและโครงการที่ผูกไว้ยังอยู่ในรายการเดิมครับ',
    ].join('\n');
  }

  const combinedPurpose = normalizeText([intake.purpose_raw, purpose].filter(Boolean).join(' '));
  const mentionedProject = await ownerProjectMention(combinedPurpose, groupHash);
  if (mentionedProject.kind === 'matched') {
    // A named project is context, not just a foreign key. Use its stored
    // purpose as well as the owner's slip description to classify the same
    // expense against the Owner OS business-unit taxonomy.
    const projectClassification = classifyOwnerExpensePurpose(normalizeText([
      combinedPurpose,
      mentionedProject.project.purpose ?? '',
    ].filter(Boolean).join(' ')));
    return resolveExpenseToProject({
      intake,
      project: mentionedProject.project,
      purpose,
      classification: projectClassification,
      userHash: piiHash(input.userId) ?? '',
      messageId: input.messageId,
    });
  }
  if (mentionedProject.kind === 'ambiguous' || mentionedProject.kind === 'not_found') {
    const projectClassification = classifyOwnerExpensePurpose(combinedPurpose);
    await stageProjectMentionForClarification({
      intake,
      purpose: intake.purpose_raw || purpose,
      classification: projectClassification,
      userHash: piiHash(input.userId) ?? '',
      messageId: input.messageId,
    });
    return mentionedProject.kind === 'ambiguous'
      ? 'ผมเห็นว่าระบุโครงการแล้ว แต่มีชื่อใกล้กันหลายรายการครับ ช่วยพิมพ์ชื่อโครงการให้ครบอีกครั้งครับ'
      : 'ผมเห็นว่าระบุโครงการแล้ว แต่ยังหาโครงการชื่อนี้ในหลังบ้านไม่เจอครับ ช่วยพิมพ์ชื่อโครงการที่ยืนยันไว้ให้ตรงอีกครั้งครับ';
  }

  if (intake.status === 'awaiting_purpose') {
    const classification = classifyOwnerExpensePurpose(purpose);
    if (classification.businessUnit) {
      const result = await rpc<ResolveResult>('financial_resolve_owner_expense_intake_v1', {
        p_intake_id: intake.id,
        p_purpose: purpose,
        p_business_unit_code: classification.businessUnit,
        p_expense_class: classification.expenseClass,
        p_expense_category: classification.expenseCategory,
        p_expense_subcategory: classification.expenseSubcategory,
        p_confidence: classification.confidence,
        p_user_hash: piiHash(input.userId) ?? '',
        p_message_id: input.messageId,
      });
      return result.duplicate
        ? '📁 Owner Expense — คำตอบนี้บันทึกไว้แล้วครับ'
        : resultReply(result);
    }

    const result = await rpc<ResolveResult>('financial_stage_owner_expense_purpose_v1', {
      p_intake_id: intake.id,
      p_purpose: purpose,
      p_expense_class: classification.expenseClass,
      p_expense_category: classification.expenseCategory,
      p_expense_subcategory: classification.expenseSubcategory,
      p_confidence: classification.confidence,
      p_user_hash: piiHash(input.userId) ?? '',
      p_message_id: input.messageId,
    });
    if (result.duplicate) return '📁 Owner Expense — คำตอบนี้บันทึกไว้แล้วครับ';
    return [
      'เข้าใจว่าเป็น ' + categoryLabel(classification.expenseCategory) + ' แล้วครับ',
      'แต่ยังไม่ทราบว่าเป็นของกิจการ/ส่วนไหนครับ?',
      'ตอบได้ เช่น ตำมา-ชาติ / Inthanin / เฮือนสเตย์ / ผจญภัย / OTOP / ส่วนกลางครับ',
    ].join('\n');
  }

  const classification = classifyOwnerExpensePurpose((intake.purpose_raw || '') + ' ' + purpose);
  if (!classification.businessUnit) {
    return 'รบกวนระบุกิจการครับ: ตำมา-ชาติ / Inthanin / เฮือนสเตย์ / ผจญภัย / OTOP / ส่วนกลางครับ';
  }
  const result = await rpc<ResolveResult>('financial_resolve_owner_expense_intake_v1', {
    p_intake_id: intake.id,
    p_purpose: intake.purpose_raw || purpose,
    p_business_unit_code: classification.businessUnit,
    p_expense_class: intake.expense_class || classification.expenseClass,
    p_expense_category: intake.expense_category || classification.expenseCategory,
    p_expense_subcategory: intake.expense_subcategory || classification.expenseSubcategory,
    p_confidence: Math.max(classification.confidence, 0.76),
    p_user_hash: piiHash(input.userId) ?? '',
    p_message_id: input.messageId,
  });
  return result.duplicate
    ? '📁 Owner Expense — คำตอบนี้บันทึกไว้แล้วครับ'
    : resultReply(result);
}
