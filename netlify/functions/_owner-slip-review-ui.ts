import type { LineMessage } from './_ops-line-ui';

/** Pure presentation/serialization only. Ownership, revisions and writes belong to the handler.
 * LINE limits: https://developers.line.biz/en/reference/messaging-api/#postback-action
 * https://developers.line.biz/en/reference/messaging-api/#flex-message
 * Postback data: 300 characters; this module uses the stricter 300 UTF-8 bytes.
 * Flex button labels: 40 characters. A bubble's JSON must be at most 30 KB.
 */
export const OWNER_SLIP_ACTION_PREFIX = 'owner-slip:';
export const OWNER_SLIP_ACTIONS = [
  'employee_advance', 'business', 'project', 'category', 'destination', 'installment',
  'document_kind', 'no_project', 'no_installment', 'show_business', 'show_project', 'show_category',
  'show_destination', 'show_installment', 'show_review', 'page', 'confirm', 'cancel', 'later',
] as const;
export type OwnerSlipActionName = typeof OWNER_SLIP_ACTIONS[number];
export type OwnerSlipAction = {
  id: string;
  revision: number;
  action: OwnerSlipActionName;
  value?: string;
};
export type OwnerSlipReviewStep = 'business' | 'project' | 'category' | 'destination' | 'installment' | 'confirm' | 'closed' | 'error';
export type OwnerSlipReviewCardInput = {
  id: string;
  revision: number;
  amount: number | null;
  date: string | null;
  memo: string;
  project: string | null;
  business: string | null;
  category: string | null;
  categorySuggested?: boolean;
  destination: string | null;
  installment: string | null;
  /** Omit for legacy callers; false hides installment controls unless a selection exists. */
  installmentApplicable?: boolean;
  /** A draft-only route; this control never confirms payroll. */
  employeeAdvanceAvailable?: boolean;
  step: OwnerSlipReviewStep;
  question?: string;
  choices?: Array<{ label: string; action: string; value?: string }>;
  error?: string;
  closedText?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const valueActions = new Set<string>(['business', 'project', 'category', 'destination', 'installment', 'page','document_kind']);
const actions = new Set<string>(OWNER_SLIP_ACTIONS);
const unsafeValue = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ud800-\udfff]/u;

function validateAction(input: unknown): input is OwnerSlipAction {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  const item = input as Record<string, unknown>;
  if (Object.keys(item).some(key => !['id', 'revision', 'action', 'value'].includes(key))) return false;
  if (typeof item.id !== 'string' || !UUID.test(item.id)) return false;
  if (!Number.isSafeInteger(item.revision) || (item.revision as number) < 0 || Object.is(item.revision, -0)) return false;
  if (typeof item.action !== 'string' || !actions.has(item.action)) return false;
  if (!valueActions.has(item.action)) return item.value === undefined;
  return typeof item.value === 'string' && item.value.length > 0 && item.value.length <= 160
    && item.value.trim() === item.value && !unsafeValue.test(item.value);
}

/** Never normalize IDs, revisions or values: a tap must reference exactly what was rendered. */
export function encodeOwnerSlipAction(input: { id: string; revision: number; action: string; value?: string }): string {
  if (!validateAction(input)) throw new TypeError('Invalid owner slip action');
  const payload = OWNER_SLIP_ACTION_PREFIX + JSON.stringify({
    id: input.id, revision: input.revision, action: input.action,
    ...(input.value !== undefined ? { value: input.value } : {}),
  });
  if (Buffer.byteLength(payload, 'utf8') > 300) throw new RangeError('Owner slip action exceeds 300 bytes');
  return payload;
}

/** Reject duplicate/unknown keys, malformed/noncanonical JSON and oversized payloads. */
export function decodeOwnerSlipAction(data: unknown): OwnerSlipAction | null {
  if (typeof data !== 'string' || !data.startsWith(OWNER_SLIP_ACTION_PREFIX) || Buffer.byteLength(data, 'utf8') > 300) return null;
  try {
    const parsed: unknown = JSON.parse(data.slice(OWNER_SLIP_ACTION_PREFIX.length));
    if (!validateAction(parsed) || encodeOwnerSlipAction(parsed) !== data) return null;
    return parsed;
  } catch {
    return null;
  }
}

