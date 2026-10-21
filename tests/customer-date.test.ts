import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCustomerDate } from '../netlify/functions/_customer-date';

// Dates the customer reads: "พรุ่งนี้ (พฤ. 22 ต.ค.)", "tomorrow (Thu 22 Oct)",
// relative to the Bangkok calendar day; anything that is not YYYY-MM-DD is
// left alone.
test('relative days and short dates, Thai and English, on the Bangkok calendar', () => {
  const now = new Date('2026-10-21T10:00:00+07:00');
  assert.equal(formatCustomerDate('2026-10-21', 'th', now), 'วันนี้ (พ. 21 ต.ค.)');
  assert.equal(formatCustomerDate('2026-10-22', 'th', now), 'พรุ่งนี้ (พฤ. 22 ต.ค.)');
  assert.equal(formatCustomerDate('2026-10-23', 'th', now), 'มะรืนนี้ (ศ. 23 ต.ค.)');
  assert.equal(formatCustomerDate('2026-10-30', 'th', now), 'ศ. 30 ต.ค.');
  assert.equal(formatCustomerDate('2026-10-22', 'en', now), 'tomorrow (Thu 22 Oct)');
  assert.equal(formatCustomerDate('2026-12-31', 'en', now), 'Thu 31 Dec');
  // 23:30 in Bangkok is already the next UTC day for nobody: still the 21st.
  assert.equal(formatCustomerDate('2026-10-22', 'th', new Date('2026-10-21T23:30:00+07:00')), 'พรุ่งนี้ (พฤ. 22 ต.ค.)');
  assert.equal(formatCustomerDate('2026-10-22', 'th', new Date('2026-10-22T00:30:00+07:00')), 'วันนี้ (พฤ. 22 ต.ค.)');
  for (const value of ['พรุ่งนี้', '2026-10-22T03:00:00Z', '']) assert.equal(formatCustomerDate(value, 'th', now), value);
});
