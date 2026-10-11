import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildInthaninDailyCloseCard, buildInthaninMissingCloseCard, decodeInthaninDailyCloseAction, encodeInthaninDailyCloseAction,
  INTHANIN_CLOSE_ACTION_PREFIX, INTHANIN_CLOSE_ACTIONS,
  type InthaninDailyCloseAction, type InthaninDailyCloseCardInput,
} from '../netlify/functions/_inthanin-daily-close-card';

const identity = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', localDate: '2037-10-11', revision: 3 };
const action = (): InthaninDailyCloseAction => ({ ...identity, action: 'check' });
const input = (): InthaninDailyCloseCardInput => ({
  ...identity, status: 'draft', netSales: 1234, paymentCash: 434, paymentQr: 800,
  paymentsTotal: 1234, salesVariance: 0, drawerOutflow: 34, openingFloat: 500,
  countedClosing: 900, readyToConfirm: true, blockers: [], warnings: [],
});
const raw = (payload: unknown): string => INTHANIN_CLOSE_ACTION_PREFIX + JSON.stringify(payload);
function nodes(value: unknown): Array<Record<string, unknown>> {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [value as Record<string, unknown>, ...Object.values(value).flatMap(nodes)];
}
const renderedActions = (card: Record<string, unknown>) => nodes(card)
  .filter(node => node.type === 'postback').map(node => decodeInthaninDailyCloseAction(node.data)!);
const visibleText = (card: Record<string, unknown>) => nodes(card)
  .filter(node => node.type === 'text').map(node => node.text).join('\n');

test('all postbacks carry the exact UUID, ISO day, safe positive revision and action', () => {
  for (const name of INTHANIN_CLOSE_ACTIONS) {
    const payload = { ...action(), action: name };
    const encoded = encodeInthaninDailyCloseAction(payload);
    assert.deepEqual(decodeInthaninDailyCloseAction(encoded), payload);
    assert.ok(Buffer.byteLength(encoded, 'utf8') <= 300);
  }
});

test('invalid action fields and extra financial or authority data fail closed', () => {
  const invalid: unknown[] = [null, [], 'check', {},
    ...['', 'check ', 'CONFIRM', 'delete', 'approve'].map(value => ({ ...action(), action: value })),
    ...['', 'not-a-uuid', identity.id.toUpperCase(), identity.id + ' ', 123].map(id => ({ ...action(), id })),
    ...['2037-02-30', '2025-02-29', '2037-13-01', '0000-01-01', '11/10/2026', '2037-1-01', '2037-10-11T00:00:00Z', null].map(localDate => ({ ...action(), localDate })),
    ...[0, -0, -1, 1.5, '3', null, Number.MAX_SAFE_INTEGER + 1].map(revision => ({ ...action(), revision })),
    { ...action(), readyToConfirm: true }, { ...action(), amount: 0 }, { ...action(), actor: 'owner' },
    { ...action(), value: 'confirmed' }, { id: identity.id, action: 'check' },
  ];
  for (const payload of invalid) {
    assert.equal(decodeInthaninDailyCloseAction(raw(payload)), null, JSON.stringify(payload));
    assert.throws(() => encodeInthaninDailyCloseAction(payload as InthaninDailyCloseAction), TypeError);
  }
  for (const revision of [NaN, Infinity, -Infinity]) {
    assert.throws(() => encodeInthaninDailyCloseAction({ ...action(), revision }), TypeError);
  }
});

test('decoder rejects legacy, duplicate-field, reordered, escaped, oversized and noncanonical formats', () => {
  const encoded = encodeInthaninDailyCloseAction(action());
  const invalid: unknown[] = [undefined, null, 42, '', 'owner-slip:' + encoded.split(':').slice(1).join(':'),
    'inthanin-close:confirm:' + identity.id, raw({ id: identity.id, action: 'confirm', revision: 3 }),
    encoded.replace('"revision":3', '"revision":3,"revision":4'),
    encoded.replace('"action":"check"', '"action":"confirm","action":"check"'),
    encoded.replace('"revision":3', '"revision":3.0'),
    encoded.replace('"revision":3', '"revision":3e0'),
    encoded.replace('"localDate"', '"local\\u0044ate"'),
    INTHANIN_CLOSE_ACTION_PREFIX + JSON.stringify(action(), null, 2),
    raw({ action: 'check', ...identity }), encoded + ' ', encoded + '\n',
    encoded.slice(0, -1), encoded + 'x'.repeat(301),
  ];
  for (const payload of invalid) assert.equal(decodeInthaninDailyCloseAction(payload), null, String(payload));
  assert.ok(decodeInthaninDailyCloseAction(encodeInthaninDailyCloseAction({ ...action(), localDate: '2028-02-29' })));
});

