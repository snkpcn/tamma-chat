import { createHash } from 'node:crypto';
import { decryptPii, piiHash } from './_operations-db';

export type PaymentLineMessage = { type: string; [key: string]: unknown };
type PaymentStatus = 'quote_required' | 'awaiting_payment' | 'proof_submitted' | 'verified' | 'rejected' | 'cancelled';
type TeamCode = 'restaurant' | 'stay' | 'activity' | 'cafe' | 'otop' | 'all';

type PaymentRequest = {
  id: string;
  payment_code: string;
  entity_type: string;
  entity_id: string;
  entity_code: string;
  guest_id: string | null;
  customer_id: string | null;
  team_code: TeamCode;
  amount: number | null;
  currency: string;
  method: 'promptpay_owner_qr';
  status: PaymentStatus;
  source_channel: string;
  environment: string;
  note: string | null;
  updated_at: string;
};

type Binding = { id: string; team_code: TeamCode; target_id_enc: string };
type DeliveryRow = { id: string; status: string };

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const LINE_CONTENT_BASE = 'https://api-data.line.me/v2/bot/message';
const QR_IMAGE_URL = 'https://tamma-chat.netlify.app/assets/payment/tamma-promptpay-poster.png';
const BACKOFFICE_URL = 'https://tamma-backoffice.netlify.app/';
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_CODE_RE = /^(?:BK|PO|OR)-\d{6}-[A-Z0-9]{8}$/i;

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Payment database configuration missing');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
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
    throw new Error(`payment_db_${response.status}:${body.slice(0, 280)}`);
  }
  return response;
}

async function linePush(targetId: string, messages: PaymentLineMessage[]): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ to: targetId, messages: messages.slice(0, 5) }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`payment_line_push_${response.status}:${body.slice(0, 240)}`);
  }
}

function money(value: number | null): string {
  if (value === null || !Number.isFinite(Number(value))) return 'รอกำหนดยอด';
  return `${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} บาท`;
}

function parseAmount(raw: string): number | null {
  const amount = Number(raw.replace(/,/g, ''));
  return Number.isFinite(amount) && amount > 0 && amount <= 10_000_000 ? amount : null;
}

function statusLabel(status: PaymentStatus): string {
  return ({
    quote_required: 'รอทีมงานกำหนดยอด',
    awaiting_payment: 'รอชำระเงิน',
    proof_submitted: 'ส่งสลิปแล้ว / รอตรวจสอบ',
    verified: 'ชำระแล้ว',
    rejected: 'สลิปไม่ผ่าน / กรุณาส่งใหม่',
    cancelled: 'ยกเลิก',
  } as Record<PaymentStatus, string>)[status];
}

function paymentText(request: PaymentRequest): string {
  return [
    `💳 ชำระเงิน ${request.entity_code}`,
    `ยอด: ${money(request.amount)}`,
    'ช่องทางชำระเดียวของทำมา-ชาติ: PromptPay QR ด้านล่าง',
    'ชื่อบัญชี: นาย ชานนท์ ปรีชานนท์',
    '',
    'หลังโอนแล้ว ส่งรูปสลิปกลับมาในแชต LINE นี้ได้เลยครับ ทองไทยจะส่งให้ทีมงานตรวจสอบ',
  ].join('\n');
}

function qrMessages(request: PaymentRequest): PaymentLineMessage[] {
  return [
    { type: 'text', text: paymentText(request) },
    { type: 'image', originalContentUrl: QR_IMAGE_URL, previewImageUrl: QR_IMAGE_URL },
  ];
}

async function paymentRequestById(id: string): Promise<PaymentRequest | null> {
  if (!UUID_RE.test(id)) return null;
  const response = await dbFetch(`payment_requests?id=eq.${id}&select=*&limit=1`);
  return (await response.json() as PaymentRequest[])[0] ?? null;
}

async function paymentRequestByCode(code: string): Promise<PaymentRequest | null> {
  const normalized = code.trim().toUpperCase();
  if (!ENTITY_CODE_RE.test(normalized)) return null;
  const response = await dbFetch(
    `payment_requests?entity_code=eq.${encodeURIComponent(normalized)}&select=*&order=created_at.desc&limit=1`,
  );
  return (await response.json() as PaymentRequest[])[0] ?? null;
}

