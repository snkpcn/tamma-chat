import { decryptPii, piiHash } from './_operations-db';
import type { LineMessage } from './_ops-line-ui';

type TeamCode = 'cafe' | 'otop';
type ChannelRow = { id: string; target_id_enc: string };
type DeliveryRow = { id: string; status: string };

type CafeRow = {
  id: string; inquiry_code: string; customer_id: string | null; question: string; status: string;
  source_channel: string; response_note: string | null; assigned_to: string | null; environment: string; created_at: string;
};

type OtopRow = {
  id: string; order_code: string; customer_id: string | null; status: string; source_channel: string;
  fulfillment_type: string; customer_note: string | null; staff_note: string | null;
  total_amount: number | string; contact_status: string; environment: string; created_at: string;
};

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const BACKOFFICE_URL = 'https://tamma-backoffice.netlify.app/';

function config(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Operations database is not configured');
  return { url: url.replace(/\/$/, ''), key };
}

async function dbFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const c = config();
  const response = await fetch(`${c.url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: c.key, Authorization: `Bearer ${c.key}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`simple_staff_db_${response.status}:${body.slice(0, 260)}`);
  }
  return response;
}

function text(textValue: string): LineMessage { return { type: 'text', text: textValue.slice(0, 4900) }; }
function clean(value: unknown, max = 500): string { return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : ''; }
function money(value: unknown): string { return `${Number(value || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })} บาท`; }
function thaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}
function actorTag(userId?: string | null): string {
  const hash = userId ? piiHash(userId) : null;
  return hash ? `staff:${hash.slice(0, 12)}` : 'staff';
}
function pb(entity: string, action: string, id: string): string { return new URLSearchParams({ ops: 'simple', entity, action, id }).toString(); }
function button(label: string, action: Record<string, unknown>, primary = false): Record<string, unknown> {
  return { type: 'button', style: primary ? 'primary' : 'secondary', height: 'sm', color: primary ? '#65704C' : undefined, action: { label, ...action } };
}
function row(label: string, value: string, bold = false): Record<string, unknown> {
  return { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
    { type: 'text', text: label, size: 'sm', color: '#7C7369', flex: 3, wrap: true },
    { type: 'text', text: value, size: 'sm', color: '#241A12', weight: bold ? 'bold' : 'regular', flex: 7, wrap: true },
  ] };
}

async function bindingForTarget(targetId: string): Promise<TeamCode | null> {
  const hash = piiHash(targetId); if (!hash) return null;
  const response = await dbFetch(`ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true&select=team_code&limit=1`);
  const team = (await response.json() as Array<{ team_code: string }>)[0]?.team_code;
  return team === 'cafe' || team === 'otop' ? team : null;
}
async function channelForTeam(team: TeamCode): Promise<ChannelRow | null> {
  const response = await dbFetch(`ops_notification_channels?team_code=eq.${team}&provider=eq.line&enabled=eq.true&select=id,target_id_enc&limit=1`);
  return (await response.json() as ChannelRow[])[0] ?? null;
}
async function customerInfo(customerId: string | null): Promise<{ name: string; phone: string }> {
  if (!customerId) return { name: '', phone: '' };
  const response = await dbFetch(`customer_accounts?id=eq.${customerId}&select=full_name_enc,phone_enc&limit=1`);
  const r = (await response.json() as Array<{ full_name_enc: string | null; phone_enc: string | null }>)[0];
  return { name: decryptPii(r?.full_name_enc) ?? '', phone: decryptPii(r?.phone_enc) ?? '' };
}
async function customerLine(customerId: string | null): Promise<string | null> {
  if (!customerId) return null;
  const response = await dbFetch(`customer_channel_contacts?customer_id=eq.${customerId}&provider=eq.line&reachable=eq.true&verified=eq.true&select=external_id_enc&order=last_seen_at.desc&limit=1`);
  const r = (await response.json() as Array<{ external_id_enc: string }>)[0];
  return decryptPii(r?.external_id_enc) ?? null;
}
async function linePush(targetId: string, messages: LineMessage[]): Promise<void> {
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN; if (!token) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_PUSH_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ to: targetId, messages: messages.slice(0, 5) }) });
  if (!response.ok) throw new Error(`simple_staff_line_${response.status}`);
}
async function pushCustomer(customerId: string | null, message: string): Promise<boolean> {
  const target = await customerLine(customerId); if (!target) return false;
  try { await linePush(target, [text(message)]); return true; } catch { return false; }
}

