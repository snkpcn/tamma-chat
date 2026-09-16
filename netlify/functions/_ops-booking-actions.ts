import { decryptPii, piiHash } from './_operations-db';

type OpsTeamCode = 'restaurant' | 'stay' | 'activity' | 'cafe' | 'otop' | 'all';
type Binding = { team_code: OpsTeamCode };
type BookingRow = {
  id: string;
  booking_code: string;
  customer_id: string | null;
  service_type: string;
  resource_id: string;
  start_at: string;
  end_at: string;
  party_size: number | null;
  quantity: number;
  status: string;
  staff_note: string | null;
  environment: string;
  contact_status: string;
};

type UnitRow = {
  id: string;
  code: string;
  name: string;
  metadata: Record<string, unknown>;
};

const LINE_PUSH_ENDPOINT = 'https://api.line.me/v2/bot/message/push';
const BANGKOK_OFFSET = '+07:00';
const BOOKING_CODE_RE = 'BK-\\d{6}-[A-Z0-9]{8}';

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
    headers: {
      apikey: c.key,
      Authorization: `Bearer ${c.key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`ops_db_${response.status}:${body.slice(0, 300)}`);
  }
  return response;
}

async function rpc<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const response = await dbFetch(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body) });
  return await response.json() as T;
}

async function linePush(targetId: string, text: string): Promise<void> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) throw new Error('LINE_CHANNEL_ACCESS_TOKEN is not configured');
  const response = await fetch(LINE_PUSH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ to: targetId, messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
  if (!response.ok) throw new Error(`line_push_${response.status}`);
}

function thaiDateTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function localDateFromIso(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function bindingForTarget(targetId: string): Promise<Binding | null> {
  const hash = piiHash(targetId);
  if (!hash) return null;
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true&select=team_code&limit=1`,
  );
  return (await response.json() as Binding[])[0] ?? null;
}

async function bookingByCode(code: string): Promise<BookingRow | null> {
  const response = await dbFetch(
    `bookings?booking_code=eq.${encodeURIComponent(code)}`
    + '&select=id,booking_code,customer_id,service_type,resource_id,start_at,end_at,party_size,quantity,status,staff_note,environment,contact_status&limit=1',
  );
  return (await response.json() as BookingRow[])[0] ?? null;
}

function teamMatches(binding: Binding, booking: BookingRow): boolean {
  return binding.team_code !== 'all' && binding.team_code === booking.service_type;
}

function actorTag(userId?: string | null): string {
  const hash = userId ? piiHash(userId) : null;
  return hash ? `staff:${hash.slice(0, 12)}` : 'staff';
}