async function latestQuoteRequiredForTeam(binding: Binding): Promise<PaymentRequest | null> {
  if (binding.team_code === 'all') return null;
  const response = await dbFetch(
    `payment_requests?team_code=eq.${binding.team_code}&status=eq.quote_required&select=*&order=updated_at.desc&limit=1`,
  );
  return (await response.json() as PaymentRequest[])[0] ?? null;
}

async function guestDbId(anonymousId: string): Promise<string | null> {
  if (!UUID_RE.test(anonymousId)) return null;
  const response = await dbFetch(`guests?anonymous_id=eq.${encodeURIComponent(anonymousId)}&select=id&limit=1`);
  return (await response.json() as Array<{ id: string }>)[0]?.id ?? null;
}

async function latestPaymentForGuest(anonymousId: string, includeFinished = false): Promise<PaymentRequest | null> {
  const guestId = await guestDbId(anonymousId);
  if (!guestId) return null;
  const statusFilter = includeFinished
    ? ''
    : '&status=in.(quote_required,awaiting_payment,proof_submitted,rejected)';
  const response = await dbFetch(
    `payment_requests?guest_id=eq.${guestId}${statusFilter}&select=*&order=created_at.desc&limit=1`,
  );
  return (await response.json() as PaymentRequest[])[0] ?? null;
}

async function bindingForTarget(targetId: string): Promise<Binding | null> {
  const hash = piiHash(targetId);
  if (!hash) return null;
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true&select=id,team_code,target_id_enc&limit=1`,
  );
  return (await response.json() as Binding[])[0] ?? null;
}

async function teamBinding(teamCode: TeamCode): Promise<Binding | null> {
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&team_code=eq.${teamCode}&enabled=eq.true&select=id,team_code,target_id_enc&limit=1`,
  );
  return (await response.json() as Binding[])[0] ?? null;
}

function teamMatches(binding: Binding, request: PaymentRequest): boolean {
  return binding.team_code === 'all' || binding.team_code === request.team_code;
}

async function customerLineTarget(request: PaymentRequest): Promise<string | null> {
  let customerId = request.customer_id;
  if (!customerId && request.guest_id) {
    const accountResponse = await dbFetch(
      `customer_accounts?guest_id=eq.${request.guest_id}&select=id&limit=1`,
    );
    customerId = (await accountResponse.json() as Array<{ id: string }>)[0]?.id ?? null;
  }
  if (!customerId) return null;
  const response = await dbFetch(
    `customer_channel_contacts?customer_id=eq.${customerId}&provider=eq.line&reachable=eq.true&verified=eq.true`
      + '&select=external_id_enc&order=last_seen_at.desc&limit=1',
  );
  const row = (await response.json() as Array<{ external_id_enc: string }>)[0];
  return decryptPii(row?.external_id_enc) ?? null;
}

async function beginDelivery(input: {
  request: PaymentRequest;
  channelId?: string | null;
  audience: 'customer' | 'team';
}): Promise<{ id: string; shouldSend: boolean }> {
  const key = [
    'payment', input.request.id, input.audience, input.request.status,
    createHash('sha256').update(input.request.updated_at).digest('hex').slice(0, 12),
  ].join(':');
  const insert = await dbFetch('ops_notification_deliveries?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      channel_id: input.channelId ?? null,
      booking_id: null,
      entity_type: 'payment_request',
      entity_id: input.request.id,
      idempotency_key: key,
      delivery_type: `payment_${input.request.status}_${input.audience}`,
      provider: 'line',
      status: 'pending',
      payload: { payment_code: input.request.payment_code, entity_code: input.request.entity_code },
    }),
  });
  const created = (await insert.json() as DeliveryRow[])[0];
  if (created?.id) return { id: created.id, shouldSend: true };
  const lookup = await dbFetch(
    `ops_notification_deliveries?idempotency_key=eq.${encodeURIComponent(key)}&select=id,status&limit=1`,
  );
  const existing = (await lookup.json() as DeliveryRow[])[0];
  return { id: existing?.id ?? '', shouldSend: false };
}