async function beginDelivery(input: { channelId: string; entity: 'cafe_inquiry' | 'otop_order'; id: string; type: 'cafe_inquiry_created' | 'otop_order_created'; key: string; code: string }): Promise<{ id: string; send: boolean }> {
  const response = await dbFetch('ops_notification_deliveries?on_conflict=idempotency_key', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify({ channel_id: input.channelId, entity_type: input.entity, entity_id: input.id, idempotency_key: input.key, delivery_type: input.type, provider: 'line', status: 'pending', payload: { code: input.code, ui: 'simple-flex-v1' } }) });
  const made = (await response.json() as DeliveryRow[])[0]; if (made?.id) return { id: made.id, send: true };
  const lookup = await dbFetch(`ops_notification_deliveries?idempotency_key=eq.${encodeURIComponent(input.key)}&select=id,status&limit=1`);
  const existing = (await lookup.json() as DeliveryRow[])[0];
  if (!existing) throw new Error('simple_delivery_lookup_failed');
  if (existing.status === 'sent' || existing.status === 'pending') return { id: existing.id, send: false };
  await dbFetch(`ops_notification_deliveries?id=eq.${existing.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', error_message: null, payload: { code: input.code, ui: 'simple-flex-v1' } }) });
  return { id: existing.id, send: true };
}
async function finishDelivery(id: string, error?: unknown): Promise<void> {
  await dbFetch(`ops_notification_deliveries?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: error ? 'failed' : 'sent', error_message: error ? (error instanceof Error ? error.message.slice(0, 500) : 'unknown') : null }) });
}

async function cafeById(id: string): Promise<CafeRow | null> {
  const r = await dbFetch(`cafe_inquiries?id=eq.${id}&select=id,inquiry_code,customer_id,question,status,source_channel,response_note,assigned_to,environment,created_at&limit=1`);
  return (await r.json() as CafeRow[])[0] ?? null;
}
async function otopById(id: string): Promise<OtopRow | null> {
  const r = await dbFetch(`otop_orders?id=eq.${id}&select=id,order_code,customer_id,status,source_channel,fulfillment_type,customer_note,staff_note,total_amount,contact_status,environment,created_at&limit=1`);
  return (await r.json() as OtopRow[])[0] ?? null;
}
async function otopItems(id: string): Promise<string> {
  const r = await dbFetch(`otop_order_items?order_id=eq.${id}&select=product_id,quantity`);
  const items = await r.json() as Array<{ product_id: string; quantity: number }>;
  const names = new Map<string, string>();
  for (const productId of [...new Set(items.map(x => x.product_id))]) {
    const p = await dbFetch(`otop_products?id=eq.${productId}&select=id,name&limit=1`);
    const product = (await p.json() as Array<{ id: string; name: string }>)[0]; if (product) names.set(product.id, product.name);
  }
  return items.length ? items.map(x => `${names.get(x.product_id) ?? 'สินค้า'} × ${x.quantity}`).join(', ') : 'ดูรายละเอียดในหลังบ้าน';
}

