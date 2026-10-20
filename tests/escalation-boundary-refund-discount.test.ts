import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEscalationBoundary } from '../netlify/functions/_boundary-classifier';
import { normalizeCustomerText } from '../netlify/functions/_customer-text';

function category(message: string): string | null {
  return classifyEscalationBoundary(message)?.category ?? null;
}

/** Customers reach this classifier through normalizeCustomerText, so the
 *  Isan/elongated forms must survive the real pipeline, not just the regex. */
function categoryAsTyped(message: string): string | null {
  return category(normalizeCustomerText(message));
}

test('the wordings that already escalated still escalate', () => {
  assert.equal(category('ขอคืนเงินได้ไหม'), 'refund_request');
  assert.equal(category('ขอเงินคืน'), 'refund_request');
  assert.equal(category('can I get a refund'), 'refund_request');
  assert.equal(category('ขอส่วนลดพิเศษ กลุ่ม 20 คน'), 'special_discount');
  assert.equal(category('ขอลดราคาหน่อย'), 'special_discount');
  assert.equal(category('มีราคาพิเศษไหม'), 'special_discount');
});

test('refund wordings that used to slip through now escalate', () => {
  for (const message of [
    'ยกเลิกแล้วได้เงินคืนไหม',
    'อยากได้เงินคืน',
    'เอาเงินคืนได้ไหม',
    'คืนตังค์ได้ป่าว',
    'คืนตังได้ไหม',
    'ขอรีฟันด์ครับ',
  ]) {
    assert.equal(category(message), 'refund_request', `${message} must escalate`);
  }
});

test('asking WHEN a refund arrives still escalates', () => {
  // Review finding: the night-context guard excluded a bare "วัน", which
  // swallowed the most natural way to ask about refund timing. These fell
  // through to the LLM with no policy guardrail -- the exact gap this
  // classifier exists to close.
  for (const message of [
    'ได้เงินคืนวันไหน',
    'เงินคืนวันไหน',
    'เงินคืนเมื่อไหร่',
    'ได้เงินคืนเมื่อไร',
    'ได้เงินคืนตอนไหน',
    'เงินคืนกี่วัน',
  ]) {
    assert.equal(category(message), 'refund_request', `${message} must escalate`);
  }
});

test('a night of accommodation is never mistaken for a refund', () => {
  // "คืน" is also the word for a night, so these all contain "เงินคืน".
  for (const message of [
    'จ่ายเงินคืนนี้ได้ไหม',
    'จ่ายเงินคืนนี้',
    'โอนเงินคืนวันศุกร์ได้ไหม',
    'คืนวันศุกร์',
    'เงินคืนวันศุกร์',
    'จ่ายเงินคืนแรกก่อนได้ไหม',
    'ค่าที่พักเป็นเงินคืนละเท่าไหร่',
    'จ่ายเงินคืนสุดท้ายตอนเช็กเอาต์',
    'ที่พักคืนละเท่าไหร่',
    'พักกี่คืน',
  ]) {
    assert.notEqual(
      category(message), 'refund_request',
      `${message} is about nights of stay, not a refund`,
    );
  }
});

test('asking for a better price now escalates', () => {
  for (const message of [
    'ลดให้หน่อยได้ป่าว',
    'ลดได้ไหม',
    'ลดหน่อยครับ',
    'ลดอีกหน่อยได้ไหม',
    'ถูกกว่านี้ได้ไหม',
    'ต่อราคาได้ไหม',
    'ลดกว่านี้ได้ไหม',
  ]) {
    assert.equal(category(message), 'special_discount', `${message} must escalate`);
  }
});

test('reducing an ingredient is not a discount request (noun AFTER ลด)', () => {
  for (const message of [
    'ลดหวานหน่อยครับ',
    'ลดน้ำตาลครึ่งนึง',
    'ลดเผ็ดได้ไหม',
    'ลดน้ำแข็งด้วยครับ',
    'ลดเค็มหน่อย',
    'ลดนมได้ไหม',
    'ลดปริมาณข้าวหน่อย',
  ]) {
    assert.notEqual(
      category(message), 'special_discount',
      `${message} is a food modifier, not haggling`,
    );
  }
});

