import { handleBookingOpsCommand } from './_ops-booking-actions';
import { piiHash } from './_operations-db';

export type LineMessage = {
  type: string;
  [key: string]: unknown;
};

type OpsTeamCode = 'restaurant' | 'stay' | 'activity' | 'cafe' | 'otop' | 'all';

type BookingUiRow = {
  id: string;
  booking_code: string;
  service_type: string;
  resource_id: string;
  start_at: string;
  end_at: string;
  party_size: number | null;
  quantity: number;
  status: string;
  environment: string;
};

type UnitRow = {
  id: string;
  code: string;
  name: string;
  metadata: Record<string, unknown>;
};

type BindingRow = { team_code: OpsTeamCode };

type BookingCardInput = {
  bookingCode: string;
  serviceName: string;
  teamLabel: string;
  status: string;
  environment: string;
  startAt: string;
  endAt: string;
  customerName?: string;
  phone?: string;
  amount: string;
  sourceChannel?: string;
  note?: string;
  activityCode?: string;
  unitNames?: string[];
  backofficeUrl?: string;
};

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
    throw new Error(`ops_ui_db_${response.status}:${body.slice(0, 260)}`);
  }
  return response;
}

function textMessage(text: string): LineMessage {
  return { type: 'text', text: text.slice(0, 4900) };
}

function postbackData(action: string, code: string, extra: Record<string, string> = {}): string {
  return new URLSearchParams({ ops: 'booking', action, code, ...extra }).toString();
}

function thaiDate(value: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: 'numeric',
  }).format(new Date(value));
}

function thaiTime(value: string): string {
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(value));
}

function localDateTime(value: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(value));
  const pick = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${pick('year')}-${pick('month')}-${pick('day')}T${pick('hour')}:${pick('minute')}`;
}

function statusLabel(status: string): string {
  if (status === 'requested') return 'รอยืนยัน';
  if (status === 'confirmed') return 'รับงานแล้ว';
  if (status === 'completed') return 'เสร็จแล้ว';
  if (status === 'cancelled') return 'ยกเลิกแล้ว';
  return status;
}

function activityNoun(activityCode?: string): { singular: string; field: string; change: string } {
  if (activityCode === 'atv') return { singular: 'รถ', field: 'รถที่จัด', change: 'เปลี่ยนรถ' };
  if (activityCode === 'horse') return { singular: 'ม้า', field: 'ม้าที่จัด', change: 'เปลี่ยนม้า' };
  if (activityCode === 'archery') return { singular: 'ช่องยิง', field: 'ช่องยิงที่จัด', change: 'เปลี่ยนช่อง' };
  return { singular: 'รายการ', field: 'ที่จัดไว้', change: 'เปลี่ยน' };
}

function valueRow(label: string, value: string, emphasis = false): Record<string, unknown> {
  return {
    type: 'box', layout: 'baseline', spacing: 'sm',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#7C7369', flex: 3, wrap: true },
      { type: 'text', text: value, size: 'sm', color: emphasis ? '#241A12' : '#3A342F', weight: emphasis ? 'bold' : 'regular', flex: 7, wrap: true },
    ],
  };
}

function actionButton(label: string, action: Record<string, unknown>, primary = false): Record<string, unknown> {
  return {
    type: 'button',
    style: primary ? 'primary' : 'secondary',
    height: 'sm',
    color: primary ? '#65704C' : undefined,
    action: { label, ...action },
  };
}

function bookingFooter(input: BookingCardInput): Record<string, unknown>[] {
  const active = ['requested', 'confirmed'].includes(input.status);
  if (!active) {
    return input.backofficeUrl ? [
      actionButton('เปิดหลังบ้าน', { type: 'uri', uri: input.backofficeUrl }),
    ] : [];
  }

  const rows: Record<string, unknown>[] = [];
  if (input.status === 'requested') {
    rows.push(actionButton('✅ รับงาน', {
      type: 'postback',
      data: postbackData('confirm', input.bookingCode),
      displayText: 'รับงาน',
    }, true));
  } else if (input.status === 'confirmed') {
    rows.push(actionButton('✅ เสร็จงาน', {
      type: 'postback',
      data: postbackData('complete', input.bookingCode),
      displayText: 'เสร็จงาน',
    }, true));
  }

  if (input.activityCode) {
    const noun = activityNoun(input.activityCode);
    rows.push({
      type: 'box', layout: 'horizontal', spacing: 'sm',
      contents: [
        actionButton(`🔄 ${noun.change}`, {
          type: 'postback', data: postbackData('choose_units', input.bookingCode), displayText: noun.change,
        }),
        actionButton('🕒 เลื่อนเวลา', {
          type: 'datetimepicker', data: postbackData('reschedule', input.bookingCode), mode: 'datetime',
          initial: localDateTime(input.startAt),
        }),
      ],
    });
  }

  rows.push(actionButton('❌ ยกเลิกงาน', {
    type: 'postback', data: postbackData('cancel_prompt', input.bookingCode), displayText: 'ยกเลิกงาน',
  }));

  if (input.backofficeUrl) {
    rows.push(actionButton('ดูรายละเอียดในหลังบ้าน', { type: 'uri', uri: input.backofficeUrl }));
  }
  return rows;
}

export function buildStaffBookingFlexMessage(input: BookingCardInput): LineMessage {
  const noun = activityNoun(input.activityCode);
  const test = input.environment === 'test';
  const unitText = input.unitNames?.length ? input.unitNames.join(' + ') : '';
  const title = input.status === 'requested' ? '🔔 งานใหม่' : `งาน • ${statusLabel(input.status)}`;
  const bodyRows: Record<string, unknown>[] = [
    valueRow('วัน', thaiDate(input.startAt), true),
    valueRow('เวลา', `${thaiTime(input.startAt)}–${thaiTime(input.endAt)}`, true),
    input.customerName ? valueRow('ลูกค้า', input.customerName) : null,
    input.phone ? valueRow('โทร', input.phone) : null,
    valueRow('จำนวน', input.amount),
    unitText ? valueRow(noun.field, unitText, true) : null,
    valueRow('สถานะ', statusLabel(input.status), true),
  ].filter(Boolean) as Record<string, unknown>[];

  if (input.note) bodyRows.push(valueRow('หมายเหตุ', input.note));

  return {
    type: 'flex',
    altText: `${test ? 'TEST • ' : ''}${title} ${input.serviceName} ${thaiDate(input.startAt)} ${thaiTime(input.startAt)}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', spacing: 'xs', backgroundColor: test ? '#7A6536' : '#65704C', paddingAll: '16px',
        contents: [
          { type: 'text', text: `${test ? '🧪 TEST • ' : ''}${title}`, color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: input.serviceName, color: '#FFFFFF', weight: 'bold', size: 'xl', wrap: true },
          { type: 'text', text: input.teamLabel, color: '#F0EEE9', size: 'xs', wrap: true },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md', paddingAll: '16px',
        contents: [
          ...bodyRows,
          { type: 'separator', margin: 'md' },
          { type: 'text', text: `อ้างอิง ${input.bookingCode}`, size: 'xxs', color: '#A69C91', wrap: true, margin: 'md' },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: bookingFooter(input),
      },
    },
  };
}

