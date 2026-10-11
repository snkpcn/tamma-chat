import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOwnerSlipReviewCard, decodeOwnerSlipAction, encodeOwnerSlipAction,
  OWNER_SLIP_ACTIONS, OWNER_SLIP_ACTION_PREFIX, type OwnerSlipReviewCardInput,
} from '../netlify/functions/_owner-slip-review-ui';

const id = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const base: OwnerSlipReviewCardInput = {
  id, revision: 7, amount: 475, date: '2026-10-11', memo: 'ตัวอย่างเสื้อ',
  business: 'ตำมา-ชาติ', project: null, category: null,
  destination: 'ค่าใช้จ่ายดำเนินงาน', installment: null, step: 'category',
};

function collect(value: unknown, key: string): any[] {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([name, child]) => [
    ...(name === key ? [child] : []), ...collect(child, key),
  ]);
}
const actionData = (card: unknown) => collect(card, 'action').map(a => a.data as string);
const visibleText = (card: unknown) => collect(card, 'text').concat(collect(card, 'label')).join('\n');

test('canonical postbacks round-trip the exact full UUID, revision, action and value', () => {
  for (const action of OWNER_SLIP_ACTIONS) {
    const value = ['business', 'project', 'category', 'destination', 'installment', 'page', 'document_kind'].includes(action) ? 'fixture-value' : undefined;
    const input = { id, revision: 7, action, ...(value === undefined ? {} : { value }) };
    const encoded = encodeOwnerSlipAction(input);
    assert.ok(encoded.startsWith(OWNER_SLIP_ACTION_PREFIX));
    assert.deepEqual(decodeOwnerSlipAction(encoded), input);
    assert.ok(Buffer.byteLength(encoded, 'utf8') <= 300);
  }
  const thai = { id, revision: 0, action: 'category', value: 'ตัวเลือกทดสอบ' };
  assert.deepEqual(decodeOwnerSlipAction(encodeOwnerSlipAction(thai)), thai);
  const largestRevision = { id, revision: Number.MAX_SAFE_INTEGER, action: 'confirm' };
  assert.deepEqual(decodeOwnerSlipAction(encodeOwnerSlipAction(largestRevision)), largestRevision);
});

test('decoder rejects foreign, malformed, duplicated, noncanonical and unknown payloads', () => {
  const good = encodeOwnerSlipAction({ id, revision: 1, action: 'confirm' });
  const invalid: unknown[] = [null, {}, 12, '', 'ops:booking', good.slice(0, -1),
    good + ' ', good.replace('"revision":1', '"revision":1,"revision":2'),
    good.replace('"revision":1', '"revision":1,"extra":"forged"'),
    good.replace('"revision":1', '"revision":1.0'),
    good.replace('"revision":1', '"revision":-0'),
    good.replace('"revision":1', '"revision":"1"'),
    good.replace('"confirm"', '"pay"'), good.replace('11111111-', 'A1111111-'),
    good.replace('"confirm"', '"project"'),
    OWNER_SLIP_ACTION_PREFIX + '[]', OWNER_SLIP_ACTION_PREFIX + 'null',
    OWNER_SLIP_ACTION_PREFIX + '"confirm"',
    good.replace('"confirm"', '"confirm","value":"extra"'),
    OWNER_SLIP_ACTION_PREFIX + 'x'.repeat(301),
  ];
  for (const payload of invalid) assert.equal(decodeOwnerSlipAction(payload), null, String(payload));
});

test('encoder rejects unsafe identity, action, revision, selector and oversized UTF-8 data', () => {
  const good = { id, revision: 0, action: 'project', value: projectId };
  for (const change of [
    { id: '111111' }, { id: id.toUpperCase().replace('1111', 'ABCD') },
    { revision: -1 }, { revision: -0 }, { revision: 0.5 }, { revision: Infinity },
    { revision: Number.MAX_SAFE_INTEGER + 1 }, { action: '__proto__' },
    { value: '' }, { value: ' leading' }, { value: 'trailing ' },
    { value: 'a\nb' }, { value: 'a\u0000b' }, { value: 'a\u202eb' }, { value: '\ud800' },
    { value: 'ก'.repeat(100) },
  ]) assert.throws(() => encodeOwnerSlipAction({ ...good, ...change }));
  const oversized = OWNER_SLIP_ACTION_PREFIX + JSON.stringify({ ...good, value: 'ก'.repeat(100) });
  assert.ok(oversized.length < 300, 'UTF-16 character limit alone would miss the oversized payload');
  assert.equal(decodeOwnerSlipAction(oversized), null);
  assert.throws(() => encodeOwnerSlipAction({ ...good, extra: 'forged' } as any));
});

