import { handleBookingOpsCommand } from './_ops-booking-actions';
import { decryptPii, encryptPii, piiHash } from './_operations-db';

export type OpsTeamCode = 'restaurant' | 'stay' | 'activity' | 'cafe' | 'otop' | 'all' | 'owner_general';
export type OpsNotificationEntity = 'booking' | 'cafe_inquiry' | 'otop_order' | 'feedback_event';

type TargetType = 'group' | 'room';

type NotificationChannel = {
  id: string;
  team_code: OpsTeamCode;
  target_type: TargetType | 'user';
  target_id_enc: string;
  display_name: string | null;
  enabled: boolean;
};

type DeliveryRow = {
  id: string;
  status: string;
};

type CustomerRow = {
  full_name_enc: string | null;
  phone_enc: string | null;
  email_enc: string | null;
};

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const BACKOFFICE_URL = 'https://tamma-backoffice.netlify.app/';
const BANGKOK_OFFSET = '+07:00';

const TEAM_LABELS: Record<OpsTeamCode, string> = {
  restaurant: 'ตำมา-ชาติ / ร้านอาหาร',
  stay: 'ทำมา-ชาติ เฮือนสเตย์',
  activity: 'ทำมา-ชาติ ผจญภัย',
  cafe: 'Inthanin Café',
  otop: 'OTOP / สินค้าชุมชน',
  all: 'ทุกทีม',
  owner_general: 'เจ้าของ/ทั่วไป',
};

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
    throw new Error(`Ops notification DB request failed ${response.status}: ${body.slice(0, 260)}`);
  }
  return response;
}

function cleanText(value: unknown, max = 300): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

