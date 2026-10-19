import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCustomerText } from '../netlify/functions/_customer-text';
import { deriveDeterministicSemanticTurn } from '../netlify/functions/_deterministic-semantic-turn';
import { emptySemanticContext } from '../netlify/functions/_semantic-interpreter';
import { createActiveTask, emptyTaskStateContainer } from '../netlify/functions/_task-state';

test('Thai digits and invisible separators retain booking context without an AI call', () => {
  const now = new Date('2026-10-09T05:00:00Z');
  const state = emptyTaskStateContainer();
  state.activeTask = createActiveTask({type:'activity_booking',sourceChannel:'line',now,
    initialSlots:{resourceCode:'horse_riding'},requiredFields:['date','time','partySize']});
  for (const [thai, standard] of [
    ['๒ คน','2 คน'], ['๑๔:๓๐','14:30'], ['๓๐ นาที','30 นาที'],
    ['พรุ่ง\u200Bนี้','พรุ่งนี้'], ['ไม่\u2060เอาแล้ว ยกเลิก','ไม่เอาแล้ว ยกเลิก'],
  ]) {
    const expected = deriveDeterministicSemanticTurn(standard,emptySemanticContext(),state,now);
    assert.ok(expected,standard);
    const actual = deriveDeterministicSemanticTurn(thai,emptySemanticContext(),state,now);
    assert.deepEqual(actual,expected,thai);
  }
});

test('typography normalization preserves negation, named horses and family emoji', () => {
  const message = 'ไม่เอาทองไทย เอาภาราดร 👨‍👩‍👧';
  assert.equal(normalizeCustomerText(message),message);
});
