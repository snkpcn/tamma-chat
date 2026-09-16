import { createHash } from 'node:crypto';
import { piiHash } from './_operations-db';

type TargetType = 'group' | 'room';

type FuelSession = {
  id: string;
  selected_asset_id: string | null;
  pending_line_message_id: string | null;
  pending_extraction: Record<string, unknown>;
  pending_received_at: string | null;
  expires_at: string;
};

type AtvAsset = {
  id: string;
  asset_code: string;
  name: string;
  active: boolean;
};

type ReceiptExtraction = {
  is_fuel_receipt: boolean;
  merchant: string | null;
  receipt_number: string | null;
  fueled_at_local: string | null;
  liters: number | null;
  total_cost: number | null;
  unit_price: number | null;
  fuel_type: string | null;
  asset_number: number | null;
  confidence: number;
  note: string | null;
  extraction_model: string;
};

const LINE_CONTENT_ENDPOINT = 'https://api-data.line.me/v2/bot/message';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const GEMINI_MODELS = ['gemini-3.6-flash', 'gemini-3.5-flash'] as const;
const OPENAI_MODEL = 'gpt-5.6-luna';

function dbConfig(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Operations database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = dbConfig();
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Fuel receipt DB request failed ${response.status}: ${body.slice(0, 260)}`);
  }
  return response;
}

function senderHash(targetId: string, userId?: string | null): string {
  return piiHash(userId || `ops-group:${targetId}`) || createHash('sha256').update(userId || targetId).digest('hex');
}

function targetHash(targetId: string): string {
  return piiHash(targetId) || createHash('sha256').update(targetId).digest('hex');
}

async function isActivityGroup(targetId: string): Promise<boolean> {
  const hash = targetHash(targetId);
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${encodeURIComponent(hash)}&enabled=eq.true&select=team_code&limit=1`,
  );
  const rows = await response.json() as Array<{ team_code: string }>;
  return rows[0]?.team_code === 'activity';
}

async function activeAtvs(): Promise<AtvAsset[]> {
  const response = await dbFetch(
    'activity_assets?activity_code=eq.atv&active=eq.true&select=id,asset_code,name,active&order=sort_order.asc,asset_code.asc',
  );
  return await response.json() as AtvAsset[];
}

async function atvByNumber(number: number): Promise<AtvAsset | null> {
  if (!Number.isInteger(number) || number < 1 || number > 99) return null;
  const code = `atv-${String(number).padStart(2, '0')}`;
  const response = await dbFetch(
    `activity_assets?activity_code=eq.atv&asset_code=eq.${encodeURIComponent(code)}&active=eq.true&select=id,asset_code,name,active&limit=1`,
  );
  return (await response.json() as AtvAsset[])[0] ?? null;
}

async function getSession(targetId: string, userId?: string | null): Promise<FuelSession | null> {
  const th = targetHash(targetId);
  const sh = senderHash(targetId, userId);
  const response = await dbFetch(
    `activity_line_fuel_sessions?target_id_hash=eq.${encodeURIComponent(th)}&sender_id_hash=eq.${encodeURIComponent(sh)}`
    + '&select=id,selected_asset_id,pending_line_message_id,pending_extraction,pending_received_at,expires_at&limit=1',
  );
  const row = (await response.json() as FuelSession[])[0] ?? null;
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await clearSession(targetId, userId);
    return null;
  }
  return row;
}

async function saveSession(targetId: string, userId: string | null | undefined, patch: {
  selectedAssetId?: string | null;
  pendingLineMessageId?: string | null;
  pendingExtraction?: Record<string, unknown>;
  pendingReceivedAt?: string | null;
  status: 'waiting' | 'pending_asset' | 'pending_receipt' | 'error';
}): Promise<void> {
  const now = new Date();
  const payload = {
    target_id_hash: targetHash(targetId),
    sender_id_hash: senderHash(targetId, userId),
    selected_asset_id: patch.selectedAssetId ?? null,
    pending_line_message_id: patch.pendingLineMessageId ?? null,
    pending_extraction: patch.pendingExtraction ?? {},
    pending_received_at: patch.pendingReceivedAt ?? null,
    status: patch.status,
    expires_at: new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
    updated_at: now.toISOString(),
  };
  await dbFetch('activity_line_fuel_sessions?on_conflict=target_id_hash,sender_id_hash', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  });
}

