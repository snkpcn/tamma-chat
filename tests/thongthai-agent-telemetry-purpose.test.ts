import test from 'node:test';
import assert from 'node:assert/strict';
import { agentRuntimeCallPurpose } from '../netlify/functions/_thongthai-agent-session';

test('Agent telemetry distinguishes production primary from staging shadow', () => {
  assert.equal(agentRuntimeCallPurpose('primary'), 'agent_primary_turn_aggregate');
  assert.equal(agentRuntimeCallPurpose('shadow'), 'agent_shadow_turn_aggregate');
});
