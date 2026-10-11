import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { buildOwnerDocumentChoiceCard, decodeOwnerDocumentAction } from '../netlify/functions/_owner-document-intent-ui';

const now = 1_791_720_000_000;
const key = 'fixture-line-channel-secret';
const targetId = 'C11111111111111111111111111111111';
const userId = 'U22222222222222222222222222222222';
const imageMessageId = '573920481234567890';
const context = { targetId, userId, imageMessageId, now };
const PREFIX = 'owner-doc:';

function configure(t: any) {
  const previous = process.env.LINE_CHANNEL_SECRET;
  process.env.LINE_CHANNEL_SECRET = key;
  t.after(() => { if (previous === undefined) delete process.env.LINE_CHANNEL_SECRET; else process.env.LINE_CHANNEL_SECRET = previous; });
}
function buttons(card: unknown): any[] { return (card as any).contents.footer.contents.map((button: any) => button.action); }
function kind() { return buildOwnerDocumentChoiceCard({ ...context, step: 'kind' }); }
function parse(data: string): any[] { return JSON.parse(data.slice(PREFIX.length)); }
function modify(data: string, index: number, value: unknown): string {
  const fields = parse(data); fields[index] = value; return PREFIX + JSON.stringify(fields);
}

test('neutral document-kind card contains exactly the requested question and choices', t => {
  configure(t);
  const card = kind();
  assert.equal(card.type, 'flex');
  assert.equal(card.altText, 'รูปนี้เป็นเอกสารอะไรครับ?');
  assert.equal((card.contents as any).body.contents[0].text, card.altText);
  assert.deepEqual(buttons(card).map(a => a.label), ['ใบเสนอราคา', 'หลักฐานโอน', 'เอกสารอื่น']);
  assert.deepEqual(buttons(card).map(a => decodeOwnerDocumentAction({ ...context, data: a.data })?.action), ['quotation', 'payment_evidence', 'other_document']);
});

test('direction card contains only outgoing/incoming choices with no accounting claim', t => {
  configure(t);
  const card = buildOwnerDocumentChoiceCard({ ...context, step: 'direction' });
  assert.equal(card.altText, 'เงินในหลักฐานนี้เป็นเงินรับเข้าหรือจ่ายออกครับ?');
  assert.deepEqual(buttons(card).map(a => a.label), ['จ่ายออก', 'รับเข้า']);
  assert.deepEqual(buttons(card).map(a => decodeOwnerDocumentAction({ ...context, data: a.data })?.action), ['outgoing_payment', 'incoming_funds']);
  for (const message of [kind(), card]) {
    const visible = [(message.contents as any).body.contents[0].text, message.altText, ...buttons(message).flatMap(a => [a.label, a.displayText])].join('\n');
    assert.doesNotMatch(visible, /[0-9]|บาท|วันที่|ยืนยัน|บันทึกแล้ว|ชำระแล้ว|สำเร็จ/);
    assert.ok(!visible.includes(targetId) && !visible.includes(userId) && !visible.includes(imageMessageId));
  }
});

test('each postback preserves exact image/action and binds full identities using the existing secret', t => {
  configure(t);
  const card = kind();
  for (const action of buttons(card)) {
    const fields = parse(action.data);
    assert.equal(fields[0], imageMessageId);
    assert.equal(fields[2], now);
    assert.equal(fields[3] - fields[2], 900_000);
    assert.equal(fields[4], createHmac('sha256', key).update(JSON.stringify(['owner-doc:v1', targetId, userId, ...fields.slice(0, 4)])).digest('base64url'));
    assert.deepEqual(decodeOwnerDocumentAction({ ...context, data: action.data }), { imageMessageId, action: fields[1] });
    assert.ok(!action.data.includes(targetId) && !action.data.includes(userId));
    assert.ok(Buffer.byteLength(action.data, 'utf8') <= 300);
    assert.equal(action.type, 'postback');
    assert.equal(action.text, undefined);
  }
});

test('forgeries and any different group or actor are rejected, including matching prefixes', t => {
  configure(t);
  const data = buttons(kind())[0].data;
  for (const change of [
    { targetId: targetId.slice(0, -1) + '2' }, { userId: userId.slice(0, -1) + '3' },
    { targetId: userId, userId: targetId }, { targetId: '' }, { userId: '' },
  ]) assert.equal(decodeOwnerDocumentAction({ ...context, ...change, data }), null);
  for (const [index, value] of [[0, '573920481234567891'], [1, 'payment_evidence'], [2, now - 1], [3, now + 900_001], [4, 'A'.repeat(43)]] as Array<[number, unknown]>) {
    assert.equal(decodeOwnerDocumentAction({ ...context, data: modify(data, index, value) }), null);
  }
  process.env.LINE_CHANNEL_SECRET = 'different-fixture-secret';
  assert.equal(decodeOwnerDocumentAction({ ...context, data }), null);
});