function thaiDateTime(value: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function thaiTime(value: string): string {
  try {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function localDateParts(date = new Date()): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find(part => part.type === type)?.value ?? 0);
  return { year: pick('year'), month: pick('month'), day: pick('day') };
}

function isoLocalDate(date = new Date(), addDays = 0): string {
  const base = localDateParts(date);
  const cursor = new Date(Date.UTC(base.year, base.month - 1, base.day + addDays));
  const year = cursor.getUTCFullYear();
  const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
  const day = String(cursor.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function nextIsoDate(localDate: string): string {
  const [year, month, day] = localDate.split('-').map(Number);
  const cursor = new Date(Date.UTC(year, month - 1, day + 1));
  return `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-${String(cursor.getUTCDate()).padStart(2, '0')}`;
}

function dayBounds(localDate: string): { start: string; end: string } {
  return {
    start: new Date(`${localDate}T00:00:00${BANGKOK_OFFSET}`).toISOString(),
    end: new Date(`${nextIsoDate(localDate)}T00:00:00${BANGKOK_OFFSET}`).toISOString(),
  };
}

function parseTeamCode(raw: string): OpsTeamCode | null {
  const value = raw.trim().toLowerCase().replace(/[\s_-]+/g, ' ');
  const aliases: Array<[RegExp, OpsTeamCode]> = [
    [/^(restaurant|ร้านอาหาร|ตำมา ?ชาติ|ตํา​มา ?ชาติ)$/u, 'restaurant'],
    [/^(stay|ที่พัก|เฮือนสเตย์|เฮือนเสตย์|homestay)$/u, 'stay'],
    [/^(activity|กิจกรรม|ผจญภัย|adventure)$/u, 'activity'],
    [/^(cafe|café|คาเฟ่|กาแฟ|inthanin|อินทนิน)$/u, 'cafe'],
    [/^(otop|โอทอป|สินค้า|สินค้าชุมชน)$/u, 'otop'],
    [/^(all|ทั้งหมด|ทุกทีม)$/u, 'all'],
    // Owner/general/admin -- a real, dedicated LINE group for system
    // feedback, unknown-business-unit feedback, and the urgent-safety
    // escalation (see notifyFeedbackEvent below). Deliberately a
    // DIFFERENT team code than 'all' (which stays reserved for its
    // existing, narrower meaning elsewhere) -- 'all' remains unbindable
    // via this command (checked below), but 'owner_general' is a real,
    // bindable team like restaurant/stay/activity/cafe/otop.
    [/^(owner|general|admin|เจ้าของ|ทั่วไป|แอดมิน|ผู้ดูแล)$/u, 'owner_general'],
  ];
  return aliases.find(([pattern]) => pattern.test(value))?.[1] ?? null;
}

// Rebinding a team's LINE group reroutes ALL future notifications for
// that team, so it's the one command in this file worth gating -- unlike
// every other ops-group command here, whose only real access boundary is
// "you're physically in the group the bot was added to."
//
// OPT-IN by design: if LINE_OPS_ADMIN_USER_IDS is unset, every sender is
// authorized, exactly matching this codebase's existing behavior (group
// membership as the access boundary) -- so deploying this fix never locks
// an owner out of a bind command they haven't configured an allowlist
// for yet. Once set (comma-separated LINE userIds), only those senders
// may rebind a team.
function isAuthorizedForTeamBind(userId: string | null): boolean {
  const allowlist = (process.env.LINE_OPS_ADMIN_USER_IDS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (allowlist.length === 0) return true;
  return typeof userId === 'string' && allowlist.includes(userId);
}

/** Redacted group/room id for LINE_GROUP_BIND_ATTEMPT logging -- never the
 *  full LINE target id. */
function redactBindTargetId(value: string | null | undefined): string {
  if (!value) return 'none';
  return value.length <= 6 ? `${value.slice(0, 2)}…` : `${value.slice(0, 6)}…(len:${value.length})`;
}

async function currentBindingForTarget(targetId: string): Promise<NotificationChannel | null> {
  const hash = piiHash(targetId);
  if (!hash) return null;
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true`
    + '&select=id,team_code,target_type,target_id_enc,display_name,enabled&limit=1',
  );
  const rows = await response.json() as NotificationChannel[];
  return rows[0] ?? null;
}

export async function bindLineTeamChannel(input: {
  teamCode: OpsTeamCode;
  targetType: TargetType;
  targetId: string;
  createdByUserId?: string | null;
}): Promise<void> {
  const targetHash = piiHash(input.targetId);
  const targetEncrypted = encryptPii(input.targetId);
  if (!targetHash || !targetEncrypted) throw new Error('LINE target id is invalid');

  const existingByTarget = await currentBindingForTarget(input.targetId);
  const now = new Date().toISOString();
  // service_type's own CHECK constraint only allows the five real business
  // unit codes (or NULL) -- 'all' and 'owner_general' are both pseudo-teams
  // with no corresponding service_type row, so both map to NULL here rather
  // than widening that constraint to accept values it was never meant to
  // describe. team_code is the column with an owner_general-specific
  // migration (see supabase/migrations); service_type deliberately stays
  // untouched.
  const NON_SERVICE_TEAM_CODES: OpsTeamCode[] = ['all', 'owner_general'];
  const payload = {
    team_code: input.teamCode,
    service_type: NON_SERVICE_TEAM_CODES.includes(input.teamCode) ? null : input.teamCode,
    provider: 'line',
    target_type: input.targetType,
    target_id_enc: targetEncrypted,
    target_id_hash: targetHash,
    display_name: TEAM_LABELS[input.teamCode],
    enabled: true,
    created_by_provider: input.createdByUserId ? 'line' : null,
    created_by_hash: input.createdByUserId ? piiHash(input.createdByUserId) : null,
    last_bound_at: now,
    updated_at: now,
  };

  if (existingByTarget) {
    await dbFetch(
      `ops_notification_channels?team_code=eq.${encodeURIComponent(input.teamCode)}`
      + `&provider=eq.line&id=neq.${existingByTarget.id}`,
      { method: 'DELETE', headers: { Prefer: 'return=minimal' } },
    );
    await dbFetch(`ops_notification_channels?id=eq.${existingByTarget.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(payload),
    });
    return;
  }

  await dbFetch('ops_notification_channels?on_conflict=team_code,provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(payload),
  });
}

async function channelForTeam(teamCode: OpsTeamCode): Promise<NotificationChannel | null> {
  const response = await dbFetch(
    `ops_notification_channels?team_code=eq.${encodeURIComponent(teamCode)}&provider=eq.line&enabled=eq.true`
    + '&select=id,team_code,target_type,target_id_enc,display_name,enabled&limit=1',
  );
  const rows = await response.json() as NotificationChannel[];
  return rows[0] ?? null;
}

async function linePush(targetId: string, text: string): Promise<void> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ to: targetId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`LINE push failed ${response.status}: ${body.slice(0, 260)}`);
  }
}

async function customerInfo(customerId: string | null): Promise<{ name: string; phone: string; email: string }> {
  if (!customerId) return { name: '', phone: '', email: '' };
  const response = await dbFetch(
    `customer_accounts?id=eq.${customerId}&select=full_name_enc,phone_enc,email_enc&limit=1`,
  );
  const row = (await response.json() as CustomerRow[])[0];
  return {
    name: decryptPii(row?.full_name_enc) ?? '',
    phone: decryptPii(row?.phone_enc) ?? '',
    email: decryptPii(row?.email_enc) ?? '',
  };
}