async function clearSession(targetId: string, userId?: string | null): Promise<void> {
  await dbFetch(
    `activity_line_fuel_sessions?target_id_hash=eq.${encodeURIComponent(targetHash(targetId))}`
    + `&sender_id_hash=eq.${encodeURIComponent(senderHash(targetId, userId))}`,
    { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
  );
}

function parseAtvNumber(text: string): number | null {
  const normalized = text.trim();
  const explicit = [
    /(?:เติมน้ำมัน|น้ำมัน|เติม).{0,20}?ATV\s*#?\s*(\d{1,2})/iu,
    /ATV\s*#?\s*(\d{1,2}).{0,20}?(?:เติมน้ำมัน|น้ำมัน|เติม)/iu,
    /(?:เติมน้ำมัน|น้ำมัน|เติม).{0,20}?คัน\s*(\d{1,2})/u,
  ];
  for (const pattern of explicit) {
    const match = normalized.match(pattern);
    if (match) return Number(match[1]);
  }
  return null;
}

function parsePendingAtvAnswer(text: string): number | null {
  const match = text.trim().match(/^(?:ATV\s*#?\s*|คัน\s*)?(\d{1,2})$/iu);
  return match ? Number(match[1]) : null;
}

function hasFuelIntent(text: string): boolean {
  return /(?:เติมน้ำมัน|น้ำมันรถ|เติม\s*ATV|fuel)/iu.test(text);
}

function stripCodeFences(text: string): string {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
}

function numberOrNull(value: unknown, max = 10_000_000): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
}

function normalizeExtraction(raw: Record<string, unknown>, model: string): ReceiptExtraction {
  const assetNumber = numberOrNull(raw.asset_number, 99);
  const confidence = Math.max(0, Math.min(1, numberOrNull(raw.confidence, 1) ?? 0));
  return {
    is_fuel_receipt: Boolean(raw.is_fuel_receipt),
    merchant: typeof raw.merchant === 'string' && raw.merchant.trim() ? raw.merchant.trim().slice(0, 180) : null,
    receipt_number: typeof raw.receipt_number === 'string' && raw.receipt_number.trim() ? raw.receipt_number.trim().slice(0, 120) : null,
    fueled_at_local: typeof raw.fueled_at_local === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(raw.fueled_at_local)
      ? raw.fueled_at_local
      : null,
    liters: numberOrNull(raw.liters, 1000),
    total_cost: numberOrNull(raw.total_cost, 1_000_000),
    unit_price: numberOrNull(raw.unit_price, 1000),
    fuel_type: typeof raw.fuel_type === 'string' && raw.fuel_type.trim() ? raw.fuel_type.trim().slice(0, 120) : null,
    asset_number: assetNumber && Number.isInteger(assetNumber) ? assetNumber : null,
    confidence,
    note: typeof raw.note === 'string' && raw.note.trim() ? raw.note.trim().slice(0, 400) : null,
    extraction_model: model,
  };
}

const RECEIPT_PROMPT = `You are extracting a real fuel receipt for an ATV operations ledger in Thailand.
Read ONLY visible information from the image. Never invent missing fields.
If a Buddhist year is visible (e.g. 2569), convert it to Gregorian (2026).
Return fueled_at_local as YYYY-MM-DDTHH:mm:ss in Thailand local time only when the receipt visibly contains enough date/time information.
asset_number is ONLY the ATV number if the image itself visibly contains a handwritten or printed marker such as ATV 1, ATV2, คัน 3. Never infer it from receipt number, pump number, lane, nozzle, or transaction number.
If this is a payment/transfer slip clearly related to fuel but liters are not shown, total_cost may still be returned and liters must be null.
confidence is 0..1 for the extracted values as a whole.
Return ONLY JSON with exactly these keys:
{"is_fuel_receipt":boolean,"merchant":string|null,"receipt_number":string|null,"fueled_at_local":string|null,"liters":number|null,"total_cost":number|null,"unit_price":number|null,"fuel_type":string|null,"asset_number":number|null,"confidence":number,"note":string|null}`;

async function extractWithGemini(bytes: Buffer, mimeType: string): Promise<ReceiptExtraction> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Gemini not configured');
  let lastError = 'Gemini unavailable';
  for (const model of GEMINI_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{
            role: 'user',
            parts: [
              { text: RECEIPT_PROMPT },
              { inline_data: { mime_type: mimeType, data: bytes.toString('base64') } },
            ],
          }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 1200 },
        }),
      });
      if (!response.ok) {
        lastError = `Gemini ${response.status}`;
        if ([429, 500, 502, 503, 504].includes(response.status)) continue;
        throw new Error(lastError);
      }
      const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.map(part => part.text || '').join('') || '';
      if (!text) throw new Error('Gemini returned no receipt data');
      return normalizeExtraction(JSON.parse(stripCodeFences(text)), model);
    } catch (error) {
      if ((error as Error).name === 'AbortError') lastError = 'Gemini timeout';
      else lastError = error instanceof Error ? error.message : 'Gemini receipt extraction failed';
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastError);
}

