import test from 'node:test';
import assert from 'node:assert/strict';
import { completedPrimaryRuntimeStateFields } from '../netlify/functions/_thongthai-agent-session';

test('completed primary Agent turn folds minimal legacy runtime metadata into the session CAS write', () => {
  assert.deepEqual(completedPrimaryRuntimeStateFields('web'), {
    last_intent:'information',
    last_channel:'web',
    last_style_mode:'direct',
  });
  assert.deepEqual(completedPrimaryRuntimeStateFields('line'), {
    last_intent:'information',
    last_channel:'line',
    last_style_mode:'direct',
  });
});

test('completed primary runtime metadata is empty without a resolved channel', () => {
  assert.deepEqual(completedPrimaryRuntimeStateFields(undefined), {});
});
