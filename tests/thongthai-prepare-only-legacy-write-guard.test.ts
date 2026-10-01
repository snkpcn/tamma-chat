import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldBlockLegacyWriteForPrepareOnly } from '../netlify/functions/_thongthai-runtime-v3';

function withEnv(values: Record<string,string|undefined>, fn: () => void) {
  const before = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    for (const [key,value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
    fn();
  } finally {
    for (const [key,value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key]=value;
    }
  }
}

test('prepare-only guest blocks every legacy consequential write tool', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS:'web',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'0',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_GUESTS:'prepare-cert-guest',
  }, () => {
    for (const toolName of [
      'create_booking',
      'create_restaurant_preorder',
      'create_cafe_inquiry',
      'create_otop_order',
      'redeem_promotion',
    ]) {
      assert.equal(shouldBlockLegacyWriteForPrepareOnly({
        toolName,
        guestKey:'prepare-cert-guest',
        guestDbId:'db-a',
        channel:'web',
      }), true, toolName);
    }
  });
});

test('prepare-only guard does not block read-only tools or unrelated guests/channels', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS:'web',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'0',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_GUESTS:'prepare-cert-guest',
  }, () => {
    assert.equal(shouldBlockLegacyWriteForPrepareOnly({
      toolName:'list_booking_options',
      guestKey:'prepare-cert-guest',
      guestDbId:'db-a',
      channel:'web',
    }), false);
    assert.equal(shouldBlockLegacyWriteForPrepareOnly({
      toolName:'create_booking',
      guestKey:'other-guest',
      guestDbId:'db-a',
      channel:'web',
    }), false);
    assert.equal(shouldBlockLegacyWriteForPrepareOnly({
      toolName:'create_booking',
      guestKey:'prepare-cert-guest',
      guestDbId:'db-a',
      channel:'line',
    }), false);
  });
});
