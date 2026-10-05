import assert from 'node:assert/strict';
import test from 'node:test';
import { interpret, interpretWithRules, validateLlmIntent, type NluContext } from '../netlify/functions/_personal-finance-nlu';

const acc = (name: string) => ({ id: name, name, balance: null, balance_status: 'UNKNOWN' as const });
const ctx: NluContext = { today: '2026-10-05', accounts: [acc('SCB'), acc('KBank'), acc('บัญชีใช้จ่าย')], hasLastTransaction: true };
const kind = (t: string) => interpretWithRules(t, ctx).intent;

test('owner phrases map to the right intents', () => {
  assert.deepEqual(kind('บัญชีใช้จ่ายตอนนี้เหลือ 85,000'), { kind: 'SET_BALANCE', amount: 85000, accountHint: 'บัญชีใช้จ่าย', accountKind: null });
  assert.equal(kind('จ่ายประกัน 18500').kind, 'EXPENSE');
  const income = kind('ได้เงินค่าเช่า 25000 เข้า SCB') as any;
  assert.equal(income.kind, 'INCOME'); assert.equal(income.accountHint, 'SCB'); assert.equal(income.amount, 25000);
  assert.equal(kind('จ่ายแล้ว').kind, 'MARK_PAID');
  assert.equal((kind('ปรับ SCB เหลือ 70000') as any).amount, 70000);
  assert.equal(kind('เดือนนี้หมดไปเท่าไหร่').kind, 'QUERY_SUMMARY');
  assert.equal(kind('อาทิตย์หน้ามีอะไรต้องจ่าย').kind, 'QUERY_UPCOMING');
  assert.equal(kind('เมื่อกี้ลงผิด ยกเลิกรายการล่าสุด').kind, 'VOID_LAST');
  assert.equal((kind('เปลี่ยนจากค่าอาหารเป็นค่าเดินทาง') as any).category, 'ค่าเดินทาง');
  assert.equal((kind('ไม่ใช่ 18500 เป็น 15800') as any).amount, 15800);
  assert.equal(kind('โอนจาก SCB ไป KBank 5000').kind, 'TRANSFER');
  const rec = kind('ค่าเน็ต 599 ทุกวันที่ 5') as any;
  assert.equal(rec.kind, 'CREATE_RECURRING'); assert.equal(rec.frequency, 'MONTHLY'); assert.equal(rec.dayOfMonth, 5);
  const inst = kind('ผ่อนรถ 12000 ทุกเดือนวันที่ 25 อีก 24 งวด') as any;
  assert.equal(inst.frequency, 'INSTALLMENT'); assert.equal(inst.installments, 24); assert.equal(inst.firstDue, '2026-10-25');
  const once = kind('ต้องจ่ายประกัน 18500 วันที่ 30') as any;
  assert.equal(once.kind, 'CREATE_RECURRING'); assert.equal(once.frequency, 'ONE_TIME'); assert.equal(once.firstDue, '2026-10-30');
});

test('negations and vague text never become writes', () => {
  assert.equal(kind('ไม่ได้จ่ายประกันนะ').kind, 'NEGATED');
  assert.equal(kind('ยังไม่จ่ายค่าไฟ').kind, 'NEGATED');
  assert.equal(kind('จ่ายไปเยอะเลย').kind, 'UNCLEAR');
  assert.equal(kind('18500').kind, 'UNCLEAR');
  assert.equal(kind('สวัสดีครับ').kind, 'UNCLEAR');
  assert.equal((kind('สวัสดีครับ') as any).financeCue, false);
  assert.equal(kind('ลบทั้งหมด').kind, 'UNSUPPORTED_BULK');
});

test('"ใช้จ่าย" inside an account name is not an expense verb', () => {
  assert.equal(kind('บัญชีใช้จ่ายตอนนี้เหลือ 85,000').kind, 'SET_BALANCE');
});

test('LLM proposals: amount must literally appear, kinds are whitelisted, confidence is capped at medium', () => {
  assert.equal(validateLlmIntent({ kind: 'EXPENSE', amount: 999, title: 'x' }, 'จ่ายกาแฟ 120'), null);
  assert.equal(validateLlmIntent({ kind: 'DELETE_EVERYTHING' }, 'x'), null);
  assert.equal(validateLlmIntent({ kind: 'EXPENSE', amount: null }, 'จ่ายกาแฟ'), null);
  const ok = validateLlmIntent({ kind: 'EXPENSE', amount: 120, title: 'กาแฟ', account: 'SCB' }, 'ซัดกาแฟไป 120');
  assert.ok(ok); assert.equal(ok!.confidence, 'medium'); assert.equal(ok!.source, 'llm');
});

test('LLM is only consulted for finance-looking text the rules cannot place', async () => {
  let calls = 0;
  const llm = async () => { calls++; return { kind: 'EXPENSE', amount: 120, title: 'กาแฟ' }; };
  const chat = await interpret('สวัสดีครับ', ctx, llm);
  assert.equal(calls, 0); assert.equal(chat.intent.kind, 'UNCLEAR');
  const ruled = await interpret('จ่ายประกัน 18500', ctx, llm);
  assert.equal(calls, 0); assert.equal(ruled.source, 'rules');
  const fuzzy = await interpret('ซัดกาแฟไป 120 บาท', ctx, llm);
  assert.equal(calls, 1); assert.equal(fuzzy.source, 'llm'); assert.equal(fuzzy.confidence, 'medium');
  const failing = await interpret('ซัดกาแฟไป 120 บาท', ctx, async () => { throw new Error('boom'); });
  assert.equal(failing.intent.kind, 'UNCLEAR');
});