const palette = { green: '#35654D', ink: '#20352B', muted: '#69796F', paper: '#F5F8F5', warning: '#9C472F' };
const questions: Record<OwnerSlipReviewStep, string> = {
  business: 'รายการนี้เป็นของกิจการไหนครับ?',
  project: 'ต้องการผูกกับโครงการไหนครับ?',
  category: 'รายการนี้อยู่ในหมวดไหนครับ?',
  destination: 'ต้องการบันทึกรายการนี้ไว้ที่ไหนครับ?',
  installment: 'รายการนี้เป็นการจ่ายงวดไหนครับ?',
  confirm: 'ตรวจสอบข้อมูล แล้วกดยืนยันบันทึกครับ',
  closed: 'ตรวจสอบรายการเรียบร้อย',
  error: 'ยังดำเนินการต่อไม่ได้ครับ',
};

/** Conservative UTF-16 limit is safe under LINE's label/grapheme limit, without splitting emoji. */
function shorten(value: string, max: number): string {
  if (value.length <= max) return value;
  let prefix = value.slice(0, max - 1);
  if (/[\ud800-\udbff]$/.test(prefix)) prefix = prefix.slice(0, -1);
  return prefix + '…';
}

function text(value: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { type: 'text', text: value || '—', size: 'sm', color: palette.ink, wrap: true, ...extra };
}

function valueRow(label: string, value: string): Record<string, unknown> {
  return {
    type: 'box', layout: 'baseline', spacing: 'md',
    contents: [text(label, { color: palette.muted, size: 'xs', flex: 3 }), text(shorten(value, 500), { flex: 7 })],
  };
}

function actionButton(input: OwnerSlipReviewCardInput, label: string, action: string, value?: string, style: 'primary' | 'secondary' | 'link' = 'secondary'): Record<string, unknown> {
  if (!label.trim()) throw new TypeError('Owner slip choice requires a visible label');
  if (action === 'cancel' && /ไว้ก่อน|ภายหลัง|ทีหลัง/u.test(label)) throw new TypeError('Deferring a slip must not cancel it');
  return {
    type: 'button', style, height: 'sm',
    ...(style === 'primary' || style === 'link' ? { color: palette.green } : {}),
    action: {
      type: 'postback', label: shorten(label, 40),
      data: encodeOwnerSlipAction({ id: input.id, revision: input.revision, action, ...(value !== undefined ? { value } : {}) }),
      displayText: shorten(label, 300),
    },
  };
}

