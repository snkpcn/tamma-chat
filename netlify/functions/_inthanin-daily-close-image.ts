import { createHash } from 'node:crypto';
import { piiHash } from './_operations-db';
import { boundLineOpsTeam } from './_ops-notifications';

type FinancialDocumentType =
  | 'pos_close'
  | 'purchase_receipt'
  | 'expense_receipt'
  | 'transfer_slip'
  | 'stock_photo'
  | 'waste_photo'
  | 'other';

type ExpenseCategory =
  | 'ingredients'
  | 'beverages'
  | 'packaging'
  | 'consumables'
  | 'cleaning'
  | 'maintenance'
  | 'utilities'
  | 'transport'
  | 'staff'
  | 'equipment'
  | 'marketing'
  | 'fees'
  | 'petty_cash'
  | 'other';

export type FinancialImageExtraction = {
  document_type: FinancialDocumentType;
  amount_total: number | null;
  document_date_local: string | null;
  merchant: string | null;
  reference_number: string | null;
  bank: string | null;
  expense_category: ExpenseCategory | null;
  pos_net_sales: number | null;
  pos_cash: number | null;
  pos_qr: number | null;
  pos_card: number | null;
  pos_other: number | null;
  confidence: number;
  note: string | null;
  extraction_model: string;
};

type AttachResult = {
  ok?: boolean;
  duplicate?: boolean;
  evidence_id?: string | null;
  daily_close_id?: string | null;
  evidence_type?: string | null;
  document_type?: string | null;
  amount?: number | string | null;
  confidence?: number | string | null;
  match_status?: string | null;
  match_reason?: string | null;
  ledger_entry_id?: string | null;
  expense_claim_id?: string | null;
  matched_label?: string | null;
  effective_date?: string | null;
  received_local_date?: string | null;
};

const LINE_CONTENT_ENDPOINT = 'https://api-data.line.me/v2/bot/message';
const BUCKET = 'financial-evidence';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OPENAI_MODEL = 'gpt-5.6-luna';
const AUTO_MATCH_CONFIDENCE = 0.80;

const EXTRACTION_PROMPT = `You extract bookkeeping evidence for one Inthanin coffee shop in Thailand.
Read ONLY visible information from the image. Never invent missing values.

Classify document_type as exactly one of:
- pos_close: POS/end-of-day sales summary
- purchase_receipt: receipt/tax invoice for goods or ingredients purchased
- expense_receipt: receipt/invoice for services, utilities, repairs, fees or other operating expenses
- transfer_slip: bank/QR money transfer slip or bank payment confirmation
- stock_photo: photo of physical stock/inventory, not a receipt
- waste_photo: photo documenting damaged/wasted goods, not a receipt
- other: unclear or none of the above

Important accounting rules:
- A transfer slip proves money movement; it does NOT by itself prove a new expense category.
- Do not infer whether the sender is owner, employee, or vendor from names/account numbers.
- Do not return personal account names or full account numbers.
- amount_total is the clearly visible final amount only.
- If a Buddhist year such as 2569 is visible, convert it to Gregorian 2026.
- document_date_local must be YYYY-MM-DD only when a clear document/transaction date is visible.
- expense_category is only for purchase_receipt/expense_receipt, and must be one of:
  ingredients, beverages, packaging, consumables, cleaning, maintenance, utilities,
  transport, staff, equipment, marketing, fees, petty_cash, other.
- For pos_close, extract visible POS net sales and visible payment totals when clearly present.
- confidence is 0..1 for the extraction as a whole.

Return ONLY JSON with exactly these keys:
{"document_type":"pos_close|purchase_receipt|expense_receipt|transfer_slip|stock_photo|waste_photo|other","amount_total":number|null,"document_date_local":"YYYY-MM-DD"|null,"merchant":string|null,"reference_number":string|null,"bank":string|null,"expense_category":"ingredients|beverages|packaging|consumables|cleaning|maintenance|utilities|transport|staff|equipment|marketing|fees|petty_cash|other"|null,"pos_net_sales":number|null,"pos_cash":number|null,"pos_qr":number|null,"pos_card":number|null,"pos_other":number|null,"confidence":number,"note":string|null}`;

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Financial database is not configured');
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
    throw new Error('Financial evidence DB request failed ' + response.status + ': ' + body.slice(0, 260));
  }
  return response;
}