async function finishDelivery(id: string, error?: unknown): Promise<void> {
  if (!id) return;
  await dbFetch(`ops_notification_deliveries?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: error ? 'failed' : 'sent',
      error_message: error ? (error instanceof Error ? error.message.slice(0, 500) : 'unknown') : null,
    }),
  });
}

function encodedObjectPath(path: string): string {
  return path.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function signedReceiptUrl(requestId: string): Promise<string | null> {
  const response = await dbFetch(
    `payment_receipts?payment_request_id=eq.${requestId}&select=object_path&order=created_at.desc&limit=1`,
  );
  const row = (await response.json() as Array<{ object_path: string }>)[0];
  if (!row?.object_path) return null;
  const c = config();
  const signResponse = await fetch(
    `${c.url}/storage/v1/object/sign/payment-slips/${encodedObjectPath(row.object_path)}`,
    {
      method: 'POST',
      headers: {
        apikey: c.key,
        Authorization: `Bearer ${c.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 3600 }),
    },
  );
  if (!signResponse.ok) return null;
  const data = await signResponse.json() as { signedURL?: string; signedUrl?: string };
  const signed = data.signedURL ?? data.signedUrl;
  if (!signed) return null;
  if (/^https?:\/\//i.test(signed)) return signed;
  return `${c.url}/storage/v1${signed.startsWith('/') ? signed : `/${signed}`}`;
}

function staffReviewCard(request: PaymentRequest): PaymentLineMessage {
  return {
    type: 'flex',
    altText: `ตรวจสลิป ${request.entity_code} ${money(request.amount)}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#245B51', paddingAll: '16px',
        contents: [
          { type: 'text', text: '💳 มีสลิปใหม่ให้ตรวจ', color: '#FFFFFF', weight: 'bold', size: 'lg' },
          { type: 'text', text: request.entity_code, color: '#E6F3EF', size: 'sm', margin: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          { type: 'text', text: `ยอดที่ต้องชำระ: ${money(request.amount)}`, weight: 'bold', wrap: true },
          { type: 'text', text: `สถานะ: ${statusLabel(request.status)}`, size: 'sm', color: '#6A625C', wrap: true },
          { type: 'text', text: 'ตรวจยอด/ชื่อบัญชีจากสลิปก่อนกดยืนยัน', size: 'xs', color: '#857A70', wrap: true },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          {
            type: 'button', style: 'primary', color: '#245B51',
            action: { type: 'postback', label: '✅ รับเงินแล้ว', data: `ops=payment&action=verify&id=${request.id}`, displayText: `ยืนยันรับเงิน ${request.entity_code}` },
          },
          {
            type: 'button', style: 'secondary',
            action: { type: 'postback', label: '❌ สลิปไม่ผ่าน', data: `ops=payment&action=reject&id=${request.id}`, displayText: `สลิปไม่ผ่าน ${request.entity_code}` },
          },
          {
            type: 'button', style: 'link',
            action: { type: 'uri', label: 'เปิดหลังบ้าน', uri: BACKOFFICE_URL },
          },
        ],
      },
    },
  };
}

async function sendCustomer(request: PaymentRequest, messages: PaymentLineMessage[]): Promise<boolean> {
  const target = await customerLineTarget(request);
  if (!target) return false;
  const delivery = await beginDelivery({ request, audience: 'customer' });
  if (!delivery.shouldSend) return true;
  try {
    await linePush(target, messages);
    await finishDelivery(delivery.id);
    return true;
  } catch (error) {
    await finishDelivery(delivery.id, error).catch(() => undefined);
    throw error;
  }
}

async function sendTeam(request: PaymentRequest, messages: PaymentLineMessage[]): Promise<boolean> {
  const binding = await teamBinding(request.team_code);
  if (!binding) return false;
  const target = decryptPii(binding.target_id_enc);
  if (!target) return false;
  const delivery = await beginDelivery({ request, channelId: binding.id, audience: 'team' });
  if (!delivery.shouldSend) return true;
  try {
    await linePush(target, messages);
    await finishDelivery(delivery.id);
    return true;
  } catch (error) {
    await finishDelivery(delivery.id, error).catch(() => undefined);
    throw error;
  }
}

async function setPaymentAmount(request: PaymentRequest, amount: number): Promise<void> {
  await dbFetch(`payment_requests?id=eq.${request.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      amount,
      status: 'awaiting_payment',
      quoted_at: new Date().toISOString(),
      submitted_at: null,
      rejected_at: null,
    }),
  });
}

