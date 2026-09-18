import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ProviderNotConfiguredError,
  LLMRequestError,
  LLMAvailabilityError,
  shouldFallbackToSecondaryProvider,
  type ProviderAttemptDiagnostic,
} from '../netlify/functions/_thongthai-model-provider';

// Phase P — the legacy brain's LLM call fails with LLMAvailabilityError on
// nearly every real non-discovery production turn while smaller-prompt
// callers on the same shared provider layer succeed, and two real prompt-
// size reductions (world_facts bound, restaurant_menu_live trim, ~77KB ->
// ~52KB measured directly against production) had zero effect on the
// failure. This is a genuine unresolved provider-layer defect, not a prompt-
// size one as far as the evidence shows -- so the next step is capturing
// the actual per-attempt provider/model/outcome/status/latency trail rather
// than guessing at more prompt trims. These tests lock in that the error
// classes carry that trail without changing any existing behavior: every
// constructor remains callable with just a message (backward compatible
// with every pre-existing call site and test), and attempts defaults to [].

test('ProviderNotConfiguredError remains constructable with no arguments and defaults attempts to []', () => {
  const error = new ProviderNotConfiguredError();
  assert.equal(error.name, 'ProviderNotConfiguredError');
  assert.deepEqual(error.attempts, []);
});

test('LLMRequestError and LLMAvailabilityError remain constructable with just a message', () => {
  const requestError = new LLMRequestError('blocked');
  assert.equal(requestError.message, 'blocked');
  assert.deepEqual(requestError.attempts, []);

  const availabilityError = new LLMAvailabilityError('all providers down');
  assert.equal(availabilityError.message, 'all providers down');
  assert.deepEqual(availabilityError.attempts, []);
  assert.ok(availabilityError instanceof LLMRequestError, 'LLMAvailabilityError must stay a subclass of LLMRequestError');
});

test('LLMAvailabilityError carries a structured, safe attempt trail when given one', () => {
  const attempts: ProviderAttemptDiagnostic[] = [
    { provider: 'gemini', model: 'gemini-3.6-flash', outcome: 'server_error', httpStatus: 503, elapsedMs: 1200 },
    { provider: 'gemini', model: 'gemini-3.5-flash', outcome: 'rate_limited', httpStatus: 429, elapsedMs: 800 },
    { provider: 'openai', model: 'gpt-5.6-luna', outcome: 'timeout', elapsedMs: 8000 },
  ];
  const error = new LLMAvailabilityError('all providers down', attempts);
  assert.deepEqual(error.attempts, attempts);
  // Never a prompt, customer message, model output, or credential field.
  for (const attempt of error.attempts) {
    assert.deepEqual(Object.keys(attempt).sort(), ['elapsedMs', 'httpStatus', 'model', 'outcome', 'provider'].filter(key => key in attempt).sort());
  }
});

test('shouldFallbackToSecondaryProvider behavior is unchanged by the diagnostic trail addition', () => {
  assert.equal(shouldFallbackToSecondaryProvider(new ProviderNotConfiguredError()), true);
  assert.equal(shouldFallbackToSecondaryProvider(new LLMAvailabilityError('timeout')), true);
  assert.equal(shouldFallbackToSecondaryProvider(new LLMRequestError('blocked')), false);
  assert.equal(shouldFallbackToSecondaryProvider(new Error('unrelated')), false);
});