async function extractWithOpenAI(bytes: Buffer, mimeType: string): Promise<ReceiptExtraction> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OpenAI not configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: RECEIPT_PROMPT,
        input: [{ role: 'user', content: [
          { type: 'input_text', text: 'Extract this fuel receipt.' },
          { type: 'input_image', image_url: `data:${mimeType};base64,${bytes.toString('base64')}` },
        ] }],
        reasoning: { effort: 'none' },
        max_output_tokens: 1200,
        text: { format: { type: 'json_schema', name: 'fuel_receipt', strict: false, schema: { type: 'object' } } },
      }),
    });
    if (!response.ok) throw new Error(`OpenAI ${response.status}`);
    const data = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    let text = data.output_text ?? '';
    if (!text) for (const item of data.output ?? []) for (const part of item.content ?? []) if (part.type === 'output_text' && part.text) text += part.text;
    if (!text) throw new Error('OpenAI returned no receipt data');
    return normalizeExtraction(JSON.parse(stripCodeFences(text)), OPENAI_MODEL);
  } finally {
    clearTimeout(timer);
  }
}

async function extractReceipt(bytes: Buffer, mimeType: string): Promise<ReceiptExtraction> {
  try {
    return await extractWithGemini(bytes, mimeType);
  } catch (geminiError) {
    console.error('LINE_FUEL_RECEIPT_GEMINI_ERROR', geminiError instanceof Error ? geminiError.message.slice(0, 180) : 'unknown');
    return extractWithOpenAI(bytes, mimeType);
  }
}

