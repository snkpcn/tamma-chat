import test from 'node:test';
import assert from 'node:assert/strict';
import { THONGTHAI_READ_ONLY_TOOLS, executeThongthaiReadOnlyTool } from '../netlify/functions/_thongthai-agent-tools';
import { thongthaiStagingAgentConfig, THONGTHAI_STAGING_AGENT_ID } from '../netlify/functions/_thongthai-agent-profile';

test('Thongthai Agent exposes only bounded read-only business tools', () => {
  const names = THONGTHAI_READ_ONLY_TOOLS.map(tool => tool.name);
  assert.deepEqual(names, [
    'get_restaurant_menu',
    'get_activity_catalog',
    'check_activity_availability',
    'get_stay_catalog',
    'check_stay_availability',
    'get_otop_catalog',
    'get_active_promotions',
    'get_booking_status',
    'get_payment_status',
    'get_membership_status',
  ]);
  for (const tool of THONGTHAI_READ_ONLY_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.parameters.additionalProperties, false);
    assert.doesNotMatch(tool.name, /create|update|modify|cancel|delete|refund|notify|submit|redeem|order/i);
    assert.match(tool.description, /Read-only/i);
  }
});

test('saved-agent config carries the read-only tool set and low-cost response settings', () => {
  const config = thongthaiStagingAgentConfig('test-model');
  assert.equal(THONGTHAI_STAGING_AGENT_ID.startsWith('agent_'), true);
  assert.deepEqual(config.tools.map(tool => tool.name), THONGTHAI_READ_ONLY_TOOLS.map(tool => tool.name));
  assert.equal(config.reasoning.effort, 'low');
  assert.equal(config.text.verbosity, 'low');
  assert.equal(config.text.format.type, 'text');
});

test('unknown read-only tool fails closed without touching a business source', async () => {
  const result = JSON.parse(await executeThongthaiReadOnlyTool('create_booking', {}, {
    guestDbId: null,
    channel: 'web',
    environment: 'test',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'unknown_read_only_tool');
});
