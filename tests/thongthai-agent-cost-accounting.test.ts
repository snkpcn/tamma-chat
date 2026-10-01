import test from 'node:test';
import assert from 'node:assert/strict';
import { conservativeAgentCostUsd } from '../netlify/functions/_thongthai-agent-session';
import { calculateAiCostUsd } from '../netlify/functions/_ai-cost-policy';

test('Agent cost accounting never ignores possible GPT-5.6 cache-write uplift', () => {
  const usage = { inputTokens: 20_000, cachedInputTokens: 8_000, outputTokens: 150 };
  const base = calculateAiCostUsd('gpt-5.6-terra', usage);
  const conservative = conservativeAgentCostUsd('gpt-5.6-terra', usage);
  assert.ok(conservative > base);
});

test('fully cached Agent input has no possible cache-write uplift', () => {
  const usage = { inputTokens: 20_000, cachedInputTokens: 20_000, outputTokens: 150 };
  assert.equal(
    conservativeAgentCostUsd('gpt-5.6-terra', usage),
    calculateAiCostUsd('gpt-5.6-terra', usage),
  );
});
