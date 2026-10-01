import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredAgentPrimaryPercent,
  configuredAgentPreparePercent,
  shouldUseThongthaiAgentPrimary,
  shouldUseThongthaiAgentTransactionPrepare,
  stableAgentCanaryBucket,
  stableAgentPrepareCanaryBucket,
} from '../netlify/functions/_thongthai-agent-primary';

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

function guestInBucket(minInclusive: number, maxExclusive: number): string {
  for (let i=0;i<50_000;i+=1) {
    const key=`guest-${i}`;
    const bucket=stableAgentCanaryBucket(key);
    if (bucket>=minInclusive && bucket<maxExclusive) return key;
  }
  throw new Error(`No guest found in bucket range ${minInclusive}-${maxExclusive}`);
}

test('production Agent canary is disabled by default', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT: '100',
    THONGTHAI_AGENT_PRIMARY_PERCENT_WEB: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK: undefined,
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
    THONGTHAI_AGENT_PRIMARY_PERCENT_WEB: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK: undefined,
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
    THONGTHAI_AGENT_PRIMARY_PERCENT_WEB: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK: undefined,
    THONGTHAI_AGENT_PRIMARY_CHANNELS: 'web',
  }, () => {
    assert.equal(shouldUseThongthaiAgentPrimary({
      guestKey:'guest-a',guestDbId:'db-a',channel:'line',
      explicitTransactionIntent:false,weatherRequest:false,locationRequest:false,
    }), false);
  });
});

test('channel-specific percentages override the global rollout independently', () => {
  const inTenPercent=guestInBucket(0,1_000);
  const outsideTenButInsideHundred=guestInBucket(1_000,10_000);

  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED: '1',
    THONGTHAI_AGENT_PRIMARY_PERCENT: '100',
    THONGTHAI_AGENT_PRIMARY_PERCENT_WEB: '100',
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE: '10',
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK: '10',
    THONGTHAI_AGENT_PRIMARY_CHANNELS: 'web,line,facebook',
  }, () => {
    assert.equal(configuredAgentPrimaryPercent('web'),100);
    assert.equal(configuredAgentPrimaryPercent('line'),10);
    assert.equal(configuredAgentPrimaryPercent('facebook'),10);

    const shared={
      guestDbId:'db-a',
      explicitTransactionIntent:false,
      weatherRequest:false,
      locationRequest:false,
    };
    assert.equal(shouldUseThongthaiAgentPrimary({...shared,guestKey:outsideTenButInsideHundred,channel:'web'}),true);
    assert.equal(shouldUseThongthaiAgentPrimary({...shared,guestKey:outsideTenButInsideHundred,channel:'line'}),false);
    assert.equal(shouldUseThongthaiAgentPrimary({...shared,guestKey:outsideTenButInsideHundred,channel:'facebook'}),false);
    assert.equal(shouldUseThongthaiAgentPrimary({...shared,guestKey:inTenPercent,channel:'line'}),true);
    assert.equal(shouldUseThongthaiAgentPrimary({...shared,guestKey:inTenPercent,channel:'facebook'}),true);
  });
});

test('channel-specific percentage falls back to the legacy global value when unset', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_PERCENT: '37',
    THONGTHAI_AGENT_PRIMARY_PERCENT_WEB: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_LINE: undefined,
    THONGTHAI_AGENT_PRIMARY_PERCENT_FACEBOOK: undefined,
  }, () => {
    assert.equal(configuredAgentPrimaryPercent('web'),37);
    assert.equal(configuredAgentPrimaryPercent('line'),37);
    assert.equal(configuredAgentPrimaryPercent('facebook'),37);
  });
});


test('prepare-only transaction canary is separately gated and stable', () => {
  const inPrepareTen = (() => {
    for (let i=0;i<50_000;i+=1) {
      const key=`prepare-guest-${i}`;
      if (stableAgentPrepareCanaryBucket(key) < 1_000) return key;
    }
    throw new Error('no prepare canary guest found');
  })();
  const outsidePrepareTen = (() => {
    for (let i=0;i<50_000;i+=1) {
      const key=`prepare-outside-${i}`;
      if (stableAgentPrepareCanaryBucket(key) >= 1_000) return key;
    }
    throw new Error('no outside prepare guest found');
  })();

  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:'1',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS:'web',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'10',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_WEB:undefined,
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_LINE:undefined,
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_FACEBOOK:undefined,
  }, () => {
    assert.equal(configuredAgentPreparePercent('web'),10);
    assert.equal(shouldUseThongthaiAgentTransactionPrepare({
      guestKey:inPrepareTen,guestDbId:'db-a',channel:'web',
    }),true);
    assert.equal(shouldUseThongthaiAgentTransactionPrepare({
      guestKey:outsidePrepareTen,guestDbId:'db-a',channel:'web',
    }),false);
    assert.equal(shouldUseThongthaiAgentTransactionPrepare({
      guestKey:inPrepareTen,guestDbId:'db-a',channel:'line',
    }),false);
  });
});

test('prepare-only transaction canary is disabled unless its explicit flag is on', () => {
  withEnv({
    THONGTHAI_AGENT_PRIMARY_ENABLED:'1',
    THONGTHAI_AGENT_PRIMARY_CHANNELS:'web,line,facebook',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_ENABLED:undefined,
    THONGTHAI_AGENT_TRANSACTION_PREPARE_CHANNELS:'web',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'100',
  }, () => {
    assert.equal(shouldUseThongthaiAgentTransactionPrepare({
      guestKey:'guest-a',guestDbId:'db-a',channel:'web',
    }),false);
  });
});

test('prepare percentage supports channel-specific rollout overrides', () => {
  withEnv({
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT:'5',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_WEB:'10',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_LINE:'25',
    THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT_FACEBOOK:'50',
  }, () => {
    assert.equal(configuredAgentPreparePercent('web'),10);
    assert.equal(configuredAgentPreparePercent('line'),25);
    assert.equal(configuredAgentPreparePercent('facebook'),50);
  });
});
