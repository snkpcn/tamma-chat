/** Pure LINE presentation and serialization. No I/O, arithmetic reconciliation or writes.
 * The handler must reload this exact day/revision and verify the owner before confirming.
 * A button is a review request, never authorization or proof that a close was confirmed.
 */
export const INTHANIN_CLOSE_ACTION_PREFIX = 'inthanin-close:';
export const INTHANIN_CLOSE_ACTIONS = ['check', 'edit', 'confirm'] as const;
export type InthaninDailyCloseActionName = typeof INTHANIN_CLOSE_ACTIONS[number];
export type InthaninDailyCloseAction = {
  id: string;
  localDate: string;
  revision: number;
  action: InthaninDailyCloseActionName;
};
export type InthaninDailyCloseIssue = {
  code?: string;
  message?: string;
  amount?: number | null;
  count?: number | null;
};
export type InthaninDailyCloseCardInput = {
  id: string;
  localDate: string;
  revision: number;
  status: string;
  netSales: number | null;
  paymentCash: number | null;
  paymentQr: number | null;
  paymentsTotal: number | null;
  salesVariance: number | null;
  drawerOutflow: number | null;
  openingFloat: number | null;
  countedClosing: number | null;
  readyToConfirm: boolean;
  /** Server-provided availability explanation; always suppresses the confirm button. */
  confirmationUnavailableReason?: string;
  blockers: InthaninDailyCloseIssue[];
  warnings: InthaninDailyCloseIssue[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const actionNames = new Set<string>(INTHANIN_CLOSE_ACTIONS);
const actionKeys = ['id', 'localDate', 'revision', 'action'];
const palette = {
  green: '#35654D', ink: '#20352B', muted: '#69796F', paper: '#F5F8F5',
  danger: '#9C472F', dangerPaper: '#FFF1EC', amber: '#8A5A13', amberPaper: '#FFF8E8',
};

function validLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validAction(input: unknown): input is InthaninDailyCloseAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const item = input as Record<string, unknown>;
  const keys = Object.keys(item);
  return keys.length === actionKeys.length && keys.every(key => actionKeys.includes(key))
    && typeof item.id === 'string' && UUID.test(item.id)
    && validLocalDate(item.localDate)
    && Number.isSafeInteger(item.revision) && (item.revision as number) >= 1
    && typeof item.action === 'string' && actionNames.has(item.action);
}

/** Canonical JSON binds every action to an exact close, calendar day and revision. */
export function encodeInthaninDailyCloseAction(input: InthaninDailyCloseAction): string {
  if (!validAction(input)) throw new TypeError('Invalid Inthanin daily close action');
  const data = INTHANIN_CLOSE_ACTION_PREFIX + JSON.stringify({
    id: input.id, localDate: input.localDate, revision: input.revision, action: input.action,
  });
  if (Buffer.byteLength(data, 'utf8') > 300) throw new RangeError('Daily close action exceeds LINE limit');
  return data;
}

/** Reject old unbound formats, duplicate/unknown fields, coercions and noncanonical JSON. */
export function decodeInthaninDailyCloseAction(data: unknown): InthaninDailyCloseAction | null {
  if (typeof data !== 'string' || !data.startsWith(INTHANIN_CLOSE_ACTION_PREFIX)
    || Buffer.byteLength(data, 'utf8') > 300) return null;
  try {
    const parsed: unknown = JSON.parse(data.slice(INTHANIN_CLOSE_ACTION_PREFIX.length));
    return validAction(parsed) && encodeInthaninDailyCloseAction(parsed) === data ? parsed : null;
  } catch {
    return null;
  }
}

function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  let prefix = value.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

function text(value: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'text', text: value || '—', size: 'xs', color: palette.ink, wrap: true, ...extra };
}

const numberFormat = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (value: number | null): string => value === null ? 'ยังไม่มีข้อมูล' : numberFormat.format(value);
const amountKeys = ['netSales', 'paymentCash', 'paymentQr', 'paymentsTotal', 'salesVariance', 'drawerOutflow', 'openingFloat', 'countedClosing'] as const;
type AmountKey = typeof amountKeys[number];
const labels: Record<AmountKey, string> = {
  netSales: 'ยอดขายสุทธิ', paymentCash: 'รับเงินสด', paymentQr: 'รับ QR / โอน',
  paymentsTotal: 'รับเงินรวม', salesVariance: 'ส่วนต่างรับเงิน', drawerOutflow: 'จ่ายจากลิ้นชัก',
  openingFloat: 'เงินทอนตั้งต้น', countedClosing: 'นับลิ้นชักจริง',
};

function amountRow(input: InthaninDailyCloseCardInput, key: AmountKey): Record<string, unknown> {
  const value = input[key];
  const mismatch = key === 'salesVariance' && value !== null && value !== 0;
  const important = key === 'netSales' || key === 'paymentsTotal';
  return {
    type: 'box', layout: 'horizontal', spacing: 'sm', paddingAll: '6px',
    backgroundColor: mismatch || value === null ? palette.dangerPaper : important ? palette.paper : '#FFFFFF',
    contents: [
      text(labels[key], { flex: 5, weight: important || mismatch ? 'bold' : 'regular' }),
      text(money(value), { flex: 4, align: 'end', weight: important || mismatch ? 'bold' : 'regular',
        color: mismatch || value === null ? palette.danger : palette.ink }),
    ],
  };
}