async function bindingForTarget(targetId: string): Promise<BindingRow | null> {
  const hash = piiHash(targetId);
  if (!hash) return null;
  const response = await dbFetch(
    `ops_notification_channels?provider=eq.line&target_id_hash=eq.${hash}&enabled=eq.true&select=team_code&limit=1`,
  );
  return (await response.json() as BindingRow[])[0] ?? null;
}

async function bookingByCode(code: string): Promise<BookingUiRow | null> {
  const response = await dbFetch(
    `bookings?booking_code=eq.${encodeURIComponent(code)}`
    + '&select=id,booking_code,service_type,resource_id,start_at,end_at,party_size,quantity,status,environment&limit=1',
  );
  return (await response.json() as BookingUiRow[])[0] ?? null;
}

async function resourceInfo(resourceId: string): Promise<{ name: string; metadata: Record<string, unknown> }> {
  const response = await dbFetch(`service_resources?id=eq.${resourceId}&select=name,metadata&limit=1`);
  return (await response.json() as Array<{ name: string; metadata: Record<string, unknown> }>)[0]
    ?? { name: 'รายการ', metadata: {} };
}

async function assignedUnits(bookingId: string): Promise<UnitRow[]> {
  const assignmentResponse = await dbFetch(`booking_unit_assignments?booking_id=eq.${bookingId}&select=resource_id`);
  const assignments = await assignmentResponse.json() as Array<{ resource_id: string }>;
  if (!assignments.length) return [];
  const ids = assignments.map(row => row.resource_id).join(',');
  const response = await dbFetch(`service_resources?id=in.(${ids})&select=id,code,name,metadata`);
  const rows = await response.json() as UnitRow[];
  return rows.sort((a, b) => Number(a.metadata?.sort_order ?? 9999) - Number(b.metadata?.sort_order ?? 9999));
}