async function beginDelivery(input: {
  channel: NotificationChannel;
  entityType: OpsNotificationEntity | 'daily_schedule';
  entityId?: string | null;
  bookingId?: string | null;
  deliveryType: string;
  idempotencyKey: string;
  payload?: Record<string, unknown>;
}): Promise<{ id: string; shouldSend: boolean }> {
  const insertResponse = await dbFetch('ops_notification_deliveries?on_conflict=idempotency_key', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      channel_id: input.channel.id,
      booking_id: input.bookingId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      idempotency_key: input.idempotencyKey,
      delivery_type: input.deliveryType,
      provider: 'line',
      status: 'pending',
      payload: input.payload ?? {},
    }),
  });
  const inserted = (await insertResponse.json() as DeliveryRow[])[0];
  if (inserted?.id) return { id: inserted.id, shouldSend: true };

  const lookup = await dbFetch(
    `ops_notification_deliveries?idempotency_key=eq.${encodeURIComponent(input.idempotencyKey)}`
    + '&select=id,status&limit=1',
  );
  const existing = (await lookup.json() as DeliveryRow[])[0];
  if (!existing) throw new Error('Notification delivery idempotency lookup failed');
  if (existing.status === 'sent' || existing.status === 'pending') {
    return { id: existing.id, shouldSend: false };
  }

  await dbFetch(`ops_notification_deliveries?id=eq.${existing.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      channel_id: input.channel.id,
      booking_id: input.bookingId ?? null,
      entity_type: input.entityType,
      entity_id: input.entityId ?? null,
      delivery_type: input.deliveryType,
      status: 'pending',
      error_message: null,
      payload: input.payload ?? {},
    }),
  });
  return { id: existing.id, shouldSend: true };
}

async function finishDelivery(deliveryId: string, error?: unknown): Promise<void> {
  const failed = Boolean(error);
  await dbFetch(`ops_notification_deliveries?id=eq.${deliveryId}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: failed ? 'failed' : 'sent',
      error_message: failed
        ? (error instanceof Error ? error.message.slice(0, 500) : 'Unknown notification error')
        : null,
    }),
  });
}

async function sendTeamMessage(input: {
  teamCode: OpsTeamCode;
  entityType: OpsNotificationEntity | 'daily_schedule';
  entityId?: string | null;
  bookingId?: string | null;
  deliveryType: string;
  idempotencyKey: string;
  text: string;
  payload?: Record<string, unknown>;
}): Promise<'sent' | 'duplicate' | 'not_bound'> {
  const channel = await channelForTeam(input.teamCode);
  if (!channel) return 'not_bound';
  const targetId = decryptPii(channel.target_id_enc);
  if (!targetId) throw new Error(`LINE target for ${input.teamCode} cannot be decrypted`);

  const delivery = await beginDelivery({
    channel,
    entityType: input.entityType,
    entityId: input.entityId,
    bookingId: input.bookingId,
    deliveryType: input.deliveryType,
    idempotencyKey: input.idempotencyKey,
    payload: input.payload,
  });
  if (!delivery.shouldSend) return 'duplicate';
  try {
    await linePush(targetId, input.text);
    await finishDelivery(delivery.id);
    return 'sent';
  } catch (error) {
    await finishDelivery(delivery.id, error).catch(() => undefined);
    throw error;
  }
}

async function notifyBooking(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const response = await dbFetch(
    `bookings?id=eq.${id}`
    + '&select=id,booking_code,customer_id,service_type,resource_id,start_at,end_at,party_size,quantity,status,source_channel,customer_note,environment&limit=1',
  );
  const booking = (await response.json() as Array<{
    id: string; booking_code: string; customer_id: string | null; service_type: string; resource_id: string;
    start_at: string; end_at: string; party_size: number | null; quantity: number; status: string;
    source_channel: string; customer_note: string | null; environment: string;
  }>)[0];
  if (!booking || !['live', 'test'].includes(booking.environment)) return 'ignored';
  const environmentPrefix = booking.environment === 'test' ? '🧪 TEST — ' : '';
  if (!['restaurant', 'stay', 'activity'].includes(booking.service_type)) return 'ignored';
  const teamCode = booking.service_type as OpsTeamCode;

  const [resourceResponse, customer] = await Promise.all([
    dbFetch(`service_resources?id=eq.${booking.resource_id}&select=code,name&limit=1`),
    customerInfo(booking.customer_id),
  ]);
  const resource = (await resourceResponse.json() as Array<{ code: string; name: string }>)[0];
  const amount = teamCode === 'stay'
    ? `${booking.quantity || 1} หลัง${booking.party_size ? ` / ${booking.party_size} คน` : ''}`
    : `${booking.party_size ?? booking.quantity ?? 1} คน`;
  const lines = [
    `${environmentPrefix}🔔 งานใหม่ — ${TEAM_LABELS[teamCode]}`,
    `เลขที่: ${booking.booking_code}`,
    'สถานะ: รอทีมงานยืนยัน',
    customer.name ? `ลูกค้า: ${customer.name}` : '',
    customer.phone ? `โทร: ${customer.phone}` : (customer.email ? `อีเมล: ${customer.email}` : ''),
    `วันเวลา: ${thaiDateTime(booking.start_at)}${booking.end_at ? ` → ${thaiDateTime(booking.end_at)}` : ''}`,
    `จำนวน: ${amount}`,
    resource?.name ? `รายการ/ทรัพยากร: ${resource.name}` : '',
    `ช่องทาง: ${booking.source_channel.toUpperCase()}`,
    booking.customer_note ? `หมายเหตุ: ${cleanText(booking.customer_note, 500)}` : '',
    `หลังบ้าน: ${BACKOFFICE_URL}`,
  ].filter(Boolean);

  return sendTeamMessage({
    teamCode,
    entityType: 'booking',
    entityId: booking.id,
    bookingId: booking.id,
    deliveryType: 'booking_created',
    idempotencyKey: `booking_created:${booking.id}:${teamCode}`,
    text: lines.join('\n'),
    payload: { booking_code: booking.booking_code, source_channel: booking.source_channel },
  });
}