async function cafeCard(cafe: CafeRow): Promise<LineMessage> {
  const customer = await customerInfo(cafe.customer_id);
  const claimed = Boolean(cafe.assigned_to);
  const footer: Record<string, unknown>[] = [];
  if (cafe.status !== 'closed') {
    if (!claimed) footer.push(button('✅ รับเรื่อง', { type: 'postback', data: pb('cafe', 'claim', cafe.id), displayText: 'รับเรื่อง' }, true));
    footer.push(button('✅ ปิดเรื่อง', { type: 'postback', data: pb('cafe', 'close_prompt', cafe.id), displayText: 'ปิดเรื่อง' }));
  }
  footer.push(button('เปิดหลังบ้าน', { type: 'uri', uri: BACKOFFICE_URL }));
  return { type: 'flex', altText: `☕ เรื่องลูกค้า ${cafe.inquiry_code}`, contents: { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: cafe.environment === 'test' ? '#7A6536' : '#65704C', contents: [
    { type: 'text', text: `${cafe.environment === 'test' ? '🧪 TEST • ' : ''}☕ เรื่องลูกค้า`, color: '#FFFFFF', size: 'lg', weight: 'bold' },
    { type: 'text', text: 'Inthanin Café', color: '#FFFFFF', size: 'xl', weight: 'bold' },
  ] }, body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
    customer.name ? row('ลูกค้า', customer.name, true) : null,
    customer.phone ? row('โทร', customer.phone) : null,
    row('เรื่อง', clean(cafe.question, 900), true),
    row('สถานะ', cafe.status === 'closed' ? 'ปิดเรื่องแล้ว' : claimed ? 'มีคนรับเรื่องแล้ว' : 'รอรับเรื่อง', true),
    { type: 'text', text: `อ้างอิง ${cafe.inquiry_code}`, size: 'xxs', color: '#A69C91', margin: 'md' },
  ].filter(Boolean) as Record<string, unknown>[] }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: footer } } };
}