async function expectedUnits(booking: BookingUiRow): Promise<number> {
  const response = await dbFetch(`booking_allocations?booking_id=eq.${booking.id}&select=capacity_units`);
  const rows = await response.json() as Array<{ capacity_units: number }>;
  if (!rows.length) return Math.max(Number(booking.party_size ?? booking.quantity ?? 1), 1);
  return Math.max(...rows.map(row => Number(row.capacity_units) || 1));
}

async function allActivityUnits(booking: BookingUiRow): Promise<{ activityCode: string; units: UnitRow[] }> {
  const info = await resourceInfo(booking.resource_id);
  const activityCode = String(info.metadata?.activity_code ?? '');
  if (!activityCode) return { activityCode: '', units: [] };
  const response = await dbFetch(
    'service_resources?service_type=eq.activity&active=eq.true&requires_schedule=eq.false&select=id,code,name,metadata',
  );
  const rows = await response.json() as UnitRow[];
  return {
    activityCode,
    units: rows.filter(row => row.metadata?.activity_unit === true && String(row.metadata?.activity_code ?? '') === activityCode)
      .sort((a, b) => Number(a.metadata?.sort_order ?? 9999) - Number(b.metadata?.sort_order ?? 9999)),
  };
}

async function availableActivityUnits(booking: BookingUiRow): Promise<{ activityCode: string; units: UnitRow[] }> {
  const base = await allActivityUnits(booking);
  if (!base.units.length) return base;
  const ids = base.units.map(unit => unit.id).join(',');
  const assignmentResponse = await dbFetch(
    `booking_unit_assignments?resource_id=in.(${ids})&select=booking_id,resource_id`,
  );
  const assignments = await assignmentResponse.json() as Array<{ booking_id: string; resource_id: string }>;
  const otherBookingIds = [...new Set(assignments.map(row => row.booking_id).filter(id => id !== booking.id))];
  if (!otherBookingIds.length) return base;

  const bookingResponse = await dbFetch(
    `bookings?id=in.(${otherBookingIds.join(',')})&select=id,start_at,end_at,status,environment`,
  );
  const others = await bookingResponse.json() as Array<{
    id: string; start_at: string; end_at: string; status: string; environment: string;
  }>;
  const overlapping = new Set(
    others.filter(row => row.environment === booking.environment
      && ['requested', 'confirmed'].includes(row.status)
      && new Date(row.start_at).getTime() < new Date(booking.end_at).getTime()
      && new Date(row.end_at).getTime() > new Date(booking.start_at).getTime())
      .map(row => row.id),
  );
  const blocked = new Set(assignments.filter(row => overlapping.has(row.booking_id)).map(row => row.resource_id));
  return { activityCode: base.activityCode, units: base.units.filter(unit => !blocked.has(unit.id)) };
}

function combinations<T>(items: T[], size: number, limit = 8): T[][] {
  const result: T[][] = [];
  const walk = (start: number, picked: T[]) => {
    if (result.length >= limit) return;
    if (picked.length === size) {
      result.push([...picked]);
      return;
    }
    for (let i = start; i < items.length; i += 1) {
      picked.push(items[i]);
      walk(i + 1, picked);
      picked.pop();
      if (result.length >= limit) break;
    }
  };
  walk(0, []);
  return result;
}

async function compactManageCard(booking: BookingUiRow): Promise<LineMessage> {
  const info = await resourceInfo(booking.resource_id);
  const activityCode = booking.service_type === 'activity' ? String(info.metadata?.activity_code ?? '') : '';
  const units = booking.service_type === 'activity' ? await assignedUnits(booking.id) : [];
  const amount = booking.service_type === 'stay'
    ? `${booking.quantity || 1} หลัง${booking.party_size ? ` / ${booking.party_size} คน` : ''}`
    : `${booking.party_size ?? booking.quantity ?? 1} คน`;
  const teamLabels: Record<string, string> = {
    restaurant: 'ตำมา-ชาติ / ร้านอาหาร', stay: 'ทำมา-ชาติ เฮือนสเตย์', activity: 'ทำมา-ชาติ ผจญภัย',
  };
  return buildStaffBookingFlexMessage({
    bookingCode: booking.booking_code,
    serviceName: info.name,
    teamLabel: teamLabels[booking.service_type] ?? booking.service_type,
    status: booking.status,
    environment: booking.environment,
    startAt: booking.start_at,
    endAt: booking.end_at,
    amount,
    activityCode: activityCode || undefined,
    unitNames: units.map(unit => unit.name),
    backofficeUrl: booking.service_type === 'activity'
      ? 'https://tamma-backoffice.netlify.app/activity-bookings.html'
      : 'https://tamma-backoffice.netlify.app/',
  });
}