test('mockup: 475-baht clothing memo asks one missing question and keeps known facts visible', () => {
  const card = buildOwnerSlipReviewCard({ ...base,
    question: 'ตัวอย่างเสื้อนี้ใช้ทำอะไรครับ?',
    choices: [
      { label: 'ใช้ในงานร้าน', action: 'category', value: 'consumables' },
      { label: 'ใช้ทำการตลาด', action: 'category', value: 'marketing' },
    ],
  });
  assert.equal(card.type, 'flex');
  const visible = visibleText(card);
  for (const expected of ['475.00 บาท', '2026-10-11', 'ตัวอย่างเสื้อ', 'ตำมา-ชาติ', 'ค่าใช้จ่ายดำเนินงาน', 'ยังไม่บันทึกรายจ่าย', 'ตัวอย่างเสื้อนี้ใช้ทำอะไรครับ?', 'ไว้ก่อน']) {
    assert.ok(visible.includes(expected), expected);
  }
  assert.equal((visible.match(/\?/g) ?? []).length, 1);
  assert.doesNotMatch(visible, /#[A-F0-9]|พิมพ์|ยืนยันบันทึก/);
  assert.ok(!visible.includes(id));
  assert.ok(!visible.includes('v7'));
  assert.deepEqual(actionData(card).map(data => decodeOwnerSlipAction(data)?.action), ['category', 'category', 'later']);
  for (const data of actionData(card)) {
    assert.equal(decodeOwnerSlipAction(data)?.id, id);
    assert.equal(decodeOwnerSlipAction(data)?.revision, 7);
  }
});

test('all selection screens render only supplied catalogue choices and hide identity tokens', () => {
  for (const step of ['business', 'project', 'category', 'destination', 'installment'] as const) {
    const card = buildOwnerSlipReviewCard({ ...base, step, choices: [{ label: 'ตัวเลือกจากข้อมูลจริง', action: step, value: 'fixture-choice' }] });
    assert.deepEqual(actionData(card).map(data => decodeOwnerSlipAction(data)?.value), ['fixture-choice', undefined]);
    assert.ok(!visibleText(card).includes(id));
  }
  const empty = buildOwnerSlipReviewCard({ ...base, step: 'project', choices: [] });
  assert.deepEqual(actionData(empty).map(data => decodeOwnerSlipAction(data)?.action), ['later']);
  assert.match(visibleText(empty), /ยังไม่มีตัวเลือกที่ใช้ได้/);
});

test('final card highlights explicit confirmation with edits, and later is never cancel', () => {
  const card = buildOwnerSlipReviewCard({ ...base, category: 'วัสดุสิ้นเปลือง', step: 'confirm' });
  const decoded = actionData(card).map(data => decodeOwnerSlipAction(data)!);
  assert.deepEqual(decoded.map(action => action.action), ['confirm', 'show_business', 'show_project', 'show_category', 'show_destination', 'show_installment', 'later']);
  const buttons = collect(card, 'action');
  assert.equal(buttons[0].label, 'ยืนยันบันทึก');
  assert.equal(buttons.at(-1).label, 'ไว้ก่อน');
  assert.ok(!decoded.some(action => action.action === 'cancel'));
  const visible = visibleText(card);
  assert.match(visible, /ไม่ผูกโครงการ/);
  assert.match(visible, /ไม่ผูกงวด/);
  assert.equal((card.contents as any).footer.contents[0].style, 'primary');
  assert.throws(() => buildOwnerSlipReviewCard({ ...base, choices: [{ label: 'ไว้ก่อน', action: 'cancel' }] }));
});

test('confirmation rejects missing required details and invalid amount rather than implying ready', () => {
  const ready = { ...base, step: 'confirm' as const, category: 'วัสดุสิ้นเปลือง' };
  for (const field of ['amount', 'date', 'business', 'category', 'destination'] as const) {
    assert.throws(() => buildOwnerSlipReviewCard({ ...ready, [field]: null }));
  }
  assert.throws(() => buildOwnerSlipReviewCard({ ...ready, memo: ' ' }));
  assert.throws(() => buildOwnerSlipReviewCard({ ...ready, amount: 0 }));
  assert.throws(() => buildOwnerSlipReviewCard({ ...ready, step: '__proto__' } as any));
  for (const amount of [NaN, Infinity, -1]) assert.throws(() => buildOwnerSlipReviewCard({ ...ready, amount }));
});

test('irrelevant installment summary and edit are hidden, but an existing selection remains visible', () => {
  const input = { ...base, category: 'วัสดุสิ้นเปลือง', step: 'confirm' as const, installmentApplicable: false };
  const card = buildOwnerSlipReviewCard(input);
  assert.doesNotMatch(visibleText(card), /งวด/);
  assert.ok(!actionData(card).some(data => decodeOwnerSlipAction(data)?.action === 'show_installment'));
  for (const change of [{ installmentApplicable: true }, { installment: 'งวด 2 ระบบไฟ' }, { installmentApplicable: undefined }]) {
    const applicable = buildOwnerSlipReviewCard({ ...input, ...change });
    assert.match(visibleText(applicable), /งวด/);
    assert.ok(actionData(applicable).some(data => decodeOwnerSlipAction(data)?.action === 'show_installment'));
  }
});

test('suggested categories stay distinct from a category explicitly selected by the owner', () => {
  const input = { ...base, category: 'วัสดุสิ้นเปลือง' };
  assert.match(visibleText(buildOwnerSlipReviewCard({ ...input, categorySuggested: true })), /หมวดที่เสนอ/);
  assert.doesNotMatch(visibleText(buildOwnerSlipReviewCard({ ...input, categorySuggested: false })), /หมวดที่เสนอ/);
  assert.match(visibleText(buildOwnerSlipReviewCard(input)), /ร้าน\/กิจการ/);
});

test('closed cards have no actionable stale buttons; error cards never claim success', () => {
  const closed = buildOwnerSlipReviewCard({ ...base, step: 'closed', closedText: 'เก็บสลิปไว้ตรวจต่อภายหลัง', choices: [{ label: 'เก่า', action: 'confirm' }] });
  assert.deepEqual(actionData(closed), []);
  assert.match(visibleText(closed), /เก็บสลิปไว้ตรวจต่อภายหลัง/);
  assert.doesNotMatch(visibleText(closed), /ยืนยันบันทึก|ยังไม่บันทึกรายจ่าย/);
  const error = buildOwnerSlipReviewCard({ ...base, step: 'error', error: 'ข้อมูลเปลี่ยนแล้ว กรุณาใช้การ์ดล่าสุด' });
  assert.deepEqual(actionData(error).map(data => decodeOwnerSlipAction(data)?.action), ['later']);
  assert.match(visibleText(error), /ข้อมูลเปลี่ยนแล้ว/);
  assert.doesNotMatch(visibleText(error), /ยืนยันบันทึก|สำเร็จ/);
});

test('long names remain visible while labels, display text, alt text and payloads stay bounded', () => {
  const fullName = 'โครงการตัวอย่างชื่อยาวสำหรับแยกตัวเลือกให้ชัดเจน '.repeat(3);
  const card = buildOwnerSlipReviewCard({ ...base, memo: 'ตัวอย่างเสื้อ '.repeat(130), step: 'project',
    choices: [{ label: fullName, action: 'project', value: projectId }, { label: 'หน้าถัดไป', action: 'page', value: 'project:1' }],
  });
  assert.ok(visibleText(card).includes(fullName));
  assert.ok(String(card.altText).length <= 400);
  assert.ok(Buffer.byteLength(JSON.stringify(card.contents)) < 30_000);
  for (const action of collect(card, 'action')) {
    assert.ok(action.label.length <= 40);
    assert.ok(action.displayText.length <= 300);
    assert.ok(Buffer.byteLength(action.data) <= 300);
  }
  assert.equal(decodeOwnerSlipAction(actionData(card)[1])?.value, 'project:1');
  assert.throws(() => buildOwnerSlipReviewCard({ ...base, choices: Array.from({ length: 13 }, () => ({ label: 'ตัวเลือก', action: 'project', value: projectId })) }));
});

test('rendering is deterministic, does not mutate input, and needs no network or database', t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Rendering must not perform any I/O'); });
  const input = { ...base, choices: [{ label: 'โครงการทดสอบ', action: 'project', value: projectId }] };
  const before = JSON.stringify(input);
  assert.deepEqual(buildOwnerSlipReviewCard(input), buildOwnerSlipReviewCard(input));
  assert.equal(JSON.stringify(input), before);
});