export async function dispatchPaymentNotification(id: string): Promise<string> {
  const request = await paymentRequestById(id);
  if (!request) return 'missing';
  if (!['live', 'test'].includes(request.environment)) return 'ignored';

  if (request.status === 'quote_required') {
    const prefix = request.environment === 'test' ? '🧪 TEST • ' : '';
    const sent = await sendTeam(request, [{
      type: 'flex',
      altText: `${prefix}ต้องกำหนดยอดชำระ ${request.entity_code}`,
      contents: {
        type: 'bubble', size: 'kilo',
        header: {
          type: 'box', layout: 'vertical', backgroundColor: '#7A5A32', paddingAll: '16px',
          contents: [
            { type: 'text', text: `${prefix}💳 ใส่ราคาก่อนรับงาน`, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
            { type: 'text', text: request.entity_code, color: '#F4E9D7', size: 'sm', margin: 'sm' },
          ],
        },
        body: {
          type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
          contents: [
            { type: 'text', text: 'พิมพ์ราคาในกลุ่มนี้ได้เลย', weight: 'bold', wrap: true },
            { type: 'text', text: 'เช่น 300 หรือ 300 บาท รับงาน', size: 'sm', color: '#6A625C', wrap: true },
            { type: 'text', text: 'ทองไทยจะส่ง QR PromptPay ให้ลูกค้าอัตโนมัติทันทีที่ตั้งยอด', size: 'xs', color: '#857A70', wrap: true },
          ],
        },
        footer: {
          type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
          contents: [
            {
              type: 'button', style: 'primary', color: '#7A5A32',
              action: { type: 'postback', label: 'ใส่ราคา/รับงาน', data: `ops=payment&action=quote_prompt&id=${request.id}`, displayText: 'รับงาน' },
            },
          ],
        },
      },
    }]);
    return sent ? 'team_notified' : 'team_not_bound';
  }

  if (request.status === 'awaiting_payment') {
    if (request.amount === null || request.amount <= 0) return 'invalid_amount';
    return (await sendCustomer(request, qrMessages(request))) ? 'customer_qr_sent' : 'customer_not_reachable';
  }

  if (request.status === 'proof_submitted') {
    const signedUrl = await signedReceiptUrl(request.id);
    const messages: PaymentLineMessage[] = [];
    if (signedUrl) messages.push({ type: 'image', originalContentUrl: signedUrl, previewImageUrl: signedUrl });
    messages.push(staffReviewCard(request));
    return (await sendTeam(request, messages)) ? 'team_receipt_sent' : 'team_not_bound';
  }

  if (request.status === 'verified') {
    const sent = await sendCustomer(request, [{
      type: 'text',
      text: [
        `✅ ทองไทยยืนยันการชำระเงินแล้วครับ`,
        `รายการ: ${request.entity_code}`,
        `ยอด: ${money(request.amount)}`,
        'ทีมงานจะดำเนินการรายการ/การจองต่อจากสถานะนี้ครับ',
      ].join('\n'),
    }]);
    return sent ? 'customer_verified_sent' : 'customer_not_reachable';
  }

  if (request.status === 'rejected') {
    const sent = await sendCustomer(request, [
      {
        type: 'text',
        text: [
          `⚠️ สลิปของ ${request.entity_code} ยังตรวจสอบไม่ผ่านครับ`,
          `ยอดที่ต้องชำระ: ${money(request.amount)}`,
          'กรุณาตรวจสอบยอด/บัญชี แล้วส่งสลิปใหม่ในแชตนี้ได้เลย',
          'ช่องทางชำระยังคงเป็น PromptPay QR นี้ช่องทางเดียวครับ',
        ].join('\n'),
      },
      { type: 'image', originalContentUrl: QR_IMAGE_URL, previewImageUrl: QR_IMAGE_URL },
    ]);
    return sent ? 'customer_rejected_sent' : 'customer_not_reachable';
  }

  if (request.status === 'cancelled') {
    const sent = await sendCustomer(request, [{ type: 'text', text: `รายการชำระ ${request.entity_code} ถูกยกเลิกแล้วครับ` }]);
    return sent ? 'customer_cancelled_sent' : 'customer_not_reachable';
  }

  return 'ignored';
}

async function uploadReceipt(messageId: string, request: PaymentRequest): Promise<{ path: string; mime: string; size: number }> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const content = await fetch(`${LINE_CONTENT_BASE}/${encodeURIComponent(messageId)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!content.ok) throw new Error(`line_content_${content.status}`);
  const mime = (content.headers.get('content-type') ?? 'image/jpeg').split(';')[0].trim().toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mime)) throw new Error('unsupported_receipt_type');
  const buffer = Buffer.from(await content.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_RECEIPT_BYTES) throw new Error('receipt_size_invalid');
  const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg';
  const safeMessageId = messageId.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
  const objectPath = `${request.id}/${Date.now()}-${safeMessageId}.${ext}`;
  const c = config();
  const upload = await fetch(`${c.url}/storage/v1/object/payment-slips/${encodedObjectPath(objectPath)}`, {
    method: 'POST',
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': mime,
      'x-upsert': 'false',
    },
    body: buffer,
  });
  if (!upload.ok) {
    const body = await upload.text().catch(() => '');
    throw new Error(`receipt_upload_${upload.status}:${body.slice(0, 180)}`);
  }
  return { path: objectPath, mime, size: buffer.length };
}

export async function handleCustomerPaymentSlip(input: {
  anonymousId: string;
  rawLineUserId: string;
  messageId: string;
}): Promise<PaymentLineMessage[]> {
  const request = await latestPaymentForGuest(input.anonymousId);
  if (!request) {
    return [{ type: 'text', text: 'ตอนนี้ยังไม่มีรายการรอชำระในบัญชีนี้ครับ ถ้าต้องการจ่ายรายการไหน พิมพ์ “ชำระเงิน” ให้ทองไทยตรวจรายการล่าสุดได้เลยครับ' }];
  }
  if (request.status === 'quote_required') {
    return [{ type: 'text', text: `รายการ ${request.entity_code} ยังรอทีมงานกำหนดยอดครับ ยังไม่ต้องโอนตอนนี้ ทองไทยจะส่ง QR ให้ทันทีเมื่อยอดพร้อม` }];
  }
  if (request.status === 'proof_submitted') {
    return [{ type: 'text', text: `ได้รับสลิปของ ${request.entity_code} แล้วครับ กำลังรอทีมงานตรวจสอบ ไม่ต้องส่งซ้ำครับ` }];
  }
  if (!['awaiting_payment', 'rejected'].includes(request.status)) {
    return [{ type: 'text', text: `รายการ ${request.entity_code} อยู่สถานะ “${statusLabel(request.status)}” ครับ` }];
  }

  const existing = await dbFetch(
    `payment_receipts?source_provider=eq.line&source_message_id=eq.${encodeURIComponent(input.messageId)}&select=id&limit=1`,
  );
  if ((await existing.json() as unknown[]).length) {
    return [{ type: 'text', text: `ได้รับสลิปของ ${request.entity_code} แล้วครับ กำลังรอตรวจสอบ` }];
  }

  const uploaded = await uploadReceipt(input.messageId, request);
  await dbFetch('payment_receipts', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      payment_request_id: request.id,
      source_provider: 'line',
      source_message_id: input.messageId,
      submitted_by_hash: piiHash(input.rawLineUserId),
      object_path: uploaded.path,
      mime_type: uploaded.mime,
      size_bytes: uploaded.size,
    }),
  });
  await dbFetch(`payment_requests?id=eq.${request.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'proof_submitted',
      submitted_at: new Date().toISOString(),
      rejected_at: null,
    }),
  });
  return [{
    type: 'text',
    text: `✅ ได้รับสลิป ${request.entity_code} แล้วครับ\nยอดที่ระบบรอตรวจ: ${money(request.amount)}\nทองไทยส่งให้ทีมงานตรวจสอบแล้ว และจะแจ้งกลับใน LINE นี้เมื่อยืนยันครับ`,
  }];
}