async function notifyCafeInquiry(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const response = await dbFetch(
    `cafe_inquiries?id=eq.${id}`
    + '&select=id,inquiry_code,customer_id,question,status,source_channel,environment&limit=1',
  );
  const inquiry = (await response.json() as Array<{
    id: string; inquiry_code: string; customer_id: string | null; question: string; status: string;
    source_channel: string; environment: string;
  }>)[0];
  if (!inquiry || !['live', 'test'].includes(inquiry.environment)) return 'ignored';
  const environmentPrefix = inquiry.environment === 'test' ? '🧪 TEST — ' : '';
  const customer = await customerInfo(inquiry.customer_id);
  const lines = [
    `${environmentPrefix}☕ งานใหม่ — ${TEAM_LABELS.cafe}`,
    `เลขที่: ${inquiry.inquiry_code}`,
    `สถานะ: ${inquiry.status}`,
    customer.name ? `ลูกค้า: ${customer.name}` : '',
    customer.phone ? `โทร: ${customer.phone}` : (customer.email ? `อีเมล: ${customer.email}` : ''),
    `เรื่อง: ${cleanText(inquiry.question, 900)}`,
    `ช่องทาง: ${inquiry.source_channel.toUpperCase()}`,
    `หลังบ้าน: ${BACKOFFICE_URL}`,
  ].filter(Boolean);
  return sendTeamMessage({
    teamCode: 'cafe',
    entityType: 'cafe_inquiry',
    entityId: inquiry.id,
    deliveryType: 'cafe_inquiry_created',
    idempotencyKey: `cafe_inquiry_created:${inquiry.id}`,
    text: lines.join('\n'),
    payload: { inquiry_code: inquiry.inquiry_code, source_channel: inquiry.source_channel },
  });
}

