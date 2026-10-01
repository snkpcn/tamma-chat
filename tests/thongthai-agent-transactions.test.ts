import test from 'node:test';
import assert from 'node:assert/strict';
import { currentTurnExplicitlyConfirmsPreparedBooking, executeThongthaiTransactionTool } from '../netlify/functions/_thongthai-agent-transactions';

test('prepared activity booking confirmation requires affirmative current-turn booking intent', () => {
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ยืนยันจองครับ'), true);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('จองเลยครับ'), true);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ยังไม่จองนะ'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('เอาไว้ก่อน ยังไม่จอง'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('จองไหมครับ'), false);
  assert.equal(currentTurnExplicitlyConfirmsPreparedBooking('ไม่ต้องจองเลยครับ'), false);
});


async function withEnvAsync<T>(values: Record<string,string|undefined>, fn: () => Promise<T>): Promise<T> {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key,value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
    return await fn();
  } finally {
    for (const [key,value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
}

test('prepare-only mode reaches draft validation but cannot commit even if live commits are enabled', async () => {
  await withEnvAsync({
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
    THONGTHAI_AGENT_LIVE_TRANSACTION_ENABLED:'1',
  }, async () => {
    const prepare = JSON.parse(await executeThongthaiTransactionTool('prepare_activity_booking', {}, {
      guestDbId:'synthetic-guest',
      channel:'web',
      environment:'live',
      eventId:'evt-prepare-1',
      message:'ขอจองม้า',
      transactionMode:'prepare',
    }));
    assert.equal(prepare.ok,false);
    assert.equal(prepare.error,'missing_or_invalid_fields');

    const commit = JSON.parse(await executeThongthaiTransactionTool('commit_prepared_activity_booking', {
      confirmation_id:'synthetic-confirmation',
    }, {
      guestDbId:'synthetic-guest',
      channel:'web',
      environment:'live',
      eventId:'evt-prepare-2',
      message:'ยืนยันจอง',
      transactionMode:'prepare',
    }));
    assert.equal(commit.ok,false);
    assert.equal(commit.error,'transaction_commit_disabled');
    assert.equal(commit.prepared_only,true);
  });
});

test('prepare-only mode fails closed when its production flag is off', async () => {
  await withEnvAsync({
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:undefined,
  }, async () => {
    const result = JSON.parse(await executeThongthaiTransactionTool('prepare_activity_booking', {}, {
      guestDbId:'synthetic-guest',
      channel:'web',
      environment:'live',
      eventId:'evt-prepare-off',
      message:'ขอจองม้า',
      transactionMode:'prepare',
    }));
    assert.equal(result.ok,false);
    assert.equal(result.error,'transaction_prepare_tools_not_enabled');
  });
});

test('prepare-only mode is never valid against test environment', async () => {
  await withEnvAsync({
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
  }, async () => {
    const result = JSON.parse(await executeThongthaiTransactionTool('prepare_activity_booking', {}, {
      guestDbId:'synthetic-guest',
      channel:'web',
      environment:'test',
      eventId:'evt-prepare-test',
      message:'ขอจองม้า',
      transactionMode:'prepare',
    }));
    assert.equal(result.ok,false);
    assert.equal(result.error,'transaction_prepare_tools_not_enabled');
  });
});