export async function handleCustomerPaymentText(anonymousId: string, text: string): Promise<PaymentLineMessage[] | null> {
  const clean = text.trim().replace(/\s+/g, ' ');
  const match = clean.match(/^(?:ชำระเงิน|จ่ายเงิน|ขอ\s*qr|ส่ง\s*qr|qr\s*จ่าย|เช็ก(?:สถานะ)?ชำระ|ดูสถานะชำระ)(?:\s+((?:BK|PO|OR)-\d{6}-[A-Z0-9]{8}))?$/iu);
  if (!match) return null;
  const request = match[1] ? await paymentRequestByCode(match[1]) : await latestPaymentForGuest(anonymousId, true);
  if (!request) return [{ type: 'text', text: 'ยังไม่พบรายการชำระเงินครับ ถ้ามีเลขที่รายการส่งมาได้ เช่น BK-… หรือ PO-…' }];
  const guestId = await guestDbId(anonymousId);
  if (!guestId || request.guest_id !== guestId) return [{ type: 'text', text: 'ไม่พบรายการชำระเงินของบัญชี LINE นี้ครับ' }];
  if (request.status === 'quote_required') return [{ type: 'text', text: `รายการ ${request.entity_code} รอทีมงานกำหนดยอดอยู่ครับ ทองไทยจะส่ง QR ให้ทันทีเมื่อยอดพร้อม` }];
  if (request.status === 'awaiting_payment' || request.status === 'rejected') return qrMessages(request);
  if (request.status === 'proof_submitted') return [{ type: 'text', text: `สลิปของ ${request.entity_code} ถูกส่งแล้วครับ กำลังรอทีมงานตรวจสอบ` }];
  if (request.status === 'verified') return [{ type: 'text', text: `✅ ${request.entity_code} ชำระแล้ว ${money(request.amount)} ครับ` }];
  return [{ type: 'text', text: `สถานะชำระ ${request.entity_code}: ${statusLabel(request.status)}` }];
}

