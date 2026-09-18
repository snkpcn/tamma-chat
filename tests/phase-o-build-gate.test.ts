import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Phase O live semantic build gate is opt-in and off by default',()=>{
  const source=readFileSync('scripts/phase-o-build-gate.mjs','utf8');
  assert.match(source,/THONGTHAI_RUN_LIVE_EVAL_ON_BUILD!==['"]1['"]/);
  assert.match(source,/LIVE_EVAL_PROFILE/);
  assert.match(source,/production-smoke/);
  assert.match(source,/LIVE_EVAL_MIN_PASS_PCT/);
});

test('Netlify build runs the opt-in Phase O gate after deterministic polish scripts',()=>{
  const toml=readFileSync('netlify.toml','utf8');
  const chat=toml.indexOf('apply-chat-polish.mjs');
  const restaurant=toml.indexOf('apply-restaurant-constraint-copy.mjs');
  const gate=toml.indexOf('phase-o-build-gate.mjs');
  assert.ok(chat>=0&&restaurant>chat&&gate>restaurant);
});

test('production-smoke semantic profile spans major customer domains',()=>{
  const source=readFileSync('scripts/run-semantic-live-eval.ts','utf8');
  for(const id of [
    'l-activity-08','l-restaurant-02','l-stay-02','l-promo-01',
    'l-member-01','l-otop-01','l-cafe-02','l-payment-03',
    'l-journey-01','l-support-02',
  ]) assert.match(source,new RegExp(id));
  assert.match(source,/มีไรทำมั่ง/);
});