test('mobile card is a single bounded Flex bubble with exact-day revision-bound actions', () => {
  const card = buildInthaninDailyCloseCard(input());
  assert.equal(card.type, 'flex');
  assert.ok(typeof card.altText === 'string' && card.altText.length <= 500);
  assert.equal((card.contents as Record<string, unknown>).type, 'bubble');
  assert.ok(Buffer.byteLength(JSON.stringify(card.contents), 'utf8') <= 30_000);
  assert.deepEqual(renderedActions(card).map(item => item.action), ['check', 'edit', 'confirm']);
  assert.ok(renderedActions(card).every(item => item.id === identity.id && item.localDate === identity.localDate && item.revision === 3));
  assert.match(visibleText(card), /DRAFT · ยังไม่ยืนยันปิดวัน/);
  assert.match(visibleText(card), /นุ๊ก \(เจ้าของ\) เท่านั้น/);
  assert.match(visibleText(card), /แก้ผ่าน Backoffice/);
  assert.ok(nodes(card).filter(node => node.type === 'postback').every(node => typeof node.label === 'string' && node.label.length <= 40));
});

test('zero remains visible and unknown is never displayed as zero or silently calculated', () => {
  const values = input();
  values.netSales = 0; values.paymentCash = 0; values.paymentQr = null; values.paymentsTotal = null;
  const card = buildInthaninDailyCloseCard(values);
  const rows = nodes(card).filter(node => node.type === 'box' && node.layout === 'horizontal');
  const rowText = (label: string) => rows.map(row => visibleText(row)).find(value => value.startsWith(label + '\n'));
  assert.equal(rowText('ยอดขายสุทธิ'), 'ยอดขายสุทธิ\n0.00');
  assert.equal(rowText('รับเงินสด'), 'รับเงินสด\n0.00');
  assert.equal(rowText('รับ QR / โอน'), 'รับ QR / โอน\nยังไม่มีข้อมูล');
  assert.equal(rowText('รับเงินรวม'), 'รับเงินรวม\nยังไม่มีข้อมูล');
  assert.match(visibleText(card), /ข้อมูลยังไม่ครบ: รับ QR \/ โอน \/ รับเงินรวม/);
  assert.ok(!renderedActions(card).some(item => item.action === 'confirm'));
});

test('all-null day stays missing, while an explicitly zero-valued day can be reviewed', () => {
  const values = input();
  const keys = ['netSales', 'paymentCash', 'paymentQr', 'paymentsTotal', 'salesVariance', 'drawerOutflow', 'openingFloat', 'countedClosing'] as const;
  keys.forEach(key => { values[key] = null; });
  const missing = buildInthaninDailyCloseCard(values);
  assert.equal((visibleText(missing).match(/ยังไม่มีข้อมูล/g) ?? []).length, 8);
  assert.doesNotMatch(visibleText(missing), /0\.00/);
  assert.ok(!renderedActions(missing).some(item => item.action === 'confirm'));
  keys.forEach(key => { values[key] = 0; });
  const zero = buildInthaninDailyCloseCard(values);
  assert.equal((visibleText(zero).match(/0\.00/g) ?? []).length, 8);
  assert.ok(renderedActions(zero).some(item => item.action === 'confirm'));
});

test('blockers always hide confirmation even when readiness is inconsistent', () => {
  const values = input();
  values.blockers = [{ code: 'missing_pos', message: 'ยังไม่มีรูป POS', amount: 0, count: 0 }];
  const card = buildInthaninDailyCloseCard(values);
  assert.match(visibleText(card), /ต้องแก้ก่อนยืนยัน/);
  assert.match(visibleText(card), /ยังไม่มีรูป POS · 0\.00 บาท · 0 รายการ/);
  assert.ok(!renderedActions(card).some(item => item.action === 'confirm'));
  assert.match(visibleText(card), /ยังยืนยันไม่ได้/);
});