function auditNote(existing: string | null, action: string, userId?: string | null): string {
  return [existing?.trim(), `${action}ผ่าน LINE · ${actorTag(userId)} · ${new Date().toISOString()}`]
    .filter(Boolean).join('\n').slice(0, 4000);
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

async function pushCustomer(booking: BookingRow, text: string): Promise<boolean> {
  const target = await customerLineTarget(booking.customer_id);
  if (!target) return false;
  try {
    await linePush(target, text);
    await dbFetch(`bookings?id=eq.${booking.id}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ contact_status: 'contacted', updated_at: new Date().toISOString() }),
    });
    return true;
  } catch {
    return false;
  }
}

async function resourceName(resourceId: string): Promise<string> {
  const response = await dbFetch(`service_resources?id=eq.${resourceId}&select=name&limit=1`);
  return (await response.json() as Array<{ name: string }>)[0]?.name ?? 'กิจกรรม';
}

async function assignedUnits(bookingId: string): Promise<UnitRow[]> {
  const assignments = await dbFetch(`booking_unit_assignments?booking_id=eq.${bookingId}&select=resource_id`);
  const rows = await assignments.json() as Array<{ resource_id: string }>;
  if (!rows.length) return [];
  const ids = rows.map(row => row.resource_id).join(',');
  const response = await dbFetch(
    `service_resources?id=in.(${ids})&select=id,code,name,metadata`,
  );
  const units = await response.json() as UnitRow[];
  return units.sort((a, b) => Number(a.metadata?.sort_order ?? 9999) - Number(b.metadata?.sort_order ?? 9999));
}

async function assignmentCapacity(bookingId: string, fallback = 1): Promise<number> {
  const response = await dbFetch(`booking_allocations?booking_id=eq.${bookingId}&select=capacity_units`);
  const rows = await response.json() as Array<{ capacity_units: number }>;
  return rows.length ? Math.max(...rows.map(row => Number(row.capacity_units) || 1)) : fallback;
}

function bookingCustomerText(booking: BookingRow, title: string, units: UnitRow[] = []): string {
  const prefix = booking.environment === 'test' ? '🧪 TEST — ' : '';
  const amount = booking.service_type === 'stay'
    ? `${booking.quantity || 1} หลัง${booking.party_size ? ` / ${booking.party_size} คน` : ''}`
    : `${booking.party_size ?? booking.quantity ?? 1} คน`;
  return [
    `${prefix}${title}`,
    `เลขที่: ${booking.booking_code}`,
    `วันเวลา: ${thaiDateTime(booking.start_at)} → ${thaiDateTime(booking.end_at)}`,
    `จำนวน: ${amount}`,
    units.length ? `ทรัพยากร: ${units.map(unit => unit.name).join(', ')}` : '',
  ].filter(Boolean).join('\n');
}

async function confirmBooking(binding: Binding, booking: BookingRow, userId?: string | null): Promise<string> {
  if (booking.status === 'confirmed') {
    const units = await assignedUnits(booking.id);
    return `✅ ${booking.booking_code} ยืนยันแล้วอยู่แล้วครับ${units.length ? `\nทรัพยากร: ${units.map(u => u.name).join(', ')}` : ''}`;
  }
  if (booking.status !== 'requested') return `รายการ ${booking.booking_code} อยู่สถานะ ${booking.status} จึงยืนยันไม่ได้ครับ`;

  let units: UnitRow[] = [];
  if (booking.service_type === 'activity') {
    await rpc('assign_activity_booking_units', { p_booking_id: booking.id, p_actor: actorTag(userId) });
    units = await assignedUnits(booking.id);
  }

  await dbFetch(`bookings?id=eq.${booking.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'confirmed', contact_status: 'pending',
      staff_note: auditNote(booking.staff_note, 'ยืนยัน', userId), updated_at: new Date().toISOString(),
    }),
  });
  const updated = { ...booking, status: 'confirmed', contact_status: 'pending' };
  const item = await resourceName(booking.resource_id);
  const customerText = [
    bookingCustomerText(updated, '✅ ทองไทยยืนยันการจองแล้วครับ', units),
    `รายการ: ${item}`,
    'สถานะ: ยืนยันแล้ว',
    '',
    'ทีมงานรับรายการเรียบร้อยแล้วครับ หากต้องการแก้ไข สามารถตอบกลับทาง LINE นี้ได้เลย',
  ].join('\n');
  const sent = await pushCustomer(updated, customerText);
  return sent
    ? `✅ ยืนยัน ${booking.booking_code} แล้ว\n${units.length ? `จัดให้: ${units.map(u => u.name).join(', ')}\n` : ''}ทองไทยแจ้งลูกค้ากลับทาง LINE สำเร็จครับ`
    : `⚠️ ยืนยัน ${booking.booking_code} แล้ว${units.length ? `\nจัดให้: ${units.map(u => u.name).join(', ')}` : ''}\nแต่ส่ง LINE หาลูกค้าไม่สำเร็จ กรุณาติดต่อจากหลังบ้านครับ`;
}