function issueLabel(issue: InthaninDailyCloseIssue): string {
  const label = issue.message?.trim() || issue.code?.trim() || 'ต้องตรวจสอบเพิ่มเติม';
  const details = [
    ...(issue.amount !== undefined && issue.amount !== null ? [money(issue.amount) + ' บาท'] : []),
    ...(issue.count !== undefined && issue.count !== null ? [issue.count + ' รายการ'] : []),
  ];
  return shorten(label, 220) + (details.length ? ' · ' + details.join(' · ') : '');
}

function issueSection(title: string, items: InthaninDailyCloseIssue[], warning = false): Record<string, unknown>[] {
  if (!items.length) return [];
  const color = warning ? palette.amber : palette.danger;
  return [{
    type: 'box', layout: 'vertical', spacing: 'xs', margin: 'md', paddingAll: '10px',
    backgroundColor: warning ? palette.amberPaper : palette.dangerPaper,
    contents: [
      text(title, { weight: 'bold', color }),
      ...items.slice(0, 6).map(item => text('• ' + issueLabel(item), { color })),
      ...(items.length > 6 ? [text('ยังมีอีก ' + (items.length - 6) + ' รายการ กรุณาตรวจใน Backoffice', { color })] : []),
    ],
  }];
}

function button(input: InthaninDailyCloseCardInput, label: string, action: InthaninDailyCloseActionName,
  primary = false): Record<string, unknown> {
  return {
    type: 'button', style: primary ? 'primary' : 'secondary', height: 'sm',
    ...(primary ? { color: palette.green } : {}),
    action: {
      type: 'postback', label,
      data: encodeInthaninDailyCloseAction({ id: input.id, localDate: input.localDate, revision: input.revision, action }),
      displayText: label + ' ' + input.localDate + ' · ฉบับ ' + input.revision,
    },
  };
}

