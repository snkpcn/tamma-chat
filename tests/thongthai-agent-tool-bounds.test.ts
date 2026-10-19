import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_MAX_TOOL_ROUNDS, AGENT_MAX_TOOL_CALLS, AGENT_TURN_RESERVE_THB } from '../netlify/functions/_thongthai-agent-session';
import { aiCostPolicy, usdToThbRate } from '../netlify/functions/_ai-cost-policy';

test('Agent permits a realistic multi-domain read-only sequence while keeping a hard tool bound', () => {
  assert.equal(AGENT_MAX_TOOL_ROUNDS, 8);
  assert.equal(AGENT_MAX_TOOL_CALLS, 12);
  assert.ok(AGENT_MAX_TOOL_CALLS >= AGENT_MAX_TOOL_ROUNDS);
  assert.ok(AGENT_MAX_TOOL_CALLS <= 16);
});


test('unbounded multi-tool Agent reserve exceeds the new cap and must use the guarded fallback', () => {
  assert.equal(AGENT_TURN_RESERVE_THB, 2.75);
  assert.ok(AGENT_TURN_RESERVE_THB > 2.5);
  assert.ok(AGENT_TURN_RESERVE_THB > aiCostPolicy().maxConversationCostUsd * usdToThbRate());
});
