import test from 'node:test';
import assert from 'node:assert/strict';
import { processThongthaiChatCore } from '../netlify/functions/thongthai-chat';
import { withHarness, brainRequest, guestId, type Harness } from './helpers/canonical-core-harness';
import { deliverLineTexts } from './helpers/line-channel';

// A rewritten turn ("How much is horse riding?" read as "ขี่ม้าราคาเท่าไหร่")
// must be remembered as what the customer typed. The proof is the next
// turn: the model prompt it builds from history carries the original text.

/** Record the body of every model request made while `run` executes. */
async function modelPrompts(harness: Harness, run: () => Promise<unknown>): Promise<string[]> {
  const prompts: string[] = [];
  // The LINE helper installs its own fetch over harness.fetchMock, so record
  // at that layer too.
  const outer = global.fetch;
  const mock = harness.fetchMock;
  const record = (inner: typeof fetch) => (async (url: string | URL, init: RequestInit = {}) => {
    if (/openai|generativelanguage|anthropic/u.test(String(url))) prompts.push(String(init.body ?? ''));
    return inner(url, init);
  }) as typeof fetch;
  global.fetch = record(outer);
  (harness as { fetchMock: typeof fetch }).fetchMock = record(mock);
  try { await run(); } finally { global.fetch = outer; (harness as { fetchMock: typeof fetch }).fetchMock = mock; }
  assert.ok(harness.modelCallCount() > 0, 'the next turn reached the model');
  return prompts;
}

const ORIGINAL = 'How much is horse riding?';
const NEXT = 'Is it safe for a 6 year old?';

test('web: the next turn sees what the customer typed, not the rewritten question', async () => {
  await withHarness(async harness => {
    const gid = guestId('history-web');
    await processThongthaiChatCore(brainRequest(ORIGINAL, gid, 'web'), 'history-web-0');
    const prompts = await modelPrompts(harness, () => processThongthaiChatCore(brainRequest(NEXT, gid, 'web'), 'history-web-1'));
    const joined = prompts.join('\n');
    assert.match(joined, /How much is horse riding\?/u);
    assert.doesNotMatch(joined, /ขี่ม้าราคาเท่าไหร่/u);
  });
});

test('LINE: the next turn sees what the customer typed (LINE history is server-side only)', async () => {
  await withHarness(async harness => {
    await deliverLineTexts(harness, { userId: 'U-history', texts: [ORIGINAL] });
    const prompts = await modelPrompts(harness, () => deliverLineTexts(harness, { userId: 'U-history', texts: [NEXT] }));
    const joined = prompts.join('\n');
    assert.match(joined, /How much is horse riding\?/u);
    assert.doesNotMatch(joined, /ขี่ม้าราคาเท่าไหร่/u);
  });
});