/** One compact reply message. The caller owns routing, authorization and LINE's 5-message cap. */
export function buildInthaninDailyCloseCard(input: InthaninDailyCloseCardInput): Record<string, unknown> {
  encodeInthaninDailyCloseAction({ id: input.id, localDate: input.localDate, revision: input.revision, action: 'check' });
  if (typeof input.status !== 'string' || !input.status.trim() || typeof input.readyToConfirm !== 'boolean') {
    throw new TypeError('Invalid daily close status');
  }
  if (input.confirmationUnavailableReason !== undefined
    && (typeof input.confirmationUnavailableReason !== 'string' || !input.confirmationUnavailableReason.trim())) {
    throw new TypeError('Invalid daily close confirmation availability');
  }
  for (const key of amountKeys) {
    if (input[key] !== null && (typeof input[key] !== 'number' || !Number.isFinite(input[key]))) {
      throw new TypeError('Invalid daily close amount: ' + key);
    }
  }
  for (const items of [input.blockers, input.warnings]) {
    if (!Array.isArray(items)) throw new TypeError('Invalid daily close issues');
    for (const item of items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)
        || (item.message !== undefined && typeof item.message !== 'string')
        || (item.code !== undefined && typeof item.code !== 'string')
        || (item.amount !== undefined && item.amount !== null && (typeof item.amount !== 'number' || !Number.isFinite(item.amount)))
        || (item.count !== undefined && item.count !== null && (!Number.isSafeInteger(item.count) || item.count < 0))) {
        throw new TypeError('Invalid daily close issue');
      }
    }
  }

  const confirmed = input.status === 'confirmed';
  const voided = input.status === 'void';
  const reviewable = ['draft', 'pending_confirmation', 'submitted'].includes(input.status);
  const missing = amountKeys.filter(key => input[key] === null);
  const mismatch = input.salesVariance !== null && input.salesVariance !== 0;
  const unavailableReason = input.confirmationUnavailableReason === undefined ? null : shorten(input.confirmationUnavailableReason, 1000);
  // Presentation fails closed if the readiness flag contradicts visible data.
  // This is not the authorization gate: all checks must be repeated by the backend on every tap.
  const canConfirm = reviewable && input.readyToConfirm && !unavailableReason && input.blockers.length === 0 && missing.length === 0 && !mismatch;
  const status = confirmed ? 'ยืนยันปิดวันแล้ว' : voided ? 'VOID · ยกเลิกรายการแล้ว'
    : input.status === 'draft' ? 'DRAFT · ยังไม่ยืนยันปิดวัน'
      : ['pending_confirmation', 'submitted'].includes(input.status) ? 'ส่งรายงานแล้ว · ยังไม่ยืนยันปิดวัน' : 'สถานะไม่รองรับ · ต้องตรวจสอบ';
  const readiness = confirmed ? 'ข้อมูลปิดวันถูกล็อกแล้ว'
    : voided ? 'รายการที่ยกเลิกแล้วไม่สามารถยืนยันปิดวันได้'
      : !reviewable ? 'ยังยืนยันไม่ได้ · กรุณาตรวจสถานะใน Backoffice' : unavailableReason ?? (canConfirm
    ? 'พร้อมให้นุ๊กตรวจและยืนยันปิดวัน' : 'ยังยืนยันไม่ได้ · ตรวจข้อมูลที่ขาดหรือไม่ตรง');
  const body: Record<string, unknown>[] = [
    text('รายการรายวัน', { size: 'sm', weight: 'bold' }),
    text('บาท · ตัวเลขตามรายงานและผลตรวจล่าสุด', { color: palette.muted }),
    ...amountKeys.map(key => amountRow(input, key)),
    ...(missing.length ? [text('ข้อมูลยังไม่ครบ: ' + missing.map(key => labels[key]).join(' / '), { color: palette.danger, margin: 'md' })] : []),
    ...(mismatch ? [text('ยอดรับเงินกับยอดขายไม่ตรง กรุณาตรวจส่วนต่างรับเงิน', { color: palette.danger, weight: 'bold', margin: 'md' })] : []),
    ...issueSection('ต้องแก้ก่อนยืนยัน', input.blockers),
    ...issueSection('ข้อควรตรวจสอบ', input.warnings, true),
    { type: 'separator', margin: 'md' },
    text(readiness, { weight: 'bold', color: confirmed || canConfirm ? palette.green : reviewable && unavailableReason ? palette.amber : palette.danger, margin: 'md' }),
    text(confirmed ? 'หากพบยอดผิด ให้แก้ผ่าน Adjustment พร้อมเหตุผลใน Backoffice'
      : reviewable ? 'พนักงานส่งรายงานได้ การยืนยันเป็นของนุ๊ก (เจ้าของ) เท่านั้น'
        : 'ใช้ปุ่มตรวจล่าสุดเพื่อดูสถานะของวัน ' + input.localDate, { color: palette.muted }),
  ];
  const footer: Record<string, unknown>[] = [
    { type: 'box', layout: 'horizontal', spacing: 'sm', contents: [
      button(input, 'ตรวจล่าสุด', 'check'),
      ...(reviewable ? [button(input, 'ตรวจ / แก้ไข', 'edit')] : []),
    ] },
    ...(canConfirm ? [button(input, 'นุ๊กยืนยันปิดวัน', 'confirm', true)] : []),
    ...(reviewable ? [text('ปุ่มแก้ไขใช้ตรวจวัน ' + input.localDate + ' และแก้ผ่าน Backoffice', { color: palette.muted })] : []),
  ];
  const contents = {
    type: 'bubble', size: 'mega',
    header: { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '16px', backgroundColor: palette.paper,
      contents: [
        text('อินทนิลตาดโตน · ปิดยอดรายวัน', { size: 'md', weight: 'bold', color: palette.green }),
        text(input.localDate + ' · ฉบับ ' + input.revision, { color: palette.muted }),
        text(status, { size: 'sm', weight: 'bold', color: confirmed ? palette.green : palette.amber }),
      ] },
    body: { type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '16px', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: footer },
  };
  if (Buffer.byteLength(JSON.stringify(contents), 'utf8') > 30_000) throw new RangeError('Daily close bubble exceeds LINE limit');
  return {
    type: 'flex',
    altText: shorten(`อินทนิล ${input.localDate} · ${status} · ขาย ${money(input.netSales)} · รับรวม ${money(input.paymentsTotal)} · ส่วนต่าง ${money(input.salesVariance)} · ${readiness}`, 500),
    contents,
  };
}

/** A rejected/incomplete staff form has no canonical close identity and no actions. */
export function buildInthaninMissingCloseCard(missingReplyText: string): Record<string, unknown> {
  if (typeof missingReplyText !== 'string' || !missingReplyText.trim()) {
    throw new TypeError('Missing daily close explanation required');
  }
  const explanation = shorten(missingReplyText, 3000);
  const status = 'ข้อมูลปิดยอดยังไม่ครบ · ยังไม่บันทึก';
  const contents = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', spacing: 'xs', paddingAll: '16px', backgroundColor: palette.paper,
      contents: [
        text('อินทนิลตาดโตน · ปิดยอดรายวัน', { size: 'md', weight: 'bold', color: palette.green }),
        text(status, { size: 'sm', weight: 'bold', color: palette.danger }),
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [text(explanation, { size: 'sm', color: palette.danger })],
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px',
      contents: [
        text('กรุณาเติมเฉพาะข้อมูลที่ระบุว่าขาด แล้วส่งรายงานอีกครั้ง', { weight: 'bold' }),
        text('เมื่อข้อมูลครบแล้ว ให้นุ๊ก (เจ้าของ) ตรวจและยืนยันปิดวัน', { color: palette.muted }),
      ],
    },
  };
  if (Buffer.byteLength(JSON.stringify(contents), 'utf8') > 30_000) throw new RangeError('Missing close bubble exceeds LINE limit');
  return { type: 'flex', altText: shorten('อินทนิล · ' + status + ' · ' + explanation, 500), contents };
}
