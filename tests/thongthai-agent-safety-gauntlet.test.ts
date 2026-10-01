import test from 'node:test';
import assert from 'node:assert/strict';

import {
  THONGTHAI_PREPARE_ONLY_TRANSACTION_TOOLS,
  currentTurnExplicitlyConfirmsPreparedBooking,
  currentTurnExplicitlyConfirmsCafeInquiry,
  executeThongthaiTransactionTool,
} from '../netlify/functions/_thongthai-agent-transactions';
import { thongthaiProductionAgentConfig } from '../netlify/functions/_thongthai-agent-profile';
import { shouldUseThongthaiAgentTransactionPrepare } from '../netlify/functions/_thongthai-agent-primary';
import { shouldBlockLegacyWriteForPrepareOnly } from '../netlify/functions/_thongthai-runtime-v3';

const PREPARE_TOOLS = [
  'prepare_activity_booking',
  'prepare_stay_booking',
  'prepare_restaurant_preorder',
  'prepare_otop_order',
  'prepare_cafe_inquiry',
] as const;

const GET_PREPARED_TOOLS = [
  'get_prepared_activity_booking',
  'get_prepared_stay_booking',
  'get_prepared_restaurant_preorder',
  'get_prepared_otop_order',
  'get_prepared_cafe_inquiry',
] as const;

const COMMIT_TOOLS = [
  'commit_prepared_activity_booking',
  'commit_prepared_stay_booking',
  'commit_prepared_restaurant_preorder',
  'commit_prepared_otop_order',
  'commit_prepared_cafe_inquiry',
] as const;

function withEnv(values: Record<string,string|undefined>, fn: () => void) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('Gate 0 production transaction surface exposes prepare/get for all five verticals and no commit tool', () => {
  const prepareOnlyNames = new Set(THONGTHAI_PREPARE_ONLY_TRANSACTION_TOOLS.map(tool => tool.name));

  for (const name of [...PREPARE_TOOLS, ...GET_PREPARED_TOOLS]) {
    assert.equal(prepareOnlyNames.has(name), true, `missing ${name}`);
  }
  for (const name of COMMIT_TOOLS) {
    assert.equal(prepareOnlyNames.has(name), false, `commit leaked into prepare-only surface: ${name}`);
  }

  const productionConfig = thongthaiProductionAgentConfig('gpt-5.6-terra');
  const productionNames = new Set(productionConfig.tools.map(tool => tool.name));

  for (const name of [...PREPARE_TOOLS, ...GET_PREPARED_TOOLS]) {
    assert.equal(productionNames.has(name), true, `production Agent missing ${name}`);
  }
  for (const name of COMMIT_TOOLS) {
    assert.equal(productionNames.has(name), false, `production Agent exposes consequential tool: ${name}`);
  }
});

test('booking/order confirmation gate rejects hold, cancellation, change-of-mind, and correction-only turns', () => {
  for (const message of [
    'ยังไม่จองครับ',
    'ยังไม่สั่ง เอาไว้ก่อน',
    'เปลี่ยนใจ ไม่เอาแล้ว',
    'ยกเลิกก่อนครับ',
    'เอาไว้ก่อน เดี๋ยวค่อยยืนยัน',
    'แก้เป็นพรุ่งนี้ก่อน ยังไม่จอง',
    'เปลี่ยนจำนวนเป็น 2 ชิ้นก่อน ยังไม่สั่ง',
    'ยืนยันจอง แต่ขอแก้เป็น 45 นาที',
    'ยืนยันสั่ง แต่เปลี่ยนเป็น 2 ชิ้น',
  ]) {
    assert.equal(
      currentTurnExplicitlyConfirmsPreparedBooking(message),
      false,
      `must not commit on: ${message}`,
    );
  }
});

test('cafe confirmation gate rejects hold, cancellation, questions, and correction-only turns', () => {
  for (const message of [
    'ยังไม่ส่งครับ',
    'ไม่ต้องส่งแล้ว',
    'เอาไว้ก่อน',
    'ยกเลิกก่อนครับ',
    'แก้คำถามเป็นเรื่องเวลาเปิดก่อน ยังไม่ส่ง',
    'ส่งให้ทีมได้ไหม',
    'ยืนยันส่งคำถามได้ไหม',
    'ยืนยันส่งคำถาม แต่ขอแก้เป็นถามเรื่องห้องประชุม',
  ]) {
    assert.equal(
      currentTurnExplicitlyConfirmsCafeInquiry(message),
      false,
      `must not send cafe inquiry on: ${message}`,
    );
  }
});