test('nonzero sales variance is highlighted and prevents confirmation without invented reconciliation', () => {
  for (const salesVariance of [25, -25]) {
    const card = buildInthaninDailyCloseCard({ ...input(), salesVariance });
    assert.match(visibleText(card), /ยอดรับเงินกับยอดขายไม่ตรง/);
    assert.ok(nodes(card).some(node => node.type === 'text' && node.text === salesVariance.toFixed(2) && node.color === '#9C472F'));
    assert.ok(!renderedActions(card).some(item => item.action === 'confirm'));
  }
});

test('readiness false hides confirmation and warnings remain visible without becoming approval', () => {
  const values = { ...input(), readyToConfirm: false, warnings: [{ message: 'ตรวจรายจ่ายอีกครั้ง' }] };
  assert.ok(!renderedActions(buildInthaninDailyCloseCard(values)).some(item => item.action === 'confirm'));
  const ready = buildInthaninDailyCloseCard({ ...values, readyToConfirm: true });
  assert.match(visibleText(ready), /ข้อควรตรวจสอบ\n• ตรวจรายจ่ายอีกครั้ง/);
  assert.match(visibleText(ready), /DRAFT · ยังไม่ยืนยันปิดวัน/);
  assert.ok(renderedActions(ready).some(item => item.action === 'confirm'));
});

test('disabled LINE confirmation explains availability without falsely claiming missing financial data', () => {
  const reason = 'ข้อมูลผ่านการตรวจแล้ว แต่ปุ่มยืนยันใน LINE ยังไม่เปิดใช้งาน กรุณายืนยันผ่านหลังบ้าน';
  for (const readyToConfirm of [false, true]) {
    const card = buildInthaninDailyCloseCard({ ...input(), readyToConfirm, confirmationUnavailableReason: reason });
    assert.deepEqual(renderedActions(card).map(item => item.action), ['check', 'edit']);
    assert.ok(visibleText(card).includes(reason));
    assert.ok((card.altText as string).includes(reason));
    assert.doesNotMatch(visibleText(card), /ตรวจข้อมูลที่ขาดหรือไม่ตรง|ข้อมูลยังไม่ครบ|พร้อมให้นุ๊ก/);
    assert.match(visibleText(card), /DRAFT · ยังไม่ยืนยันปิดวัน/);
  }
  for (const confirmationUnavailableReason of ['', ' ', null, false]) {
    assert.throws(() => buildInthaninDailyCloseCard({ ...input(), confirmationUnavailableReason } as InthaninDailyCloseCardInput), TypeError);
  }
  const long = buildInthaninDailyCloseCard({ ...input(), confirmationUnavailableReason: reason.repeat(1000) });
  assert.ok((long.altText as string).length <= 500);
  assert.ok(Buffer.byteLength(JSON.stringify(long.contents), 'utf8') <= 30_000);
});

test('confirmed closes have no edit or confirm button and clearly require adjustments', () => {
  const card = buildInthaninDailyCloseCard({ ...input(), status: 'confirmed' });
  assert.deepEqual(renderedActions(card).map(item => item.action), ['check']);
  assert.match(visibleText(card), /ยืนยันปิดวันแล้ว/);
  assert.match(visibleText(card), /Adjustment พร้อมเหตุผล/);
  assert.doesNotMatch(visibleText(card), /DRAFT|พร้อมให้นุ๊ก/);
});

test('void closes clearly show cancellation and hide edit and confirm despite readiness', () => {
  const card = buildInthaninDailyCloseCard({ ...input(), status: 'void' });
  assert.deepEqual(renderedActions(card).map(item => item.action), ['check']);
  assert.match(visibleText(card), /VOID · ยกเลิกรายการแล้ว/);
  assert.match(visibleText(card), /รายการที่ยกเลิกแล้วไม่สามารถยืนยันปิดวันได้/);
  assert.match(card.altText as string, /ยกเลิกรายการแล้ว/);
  assert.doesNotMatch(visibleText(card), /DRAFT|พร้อมให้นุ๊ก|ปุ่มแก้ไข/);
});

test('only draft and submitted statuses permit review and confirmation; unknown statuses fail closed', () => {
  for (const status of ['draft', 'submitted']) {
    const card = buildInthaninDailyCloseCard({ ...input(), status });
    assert.deepEqual(renderedActions(card).map(item => item.action), ['check', 'edit', 'confirm']);
    assert.match(visibleText(card), /ยังไม่ยืนยันปิดวัน/);
    if (status === 'submitted') assert.match(visibleText(card), /ส่งรายงานแล้ว/);
  }
  for (const status of ['cancelled', 'archived', 'future_status', 'CONFIRMED', ' draft', 'submitted ']) {
    const card = buildInthaninDailyCloseCard({ ...input(), status });
    assert.deepEqual(renderedActions(card).map(item => item.action), ['check']);
    assert.match(visibleText(card), /สถานะไม่รองรับ · ต้องตรวจสอบ/);
    assert.match(visibleText(card), /ยังยืนยันไม่ได้ · กรุณาตรวจสถานะใน Backoffice/);
    assert.doesNotMatch(visibleText(card), /DRAFT|พร้อมให้นุ๊ก|ปุ่มแก้ไข/);
  }
});