function otopStatus(status: string): string {
  return ({ requested: 'รอรับออเดอร์', confirmed: 'รับออเดอร์แล้ว', preparing: 'กำลังเตรียม', ready: 'พร้อมแล้ว', shipped: 'ส่งแล้ว', completed: 'เสร็จแล้ว', cancelled: 'ยกเลิกแล้ว' } as Record<string, string>)[status] ?? status;
}
async function otopCard(order: OtopRow): Promise<LineMessage> {
  const [customer, items] = await Promise.all([customerInfo(order.customer_id), otopItems(order.id)]);
  const footer: Record<string, unknown>[] = [];
  if (order.status === 'requested') footer.push(button('✅ รับออเดอร์', { type: 'postback', data: pb('otop', 'confirm', order.id), displayText: 'รับออเดอร์' }, true));
  if (order.status === 'confirmed') footer.push(button('🍳 เริ่มเตรียม', { type: 'postback', data: pb('otop', 'preparing', order.id), displayText: 'เริ่มเตรียม' }, true));
  if (order.status === 'preparing') footer.push(button('✅ พร้อมแล้ว', { type: 'postback', data: pb('otop', 'ready', order.id), displayText: 'พร้อมแล้ว' }, true));
  if (order.status === 'ready') footer.push(button(order.fulfillment_type === 'shipping' ? '🚚 ส่งแล้ว' : '✅ ส่งมอบแล้ว', { type: 'postback', data: pb('otop', order.fulfillment_type === 'shipping' ? 'shipped' : 'completed', order.id), displayText: order.fulfillment_type === 'shipping' ? 'ส่งแล้ว' : 'ส่งมอบแล้ว' }, true));
  if (order.status === 'shipped') footer.push(button('✅ ปิดงาน', { type: 'postback', data: pb('otop', 'completed', order.id), displayText: 'ปิดงาน' }, true));
  if (!['completed', 'cancelled'].includes(order.status)) footer.push(button('❌ ยกเลิก', { type: 'postback', data: pb('otop', 'cancel_prompt', order.id), displayText: 'ยกเลิกออเดอร์' }));
  footer.push(button('เปิดหลังบ้าน', { type: 'uri', uri: BACKOFFICE_URL }));
  return { type: 'flex', altText: `🛍️ ออเดอร์ ${order.order_code}`, contents: { type: 'bubble', size: 'kilo', header: { type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: order.environment === 'test' ? '#7A6536' : '#65704C', contents: [
    { type: 'text', text: `${order.environment === 'test' ? '🧪 TEST • ' : ''}🛍️ ออเดอร์ใหม่`, color: '#FFFFFF', size: 'lg', weight: 'bold' },
    { type: 'text', text: 'OTOP / สินค้าชุมชน', color: '#FFFFFF', size: 'xl', weight: 'bold', wrap: true },
  ] }, body: { type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px', contents: [
    customer.name ? row('ลูกค้า', customer.name, true) : null,
    customer.phone ? row('โทร', customer.phone) : null,
    row('รายการ', items, true), row('ยอดรวม', money(order.total_amount), true),
    row('รับสินค้า', order.fulfillment_type === 'shipping' ? 'จัดส่ง' : 'รับที่ร้าน'), row('สถานะ', otopStatus(order.status), true),
    order.customer_note ? row('หมายเหตุ', clean(order.customer_note)) : null,
    { type: 'text', text: `อ้างอิง ${order.order_code}`, size: 'xxs', color: '#A69C91', margin: 'md' },
  ].filter(Boolean) as Record<string, unknown>[] }, footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px', contents: footer } } };
}

export async function dispatchCafeFlexNotification(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const cafe = await cafeById(id); if (!cafe || !['live', 'test'].includes(cafe.environment)) return 'ignored';
  const channel = await channelForTeam('cafe'); if (!channel) return 'not_bound';
  const target = decryptPii(channel.target_id_enc); if (!target) throw new Error('cafe target cannot be decrypted');
  const d = await beginDelivery({ channelId: channel.id, entity: 'cafe_inquiry', id: cafe.id, type: 'cafe_inquiry_created', key: `cafe_inquiry_created:${cafe.id}`, code: cafe.inquiry_code }); if (!d.send) return 'duplicate';
  try { await linePush(target, [await cafeCard(cafe)]); await finishDelivery(d.id); return 'sent'; } catch (e) { await finishDelivery(d.id, e).catch(() => undefined); throw e; }
}
export async function dispatchOtopFlexNotification(id: string): Promise<'sent' | 'duplicate' | 'not_bound' | 'ignored'> {
  const order = await otopById(id); if (!order || !['live', 'test'].includes(order.environment)) return 'ignored';
  const channel = await channelForTeam('otop'); if (!channel) return 'not_bound';
  const target = decryptPii(channel.target_id_enc); if (!target) throw new Error('otop target cannot be decrypted');
  const d = await beginDelivery({ channelId: channel.id, entity: 'otop_order', id: order.id, type: 'otop_order_created', key: `otop_order_created:${order.id}`, code: order.order_code }); if (!d.send) return 'duplicate';
  try { await linePush(target, [await otopCard(order)]); await finishDelivery(d.id); return 'sent'; } catch (e) { await finishDelivery(d.id, e).catch(() => undefined); throw e; }
}

function confirmTemplate(entity: string, id: string, label: string): LineMessage {
  return { type: 'template', altText: `ยืนยัน ${label}`, template: { type: 'confirm', text: `ยืนยัน${label}ใช่ไหม?`, actions: [
    { type: 'postback', label: 'ใช่', data: pb(entity, 'cancel_do', id), displayText: `ยืนยัน${label}` },
    { type: 'postback', label: 'ไม่', data: pb(entity, 'cancel_no', id), displayText: 'ไม่ยกเลิก' },
  ] } };
}

async function updateOtop(order: OtopRow, status: string, userId?: string | null): Promise<OtopRow> {
  const note = [order.staff_note?.trim(), `${status} ผ่าน LINE · ${actorTag(userId)} · ${new Date().toISOString()}`].filter(Boolean).join('\n').slice(0, 4000);
  await dbFetch(`otop_orders?id=eq.${order.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status, staff_note: note, updated_at: new Date().toISOString() }) });
  return { ...order, status, staff_note: note };
}
async function notifyOtopCustomer(order: OtopRow): Promise<void> {
  const message = order.status === 'confirmed' ? `✅ ทองไทยรับออเดอร์ ${order.order_code} แล้วครับ\nสถานะ: รับออเดอร์แล้ว`
    : order.status === 'ready' ? `✅ ออเดอร์ ${order.order_code} พร้อมแล้วครับ\n${order.fulfillment_type === 'shipping' ? 'กำลังเตรียมจัดส่ง' : 'สามารถมารับสินค้าได้'}`
    : order.status === 'shipped' ? `🚚 ออเดอร์ ${order.order_code} จัดส่งแล้วครับ`
    : order.status === 'cancelled' ? `❌ ออเดอร์ ${order.order_code} ถูกยกเลิกแล้วครับ`
    : '';
  if (!message) return;
  const sent = await pushCustomer(order.customer_id, message);
  if (sent) await dbFetch(`otop_orders?id=eq.${order.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ contact_status: 'contacted', updated_at: new Date().toISOString() }) });
}