test('explicit later confirmations are recognized for the matching transaction families', () => {
  for (const message of ['ยืนยันจอง', 'ยืนยันสั่ง']) {
    assert.equal(
      currentTurnExplicitlyConfirmsPreparedBooking(message),
      true,
      `expected explicit confirmation: ${message}`,
    );
  }
  assert.equal(currentTurnExplicitlyConfirmsCafeInquiry('ยืนยันส่งคำถาม'), true);
});

test('prepare-only runtime hard-blocks every consequential commit tool before any business write', async () => {
  for (const name of COMMIT_TOOLS) {
    const raw = await executeThongthaiTransactionTool(
      name,
      { confirmation_id: 'safety-gauntlet-confirmation' },
      {
        guestDbId: 'safety-gauntlet-db',
        channel: 'web',
        environment: 'live',
        eventId: 'safety-gauntlet-confirm-event',
        message: name === 'commit_prepared_cafe_inquiry' ? 'ยืนยันส่งคำถาม' : 'ยืนยันจอง',
        transactionMode: 'prepare',
      },
    );
    const result = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(result.ok, false, name);
    assert.equal(result.error, 'transaction_commit_disabled', name);
    assert.equal(result.prepared_only, true, name);
  }
});

test('duplicate/retry commit attempts remain fail-closed in prepare-only mode', async () => {
  for (const name of COMMIT_TOOLS) {
    const context = {
      guestDbId: 'safety-gauntlet-db',
      channel: 'web' as const,
      environment: 'live' as const,
      eventId: 'safety-gauntlet-retry-event',
      message: name === 'commit_prepared_cafe_inquiry' ? 'ยืนยันส่งคำถาม' : 'ยืนยันสั่ง',
      transactionMode: 'prepare' as const,
    };

    const first = JSON.parse(await executeThongthaiTransactionTool(
      name,
      { confirmation_id: 'same-confirmation-id' },
      context,
    )) as Record<string, unknown>;

    const retry = JSON.parse(await executeThongthaiTransactionTool(
      name,
      { confirmation_id: 'same-confirmation-id' },
      { ...context, eventId: 'safety-gauntlet-retry-event-2' },
    )) as Record<string, unknown>;

    assert.deepEqual(retry, first, `retry changed fail-closed result for ${name}`);
    assert.equal(retry.error, 'transaction_commit_disabled', name);
  }
});

test('material-change-looking commit attempts still cannot cross Gate 0', async () => {
  const cases = [
    ['commit_prepared_activity_booking', 'เปลี่ยนเป็นพรุ่งนี้ แล้วก็ยืนยันจอง'],
    ['commit_prepared_stay_booking', 'เปลี่ยนวันออกเป็นอีกวัน แล้วก็ยืนยันจอง'],
    ['commit_prepared_restaurant_preorder', 'เปลี่ยนเป็นสองจาน แล้วยืนยันสั่ง'],
    ['commit_prepared_otop_order', 'เปลี่ยนจำนวนเป็น 2 ชิ้น แล้วยืนยันสั่ง'],
    ['commit_prepared_cafe_inquiry', 'แก้คำถามนิดนึง แล้วยืนยันส่งคำถาม'],
  ] as const;

  for (const [name, message] of cases) {
    const result = JSON.parse(await executeThongthaiTransactionTool(
      name,
      { confirmation_id: 'old-draft-id' },
      {
        guestDbId: 'safety-gauntlet-db',
        channel: 'web',
        environment: 'live',
        eventId: 'safety-gauntlet-change-event',
        message,
        transactionMode: 'prepare',
      },
    )) as Record<string, unknown>;

    assert.equal(result.ok, false, name);
    assert.equal(result.error, 'transaction_commit_disabled', name);
  }
});


test('public prepare rollout remains zero unless an exact synthetic guest is allowlisted', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS:'web',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'0',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_WEB:'0',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_GUESTS:'',
  }, () => {
    assert.equal(shouldUseThongthaiAgentTransactionPrepare({
      guestKey:'ordinary-production-guest',
      guestDbId:'ordinary-db-id',
      channel:'web',
    }), false);
  });
});

test('prepare-only legacy write kill switch covers all five business verticals', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS:'web',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'0',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_WEB:'0',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_GUESTS:'safety-gauntlet-guest',
  }, () => {
    for (const toolName of [
      'create_booking',
      'create_restaurant_preorder',
      'create_otop_order',
      'create_cafe_inquiry',
    ]) {
      assert.equal(shouldBlockLegacyWriteForPrepareOnly({
        toolName,
        guestKey:'safety-gauntlet-guest',
        guestDbId:'safety-gauntlet-db',
        channel:'web',
      }), true, toolName);
    }
  });
});
