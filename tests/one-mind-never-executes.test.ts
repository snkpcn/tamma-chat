// Phase P closure — structural safety proof for making One-Mind the primary
// production path (THONGTHAI_ONE_MIND_CUTOVER=1).
//
// The real safety guarantee is not "the eligibility gate usually says no" --
// it's that the One-Mind pipeline (orchestrator, response bridge, Dialog
// Manager, Knowledge Resolver, real source adapters, Response Composer) has
// NO CODE PATH that calls a transaction executor at all. A propose_action/
// execute_tool DialogDecision only ever produces a toolName STRING inside an
// ActionProposal (see TOOL_NAME_FOR_TASK_TYPE in _dialog-manager.ts) -- it is
// never invoked from within this module set. Only the pre-existing legacy
// executor (_thongthai-runtime-v3.ts's executeBrainTools, gated behind the
// customer's explicit chat handler flow) is allowed to actually write a
// booking/order/payment/promo redemption. This is proven statically so it
// cannot silently regress if someone adds a "helpful" direct call later.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ONE_MIND_MODULES = [
  '_thongthai-one-mind-orchestrator.ts',
  '_thongthai-one-mind-response.ts',
  '_dialog-manager.ts',
  '_knowledge-resolver.ts',
  '_dialog-source-adapters.ts',
  '_response-composer.ts',
  '_activity-catalog-policy.ts',
  '_deterministic-semantic-turn.ts',
];

// Real transaction-executing functions this whole pipeline must never call
// directly (only the legacy executeBrainTools path, outside this module
// set, may call these).
const EXECUTOR_CALL_PATTERNS = [
  /\bcreateBooking\s*\(/,
  /\bcreateRestaurantPreorder\s*\(/,
  /\bcreateOtopOrder\s*\(/,
  /\bredeemPromotion\s*\(/,
  /\bcreateCafeInquiry\s*\(/,
  /\bexecuteBrainTools\s*\(/,
];

async function sourceOf(relativePath: string): Promise<string> {
  return readFile(new URL(`../netlify/functions/${relativePath}`, import.meta.url), 'utf8');
}

test('no module in the One-Mind pipeline calls a real transaction-executing function', async () => {
  for (const file of ONE_MIND_MODULES) {
    const source = await sourceOf(file);
    for (const pattern of EXECUTOR_CALL_PATTERNS) {
      assert.doesNotMatch(source, pattern, `${file} must not call a transaction executor directly: ${pattern}`);
    }
  }
});

test('a propose_action/execute_tool ActionProposal is only ever a descriptive toolName string, never an invocation', async () => {
  const source = await sourceOf('_dialog-manager.ts');
  assert.match(source, /toolName,\s*validatedArgs:\s*task\.slots/, 'ActionProposal must remain a plain data record, not a call');
});

test('the One-Mind customer-response bridge never imports the legacy tool-execution runtime', async () => {
  const source = await sourceOf('_thongthai-one-mind-response.ts');
  assert.doesNotMatch(source, /_thongthai-runtime-v3/, 'must not import the legacy executeBrainTools runtime');
  const orchestrator = await sourceOf('_thongthai-one-mind-orchestrator.ts');
  assert.doesNotMatch(orchestrator, /_thongthai-runtime-v3/, 'must not import the legacy executeBrainTools runtime');
});
