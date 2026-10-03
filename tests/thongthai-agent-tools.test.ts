import test from 'node:test';
import assert from 'node:assert/strict';
import {
  THONGTHAI_AGENT_TOOLS,
  THONGTHAI_PRODUCTION_PREPARE_TOOLS,
  THONGTHAI_READ_ONLY_TOOLS,
  executeThongthaiAgentTool,
  executeThongthaiReadOnlyTool,
} from '../netlify/functions/_thongthai-agent-tools';
import { THONGTHAI_STAGING_TRANSACTION_TOOLS, agentOtopCheckoutIdempotencyKey } from '../netlify/functions/_thongthai-agent-transactions';
import { thongthaiStagingAgentConfig, THONGTHAI_STAGING_AGENT_ID } from '../netlify/functions/_thongthai-agent-profile';

test('Thongthai Agent keeps the original business fact tools bounded and read-only', () => {
  const names = THONGTHAI_READ_ONLY_TOOLS.map(tool => tool.name);
  assert.deepEqual(names, [
    'recommend_restaurant_menu',
    'get_restaurant_menu',
    'get_activity_catalog',
    'check_activity_availability',
    'get_stay_catalog',
    'check_stay_availability',
    'get_otop_catalog',
    'get_cafe_menu',
    'get_order_status',
    'get_market_context',
    'get_shipping_quote',
    'get_worldwide_offer',
    'get_active_promotions',
    'get_booking_status',
    'get_payment_status',
    'get_membership_status',
  ]);
  for (const tool of THONGTHAI_READ_ONLY_TOOLS) {
    assert.equal(tool.type, 'function');
    assert.equal(tool.parameters.additionalProperties, false);
    assert.doesNotMatch(tool.name, /create|update|modify|cancel|delete|refund|notify|submit|redeem/i);
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
    'prepare_restaurant_preorder',
    'get_prepared_restaurant_preorder',
    'commit_prepared_restaurant_preorder',
    'prepare_otop_order',
    'get_prepared_otop_order',
    'commit_prepared_otop_order',
    'prepare_cafe_inquiry',
    'get_prepared_cafe_inquiry',
    'commit_prepared_cafe_inquiry',
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


test('restaurant transaction prepare also fails closed while transaction mode is off', async () => {
  const result = JSON.parse(await executeThongthaiAgentTool('prepare_restaurant_preorder', {}, {
    guestDbId: 'synthetic-guest',
    channel: 'web',
    environment: 'test',
    eventId: 'evt-restaurant-1',
    message: 'สั่งอาหาร',
    transactionMode: 'off',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'transaction_tools_disabled');
});


test('OTOP transaction prepare also fails closed while transaction mode is off', async () => {
  const result = JSON.parse(await executeThongthaiAgentTool('prepare_otop_order', {}, {
    guestDbId: 'synthetic-guest',
    channel: 'web',
    environment: 'test',
    eventId: 'evt-otop-1',
    message: 'สั่งสินค้า',
    transactionMode: 'off',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'transaction_tools_disabled');
});


test('Agent OTOP checkout idempotency key is deterministic and durable-length', () => {
  const confirmationId = '11111111-2222-4333-8444-555555555555';
  const first = agentOtopCheckoutIdempotencyKey(confirmationId);
  const second = agentOtopCheckoutIdempotencyKey(confirmationId);
  assert.equal(first, second);
  assert.equal(first, 'thongthai-agent-otop:11111111-2222-4333-8444-555555555555');
  assert.ok(first.length >= 16);
});


test('cafe inquiry prepare also fails closed while transaction mode is off', async () => {
  const result = JSON.parse(await executeThongthaiAgentTool('prepare_cafe_inquiry', {}, {
    guestDbId: 'synthetic-guest',
    channel: 'web',
    environment: 'test',
    eventId: 'evt-cafe-1',
    message: 'ให้ทีมคาเฟ่ติดต่อกลับครับ',
    transactionMode: 'off',
  }));
  assert.equal(result.ok, false);
  assert.equal(result.error, 'transaction_tools_disabled');
});


test('production prepare tool surface exposes drafts/readback but no commit tools', () => {
  const names = THONGTHAI_PRODUCTION_PREPARE_TOOLS.map(tool => tool.name);
  assert.ok(names.includes('prepare_activity_booking'));
  assert.ok(names.includes('get_prepared_activity_booking'));
  assert.ok(names.includes('prepare_stay_booking'));
  assert.ok(names.includes('get_prepared_stay_booking'));
  assert.ok(names.includes('prepare_restaurant_preorder'));
  assert.ok(names.includes('get_prepared_restaurant_preorder'));
  assert.ok(names.includes('prepare_otop_order'));
  assert.ok(names.includes('get_prepared_otop_order'));
  assert.ok(names.includes('prepare_cafe_inquiry'));
  assert.ok(names.includes('get_prepared_cafe_inquiry'));
  assert.ok(names.some(name => THONGTHAI_READ_ONLY_TOOLS.some(tool => tool.name === name)));
  assert.ok(names.every(name => !name.startsWith('commit_prepared_')));
});


test('prepare tool descriptions tell the Agent to avoid redundant preflight lookups', () => {
  const activity = THONGTHAI_PRODUCTION_PREPARE_TOOLS.find(tool => tool.name === 'prepare_activity_booking');
  const restaurant = THONGTHAI_PRODUCTION_PREPARE_TOOLS.find(tool => tool.name === 'prepare_restaurant_preorder');
  const cafe = THONGTHAI_PRODUCTION_PREPARE_TOOLS.find(tool => tool.name === 'prepare_cafe_inquiry');
  assert.ok(activity);
  assert.match(activity.description, /call this tool DIRECTLY/i);
  assert.match(activity.description, /do NOT call get_activity_catalog or check_activity_availability first/i);
  assert.ok(restaurant);
  assert.match(restaurant.description, /call this tool directly/i);
  assert.ok(cafe);
  assert.match(cafe.description, /call this tool directly/i);
});