export async function handleSimpleStaffPostback(input: { targetId: string; userId?: string | null; data: string }): Promise<LineMessage[] | null> {
  const q = new URLSearchParams(input.data); if (q.get('ops') !== 'simple') return null;
  const entity = q.get('entity') ?? ''; const action = q.get('action') ?? ''; const id = q.get('id') ?? '';
  if (!/^[0-9a-f-]{36}$/i.test(id)) return [text('รายการไม่ถูกต้องครับ')];
  const team = await bindingForTarget(input.targetId); if (!team || team !== entity) return [text('รายการนี้ไม่ใช่ของกลุ่มนี้ครับ')];

  if (entity === 'cafe') {
    const cafe = await cafeById(id); if (!cafe) return [text('ไม่พบเรื่องนี้ครับ')];
    if (action === 'claim') {
      if (cafe.status === 'closed') return [text('เรื่องนี้ปิดแล้วครับ')];
      await dbFetch(`cafe_inquiries?id=eq.${cafe.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ assigned_to: actorTag(input.userId), updated_at: new Date().toISOString() }) });
      const fresh = await cafeById(id); return [text('✅ รับเรื่องแล้วครับ'), fresh ? await cafeCard(fresh) : text('รับเรื่องแล้วครับ')];
    }
    if (action === 'close_prompt') return [confirmTemplate('cafe', id, 'ปิดเรื่อง')];
    if (action === 'cancel_no') return [text('โอเคครับ ยังไม่ปิดเรื่อง')];
    if (action === 'cancel_do') {
      await dbFetch(`cafe_inquiries?id=eq.${cafe.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'closed', updated_at: new Date().toISOString() }) });
      return [text('✅ ปิดเรื่องเรียบร้อยแล้วครับ')];
    }
    return null;
  }

  if (entity === 'otop') {
    const order = await otopById(id); if (!order) return [text('ไม่พบออเดอร์นี้ครับ')];
    if (action === 'cancel_prompt') return [confirmTemplate('otop', id, 'ยกเลิกออเดอร์')];
    if (action === 'cancel_no') return [text('โอเคครับ ยังไม่ยกเลิกออเดอร์')];
    let next: string | null = null;
    if (action === 'confirm' && order.status === 'requested') next = 'confirmed';
    if (action === 'preparing' && order.status === 'confirmed') next = 'preparing';
    if (action === 'ready' && order.status === 'preparing') next = 'ready';
    if (action === 'shipped' && order.status === 'ready' && order.fulfillment_type === 'shipping') next = 'shipped';
    if (action === 'completed' && ['ready', 'shipped'].includes(order.status)) next = 'completed';
    if (action === 'cancel_do' && !['completed', 'cancelled'].includes(order.status)) next = 'cancelled';
    if (!next) return [text(`สถานะตอนนี้คือ ${otopStatus(order.status)} จึงกดปุ่มนี้ไม่ได้ครับ`)];
    const fresh = await updateOtop(order, next, input.userId); await notifyOtopCustomer(fresh);
    return [text(`✅ ${otopStatus(next)}ครับ`), await otopCard(fresh)];
  }
  return null;
}