test('reducing an ingredient is not a discount request (noun BEFORE ลด)', () => {
  // Review finding: Thai puts the thing being reduced on either side of
  // "ลด", and only the AFTER order was handled. These are among the most
  // common café orders there is and were all escalating to the owner as
  // haggling while answering about price instead of the drink.
  for (const message of [
    'น้ำตาลลดได้ไหม',
    'ความเผ็ดลดได้ไหม',
    'เผ็ดลดได้ป่าว',
    'น้ำแข็งลดได้ไหม',
    'หวานลดหน่อยได้ไหม',
    'ความหวานลดให้หน่อย',
    'เค็มลดได้ไหม',
    'นมลดหน่อยครับ',
    'ปริมาณลดได้ไหม',
  ]) {
    assert.notEqual(
      category(message), 'special_discount',
      `${message} is a food modifier with the noun first, not haggling`,
    );
  }
});

test('a genuine price reduction still escalates in either word order', () => {
  // The leading-noun guard must not swallow real haggling. "ราคา" is
  // deliberately absent from the consumable list for exactly this reason.
  for (const message of [
    'ราคาลดได้ไหม',
    'ค่าห้องลดได้ไหม',
    'ลดราคาได้ไหม',
    'ลดให้หน่อยได้ป่าว',
  ]) {
    assert.equal(
      category(message), 'special_discount',
      `${message} is a real price request`,
    );
  }
});

test('asking whether a cheaper option exists is a catalog question', () => {
  // Review finding: "ถูกกว่านี้" unanchored escalated an ordinary
  // option-comparison question to the owner.
  assert.notEqual(category('มีที่ถูกกว่านี้ไหม'), 'special_discount');
  assert.notEqual(category('มีห้องถูกกว่านี้ไหม'), 'special_discount');
  assert.notEqual(category('มีแพ็กเกจถูกกว่านี้ไหม'), 'special_discount');
  // The same question with "มี" after it.
  assert.notEqual(category('ถูกกว่านี้มีไหม'), 'special_discount');
  assert.notEqual(category('ถูกกว่านี้ มีไหมครับ'), 'special_discount');
  assert.notEqual(categoryAsTyped('ห้องถูกกว่านี้มีมั้ย'), 'special_discount');
  // ...but asking for a cheaper PRICE still escalates, with or without ขอ.
  assert.equal(category('ถูกกว่านี้ได้ไหม'), 'special_discount');
  assert.equal(category('ขอถูกกว่านี้ได้ไหม'), 'special_discount');
});

test('asking about existing promotions is not an owner escalation', () => {
  // These must keep reaching the promotion responder. The last one is taken
  // verbatim from tests/thongthai-ai-cost-guard.test.ts.
  for (const message of [
    'มีส่วนลดไหม',
    'มีโปรโมชันอะไรบ้าง',
    'ส่วนลดตอนนี้มีอะไร',
    'ถ้าไม่ใช้ส่วนลดตอนนี้ เก็บไว้ครั้งหน้าได้หรือเปล่า',
  ]) {
    assert.notEqual(
      category(message), 'special_discount',
      `${message} is a promotion question, not a special-discount request`,
    );
  }
});

test('the Isan and elongated forms reach the classifier correctly', () => {
  assert.equal(categoryAsTyped('ลดให้หน่อยได้ป่าววววว'), 'special_discount');
  assert.equal(categoryAsTyped('ขอเงินคืนคร้าบ'), 'refund_request');
  assert.equal(categoryAsTyped('คืนตังได้บ่'), 'refund_request');
  // ...and the near-miss sentences still survive the full pipeline.
  assert.notEqual(categoryAsTyped('ลดหวานหน่อยคร้าบ'), 'special_discount');
  assert.notEqual(categoryAsTyped('จ่ายเงินคืนนี้ได้บ่'), 'refund_request');
});

test('refund stays a pure escalation and discount still answers too', () => {
  // Unchanged routing contract: a refund must not be answered from policy
  // guesses, while a discount request may answer AND escalate.
  const refund = classifyEscalationBoundary('ขอเงินคืนได้ไหม');
  assert.equal(refund?.pureEscalation, true);
  assert.equal(refund?.escalates, true);

  const discount = classifyEscalationBoundary('ลดให้หน่อยได้ป่าว');
  assert.equal(discount?.pureEscalation, false);
  assert.equal(discount?.escalates, true);
});

test('refund is matched before discount when a message contains both', () => {
  // Ordering in classifyEscalationBoundary decides this; a refund is the
  // more serious boundary and must win.
  assert.equal(category('ขอเงินคืน หรือลดราคาให้ก็ได้'), 'refund_request');
});

test('an ordinary question is still not an escalation', () => {
  for (const message of [
    'มีโต๊ะว่างไหม',
    'ขี่ม้าราคาเท่าไหร่',
    'ร้านเปิดกี่โมง',
    'ที่พักคืนละเท่าไหร่',
  ]) {
    assert.equal(category(message), null, `${message} must not escalate`);
  }
});