async function notifyOtopOrder(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const orderResponse = await dbFetch(
    `otop_orders?id=eq.${id}`
    + '&select=id,order_code,customer_id,status,source_channel,fulfillment_type,customer_note,total_amount,environment&limit=1',
  );
  const order = (await orderResponse.json() as Array<{
    id: string; order_code: string; customer_id: string | null; status: string; source_channel: string;
    fulfillment_type: string; customer_note: string | null; total_amount: number | string; environment: string;
  }>)[0];
  if (!order || !['live', 'test'].includes(order.environment)) return 'ignored';
  const environmentPrefix = order.environment === 'test' ? '🧪 TEST — ' : '';
  const [customer, itemsResponse] = await Promise.all([
    customerInfo(order.customer_id),
    dbFetch(`otop_order_items?order_id=eq.${order.id}&select=product_id,quantity,unit_price,line_total`),
  ]);
  const items = await itemsResponse.json() as Array<{
    product_id: string; quantity: number; unit_price: number | string; line_total: number | string;
  }>;
  const productIds = [...new Set(items.map(item => item.product_id))];
  const products = new Map<string, string>();
  for (const productId of productIds) {
    const productResponse = await dbFetch(`otop_products?id=eq.${productId}&select=id,name&limit=1`);
    const product = (await productResponse.json() as Array<{ id: string; name: string }>)[0];
    if (product) products.set(product.id, product.name);
  }
  const itemText = items.length
    ? items.map(item => `${products.get(item.product_id) ?? 'สินค้า'} × ${item.quantity}`).join(', ')
    : 'ดูรายละเอียดในหลังบ้าน';
  const total = Number(order.total_amount || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const lines = [
    `${environmentPrefix}🛍️ ออเดอร์ใหม่ — ${TEAM_LABELS.otop}`,
    `เลขที่: ${order.order_code}`,
    `สถานะ: ${order.status}`,
    customer.name ? `ลูกค้า: ${customer.name}` : '',
    customer.phone ? `โทร: ${customer.phone}` : (customer.email ? `อีเมล: ${customer.email}` : ''),
    `รายการ: ${itemText}`,
    `ยอดรวม: ${total} บาท`,
    `รับสินค้า: ${order.fulfillment_type === 'shipping' ? 'จัดส่ง' : 'รับที่ร้าน'}`,
    `ช่องทาง: ${order.source_channel.toUpperCase()}`,
    order.customer_note ? `หมายเหตุ: ${cleanText(order.customer_note, 500)}` : '',
    `หลังบ้าน: ${BACKOFFICE_URL}`,
  ].filter(Boolean);
  return sendTeamMessage({
    teamCode: 'otop',
    entityType: 'otop_order',
    entityId: order.id,
    deliveryType: 'otop_order_created',
    idempotencyKey: `otop_order_created:${order.id}`,
    text: lines.join('\n'),
    payload: { order_code: order.order_code, source_channel: order.source_channel },
  });
}

// Service Mind feedback events (compliment/complaint/suggestion/
// safety_issue/system_feedback -- see _service-mind-feedback-events.ts,
// which writes ops_feedback_events and then calls this). business_unit
// values that don't map to a real bound team (membership/system/general/
// unknown) route to the dedicated 'owner_general' team -- a real,
// individually bindable LINE group (see parseTeamCode above), not the
// 'all' pseudo-team. As of this write, 'owner_general' has NOT been
// bound yet (see THONGTHAI_HANDOFF.md's Feedback Operations Phase 1
// entry) -- sendTeamMessage below honestly returns 'not_bound' until an
// owner runs "ผูกทีม เจ้าของ" (or one of its aliases) in the real group.
const FEEDBACK_BUSINESS_UNIT_TEAM: Record<string, OpsTeamCode> = {
  restaurant: 'restaurant', activity: 'activity', stay: 'stay', cafe: 'cafe',
  membership: 'owner_general', system: 'owner_general', general: 'owner_general', unknown: 'owner_general',
};
const FEEDBACK_TYPE_LABEL: Record<string, string> = {
  compliment: '💛 คำชม', complaint: '⚠️ ข้อร้องเรียน', suggestion: '💡 ข้อเสนอแนะ',
  safety_issue: '🚨 เรื่องความปลอดภัย', system_feedback: '💬 ฟีดแบ็กเรื่องทองไทย',
};
const FEEDBACK_SEVERITY_LABEL: Record<string, string> = {
  low: 'ทั่วไป', normal: 'ปกติ', high: 'ต้องดูแลเร็ว', urgent: 'ด่วนมาก',
};

function feedbackMessageBody(event: {
  id: string; feedback_type: string; business_unit: string; severity: string; summary: string;
  customer_message: string; staff_name: string | null; channel: string; environment: string;
}, teamCode: OpsTeamCode): string {
  const environmentPrefix = event.environment === 'test' ? '🧪 TEST — ' : '';
  return [
    `${environmentPrefix}${FEEDBACK_TYPE_LABEL[event.feedback_type] ?? 'ฟีดแบ็กลูกค้า'} — ${TEAM_LABELS[teamCode]}`,
    `ความรุนแรง: ${FEEDBACK_SEVERITY_LABEL[event.severity] ?? event.severity}`,
    `สรุป: ${cleanText(event.summary, 500)}`,
    `ข้อความเดิม: "${cleanText(event.customer_message, 500)}"`,
    event.staff_name ? `พนักงานที่กล่าวถึง: ${event.staff_name}` : '',
    `ช่องทาง: ${event.channel.toUpperCase()}`,
    `รหัสเรื่อง: ${event.id}`,
    `หลังบ้าน: ${BACKOFFICE_URL}customer-voice.html?event=${event.id}`,
  ].filter(Boolean).join('\n');
}

// Urgent safety issues, and any feedback whose business unit doesn't map
// to a real team, additionally reach the 'owner_general' group -- same
// "don't over-notify" discipline the task's routing rules call for: every
// OTHER severity/business-unit combination goes to exactly one group,
// never a broadcast.
async function notifyFeedbackEvent(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const response = await dbFetch(
    `ops_feedback_events?id=eq.${id}`
    + '&select=id,feedback_type,business_unit,severity,summary,customer_message,staff_name,channel,environment&limit=1',
  );
  const rows = await response.json() as Array<{
    id: string; feedback_type: string; business_unit: string; severity: string; summary: string;
    customer_message: string; staff_name: string | null; channel: string; environment: string;
  }>;
  const event = rows[0];
  if (!event || !['live', 'test'].includes(event.environment)) return 'ignored';
  const primaryTeam = FEEDBACK_BUSINESS_UNIT_TEAM[event.business_unit] ?? 'all';

  const primaryStatus = await sendTeamMessage({
    teamCode: primaryTeam,
    entityType: 'feedback_event',
    entityId: event.id,
    deliveryType: `feedback_${event.feedback_type}`,
    idempotencyKey: `feedback_event_created:${event.id}`,
    text: feedbackMessageBody(event, primaryTeam),
    payload: { feedback_type: event.feedback_type, business_unit: event.business_unit },
  });

  if (event.severity === 'urgent' && primaryTeam !== 'owner_general') {
    try {
      const escalationStatus = await sendTeamMessage({
        teamCode: 'owner_general',
        entityType: 'feedback_event',
        entityId: event.id,
        deliveryType: `feedback_${event.feedback_type}_owner_escalation`,
        idempotencyKey: `feedback_event_created_owner:${event.id}`,
        text: feedbackMessageBody(event, 'owner_general'),
        payload: { feedback_type: event.feedback_type, business_unit: event.business_unit, escalation: true },
      });
      // The primary send above already decided notification_status --
      // never let the escalation's own outcome overwrite that honest
      // value. When the escalation itself didn't actually send (no
      // owner/general group bound yet), record that fact in
      // notification_error so the dashboard can show it, without ever
      // claiming the escalation succeeded when it didn't.
      if (escalationStatus === 'not_bound') {
        await dbFetch(`ops_feedback_events?id=eq.${event.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ notification_error: 'owner_general escalation: not_bound' }),
        }).catch(() => undefined);
      }
    } catch (escalationError) {
      console.error('THONGTHAI_FEEDBACK_OWNER_ESCALATION_ERROR', escalationError instanceof Error ? escalationError.message.slice(0, 220) : 'unknown');
      await dbFetch(`ops_feedback_events?id=eq.${event.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          notification_error: `owner_general escalation failed: ${escalationError instanceof Error ? escalationError.message.slice(0, 180) : 'unknown'}`,
        }),
      }).catch(() => undefined);
    }
  }

  return primaryStatus;
}