async function cancelBooking(booking: BookingRow, userId?: string | null): Promise<string> {
  if (booking.status === 'cancelled') return `ℹ️ ${booking.booking_code} ถูกยกเลิกแล้วครับ`;
  if (!['requested', 'confirmed'].includes(booking.status)) return `รายการ ${booking.booking_code} อยู่สถานะ ${booking.status} จึงยกเลิกไม่ได้ครับ`;
  await dbFetch(`bookings?id=eq.${booking.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'cancelled', contact_status: 'pending',
      staff_note: auditNote(booking.staff_note, 'ยกเลิก', userId), updated_at: new Date().toISOString(),
    }),
  });
  const updated = { ...booking, status: 'cancelled', contact_status: 'pending' };
  const sent = await pushCustomer(updated, [
    bookingCustomerText(updated, '❌ ทองไทยแจ้งยกเลิกการจองครับ'),
    'สถานะ: ยกเลิกแล้ว',
    '',
    'หากต้องการเลือกเวลาใหม่ ตอบกลับทาง LINE นี้ได้เลยครับ',
  ].join('\n'));
  return sent
    ? `✅ ยกเลิก ${booking.booking_code} แล้ว คืน capacity และแจ้งลูกค้าทาง LINE สำเร็จครับ`
    : `⚠️ ยกเลิก ${booking.booking_code} แล้วและคืน capacity แล้ว แต่ส่ง LINE หาลูกค้าไม่สำเร็จครับ`;
}

async function completeBooking(booking: BookingRow, userId?: string | null): Promise<string> {
  if (booking.status === 'completed') return `✅ ${booking.booking_code} ปิดงานแล้วอยู่แล้วครับ`;
  if (booking.status !== 'confirmed') return `ต้องอยู่สถานะ confirmed ก่อนจึงปิดงานได้ครับ (ตอนนี้ ${booking.status})`;
  await dbFetch(`bookings?id=eq.${booking.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'completed',
      staff_note: auditNote(booking.staff_note, 'ปิดงาน', userId), updated_at: new Date().toISOString(),
    }),
  });
  return `✅ ปิดงาน ${booking.booking_code} เรียบร้อยแล้วครับ`;
}

