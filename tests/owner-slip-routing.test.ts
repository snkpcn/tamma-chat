import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('a pending Owner slip answer is handled before an unrelated project draft', () => {
  const source = readFileSync('netlify/functions/line-webhook.ts', 'utf8');
  const recentSlip = source.indexOf('const recentSlipProjectReply = await handleOwnerRecentSlipProjectPurpose');
  const pendingExpense = source.indexOf('const ownerExpenseTextReply = isExpenseClassificationReply ? null : await handleOwnerExpenseText({');
  const projectDraft = source.indexOf('const ownerProjectReply = await handleOwnerProjectText({');
  assert.ok(recentSlip >= 0, 'explicit project context from a fresh slip must retain priority');
  assert.ok(pendingExpense > recentSlip, 'pending slip answers follow fresh explicit slip-project matching');
  assert.ok(projectDraft > pendingExpense, 'pending slip answers must not be consumed by a separate project draft');
});