export async function dispatchEntityNotification(
  entity: OpsNotificationEntity,
  id: string,
): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  if (entity === 'booking') return notifyBooking(id);
  if (entity === 'cafe_inquiry') return notifyCafeInquiry(id);
  if (entity === 'feedback_event') return notifyFeedbackEvent(id);
  return notifyOtopOrder(id);
}

async function scheduleSummaryForBookingTeam(teamCode: 'restaurant' | 'stay' | 'activity', localDate: string): Promise<string> {
  const bounds = dayBounds(localDate);
  const response = await dbFetch(
    `bookings?service_type=eq.${teamCode}&environment=eq.live&status=neq.cancelled`
    + `&start_at=lt.${encodeURIComponent(bounds.end)}&end_at=gt.${encodeURIComponent(bounds.start)}`
    + '&select=booking_code,resource_id,start_at,end_at,party_size,quantity,status&order=start_at.asc&limit=100',
  );
  const rows = await response.json() as Array<{
    booking_code: string; resource_id: string; start_at: string; end_at: string;
    party_size: number | null; quantity: number; status: string;
  }>;
  if (!rows.length) return 'ยังไม่มีงานในตาราง';
  const resourceNames = new Map<string, string>();
  for (const resourceId of [...new Set(rows.map(row => row.resource_id))]) {
    const resourceResponse = await dbFetch(`service_resources?id=eq.${resourceId}&select=id,name&limit=1`);
    const resource = (await resourceResponse.json() as Array<{ id: string; name: string }>)[0];
    if (resource) resourceNames.set(resource.id, resource.name);
  }
  return rows.map(row => {
    const count = teamCode === 'stay' ? `${row.quantity || 1} หลัง` : `${row.party_size ?? row.quantity ?? 1} คน`;
    return `${thaiTime(row.start_at)}  ${row.booking_code}  ${count}${resourceNames.get(row.resource_id) ? ` — ${resourceNames.get(row.resource_id)}` : ''}`;
  }).join('\n');
}

async function scheduleSummaryForCafe(localDate: string): Promise<string> {
  const bounds = dayBounds(localDate);
  const response = await dbFetch(
    `cafe_inquiries?environment=eq.live&status=eq.open&created_at=lt.${encodeURIComponent(bounds.end)}`
    + '&select=inquiry_code,question,created_at&order=created_at.asc&limit=100',
  );
  const rows = await response.json() as Array<{ inquiry_code: string; question: string; created_at: string }>;
  if (!rows.length) return 'ไม่มีรายการค้างที่ต้องติดตาม';
  return rows.map(row => `${thaiTime(row.created_at)}  ${row.inquiry_code} — ${cleanText(row.question, 90)}`).join('\n');
}

async function scheduleSummaryForOtop(localDate: string): Promise<string> {
  const bounds = dayBounds(localDate);
  const response = await dbFetch(
    `otop_orders?environment=eq.live&status=in.(requested,confirmed,preparing)&created_at=lt.${encodeURIComponent(bounds.end)}`
    + '&select=order_code,status,total_amount,created_at&order=created_at.asc&limit=100',
  );
  const rows = await response.json() as Array<{
    order_code: string; status: string; total_amount: number | string; created_at: string;
  }>;
  if (!rows.length) return 'ไม่มีออเดอร์ค้างที่ต้องจัดการ';
  return rows.map(row => `${thaiTime(row.created_at)}  ${row.order_code}  ${row.status}  ${Number(row.total_amount || 0).toLocaleString('th-TH')} บาท`).join('\n');
}

async function teamSummaryBody(teamCode: OpsTeamCode, localDate: string): Promise<string> {
  if (teamCode === 'restaurant' || teamCode === 'stay' || teamCode === 'activity') {
    return scheduleSummaryForBookingTeam(teamCode, localDate);
  }
  if (teamCode === 'cafe') return scheduleSummaryForCafe(localDate);
  if (teamCode === 'otop') return scheduleSummaryForOtop(localDate);

  const sections: string[] = [];
  for (const team of ['restaurant', 'stay', 'activity', 'cafe', 'otop'] as const) {
    sections.push(`${TEAM_LABELS[team]}\n${await teamSummaryBody(team, localDate)}`);
  }
  return sections.join('\n\n');
}

export async function buildTeamScheduleSummary(teamCode: OpsTeamCode, localDate: string): Promise<string> {
  const dateLabel = new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'long', year: 'numeric',
  }).format(new Date(`${localDate}T12:00:00${BANGKOK_OFFSET}`));
  const body = await teamSummaryBody(teamCode, localDate);
  return [
    `📋 ตารางงาน — ${TEAM_LABELS[teamCode]}`,
    dateLabel,
    '',
    body,
    '',
    `หลังบ้าน: ${BACKOFFICE_URL}`,
  ].join('\n');
}