async function unitChoiceMessage(booking: BookingUiRow): Promise<LineMessage> {
  const { activityCode, units } = await availableActivityUnits(booking);
  const need = await expectedUnits(booking);
  const noun = activityNoun(activityCode);
  if (units.length < need) {
    return textMessage(`ตอนนี้${noun.singular}ว่างไม่พอสำหรับงานนี้ครับ กรุณาเลื่อนเวลาก่อน`);
  }
  const current = await assignedUnits(booking.id);
  const currentKey = new Set(current.map(unit => unit.id));
  const combos = combinations(units, need, 8).sort((a, b) => {
    const aCurrent = a.length === currentKey.size && a.every(unit => currentKey.has(unit.id));
    const bCurrent = b.length === currentKey.size && b.every(unit => currentKey.has(unit.id));
    return Number(bCurrent) - Number(aCurrent);
  });
  const buttons = combos.map(combo => {
    const names = combo.map(unit => unit.name).join(' + ');
    return actionButton(names, {
      type: 'postback',
      data: postbackData('set_units', booking.booking_code, { units: combo.map(unit => unit.code).join('|') }),
      displayText: `${noun.change}: ${names}`,
    }, combo.length === currentKey.size && combo.every(unit => currentKey.has(unit.id)));
  });
  return {
    type: 'flex',
    altText: `${noun.change}สำหรับ ${booking.booking_code}`,
    contents: {
      type: 'bubble', size: 'kilo',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#65704C', paddingAll: '16px',
        contents: [
          { type: 'text', text: `🔄 ${noun.change}`, color: '#FFFFFF', weight: 'bold', size: 'lg' },
          { type: 'text', text: 'กดชุดที่ต้องการได้เลย', color: '#F0EEE9', size: 'sm' },
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '14px',
        contents: [
          { type: 'text', text: `ต้องใช้ ${need} ${noun.singular}`, size: 'sm', color: '#7C7369', wrap: true },
          ...buttons,
          { type: 'button', style: 'secondary', height: 'sm', action: {
            type: 'postback', label: '← กลับ', data: postbackData('details', booking.booking_code), displayText: 'กลับ',
          } },
        ],
      },
    },
  };
}

function cancelConfirmMessage(booking: BookingUiRow, serviceName: string): LineMessage {
  return {
    type: 'template',
    altText: `ยืนยันยกเลิก ${serviceName}`,
    template: {
      type: 'confirm',
      text: `ยกเลิกงาน ${serviceName}\n${thaiDate(booking.start_at)} ${thaiTime(booking.start_at)} ใช่ไหม?`,
      actions: [
        { type: 'postback', label: 'ใช่ ยกเลิก', data: postbackData('cancel_do', booking.booking_code), displayText: 'ยืนยันยกเลิก' },
        { type: 'postback', label: 'ไม่ยกเลิก', data: postbackData('cancel_no', booking.booking_code), displayText: 'ไม่ยกเลิก' },
      ],
    },
  };
}

function simpleSuccess(label: string, detail?: string): LineMessage {
  return textMessage(`✅ ${label}${detail ? `\n${detail}` : ''}`);
}