function parseBangkokStart(raw: string, booking: BookingRow): string | null {
  const value = raw.trim();
  const full = value.match(/^(?:(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\s+)?(\d{1,2}):(\d{2})$/);
  if (!full) return null;
  const bookingDate = localDateFromIso(booking.start_at);
  const [bookingYear, bookingMonth, bookingDay] = bookingDate.split('-').map(Number);
  let year = full[3] ? Number(full[3]) : bookingYear;
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543;
  const month = full[2] ? Number(full[2]) : bookingMonth;
  const day = full[1] ? Number(full[1]) : bookingDay;
  const hour = Number(full[4]);
  const minute = Number(full[5]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const local = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00${BANGKOK_OFFSET}`;
  const parsed = new Date(local);
  if (Number.isNaN(parsed.getTime())) return null;
  const roundTrip = localDateFromIso(parsed.toISOString());
  if (roundTrip !== local.slice(0, 10)) return null;
  return parsed.toISOString();
}

async function rescheduleBooking(booking: BookingRow, rawStart: string, userId?: string | null): Promise<string> {
  if (booking.service_type !== 'activity') return 'ตอนนี้คำสั่งเลื่อนในกลุ่มรองรับงานกิจกรรมก่อนครับ';
  if (!['requested', 'confirmed'].includes(booking.status)) return `รายการ ${booking.booking_code} อยู่สถานะ ${booking.status} จึงเลื่อนไม่ได้ครับ`;
  const start = parseBangkokStart(rawStart, booking);
  if (!start) return 'รูปแบบเวลาไม่ถูกครับ ใช้ เช่น “เลื่อน BK-... 11:00” หรือ “เลื่อน BK-... 18/09 11:00”';
  await rpc('reschedule_activity_booking', { p_booking_id: booking.id, p_new_start: start, p_actor: actorTag(userId) });
  const updated = await bookingByCode(booking.booking_code);
  if (!updated) throw new Error('booking_missing_after_reschedule');
  const units = await assignedUnits(booking.id);
  const sent = await pushCustomer(updated, [
    bookingCustomerText(updated, '🕒 ทองไทยอัปเดตเวลาการจองแล้วครับ', units),
    'สถานะ: ' + (updated.status === 'confirmed' ? 'ยืนยันแล้ว' : 'รอทีมงานยืนยัน'),
  ].join('\n'));
  return `${sent ? '✅' : '⚠️'} เลื่อน ${booking.booking_code} เป็น ${thaiDateTime(updated.start_at)} → ${thaiDateTime(updated.end_at)} แล้ว\n${units.length ? `ทรัพยากร: ${units.map(u => u.name).join(', ')}\n` : ''}${sent ? 'แจ้งลูกค้าทาง LINE สำเร็จครับ' : 'แต่แจ้งลูกค้าทาง LINE ไม่สำเร็จครับ'}`;
}

async function listActivityUnitChoices(booking: BookingRow): Promise<UnitRow[]> {
  const aggregate = await dbFetch(`service_resources?id=eq.${booking.resource_id}&select=metadata&limit=1`);
  const meta = (await aggregate.json() as Array<{ metadata: Record<string, unknown> }>)[0]?.metadata ?? {};
  const activityCode = String(meta.activity_code ?? '');
  if (!activityCode) return [];
  const response = await dbFetch(
    `service_resources?service_type=eq.activity&active=eq.true&requires_schedule=eq.false&select=id,code,name,metadata`,
  );
  const rows = await response.json() as UnitRow[];
  return rows.filter(row => row.metadata?.activity_unit === true && String(row.metadata?.activity_code ?? '') === activityCode)
    .sort((a, b) => Number(a.metadata?.sort_order ?? 9999) - Number(b.metadata?.sort_order ?? 9999));
}

async function reassignUnits(booking: BookingRow, rawUnits: string, userId?: string | null): Promise<string> {
  if (booking.service_type !== 'activity') return 'คำสั่งเปลี่ยนทรัพยากรรองรับงานกิจกรรมครับ';
  if (!['requested', 'confirmed'].includes(booking.status)) return `รายการ ${booking.booking_code} อยู่สถานะ ${booking.status} จึงเปลี่ยนทรัพยากรไม่ได้ครับ`;
  const choices = await listActivityUnitChoices(booking);
  const normalized = normalizeToken(rawUnits.replace(/[+，]/g, ','));
  const tokens = normalized.split(/\s*,\s*|\s+และ\s+/).filter(Boolean);
  let selected = choices.filter(choice => {
    const variants = [choice.name, choice.code, String(choice.metadata?.asset_code ?? '')].map(normalizeToken).filter(Boolean);
    return tokens.some(token => variants.includes(token));
  });
  if (!selected.length) {
    selected = choices.filter(choice => normalizeToken(rawUnits).includes(normalizeToken(choice.name)));
  }
  selected = selected.filter((row, index, array) => array.findIndex(x => x.id === row.id) === index);
  const expected = await assignmentCapacity(booking.id, booking.party_size ?? 1);
  if (selected.length !== expected) {
    return `ต้องเลือก ${expected} หน่วยครับ ตอนนี้เลือกได้ ${selected.length}\nตัวเลือก: ${choices.map(c => c.name).join(', ')}`;
  }
  await rpc('set_activity_booking_units', {
    p_booking_id: booking.id,
    p_resource_ids: selected.map(unit => unit.id),
    p_actor: actorTag(userId),
  });
  return `✅ เปลี่ยนทรัพยากร ${booking.booking_code} แล้ว\n${selected.map(unit => unit.name).join(', ')}`;
}

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (message.includes('activity_schedule_unavailable')) return 'ช่วงเวลาใหม่ไม่ว่างพอครับ ลองเวลาอื่นได้เลย';
  if (message.includes('activity_units_unavailable')) return 'capacity รวมยังมี แต่หน่วยจริงชนกับงานอื่นครับ กรุณาเปลี่ยนเวลาหรือจัดทรัพยากรใหม่';
  const conflict = message.match(/activity_unit_unavailable:([^\\"}]+)/);
  if (conflict) return `${conflict[1]} ถูกใช้งานชนกับ booking อื่นครับ`;
  if (message.includes('assignment_count_must_match_booking_capacity')) return 'จำนวนทรัพยากรที่เลือกไม่ตรงกับจำนวนที่ booking ต้องใช้ครับ';
  if (message.includes('invalid_activity_unit')) return 'มีทรัพยากรที่ไม่ตรงกับกิจกรรมนี้หรือถูกพักใช้งานครับ';
  console.error('OPS_BOOKING_ACTION_ERROR', message.slice(0, 400));
  return 'ทำรายการไม่สำเร็จครับ ระบบยังไม่ได้เปลี่ยนข้อมูล กรุณาลองใหม่อีกครั้ง';
}

export async function handleBookingOpsCommand(input: {
  targetId: string;
  userId?: string | null;
  text: string;
}): Promise<{ handled: boolean; reply: string | null }> {
  const text = input.text.trim();
  const patterns = {
    confirm: new RegExp(`^ยืนยัน\\s+(${BOOKING_CODE_RE})$`, 'iu'),
    cancel: new RegExp(`^ยกเลิก\\s+(${BOOKING_CODE_RE})$`, 'iu'),
    complete: new RegExp(`^(?:เสร็จงาน|ปิดงาน)\\s+(${BOOKING_CODE_RE})$`, 'iu'),
    resources: new RegExp(`^(?:ทรัพยากร|ดูทรัพยากร)\\s+(${BOOKING_CODE_RE})$`, 'iu'),
    reassign: new RegExp(`^(?:เปลี่ยนทรัพยากร|จัดทรัพยากร)\\s+(${BOOKING_CODE_RE})\\s+(.+)$`, 'iu'),
    reschedule: new RegExp(`^เลื่อน\\s+(${BOOKING_CODE_RE})\\s+(.+)$`, 'iu'),
  };
  const match = Object.entries(patterns).map(([kind, re]) => ({ kind, match: text.match(re) })).find(x => x.match);
  if (!match?.match) return { handled: false, reply: null };

  const binding = await bindingForTarget(input.targetId);
  if (!binding) return { handled: true, reply: 'กลุ่มนี้ยังไม่ได้ผูกทีมครับ' };
  const bookingCode = match.match[1].toUpperCase();
  const booking = await bookingByCode(bookingCode);
  if (!booking) return { handled: true, reply: `ไม่พบเลขที่ ${bookingCode} ครับ` };
  if (!teamMatches(binding, booking)) {
    return { handled: true, reply: `รายการ ${bookingCode} เป็นงานทีม ${booking.service_type} ไม่ใช่กลุ่มนี้ครับ` };
  }

  try {
    switch (match.kind) {
      case 'confirm': return { handled: true, reply: await confirmBooking(binding, booking, input.userId) };
      case 'cancel': return { handled: true, reply: await cancelBooking(booking, input.userId) };
      case 'complete': return { handled: true, reply: await completeBooking(booking, input.userId) };
      case 'resources': {
        const units = await assignedUnits(booking.id);
        return { handled: true, reply: units.length
          ? `🧩 ${booking.booking_code}\nทรัพยากร: ${units.map(unit => unit.name).join(', ')}`
          : `🧩 ${booking.booking_code}\nยังไม่ได้จัดทรัพยากรจริงครับ` };
      }
      case 'reassign': return { handled: true, reply: await reassignUnits(booking, match.match[2], input.userId) };
      case 'reschedule': return { handled: true, reply: await rescheduleBooking(booking, match.match[2], input.userId) };
      default: return { handled: false, reply: null };
    }
  } catch (error) {
    return { handled: true, reply: friendlyError(error) };
  }
}
