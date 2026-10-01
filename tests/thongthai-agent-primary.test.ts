import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseThongthaiAgentPrimary, stableAgentCanaryBucket } from '../netlify/functions/_thongthai-agent-primary';

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

test('production Agent canary is disabled by default', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT: '100',
    THONGTHAI_AGENT_PRIMARY_CHANNELS: 'web',
  }, () => {
    assert.equal(shouldUseThongthaiAgentPrimary({
      guestKey:'guest-a',guestDbId:'db-a',channel:'web',
      explicitTransactionIntent:false,weatherRequest:false,locationRequest:false,
    }), false);
  });
});

test('production Agent canary stays read-only and excludes weather/location', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED: '1',
    THONGTHAI_AGENT_PRIMARY_PERCENT: '100',
    THONGTHAI_AGENT_PRIMARY_CHANNELS: 'web,line,facebook',
  }, () => {
    const base={guestKey:'guest-a',guestDbId:'db-a',channel:'web' as const};
    assert.equal(shouldUseThongthaiAgentPrimary({...base,explicitTransactionIntent:false,weatherRequest:false,locationRequest:false}), true);
    assert.equal(shouldUseThongthaiAgentPrimary({...base,explicitTransactionIntent:true,weatherRequest:false,locationRequest:false}), false);
    assert.equal(shouldUseThongthaiAgentPrimary({...base,explicitTransactionIntent:false,weatherRequest:true,locationRequest:false}), false);
    assert.equal(shouldUseThongthaiAgentPrimary({...base,explicitTransactionIntent:false,weatherRequest:false,locationRequest:true}), false);
  });
});

test('canary bucket is stable for the same guest', () => {
  const a=stableAgentCanaryBucket('same-guest');
  const b=stableAgentCanaryBucket('same-guest');
  assert.equal(a,b);
  assert.ok(a>=0 && a<10_000);
});

test('channel allowlist blocks non-enabled channels', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED: '1',
    THONGTHAI_AGENT_PRIMARY_PERCENT: '100',
    THONGTHAI_AGENT_PRIMARY_CHANNELS: 'web',
  }, () => {
    assert.equal(shouldUseThongthaiAgentPrimary({
      guestKey:'guest-a',guestDbId:'db-a',channel:'line',
      explicitTransactionIntent:false,weatherRequest:false,locationRequest:false,
    }), false);
  });
});