export async function sendDailyOpsSummaries(localDate = isoLocalDate()): Promise<Array<{ team: OpsTeamCode; status: string }>> {
  const response = await dbFetch(
    'ops_notification_channels?provider=eq.line&enabled=eq.true&select=id,team_code,target_type,target_id_enc,display_name,enabled&order=team_code.asc',
  );
  const channels = await response.json() as NotificationChannel[];
  const results: Array<{ team: OpsTeamCode; status: string }> = [];
  for (const channel of channels) {
    const teamCode = channel.team_code;
    const text = await buildTeamScheduleSummary(teamCode, localDate);
    const status = await sendTeamMessage({
      teamCode,
      entityType: 'daily_schedule',
      deliveryType: 'daily_schedule',
      idempotencyKey: `daily_schedule:${localDate}:${teamCode}`,
      text,
      payload: { local_date: localDate },
    });
    results.push({ team: teamCode, status });
  }
  return results;
}


async function customerLineTarget(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const response = await dbFetch(
    `customer_channel_contacts?customer_id=eq.${customerId}&provider=eq.line&reachable=eq.true&verified=eq.true`
    + '&select=external_id_enc&order=last_seen_at.desc&limit=1',
  );
  const row = (await response.json() as Array<{ external_id_enc: string }>)[0];
  return decryptPii(row?.external_id_enc) ?? null;
}

async function confirmBookingFromOpsGroup(input: {
  binding: NotificationChannel;
  bookingCode: string;
  userId?: string | null;
}): Promise<string> {
  const response = await dbFetch(
    `bookings?booking_code=eq.${encodeURIComponent(input.bookingCode)}`
    + '&select=id,booking_code,customer_id,service_type,resource_id,start_at,end_at,party_size,quantity,status,staff_note,environment&limit=1',
  );
  const booking = (await response.json() as Array<{
    id: string; booking_code: string; customer_id: string | null; service_type: string; resource_id: string;
    start_at: string; end_at: string; party_size: number | null; quantity: number; status: string;
    staff_note: string | null; environment: string;
  }>)[0];
  if (!booking) return `ไม่พบเลขที่ ${input.bookingCode} ครับ`;
  if (input.binding.team_code === 'all' || booking.service_type !== input.binding.team_code) {
    return `รายการ ${booking.booking_code} เป็นงานทีม ${booking.service_type} ไม่ใช่กลุ่ม ${TEAM_LABELS[input.binding.team_code]} ครับ`;
  }
  if (booking.status === 'confirmed') return `✅ ${booking.booking_code} ยืนยันแล้วอยู่แล้วครับ`;
  if (booking.status !== 'requested') return `รายการ ${booking.booking_code} อยู่สถานะ ${booking.status} จึงยืนยันไม่ได้ครับ`;

  const actorHash = input.userId ? piiHash(input.userId)?.slice(0, 12) : null;
  const auditLine = `ยืนยันผ่าน LINE กลุ่ม ${TEAM_LABELS[input.binding.team_code]}${actorHash ? ` · staff:${actorHash}` : ''} · ${new Date().toISOString()}`;
  const staffNote = [booking.staff_note?.trim(), auditLine].filter(Boolean).join('\n').slice(0, 4000);
  await dbFetch(`bookings?id=eq.${booking.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ status: 'confirmed', contact_status: 'pending', staff_note: staffNote, updated_at: new Date().toISOString() }),
  });

  const resourceResponse = await dbFetch(`service_resources?id=eq.${booking.resource_id}&select=name&limit=1`);
  const resource = (await resourceResponse.json() as Array<{ name: string }>)[0];
  const amount = booking.service_type === 'stay'
    ? `${booking.quantity || 1} หลัง${booking.party_size ? ` / ${booking.party_size} คน` : ''}`
    : `${booking.party_size ?? booking.quantity ?? 1} คน`;
  const prefix = booking.environment === 'test' ? '🧪 TEST — ' : '';
  const customerText = [
    `${prefix}✅ ทองไทยยืนยันการจองแล้วครับ`,
    `เลขที่: ${booking.booking_code}`,
    `รายการ: ${resource?.name ?? booking.service_type}`,
    `วันเวลา: ${thaiDateTime(booking.start_at)} → ${thaiDateTime(booking.end_at)}`,
    `จำนวน: ${amount}`,
    'สถานะ: ยืนยันแล้ว',
    '',
    'ทีมงานรับรายการเรียบร้อยแล้วครับ หากต้องการแก้ไข สามารถตอบกลับทาง LINE นี้ได้เลย',
  ].join('\n');

  const target = await customerLineTarget(booking.customer_id);
  if (!target) {
    return `⚠️ ยืนยัน ${booking.booking_code} แล้ว แต่ไม่พบ LINE ลูกค้าที่ติดต่อได้ กรุณาติดต่อจากข้อมูลหลังบ้านครับ`;
  }
  try {
    await linePush(target, customerText);
    await dbFetch(`bookings?id=eq.${booking.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ contact_status: 'contacted', updated_at: new Date().toISOString() }),
    });
    return `✅ ยืนยัน ${booking.booking_code} แล้ว\nทองไทยแจ้งลูกค้ากลับทาง LINE สำเร็จครับ`;
  } catch {
    return `⚠️ ยืนยัน ${booking.booking_code} แล้ว แต่ส่ง LINE หาลูกค้าไม่สำเร็จ กรุณาติดต่อจากหลังบ้านครับ`;
  }
}