test('long issues remain bounded, indicate hidden issues, and cannot expose confirmation', () => {
  const values = input();
  values.blockers = Array.from({ length: 30 }, () => ({ message: 'ข้อมูลยังไม่ครบ'.repeat(300), amount: 0 }));
  values.warnings = Array.from({ length: 30 }, () => ({ code: 'warning'.repeat(300) }));
  const card = buildInthaninDailyCloseCard(values);
  assert.match(visibleText(card), /ยังมีอีก 24 รายการ กรุณาตรวจใน Backoffice/);
  assert.ok(Buffer.byteLength(JSON.stringify(card.contents), 'utf8') <= 30_000);
  assert.ok(!renderedActions(card).some(item => item.action === 'confirm'));
});

test('renderer rejects numeric coercion, undefined amounts, invalid counts and nonfinite inputs', () => {
  for (const value of [undefined, '', '0', false, NaN, Infinity]) {
    assert.throws(() => buildInthaninDailyCloseCard({ ...input(), netSales: value } as InthaninDailyCloseCardInput), TypeError);
  }
  for (const issue of [null, [], { amount: '0' }, { amount: NaN }, { count: -1 }, { count: 0.5 }, { count: '0' }, { message: 7 }]) {
    assert.throws(() => buildInthaninDailyCloseCard({ ...input(), blockers: [issue] } as InthaninDailyCloseCardInput), TypeError);
  }
});

test('renderer is deterministic, immutable and has no network, database, push or confirmation I/O', () => {
  const values = input(), snapshot = structuredClone(values);
  assert.deepEqual(buildInthaninDailyCloseCard(values), buildInthaninDailyCloseCard(values));
  assert.deepEqual(values, snapshot);
  const source = readFileSync('netlify/functions/_inthanin-daily-close-card.ts', 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|api\.line\.me|message\/push|financial_confirm_|\bimport\s/);
});

test('incomplete staff form preserves the missing explanation without inventing a canonical close or actions', () => {
  const explanation = 'ยังไม่ได้บันทึกรายงานครับ\nข้อมูลที่ขาด:\n• วันที่ปิดยอด\n• ยอดขายสุทธิ POS';
  const card = buildInthaninMissingCloseCard(explanation);
  assert.equal(card.type, 'flex');
  assert.equal((card.contents as Record<string, unknown>).type, 'bubble');
  assert.ok(nodes(card).some(node => node.type === 'text' && node.text === explanation));
  assert.match(visibleText(card), /ข้อมูลปิดยอดยังไม่ครบ · ยังไม่บันทึก/);
  assert.match(visibleText(card), /เติมเฉพาะข้อมูลที่ระบุว่าขาด/);
  assert.match(visibleText(card), /นุ๊ก \(เจ้าของ\) ตรวจและยืนยันปิดวัน/);
  assert.deepEqual(renderedActions(card), []);
  assert.ok(!nodes(card).some(node => node.type === 'button' || 'id' in node || 'revision' in node || 'localDate' in node));
  assert.doesNotMatch(JSON.stringify(card), /inthanin-close:|0\.00|2037-10-11/);
  assert.deepEqual(card, buildInthaninMissingCloseCard(explanation));
});

test('incomplete staff form explanation is bounded and requires a nonempty existing reason', () => {
  const card = buildInthaninMissingCloseCard('ข้อมูลขาด 🧾'.repeat(1000));
  assert.ok((card.altText as string).length <= 500);
  assert.ok(Buffer.byteLength(JSON.stringify(card.contents), 'utf8') <= 30_000);
  assert.ok(nodes(card).filter(node => node.type === 'text').every(node => (node.text as string).length <= 3000));
  assert.ok(!nodes(card).some(node => node.type === 'postback' || node.type === 'button'));
  for (const value of ['', ' ', null, undefined, 0]) {
    assert.throws(() => buildInthaninMissingCloseCard(value as string), TypeError);
  }
});