function stripCodeFences(text: string): string {
  return text.trim().replace(/^\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`$/i, '').trim();
}

function safeString(value: unknown, max = 180): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/\s+/g, ' ');
  return text ? text.slice(0, max) : null;
}

function numberOrNull(value: unknown, max = 100_000_000): number | null {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 && numeric <= max
    ? Math.round(numeric * 100) / 100
    : null;
}

const DOC_TYPES = new Set<FinancialDocumentType>([
  'pos_close','purchase_receipt','expense_receipt','transfer_slip','stock_photo','waste_photo','other',
]);

const EXPENSE_CATEGORIES = new Set<ExpenseCategory>([
  'ingredients','beverages','packaging','consumables','cleaning','maintenance',
  'utilities','transport','staff','equipment','marketing','fees','petty_cash','other',
]);

export function normalizeFinancialImageExtraction(raw: Record<string, unknown>, model: string): FinancialImageExtraction {
  const requestedType = DOC_TYPES.has(raw.document_type as FinancialDocumentType)
    ? raw.document_type as FinancialDocumentType
    : 'other';
  const confidence = Math.max(0, Math.min(1, numberOrNull(raw.confidence, 1) ?? 0));
  const expenseCategory = EXPENSE_CATEGORIES.has(raw.expense_category as ExpenseCategory)
    ? raw.expense_category as ExpenseCategory
    : null;

  return {
    document_type: requestedType,
    amount_total: numberOrNull(raw.amount_total),
    document_date_local: typeof raw.document_date_local === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(raw.document_date_local)
      ? raw.document_date_local
      : null,
    merchant: safeString(raw.merchant),
    reference_number: safeString(raw.reference_number, 120),
    bank: safeString(raw.bank, 120),
    expense_category: expenseCategory,
    pos_net_sales: numberOrNull(raw.pos_net_sales),
    pos_cash: numberOrNull(raw.pos_cash),
    pos_qr: numberOrNull(raw.pos_qr),
    pos_card: numberOrNull(raw.pos_card),
    pos_other: numberOrNull(raw.pos_other),
    confidence,
    note: safeString(raw.note, 400),
    extraction_model: model,
  };
}

export function matchingSafeExtraction(extraction: FinancialImageExtraction): FinancialImageExtraction {
  if (extraction.confidence >= AUTO_MATCH_CONFIDENCE) return extraction;
  return {
    ...extraction,
    document_type: 'other',
    note: [
      extraction.note,
      'Auto-match disabled because extraction confidence was below ' + AUTO_MATCH_CONFIDENCE,
      'Proposed document type: ' + extraction.document_type,
    ].filter(Boolean).join(' · ').slice(0, 400),
  };
}

async function extractWithGemini(bytes: Buffer, mimeType: string): Promise<FinancialImageExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini not configured');
  let lastError = 'Gemini unavailable';

  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18_000);
    try {
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{
              role: 'user',
              parts: [
                { text: EXTRACTION_PROMPT },
                { inline_data: { mime_type: mimeType, data: bytes.toString('base64') } },
              ],
            }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1400 },
          }),
        },
      );

      if (!response.ok) {
        lastError = 'Gemini ' + response.status;
        if ([429,500,502,503,504].includes(response.status)) continue;
        throw new Error(lastError);
      }

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      };
      const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
      if (!text) throw new Error('Gemini returned no financial evidence data');
      return normalizeFinancialImageExtraction(JSON.parse(stripCodeFences(text)), model);
    } catch (error) {
      if ((error as Error).name === 'AbortError') lastError = 'Gemini timeout';
      else lastError = error instanceof Error ? error.message : 'Gemini financial evidence extraction failed';
    } finally {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}

async function extractWithOpenAI(bytes: Buffer, mimeType: string): Promise<FinancialImageExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 18_000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: EXTRACTION_PROMPT,
        input: [{
          role: 'user',
          content: [
            { type: 'input_text', text: 'Extract this financial evidence image.' },
            { type: 'input_image', image_url: 'data:' + mimeType + ';base64,' + bytes.toString('base64') },
          ],
        }],
        reasoning: { effort: 'none' },
        max_output_tokens: 1400,
        text: {
          format: {
            type: 'json_schema',
            name: 'financial_evidence',
            strict: false,
            schema: { type: 'object' },
          },
        },
      }),
    });

    if (!response.ok) throw new Error('OpenAI ' + response.status);
    const data = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
    };
    let text = data.output_text ?? '';
    if (!text) {
      for (const item of data.output ?? []) {
        for (const part of item.content ?? []) {
          if (part.type === 'output_text' && part.text) text += part.text;
        }
      }
    }
    if (!text) throw new Error('OpenAI returned no financial evidence data');
    return normalizeFinancialImageExtraction(JSON.parse(stripCodeFences(text)), OPENAI_MODEL);
  } finally {
    clearTimeout(timer);
  }
}

async function extractFinancialEvidence(bytes: Buffer, mimeType: string): Promise<FinancialImageExtraction> {
  let geminiError: unknown = null;
  try {
    return await extractWithGemini(bytes, mimeType);
  } catch (error) {
    geminiError = error;
    console.error(
      'INTHANIN_EVIDENCE_GEMINI_ERROR',
      error instanceof Error ? error.message.slice(0, 180) : 'unknown',
    );
  }

  try {
    return await extractWithOpenAI(bytes, mimeType);
  } catch (openaiError) {
    console.error(
      'INTHANIN_EVIDENCE_OPENAI_ERROR',
      openaiError instanceof Error ? openaiError.message.slice(0, 180) : 'unknown',
      geminiError instanceof Error ? 'gemini=' + geminiError.message.slice(0, 120) : '',
    );
    throw new Error('financial_evidence_extraction_unavailable');
  }
}

async function fetchLineImage(messageId: string): Promise<{ bytes: Buffer; mimeType: string; sha256: string }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_CONTENT_ENDPOINT + '/' + encodeURIComponent(messageId) + '/content', {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!response.ok) throw new Error('LINE image fetch failed ' + response.status);

  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('financial_evidence_image_too_large');

  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('financial_evidence_image_empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('financial_evidence_image_too_large');

  const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg','image/png','image/webp'].includes(mimeType)) {
    throw new Error('unsupported_financial_evidence_image_type');
  }

  return {
    bytes,
    mimeType,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function localDateBangkok(timestamp?: number): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Number.isFinite(timestamp) ? timestamp : Date.now()));
}

function extensionForMime(mimeType: string): string {
  return mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
}

function encodedObjectPath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function uploadEvidence(bytes: Buffer, mimeType: string, path: string): Promise<void> {
  const c = dbConfig();
  const response = await fetch(
    c.url + '/storage/v1/object/' + BUCKET + '/' + encodedObjectPath(path),
    {
      method: 'POST',
      headers: {
        apikey: c.key,
        Authorization: 'Bearer ' + c.key,
        'Content-Type': mimeType,
        'x-upsert': 'false',
      },
      body: bytes,
    },
  );
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error('financial_evidence_upload_' + response.status + ':' + body.slice(0, 160));
  }
}

async function deleteEvidenceObject(path: string): Promise<void> {
  const c = dbConfig();
  await fetch(
    c.url + '/storage/v1/object/' + BUCKET + '/' + encodedObjectPath(path),
    {
      method: 'DELETE',
      headers: {
        apikey: c.key,
        Authorization: 'Bearer ' + c.key,
      },
    },
  ).catch(() => undefined);
}

async function existingEvidence(messageId: string, sha256: string): Promise<{
  id: string;
  match_status: string;
  evidence_type: string;
} | null> {
  const response = await dbFetch(
    'financial_daily_close_evidence?source_channel=eq.line'
    + '&or=(source_message_id.eq.' + encodeURIComponent(messageId)
    + ',image_sha256.eq.' + encodeURIComponent(sha256) + ')'
    + '&select=id,match_status,evidence_type&order=created_at.asc&limit=1',
  );
  return (await response.json() as Array<{ id:string; match_status:string; evidence_type:string }>)[0] ?? null;
}

async function attachEvidence(input: {
  messageId: string;
  userId?: string | null;
  receivedLocalDate: string;
  sha256: string;
  storagePath: string;
  mimeType: string;
  extraction: FinancialImageExtraction;
}): Promise<AttachResult> {
  const response = await dbFetch('rpc/financial_attach_cafe_test_evidence_v1', {
    method: 'POST',
    body: JSON.stringify({
      p_message_id: input.messageId,
      p_user_hash: piiHash(input.userId) ?? '',
      p_received_local_date: input.receivedLocalDate,
      p_image_sha256: input.sha256,
      p_storage_bucket: BUCKET,
      p_storage_path: input.storagePath,
      p_mime_type: input.mimeType,
      p_extraction: input.extraction,
    }),
  });
  const raw = await response.json() as AttachResult | AttachResult[];
  return Array.isArray(raw) ? raw[0] ?? {} : raw;
}

function money(value: unknown): string {
  const numeric = Number(value);
  return (Number.isFinite(numeric) ? numeric : 0).toLocaleString('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }) + ' บาท';
}

function evidenceLabel(type: string | null | undefined): string {
  const labels: Record<string,string> = {
    pos_close:'ยอดปิด POS',
    purchase_receipt:'ใบเสร็จซื้อของ',
    expense_receipt:'ใบเสร็จค่าใช้จ่าย',
    transfer_slip:'สลิปโอนเงิน',
    stock_photo:'รูปสต๊อก',
    waste_photo:'รูปของเสีย',
    other:'รูป/หลักฐาน',
  };
  return labels[type || 'other'] || 'รูป/หลักฐาน';
}

function replyForResult(extraction: FinancialImageExtraction, result: AttachResult): string {
  if (result.duplicate) {
    return '🧪 Café TEST — รูปนี้เคยรับไว้แล้วครับ\nทองไทยไม่ลงหลักฐานหรือค่าใช้จ่ายซ้ำครับ';
  }

  const amount = result.amount === null || result.amount === undefined ? null : money(result.amount);
  const base = [
    '🧪 Café TEST — รับ' + evidenceLabel(result.evidence_type) + 'แล้วครับ',
    amount ? 'ยอดที่อ่านได้: ' + amount : 'ยอด: อ่านจากรูปได้ไม่ชัด',
  ];

  if (result.match_status === 'matched_claim') {
    return [
      ...base,
      '✅ จับคู่กับรายการเบิกพนักงานที่ค้างอยู่แล้ว',
      'บันทึกเป็น cash settlement เท่านั้น — ไม่สร้างค่าใช้จ่ายซ้ำครับ',
    ].join('\n');
  }

  if (result.match_status === 'matched_ledger') {
    return [
      ...base,
      '✅ จับคู่กับรายการค่าใช้จ่าย/ซื้อของใน Daily Close แล้ว',
      'รูปนี้เป็นหลักฐานของรายการเดิม — ไม่เพิ่มค่าใช้จ่ายอีกรอบครับ',
    ].join('\n');
  }

  if (result.match_status === 'informational') {
    const extra = extraction.document_type === 'pos_close' && extraction.pos_net_sales !== null
      ? 'ยอดสุทธิ POS ที่อ่านได้: ' + money(extraction.pos_net_sales)
      : '';
    return [
      ...base,
      extra,
      'เก็บเป็นหลักฐานประกอบ Daily Close แล้วครับ',
    ].filter(Boolean).join('\n');
  }

  if (result.match_status === 'ambiguous') {
    return [
      ...base,
      '⚠️ พบมากกว่า 1 รายการที่ยอดตรงกัน',
      'ทองไทยเก็บรูปไว้แล้ว แต่ยังไม่จับคู่เองเพื่อกันลงบัญชีผิดครับ',
    ].join('\n');
  }

  return [
    ...base,
    '⚠️ ยังไม่พบรายการเดิมที่จับคู่ได้อย่างปลอดภัย',
    'เก็บรูปไว้ในรายการ “ต้องตรวจ” ก่อน และยังไม่สร้างค่าใช้จ่ายใหม่จากสลิปเพียงอย่างเดียวครับ',
  ].join('\n');
}

export async function handleCafeTestDailyCloseImage(input: {
  targetId: string;
  userId?: string | null;
  messageId: string;
  timestamp?: number;
}): Promise<string | null> {
  const team = await boundLineOpsTeam(input.targetId);
  if (team !== 'cafe_test') return null;

  const image = await fetchLineImage(input.messageId);

  const duplicate = await existingEvidence(input.messageId, image.sha256);
  if (duplicate) {
    return '🧪 Café TEST — รูปนี้เคยรับไว้แล้วครับ\nทองไทยไม่ลงหลักฐานหรือค่าใช้จ่ายซ้ำครับ';
  }

  const receivedLocalDate = localDateBangkok(input.timestamp);
  const extractionRaw = await extractFinancialEvidence(image.bytes, image.mimeType);
  const extraction = matchingSafeExtraction(extractionRaw);

  const safeMessageId = input.messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const storagePath = [
    'test',
    'inthanin_tadtone',
    receivedLocalDate,
    image.sha256.slice(0, 16) + '-' + safeMessageId + '.' + extensionForMime(image.mimeType),
  ].join('/');

  await uploadEvidence(image.bytes, image.mimeType, storagePath);

  try {
    const result = await attachEvidence({
      messageId: input.messageId,
      userId: input.userId,
      receivedLocalDate,
      sha256: image.sha256,
      storagePath,
      mimeType: image.mimeType,
      extraction,
    });

    if (result.duplicate) {
      await deleteEvidenceObject(storagePath);
    }

    console.log('INTHANIN_FINANCIAL_EVIDENCE_INGESTED', JSON.stringify({
      environment:'test',
      documentType:extraction.document_type,
      amount:extraction.amount_total,
      confidence:extraction.confidence,
      matchStatus:result.match_status ?? null,
      duplicate:Boolean(result.duplicate),
      evidenceId:result.evidence_id ?? null,
      dailyCloseId:result.daily_close_id ?? null,
    }));

    return replyForResult(extraction, result);
  } catch (error) {
    await deleteEvidenceObject(storagePath);
    throw error;
  }
}