export async function handleLineOpsGroupMessage(input: {
  targetType: TargetType;
  targetId: string;
  userId?: string | null;
  text: string;
}): Promise<string | null> {
  const text = input.text.trim();
  const bookingAction = await handleBookingOpsCommand({
    targetId: input.targetId,
    userId: input.userId,
    text,
  });
  if (bookingAction.handled) return bookingAction.reply;
  const confirmMatch = text.match(/^ยืนยัน\s+(BK-\d{6}-[A-Z0-9]{8})$/iu);
  if (confirmMatch) {
    const binding = await currentBindingForTarget(input.targetId);
    if (!binding) return 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ';
    return confirmBookingFromOpsGroup({ binding, bookingCode: confirmMatch[1].toUpperCase(), userId: input.userId });
  }

  const bindMatch = text.match(/^ผูกทีม\s+(.+)$/iu);
  if (bindMatch) {
    const rawTeamCode = bindMatch[1];
    const teamCode = parseTeamCode(rawTeamCode);
    const logBindAttempt = (authorized: boolean, result: string) => {
      console.log('LINE_GROUP_BIND_ATTEMPT', JSON.stringify({
        teamCodeRaw: rawTeamCode.slice(0, 40),
        teamCodeParsed: teamCode ?? null,
        targetId: redactBindTargetId(input.targetId),
        authorized,
        result,
      }));
    };

    if (!isAuthorizedForTeamBind(input.userId ?? null)) {
      logBindAttempt(false, 'not_authorized');
      return 'คำสั่งนี้ใช้ได้เฉพาะผู้ดูแลระบบครับ';
    }
    if (!teamCode || teamCode === 'all') {
      logBindAttempt(true, 'invalid_team');
      return 'ยังไม่รู้จักชื่อนี้ครับ ใช้: restaurant / stay / activity / cafe / otop / เจ้าของ (owner)';
    }
    try {
      await bindLineTeamChannel({
        teamCode,
        targetType: input.targetType,
        targetId: input.targetId,
        createdByUserId: input.userId,
      });
    } catch (error) {
      logBindAttempt(true, 'db_error');
      // A bind command must NEVER go silent, including on a DB-side
      // failure (e.g. a CHECK constraint rejecting a team code the schema
      // hasn't been migrated for yet) -- rethrowing here left the group
      // with zero reply while LINE_OPS_GROUP_ERROR logged the real cause
      // invisibly. Reply with an honest, specific error instead of a
      // generic one so a schema mismatch is distinguishable in the group
      // itself, not just in logs.
      console.error('LINE_GROUP_BIND_DB_ERROR', error instanceof Error ? error.message.slice(0, 220) : 'unknown');
      return 'ผูกทีมไม่สำเร็จครับ ระบบฐานข้อมูลยังไม่รองรับทีมนี้ ทีมงานกำลังแก้ไขครับ ลองใหม่อีกครั้งในภายหลัง';
    }
    logBindAttempt(true, 'success');
    return `✅ ผูกกลุ่มนี้กับทีม ${TEAM_LABELS[teamCode]} แล้วครับ\nจากนี้งานใหม่และสรุปตารางงานของทีมนี้จะส่งเข้ากลุ่มนี้`;
  }

  if (/^(ทีมอะไร|เช็กทีม|เช็คทีม|สถานะทีม)$/u.test(text)) {
    const binding = await currentBindingForTarget(input.targetId);
    return binding
      ? `✅ กลุ่มนี้เชื่อมกับทีม ${TEAM_LABELS[binding.team_code]} อยู่ครับ`
      : 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ พิมพ์ เช่น “ผูกทีม activity”';
  }

  const scheduleMatch = text.match(/^ตาราง(วันนี้|พรุ่งนี้)$/u);
  if (scheduleMatch) {
    const binding = await currentBindingForTarget(input.targetId);
    if (!binding) return 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ พิมพ์ เช่น “ผูกทีม activity” ก่อน';
    const localDate = isoLocalDate(new Date(), scheduleMatch[1] === 'พรุ่งนี้' ? 1 : 0);
    return buildTeamScheduleSummary(binding.team_code, localDate);
  }

  if (/^(ทดสอบแจ้งเตือน|ทดสอบระบบ)$/u.test(text)) {
    const binding = await currentBindingForTarget(input.targetId);
    return binding
      ? `✅ ระบบแจ้งเตือนทีม ${TEAM_LABELS[binding.team_code]} พร้อมทำงานครับ`
      : 'ระบบตอบได้แล้ว แต่กลุ่มนี้ยังไม่ได้ผูกทีมครับ';
  }

  // Staff groups are operational channels, not customer conversations. Ignore normal chatter.
  return null;
}