async function fetchLineImage(messageId: string): Promise<{ bytes: Buffer; mimeType: string; sha256: string }> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(`${LINE_CONTENT_ENDPOINT}/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`LINE image fetch failed ${response.status}`);
  const contentLength = Number(response.headers.get('content-length') || 0);
  if (contentLength > MAX_IMAGE_BYTES) throw new Error('receipt_image_too_large');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length) throw new Error('receipt_image_empty');
  if (bytes.length > MAX_IMAGE_BYTES) throw new Error('receipt_image_too_large');
  const mimeType = (response.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
  return { bytes, mimeType, sha256: createHash('sha256').update(bytes).digest('hex') };
}

function extractionHasLedgerValue(x: ReceiptExtraction): boolean {
  return Boolean((x.liters && x.liters > 0) || (x.total_cost !== null && x.total_cost >= 0));
}

function fueledAtFromExtraction(x: ReceiptExtraction, fallbackMs?: number): string {
  if (x.fueled_at_local) {
    const raw = x.fueled_at_local.length === 16 ? `${x.fueled_at_local}:00` : x.fueled_at_local;
    const date = new Date(`${raw}+07:00`);
    if (Number.isFinite(date.getTime())) return date.toISOString();
  }
  return new Date(Number.isFinite(fallbackMs) ? fallbackMs : Date.now()).toISOString();
}

function extractionSummary(x: ReceiptExtraction): string {
  const parts = [
    x.merchant || '',
    x.liters != null ? `${x.liters.toLocaleString('th-TH', { maximumFractionDigits: 3 })} ลิตร` : '',
    x.total_cost != null ? `${x.total_cost.toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท` : '',
    x.fuel_type || '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'อ่านรายละเอียดตัวเลขไม่ครบ';
}

async function existingFuelByMessage(messageId: string): Promise<{ asset_id: string; liters: number | null; total_cost: number | null } | null> {
  const response = await dbFetch(
    `activity_atv_fuel_logs?source_line_message_id=eq.${encodeURIComponent(messageId)}&select=asset_id,liters,total_cost&limit=1`,
  );
  return (await response.json() as Array<{ asset_id: string; liters: number | null; total_cost: number | null }>)[0] ?? null;
}

async function insertFuelLog(input: {
  asset: AtvAsset;
  extraction: ReceiptExtraction;
  messageId: string;
  targetId: string;
  userId?: string | null;
  receiptSha256: string;
  receivedAtMs?: number;
}): Promise<'saved' | 'duplicate'> {
  if (await existingFuelByMessage(input.messageId)) return 'duplicate';
  const x = input.extraction;
  if (!x.is_fuel_receipt) throw new Error('not_fuel_receipt');
  if (!extractionHasLedgerValue(x)) throw new Error('receipt_has_no_ledger_value');
  const noteParts = [
    x.note,
    x.receipt_number ? `เลขที่สลิป/ใบเสร็จ ${x.receipt_number}` : null,
  ].filter(Boolean);
  const payload = {
    asset_id: input.asset.id,
    fueled_at: fueledAtFromExtraction(x, input.receivedAtMs),
    liters: x.liters,
    total_cost: x.total_cost,
    note: noteParts.length ? noteParts.join(' · ').slice(0, 800) : null,
    source: 'line_receipt',
    source_line_message_id: input.messageId,
    source_group_hash: targetHash(input.targetId),
    source_user_hash: senderHash(input.targetId, input.userId),
    merchant: x.merchant,
    fuel_type: x.fuel_type,
    unit_price: x.unit_price,
    receipt_number: x.receipt_number,
    receipt_confidence: x.confidence,
    receipt_data: x,
    extraction_model: x.extraction_model,
    receipt_sha256: input.receiptSha256,
  };
  try {
    await dbFetch('activity_atv_fuel_logs', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    if (await existingFuelByMessage(input.messageId)) return 'duplicate';
    throw error;
  }
  return 'saved';
}

async function assetNameById(id: string): Promise<AtvAsset | null> {
  const response = await dbFetch(
    `activity_assets?id=eq.${encodeURIComponent(id)}&activity_code=eq.atv&select=id,asset_code,name,active&limit=1`,
  );
  return (await response.json() as AtvAsset[])[0] ?? null;
}

function pendingExtraction(session: FuelSession | null): ReceiptExtraction | null {
  if (!session?.pending_line_message_id || !session.pending_received_at) return null;
  const raw = session.pending_extraction;
  if (!raw || typeof raw !== 'object') return null;
  return normalizeExtraction(raw, typeof raw.extraction_model === 'string' ? raw.extraction_model : 'unknown');
}

function atvListText(atvs: AtvAsset[]): string {
  return atvs.length ? atvs.map(x => x.name).join(' / ') : 'ยังไม่มี ATV ที่เปิดใช้งาน';
}

export async function handleLineFuelText(input: {
  targetType: TargetType;
  targetId: string;
  userId?: string | null;
  text: string;
}): Promise<string | null> {
  if (!(await isActivityGroup(input.targetId))) return null;
  const text = input.text.trim();
  if (!text) return null;

  if (/^(?:ยกเลิก|ล้าง)(?:\s*(?:เติมน้ำมัน|สลิป|น้ำมัน))?$/u.test(text)) {
    const session = await getSession(input.targetId, input.userId);
    if (!session) return null;
    await clearSession(input.targetId, input.userId);
    return 'ยกเลิกรายการเติมน้ำมันที่ค้างไว้แล้วครับ';
  }

  const session = await getSession(input.targetId, input.userId);
  let number = parseAtvNumber(text);
  if (number == null && session?.pending_line_message_id) number = parsePendingAtvAnswer(text);

  if (number != null) {
    const asset = await atvByNumber(number);
    if (!asset) {
      const atvs = await activeAtvs();
      return `ไม่พบ ATV ${number} ที่พร้อมใช้งานครับ ตอนนี้มี ${atvListText(atvs)}`;
    }
    const extraction = pendingExtraction(session);
    if (extraction && session?.pending_line_message_id && session.pending_received_at) {
      if (!extraction.is_fuel_receipt) {
        await clearSession(input.targetId, input.userId);
        return `รูปที่ส่งมาไม่ใช่สลิปเติมน้ำมันครับ${extraction.merchant ? ` — อ่านได้ว่าเป็น ${extraction.merchant}` : ''}\nไม่ได้บันทึกลงตารางน้ำมัน`;
      }
      if (!extractionHasLedgerValue(extraction)) {
        await saveSession(input.targetId, input.userId, {
          selectedAssetId: asset.id,
          pendingLineMessageId: session.pending_line_message_id,
          pendingExtraction: extraction,
          pendingReceivedAt: session.pending_received_at,
          status: 'error',
        });
        return `รับทราบว่าเป็น ${asset.name} ครับ แต่สลิปอ่านจำนวนลิตร/ยอดเงินไม่ครบ กรุณาส่งรูปสลิปที่ชัดขึ้นอีกครั้ง`;
      }
      const status = await insertFuelLog({
        asset,
        extraction,
        messageId: session.pending_line_message_id,
        targetId: input.targetId,
        userId: input.userId,
        receiptSha256: typeof session.pending_extraction.receipt_sha256 === 'string' ? session.pending_extraction.receipt_sha256 : '',
        receivedAtMs: new Date(session.pending_received_at).getTime(),
      });
      await clearSession(input.targetId, input.userId);
      return status === 'duplicate'
        ? `✅ สลิปนี้ถูกบันทึกไว้แล้วสำหรับ ${asset.name} ครับ`
        : `✅ บันทึกเติมน้ำมัน ${asset.name} ลงหลังบ้านแล้ว\n${extractionSummary(extraction)}`;
    }

    if (hasFuelIntent(text)) {
      await saveSession(input.targetId, input.userId, {
        selectedAssetId: asset.id,
        status: 'pending_receipt',
      });
      return `รับทราบครับ ${asset.name} — ส่งรูปสลิปเติมน้ำมันในกลุ่มนี้ได้เลยภายใน 30 นาที ทองไทยจะอ่านสลิปและลงหลังบ้านให้อัตโนมัติ`;
    }
  }

  if (hasFuelIntent(text)) {
    const atvs = await activeAtvs();
    return `จะบันทึกเติมน้ำมันคันไหนครับ? พิมพ์ เช่น “เติมน้ำมัน ATV 2” แล้วส่งรูปสลิป\nตอนนี้มี ${atvListText(atvs)}`;
  }

  return null;
}

export async function handleLineFuelImage(input: {
  targetType: TargetType;
  targetId: string;
  userId?: string | null;
  messageId: string;
  timestamp?: number;
}): Promise<string | null> {
  if (!(await isActivityGroup(input.targetId))) return null;
  if (!input.messageId) return null;

  if (await existingFuelByMessage(input.messageId)) {
    return '✅ สลิปนี้ถูกบันทึกในตารางเติมน้ำมันแล้วครับ';
  }

  let image: { bytes: Buffer; mimeType: string; sha256: string };
  try {
    image = await fetchLineImage(input.messageId);
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'อ่านรูปไม่ได้';
    return detail === 'receipt_image_too_large'
      ? 'รูปสลิปใหญ่เกินไปครับ ส่งรูปสลิปที่ย่อขนาดลงอีกครั้งได้เลย'
      : 'ทองไทยดึงรูปสลิปจาก LINE ไม่สำเร็จครับ ลองส่งรูปอีกครั้ง';
  }

  let extraction: ReceiptExtraction;
  try {
    extraction = await extractReceipt(image.bytes, image.mimeType);
  } catch (error) {
    console.error('LINE_FUEL_RECEIPT_EXTRACTION_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
    return 'ทองไทยอ่านสลิปไม่สำเร็จครับ ลองถ่ายให้เห็นวันที่ จำนวนลิตร และยอดเงินชัด ๆ แล้วส่งใหม่อีกครั้ง';
  }

  const extractionForSession = { ...extraction, receipt_sha256: image.sha256 } as unknown as Record<string, unknown>;
  if (!extraction.is_fuel_receipt) {
    await clearSession(input.targetId, input.userId);
    return `รูปที่ส่งมาไม่ใช่สลิปเติมน้ำมันครับ${extraction.merchant ? ` — อ่านได้ว่าเป็น ${extraction.merchant}` : ''}\nไม่ได้บันทึกลงตารางน้ำมัน`;
  }
  if (!extractionHasLedgerValue(extraction)) {
    await saveSession(input.targetId, input.userId, {
      pendingLineMessageId: input.messageId,
      pendingExtraction: extractionForSession,
      pendingReceivedAt: new Date(input.timestamp || Date.now()).toISOString(),
      status: 'error',
    });
    return `ได้รับรูปแล้วครับ แต่ยังอ่านจำนวนลิตรหรือยอดเงินจากสลิปไม่ได้\n${extractionSummary(extraction)}\nกรุณาส่งรูปที่ชัดขึ้นอีกครั้ง`;
  }

  const session = await getSession(input.targetId, input.userId);
  let asset: AtvAsset | null = null;
  if (extraction.asset_number) asset = await atvByNumber(extraction.asset_number);
  if (!asset && session?.selected_asset_id) asset = await assetNameById(session.selected_asset_id);

  if (!asset) {
    await saveSession(input.targetId, input.userId, {
      pendingLineMessageId: input.messageId,
      pendingExtraction: extractionForSession,
      pendingReceivedAt: new Date(input.timestamp || Date.now()).toISOString(),
      status: 'pending_asset',
    });
    const atvs = await activeAtvs();
    return `อ่านสลิปได้แล้วครับ: ${extractionSummary(extraction)}\nเติมให้คันไหน? พิมพ์ ${atvListText(atvs)} ได้เลย`;
  }

  if (extraction.confidence < 0.5) {
    await saveSession(input.targetId, input.userId, {
      selectedAssetId: asset.id,
      pendingLineMessageId: input.messageId,
      pendingExtraction: extractionForSession,
      pendingReceivedAt: new Date(input.timestamp || Date.now()).toISOString(),
      status: 'error',
    });
    return `สลิปของ ${asset.name} อ่านได้ไม่ชัดพอที่จะลงบัญชีอัตโนมัติครับ (${extractionSummary(extraction)})\nส่งรูปที่ชัดขึ้นอีกครั้งได้เลย`;
  }

  const status = await insertFuelLog({
    asset,
    extraction,
    messageId: input.messageId,
    targetId: input.targetId,
    userId: input.userId,
    receiptSha256: image.sha256,
    receivedAtMs: input.timestamp,
  });
  await clearSession(input.targetId, input.userId);
  return status === 'duplicate'
    ? `✅ สลิปนี้ถูกบันทึกไว้แล้วสำหรับ ${asset.name} ครับ`
    : `✅ ทองไทยอ่านสลิปและลงหลังบ้านแล้ว\nรถ: ${asset.name}\n${extractionSummary(extraction)}`;
}
