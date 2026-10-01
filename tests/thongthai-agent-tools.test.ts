import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THONGTHAI_AGENT_TOOLS,
  THONGTHAI_READ_ONLY_TOOLS,
  executeThongthaiAgentTool,
  executeThongthaiReadOnlyTool,
} from '../netlify/functions/_thongthai-agent-tools';
import { THONGTHAI_STAGING_TRANSACTION_TOOLS } from '../netlify/functions/_thongthai-agent-transactions';
import { thongthaiStagingAgentConfig, THONGTHAI_STAGING_AGENT_ID } from '../netlify/functions/_thongthai-agent-profile';

test('Thongthai Agent keeps the original business fact tools bounded and read-only', () => {
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

test('staging transaction surface is intentionally tiny and two-step', () => {
  assert.deepEqual(THONGTHAI_STAGING_TRANSACTION_TOOLS.map(tool => tool.name), [
    'prepare_activity_booking',
    'get_prepared_activity_booking',
    'commit_prepared_activity_booking',
    'prepare_stay_booking',
    'get_prepared_stay_booking',
    'commit_prepared_stay_booking',
  ]);
  for (const tool of THONGTHAI_STAGING_TRANSACTION_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.parameters.additionalProperties, false);
  }
});

test('saved-agent config carries read-only plus staged transaction tools and low-cost response settings', () => {
  const config = thongthaiStagingAgentConfig('test-model');
  assert.equal(THONGTHAI_STAGING_AGENT_ID.startsWith('agent_'), true);
  assert.deepEqual(config.tools.map(tool => tool.name), THONGTHAI_AGENT_TOOLS.map(tool => tool.name));
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

test('transaction tools fail closed by default before any business write', async () => {
  const result = JSON.parse(await executeThongthaiAgentTool('prepare_activity_booking', {}, {
    guestDbId: 'synthetic-guest',
    channel: 'web',
    environment: 'test',
    eventId: 'evt-1',
    message: 'จองเลย',
    transactionMode: 'off',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'transaction_tools_disabled');
});


test('stay transaction prepare also fails closed while transaction mode is off', async () => {
  const result = JSON.parse(await executeThongthaiAgentTool('prepare_stay_booking', {}, {
    guestDbId: 'synthetic-guest',
    channel: 'web',
    environment: 'test',
    eventId: 'evt-stay-1',
    message: 'จองที่พัก',
    transactionMode: 'off',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'transaction_tools_disabled');
});