export async function handleStaffBookingPostback(input: {
  targetId: string;
  userId?: string | null;
  data: string;
  params?: { datetime?: string; date?: string; time?: string } | null;
}): Promise<LineMessage[] | null> {
  const query = new URLSearchParams(input.data);
  if (query.get('ops') !== 'booking') return null;
  const action = query.get('action') ?? '';
  const code = (query.get('code') ?? '').toUpperCase();
  if (!/^BK-\d{6}-[A-Z0-9]{8}$/.test(code)) return [textMessage('รายการนี้ไม่ถูกต้องครับ')];

  const [binding, booking] = await Promise.all([bindingForTarget(input.targetId), bookingByCode(code)]);
  if (!binding) return [textMessage('กลุ่มนี้ยังไม่ได้ผูกทีมครับ')];
  if (!booking) return [textMessage('ไม่พบงานนี้ครับ')];
  if (binding.team_code === 'all' || binding.team_code !== booking.service_type) {
    return [textMessage('งานนี้ไม่ใช่ของทีมในกลุ่มนี้ครับ')];
  }

  const info = await resourceInfo(booking.resource_id);

  if (action === 'details') return [await compactManageCard(booking)];
  if (action === 'choose_units') {
    if (booking.service_type !== 'activity') return [textMessage('งานนี้ไม่มีรถ/ม้า/ช่องยิงให้เลือกครับ')];
    return [await unitChoiceMessage(booking)];
  }
  if (action === 'cancel_prompt') return [cancelConfirmMessage(booking, info.name)];
  if (action === 'cancel_no') return [textMessage('โอเคครับ งานยังอยู่เหมือนเดิม')];

  try {
    if (action === 'confirm') {
      const result = await handleBookingOpsCommand({ targetId: input.targetId, userId: input.userId, text: `ยืนยัน ${code}` });
      if (!result.reply?.startsWith('✅')) return [textMessage(result.reply ?? 'รับงานไม่สำเร็จครับ')];
      const fresh = await bookingByCode(code);
      const units = fresh && fresh.service_type === 'activity' ? await assignedUnits(fresh.id) : [];
      return [
        simpleSuccess('รับงานแล้ว', units.length ? `จัดให้: ${units.map(unit => unit.name).join(' + ')}\nแจ้งลูกค้าแล้ว` : 'แจ้งลูกค้าแล้ว'),
        fresh ? await compactManageCard(fresh) : textMessage('รับงานแล้วครับ'),
      ];
    }

    if (action === 'complete') {
      const result = await handleBookingOpsCommand({ targetId: input.targetId, userId: input.userId, text: `เสร็จงาน ${code}` });
      if (!result.reply?.startsWith('✅')) return [textMessage(result.reply ?? 'ปิดงานไม่สำเร็จครับ')];
      return [simpleSuccess('ปิดงานเรียบร้อยแล้ว')];
    }

    if (action === 'cancel_do') {
      const result = await handleBookingOpsCommand({ targetId: input.targetId, userId: input.userId, text: `ยกเลิก ${code}` });
      if (!result.reply?.startsWith('✅') && !result.reply?.startsWith('ℹ️')) {
        return [textMessage(result.reply ?? 'ยกเลิกไม่สำเร็จครับ')];
      }
      return [simpleSuccess('ยกเลิกงานแล้ว', 'คืนคิวและแจ้งลูกค้าแล้ว')];
    }

    if (action === 'set_units') {
      const raw = query.get('units') ?? '';
      const codes = raw.split('|').map(value => value.trim()).filter(Boolean);
      if (!codes.length) return [textMessage('ยังไม่ได้เลือกครับ')];
      const result = await handleBookingOpsCommand({
        targetId: input.targetId, userId: input.userId,
        text: `เปลี่ยนทรัพยากร ${code} ${codes.join(', ')}`,
      });
      if (!result.reply?.startsWith('✅')) return [textMessage(result.reply ?? 'เปลี่ยนไม่สำเร็จครับ')];
      const fresh = await bookingByCode(code);
      const units = fresh ? await assignedUnits(fresh.id) : [];
      return [
        simpleSuccess('เปลี่ยนเรียบร้อยแล้ว', units.map(unit => unit.name).join(' + ')),
        fresh ? await compactManageCard(fresh) : textMessage('เปลี่ยนเรียบร้อยแล้วครับ'),
      ];
    }

    if (action === 'reschedule') {
      const value = input.params?.datetime ?? '';
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!match) return [textMessage('ยังไม่ได้เลือกวันเวลาครับ')];
      const commandTime = `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}`;
      const result = await handleBookingOpsCommand({
        targetId: input.targetId, userId: input.userId,
        text: `เลื่อน ${code} ${commandTime}`,
      });
      if (!result.reply?.startsWith('✅')) return [textMessage(result.reply ?? 'เลื่อนเวลาไม่สำเร็จครับ')];
      const fresh = await bookingByCode(code);
      return [
        fresh ? simpleSuccess('เลื่อนเวลาแล้ว', `${thaiDate(fresh.start_at)} ${thaiTime(fresh.start_at)}–${thaiTime(fresh.end_at)}\nแจ้งลูกค้าแล้ว`) : simpleSuccess('เลื่อนเวลาแล้ว'),
        fresh ? await compactManageCard(fresh) : textMessage('เลื่อนเวลาแล้วครับ'),
      ];
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error ?? '');
    if (message.includes('activity_schedule_unavailable')) return [textMessage('เวลานี้เต็มครับ เลือกเวลาอื่นได้เลย')];
    if (message.includes('activity_units_unavailable')) return [textMessage('รถ/ม้า/ช่องยิงช่วงนี้ไม่พอครับ เลือกเวลาอื่นได้เลย')];
    if (message.includes('activity_unit_unavailable')) return [textMessage('รายการที่เลือกมีคนใช้อยู่ครับ กดเปลี่ยนแล้วเลือกชุดอื่นได้เลย')];
    console.error('OPS_LINE_UI_ERROR', message.slice(0, 300));
    return [textMessage('ทำรายการไม่สำเร็จครับ ข้อมูลเดิมยังอยู่ ลองกดใหม่อีกครั้ง')];
  }

  return null;
}
