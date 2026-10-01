import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_MAX_TOOL_ROUNDS, AGENT_MAX_TOOL_CALLS } from '../netlify/functions/_thongthai-agent-session';

test('Agent permits a realistic multi-domain read-only sequence while keeping a hard tool bound', () => {
  assert.equal(AGENT_MAX_TOOL_ROUNDS, 8);
  assert.equal(AGENT_MAX_TOOL_CALLS, 12);
  assert.ok(AGENT_MAX_TOOL_CALLS >= AGENT_MAX_TOOL_ROUNDS);
  assert.ok(AGENT_MAX_TOOL_CALLS <= 16);
});