export function buildOwnerSlipReviewCard(input: OwnerSlipReviewCardInput): LineMessage {
  // Validate the exact identity even when this is a closed, action-free card.
  encodeOwnerSlipAction({ id: input.id, revision: input.revision, action: 'later' });
  if (!Object.prototype.hasOwnProperty.call(questions, input.step)) throw new TypeError('Invalid owner slip review step');
  if (input.amount !== null && (!Number.isFinite(input.amount) || input.amount < 0)) throw new TypeError('Invalid owner slip amount');
  if ((input.choices?.length ?? 0) > 12) throw new RangeError('Page owner slip choices before rendering');
  const closed = input.step === 'closed';
  const confirm = input.step === 'confirm';
  const showInstallment = input.installmentApplicable !== false || Boolean(input.installment);
  if (confirm && (input.amount === null || input.amount <= 0 || !input.date || !input.memo.trim() || !input.business || !input.category || !input.destination)) {
    throw new TypeError('Cannot render confirmation with incomplete slip details');
  }
  const amount = input.amount === null ? 'ยอดเงินรอตรวจสอบ' : `${new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(input.amount)} บาท`;
  const question = shorten(closed ? input.closedText || questions.closed : input.error || input.question || questions[input.step], 1000);
  const summary: Record<string, unknown>[] = [
    text(amount, { size: 'xxl', weight: 'bold', color: palette.green }),
    text(shorten(input.memo.trim() || 'ยังอ่านโน้ตในสลิปไม่ชัด', 1000), { size: 'md', weight: 'bold' }),
    ...(input.date ? [valueRow('วันที่', input.date)] : []),
    ...(input.business ? [valueRow('ร้าน/กิจการ', input.business)] : []),
    ...(input.category ? [valueRow(input.categorySuggested ? 'หมวดที่เสนอ' : 'หมวด', input.category)] : []),
    ...(input.destination ? [valueRow('บันทึกเป็น', input.destination)] : []),
    ...(input.project ? [valueRow('โครงการ', input.project)] : confirm ? [valueRow('โครงการ', 'ไม่ผูกโครงการ')] : []),
    ...(showInstallment ? input.installment ? [valueRow('งวด', input.installment)] : confirm ? [valueRow('งวด', 'ไม่ผูกงวด')] : [] : []),
    { type: 'separator', margin: 'md' },
    text(question, { weight: 'bold', size: 'md', margin: 'md', ...(input.step === 'error' ? { color: palette.warning } : {}) }),
  ];

  const footer: Record<string, unknown>[] = [];
  if (!closed) {
    if (confirm) {
      footer.push(actionButton(input, 'ยืนยันบันทึก', 'confirm', undefined, 'primary'));
      footer.push(text('แก้ไขข้อมูล', { size: 'xs', color: palette.muted, margin: 'md' }));
      const edits = [
        ['กิจการ', 'show_business'], ['โครงการ', 'show_project'], ['หมวด', 'show_category'],
        ['ประเภทค่าใช้จ่าย', 'show_destination'], ...(showInstallment ? [['งวด', 'show_installment']] : []),
      ];
      for (let i = 0; i < edits.length; i += 2) {
        footer.push({ type: 'box', layout: 'horizontal', spacing: 'sm', contents: edits.slice(i, i + 2).map(([label, action]) => actionButton(input, label, action, undefined, 'link')) });
      }
    } else {
      for (const choice of input.choices ?? []) {
        // Show a long catalogue name in full above its button, so similar names stay distinguishable.
        if (choice.label.length > 40) footer.push(text(shorten(choice.label, 500), { size: 'xs', margin: 'md' }));
        footer.push(actionButton(input, choice.label, choice.action, choice.value));
      }
      if (!input.choices?.length && input.step !== 'error') {
        footer.push(text('ยังไม่มีตัวเลือกที่ใช้ได้ กรุณาตรวจสอบข้อมูลรายการนี้', { size: 'xs', color: palette.muted }));
      }
    }
    if (input.employeeAdvanceAvailable) footer.push(actionButton(input, 'เงินเบิกพนักงาน', 'employee_advance'));
    footer.push(actionButton(input, 'ไว้ก่อน', 'later', undefined, 'link'));
  }

  const bubble = {
    type: 'bubble', size: 'mega',
    header: {
      type: 'box', layout: 'vertical', backgroundColor: palette.paper, paddingAll: '16px', spacing: 'xs',
      contents: [
        text(closed ? 'สถานะสลิป' : confirm ? 'ตรวจสอบก่อนบันทึก' : 'ตรวจสลิป', { weight: 'bold', size: 'lg' }),
        ...(!closed ? [text('ยังไม่บันทึกรายจ่าย', { size: 'xs', color: palette.muted })] : []),
      ],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: summary },
    ...(footer.length ? { footer: { type: 'box', layout: 'vertical', spacing: 'sm', paddingAll: '16px', contents: footer } } : {}),
  };
  if (Buffer.byteLength(JSON.stringify(bubble), 'utf8') > 30_000) throw new RangeError('Owner slip bubble exceeds LINE size limit');
  return {
    type: 'flex', altText: shorten(`${closed ? 'สถานะสลิป' : 'ตรวจสลิป'} ${amount} • ${input.memo || 'โน้ตรอตรวจสอบ'} • ${question}`, 400),
    contents: bubble,
  };
}