test('expiry is exactly 15 minutes and not-yet-issued or malformed clocks fail closed', t => {
  configure(t);
  const data = buttons(kind())[0].data;
  assert.ok(decodeOwnerDocumentAction({ ...context, now: now + 899_999, data }));
  assert.equal(decodeOwnerDocumentAction({ ...context, now: now + 900_000, data }), null);
  assert.equal(decodeOwnerDocumentAction({ ...context, now: now - 1, data }), null);
  const preciseNow = now + 123;
  const precise = buttons(buildOwnerDocumentChoiceCard({ ...context, now: preciseNow, step: 'kind' }))[0].data;
  assert.equal(parse(precise)[2], preciseNow);
  assert.equal(decodeOwnerDocumentAction({ ...context, now: preciseNow - 1, data: precise }), null);
  assert.ok(decodeOwnerDocumentAction({ ...context, now: preciseNow + 899_999, data: precise }));
  assert.equal(decodeOwnerDocumentAction({ ...context, now: preciseNow + 900_000, data: precise }), null);
  for (const bad of [-1, NaN, Infinity, now + 0.5, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(decodeOwnerDocumentAction({ ...context, now: bad, data }), null);
    assert.throws(() => buildOwnerDocumentChoiceCard({ ...context, now: bad, step: 'kind' }));
  }
});

test('canonical payload validation rejects malformed, oversized and structurally altered input', t => {
  configure(t);
  const data = buttons(kind())[0].data;
  const invalid: unknown[] = [null, 12, {}, '', 'owner-slip:[]', PREFIX + '{}', PREFIX + 'null', PREFIX + '[]',
    data + ' ', data.replace('[', '[ '), data.slice(0, -1), PREFIX + 'x'.repeat(301),
    PREFIX + JSON.stringify([...parse(data), 'extra']),
    PREFIX + JSON.stringify(parse(data).slice(0, 4)),
    modify(data, 0, Number(imageMessageId)), modify(data, 0, '-12'), modify(data, 0, '1.2'),
    modify(data, 1, 'confirm'), modify(data, 1, '__proto__'), modify(data, 2, String(now)),
    modify(data, 3, now + 1_800_000), modify(data, 4, '!'.repeat(43)),
    modify(data, 4, 'A'.repeat(44)), modify(data, 4, null),
  ];
  for (const item of invalid) assert.equal(decodeOwnerDocumentAction({ ...context, data: item }), null, String(item));
});

test('message IDs are digits only, preserve exact large strings, and never use numeric coercion', t => {
  configure(t);
  for (const image of ['0', '123', '000123', '9'.repeat(64)]) {
    const card = buildOwnerDocumentChoiceCard({ ...context, imageMessageId: image, step: 'kind' });
    const data = buttons(card)[0].data;
    assert.equal(decodeOwnerDocumentAction({ ...context, data })?.imageMessageId, image);
    assert.ok(Buffer.byteLength(data, 'utf8') <= 300);
  }
  for (const image of ['', '123a', '-123', '1.1', '1e10', ' 123', '123 ', '๑๒๓', '9'.repeat(65), 123, null]) {
    assert.throws(() => buildOwnerDocumentChoiceCard({ ...context, imageMessageId: image as any, step: 'kind' }));
  }
});

test('missing signing secret never emits an actionable card or accepts a postback', t => {
  configure(t);
  const data = buttons(kind())[0].data;
  for (const secret of [undefined, '', '  ']) {
    if (secret === undefined) delete process.env.LINE_CHANNEL_SECRET; else process.env.LINE_CHANNEL_SECRET = secret;
    assert.equal(decodeOwnerDocumentAction({ ...context, data }), null);
    assert.throws(() => kind(), /not configured/);
  }
});

test('invalid context/step fails closed and full identity separation is unambiguous', t => {
  configure(t);
  for (const change of [{ targetId: ' group' }, { userId: 'user\n' }, { userId: 'x'.repeat(257) }, { targetId: null }, { step: '__proto__' }]) {
    assert.throws(() => buildOwnerDocumentChoiceCard({ ...context, step: 'kind', ...change } as any));
  }
  const data = buttons(buildOwnerDocumentChoiceCard({ ...context, targetId: 'ab', userId: 'c', step: 'kind' }))[0].data;
  assert.equal(decodeOwnerDocumentAction({ ...context, targetId: 'a', userId: 'bc', data }), null);
});

test('rendering and decoding are deterministic and stateless with no I/O', t => {
  configure(t);
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Document choices must not perform I/O'); });
  const original = JSON.stringify(context);
  assert.deepEqual(kind(), kind());
  const data = buttons(kind())[0].data;
  assert.deepEqual(decodeOwnerDocumentAction({ ...context, data }), decodeOwnerDocumentAction({ ...context, data }));
  assert.equal(JSON.stringify(context), original);
  // Replay suppression and sender-confirmed financial state belong to the parent workflow.
});