export async function handleLinePaymentGroupText(input: {
  targetId: string;
  userId?: string | null;
  text: string;
}): Promise<string | null> {
  const binding = await bindingForTarget(input.targetId);
  if (!binding) return null;
  const clean = input.text.trim().replace(/\s+/g, ' ');

  const easyQuote = clean.match(/^(?:ราคา\s*)?([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:บาท)?(?:\s*(?:รับงาน|ตั้งยอด|จ่าย))?$/iu);
  if (easyQuote) {
    const amount = parseAmount(easyQuote[1]);
    const hasIntentWord = /บาท|รับงาน|ตั้งยอด|ราคา|จ่าย/iu.test(clean);
    if (amount && amount >= 20 && (hasIntentWord || amount >= 50)) {
      const request = await latestQuoteRequiredForTeam(binding);
      if (!request) return null;
      await setPaymentAmount(request, amount);
      return `✅ ตั้งยอด ${request.entity_code} = ${money(amount)} แล้ว\nทองไทยจะส่ง QR PromptPay ช่องทางเดียวให้ลูกค้าอัตโนมัติครับ`;
    }
  }

  const quote = clean.match(/^(?:ตั้งยอด|ยอดชำระ)\s+((?:BK|PO|OR)-\d{6}-[A-Z0-9]{8})\s+([0-9][0-9,]*(?:\.[0-9]{1,2})?)$/iu);
  if (quote) {
    const request = await paymentRequestByCode(quote[1]);
    if (!request) return 'ไม่พบรายการชำระนี้ครับ';
    if (!teamMatches(binding, request)) return 'รายการนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ';
    const amount = parseAmount(quote[2]);
    if (!amount) return 'ยอดชำระไม่ถูกต้องครับ';
    if (request.status === 'verified') return `✅ ${request.entity_code} ชำระแล้ว ${money(request.amount)} ไม่ควรเปลี่ยนยอดครับ`;
    await setPaymentAmount(request, amount);
    return `✅ ตั้งยอด ${request.entity_code} = ${money(amount)} แล้ว\nทองไทยจะส่ง QR PromptPay ช่องทางเดียวให้ลูกค้าอัตโนมัติครับ`;
  }

  const status = clean.match(/^(?:เช็กชำระ|สถานะชำระ|ดูยอด)\s+((?:BK|PO|OR)-\d{6}-[A-Z0-9]{8})$/iu);
  if (status) {
    const request = await paymentRequestByCode(status[1]);
    if (!request) return 'ไม่พบรายการชำระนี้ครับ';
    if (!teamMatches(binding, request)) return 'รายการนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ';
    return `💳 ${request.entity_code}\nยอด: ${money(request.amount)}\nสถานะ: ${statusLabel(request.status)}\nช่องทาง: PromptPay QR เดียว`;
  }

  const resend = clean.match(/^(?:ส่ง\s*qr|ส่งคิวอาร์|ส่งยอด)\s+((?:BK|PO|OR)-\d{6}-[A-Z0-9]{8})$/iu);
  if (resend) {
    const request = await paymentRequestByCode(resend[1]);
    if (!request) return 'ไม่พบรายการชำระนี้ครับ';
    if (!teamMatches(binding, request)) return 'รายการนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ';
    if (!request.amount || request.amount <= 0) return `รายการ ${request.entity_code} ยังไม่ได้กำหนดยอดครับ`;
    const target = await customerLineTarget(request);
    if (!target) return 'ยังติดต่อ LINE ลูกค้ารายนี้ไม่ได้ครับ';
    await linePush(target, qrMessages(request));
    return `✅ ส่ง QR ให้ลูกค้า ${request.entity_code} อีกครั้งแล้วครับ`;
  }

  return null;
}

export async function handleLinePaymentPostback(input: {
  targetId: string;
  userId?: string | null;
  data: string;
}): Promise<PaymentLineMessage[] | null> {
  const params = new URLSearchParams(input.data);
  if (params.get('ops') !== 'payment') return null;
  const action = params.get('action') ?? '';
  const id = params.get('id') ?? '';
  const [binding, request] = await Promise.all([bindingForTarget(input.targetId), paymentRequestById(id)]);
  if (!binding) return [{ type: 'text', text: 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ' }];
  if (!request) return [{ type: 'text', text: 'ไม่พบรายการชำระนี้ครับ' }];
  if (!teamMatches(binding, request)) return [{ type: 'text', text: 'รายการนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ' }];

  if (action === 'quote_prompt') {
    if (request.status === 'verified') return [{ type: 'text', text: `✅ ${request.entity_code} ชำระแล้ว ${money(request.amount)} ครับ` }];
    if (request.status === 'awaiting_payment' || request.status === 'rejected') {
      return [{ type: 'text', text: `รายการ ${request.entity_code} ตั้งยอดไว้แล้ว: ${money(request.amount)}\nถ้าต้องการส่ง QR ใหม่ พิมพ์ “ส่ง QR ${request.entity_code}”` }];
    }
    if (request.status !== 'quote_required') return [{ type: 'text', text: `ตอนนี้ ${request.entity_code} อยู่สถานะ ${statusLabel(request.status)} ครับ` }];
    return [{
      type: 'text',
      text: [
        `เลือก ${request.entity_code} แล้วครับ`,
        'พิมพ์ราคาในกลุ่มนี้ได้เลย เช่น 300 หรือ 300 บาท รับงาน',
        'ทองไทยจะส่ง QR PromptPay ให้ลูกค้าอัตโนมัติหลังตั้งยอด',
      ].join('\n'),
    }];
  }

  if (action === 'verify') {
    if (request.status === 'verified') return [{ type: 'text', text: `✅ ${request.entity_code} ยืนยันชำระแล้วอยู่แล้วครับ` }];
    if (request.status !== 'proof_submitted') return [{ type: 'text', text: `ตอนนี้ ${request.entity_code} อยู่สถานะ ${statusLabel(request.status)} จึงยืนยันสลิปไม่ได้ครับ` }];
    await dbFetch(`payment_requests?id=eq.${request.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'verified',
        verified_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: input.userId ? `staff:${piiHash(input.userId)?.slice(0, 12) ?? 'line'}` : 'staff:line',
      }),
    });
    return [{ type: 'text', text: `✅ รับเงิน ${request.entity_code} แล้ว · ${money(request.amount)}\nทองไทยกำลังแจ้งลูกค้ากลับทาง LINE ครับ` }];
  }

  if (action === 'reject') {
    if (request.status !== 'proof_submitted') return [{ type: 'text', text: `ตอนนี้ ${request.entity_code} อยู่สถานะ ${statusLabel(request.status)} ครับ` }];
    await dbFetch(`payment_requests?id=eq.${request.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        reviewed_at: new Date().toISOString(),
        reviewed_by: input.userId ? `staff:${piiHash(input.userId)?.slice(0, 12) ?? 'line'}` : 'staff:line',
      }),
    });
    return [{ type: 'text', text: `⚠️ ทำเครื่องหมายว่าสลิป ${request.entity_code} ไม่ผ่านแล้ว\nทองไทยจะแจ้งลูกค้าให้ตรวจสอบและส่งใหม่ครับ` }];
  }

  return null;
}
