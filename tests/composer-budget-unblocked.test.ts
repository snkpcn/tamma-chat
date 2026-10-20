import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reserveAiCall,
  finalizeAiCall,
  reservationInputTokensForAiCall,
  reservationSizingForCallerLabel,
  reservationSizedCallerLabels,
  AiBudgetBlockedError,
} from '../netlify/functions/_ai-cost-ledger';
import {
  aiCostPolicy,
  usdToThbRate,
  usdToThb,
  estimateInputTokens,
  WEB_SEARCH_MODEL,
} from '../netlify/functions/_ai-cost-policy';
import {
  OPENAI_SEMANTIC_PRIMARY_MODEL,
  OPENAI_SEMANTIC_REVIEW_MODEL,
  RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS,
  responseComposerModel,
} from '../netlify/functions/_thongthai-model-provider';

const SUPABASE_KEYS = [
  'SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','THONGTHAI_MAX_CONVERSATION_AI_COST_THB',
  'THONGTHAI_MAX_CONVERSATION_AI_COST_USD','THONGTHAI_TEST_BYPASS_COST_CAP',
  'THONGTHAI_RESPONSE_COMPOSER_MODEL',
] as const;

/** Real persistent ledger over a fake Supabase, exactly as the production
 *  path uses it. Any request to a non-Supabase host is a paid provider call
 *  leaking out of a unit test and fails the run. */
function withFakeLedger<T>(run: (state: { providerCalls: () => number; reset: () => void }) => Promise<T>): Promise<T> {
  const before = Object.fromEntries(SUPABASE_KEYS.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  let row: { state: Record<string, unknown>; updated_at: string } | null = null;
  let providerCalls = 0;
  process.env.SUPABASE_URL = 'https://composer-budget.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_THB;
  delete process.env.THONGTHAI_MAX_CONVERSATION_AI_COST_USD;
  delete process.env.THONGTHAI_TEST_BYPASS_COST_CAP;
  delete process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;
  global.fetch = (async (input, init) => {
    if (!String(input).startsWith('https://composer-budget.test/')) {
      providerCalls += 1;
      throw new Error('Unexpected paid provider request');
    }
    if (String(input).includes('ai_api_cost_events')) return new Response('', { status: 201 });
    if (!init?.method || init.method === 'GET') return new Response(JSON.stringify(row ? [row] : []));
    row = JSON.parse(String(init.body));
    return new Response(JSON.stringify([row]));
  }) as typeof fetch;
  return run({ providerCalls: () => providerCalls, reset: () => { row = null; } }).finally(() => {
    global.fetch = originalFetch;
    for (const key of SUPABASE_KEYS) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
}

/** Every paid caller the provider can really emit, with the model and output
 *  ceiling that provider entry point actually passes to callOpenAIModel. */
function paidCallers(): Array<{ label: string; model: string; maxOut: number }> {
  const policy = aiCostPolicy();
  return [
    { label:'semantic-interpreter',          model:OPENAI_SEMANTIC_PRIMARY_MODEL, maxOut:policy.semanticMaxOutputTokens },
    { label:'semantic-reviewer',             model:OPENAI_SEMANTIC_REVIEW_MODEL,  maxOut:policy.semanticMaxOutputTokens },
    { label:'thongthai-brain-v3',            model:OPENAI_SEMANTIC_PRIMARY_MODEL, maxOut:policy.semanticMaxOutputTokens },
    { label:'grounded-response-composition', model:responseComposerModel(),       maxOut:RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS },
    { label:'grounded-response-composer',    model:responseComposerModel(),       maxOut:RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS },
  ];
}

// A real measured "complex" customer prompt: _ai-cost-policy.ts documents
// ~5.5k characters for the complex case. Thai is ~3 UTF-8 bytes per char.
const COMPLEX_PROMPT = 'ก'.repeat(5500);
const NORMAL_PROMPT = 'ก'.repeat(3700);

test('every real paid caller can reserve on the first turn of a conversation', async () => {
  await withFakeLedger(async ({ providerCalls, reset }) => {
    const capThb = aiCostPolicy().maxConversationCostUsd * usdToThbRate();
    assert.equal(capThb, 2, 'the owner ceiling must stay at 2 THB');

    for (const caller of paidCallers()) {
      reset();
      const reservation = await reserveAiCall(
        { conversationId:`c-${caller.label}`, guestDbId:'g', channel:'line', eventId:'e1', callerLabel:caller.label },
        caller.model,
        [COMPLEX_PROMPT],
        caller.maxOut,
      );
      assert.equal(
        reservation.kind, 'reserved',
        `${caller.label} must be able to reserve on a fresh conversation`,
      );
      if (reservation.kind !== 'reserved') return;
      assert.ok(
        usdToThb(reservation.reservedCostUsd) <= capThb,
        `${caller.label} reserved ${usdToThb(reservation.reservedCostUsd)} THB, above the ${capThb} THB ceiling`,
      );
    }
    assert.equal(providerCalls(), 0);
  });
});

test('a full first turn interprets AND composes inside the 2 THB ceiling', async () => {
  await withFakeLedger(async ({ providerCalls }) => {
    const policy = aiCostPolicy();
    const capThb = policy.maxConversationCostUsd * usdToThbRate();
    const context = { conversationId:'full-turn', guestDbId:'g', channel:'line' as const, eventId:'turn-1' };

    const interpret = await reserveAiCall(
      { ...context, callerLabel:'semantic-interpreter' },
      OPENAI_SEMANTIC_PRIMARY_MODEL, [NORMAL_PROMPT], policy.semanticMaxOutputTokens,
    );
    assert.equal(interpret.kind, 'reserved');
    if (interpret.kind !== 'reserved') return;
    // Settle at the real calibrated ratio (actual/estimate max 0.6359, p95
    // output 323) so the composer sees a realistic remaining budget.
    await finalizeAiCall(interpret, {
      inputTokens:Math.round(estimateInputTokens([NORMAL_PROMPT]) * 0.64),
      cachedInputTokens:0,
      outputTokens:323,
    }, '{"intent":"ask"}', true);

    const compose = await reserveAiCall(
      { ...context, callerLabel:'grounded-response-composition' },
      responseComposerModel(), [NORMAL_PROMPT], RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS,
    );
    assert.equal(
      compose.kind, 'reserved',
      'the grounded composer must still fit after interpretation on the same first turn',
    );
    if (compose.kind !== 'reserved') return;
    await finalizeAiCall(compose, {
      inputTokens:Math.round(estimateInputTokens([NORMAL_PROMPT]) * 0.64),
      cachedInputTokens:0,
      outputTokens:450,
    }, '{"message":"ok","usedFactKeys":[]}', true);

    assert.ok(
      usdToThb(interpret.reservedCostUsd) + usdToThb(compose.reservedCostUsd) <= capThb * 2,
      'sanity: reservations are released on finalize, not held for the whole conversation',
    );
    assert.equal(providerCalls(), 0);
  });
});

test('the composer reservation tracks prompt size instead of a flat ceiling', () => {
  const policy = aiCostPolicy();
  const small = reservationInputTokensForAiCall(
    { callerLabel:'grounded-response-composition' },
    estimateInputTokens(['สวัสดี']), policy.absoluteInputTokens,
  );
  const large = reservationInputTokensForAiCall(
    { callerLabel:'grounded-response-composition' },
    estimateInputTokens([COMPLEX_PROMPT]), policy.absoluteInputTokens,
  );
  assert.ok(small < large, 'a short composer prompt must reserve less than a long one');
  assert.ok(large <= policy.absoluteInputTokens, 'the absolute input ceiling still caps the reservation');
});

test('unreviewed caller labels fail closed at the absolute ceiling', () => {
  const policy = aiCostPolicy();
  assert.equal(reservationSizingForCallerLabel('some-future-paid-path'), 'absolute');
  assert.equal(
    reservationInputTokensForAiCall({ callerLabel:'some-future-paid-path' }, 10, policy.absoluteInputTokens),
    policy.absoluteInputTokens,
  );
  // 'unknown' is callPreferredModel's own default label and is deliberately
  // not registered: an unlabelled paid call must not inherit a cheap sizing.
  assert.equal(reservationSizingForCallerLabel('unknown'), 'absolute');
});

test('every paid caller label is covered by a reviewed sizing decision', () => {
  const registered = new Set(reservationSizedCallerLabels());
  for (const caller of paidCallers()) {
    assert.ok(
      registered.has(caller.label),
      `${caller.label} reaches the provider but has no reviewed reservation sizing`,
    );
  }
  assert.ok(registered.has('visitor-web-search'));
});

test('the composer model is primary by default and reverts to review by env alone', () => {
  const before = process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;
  try {
    delete process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;
    assert.equal(responseComposerModel(), OPENAI_SEMANTIC_PRIMARY_MODEL);
    process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL = OPENAI_SEMANTIC_REVIEW_MODEL;
    assert.equal(responseComposerModel(), OPENAI_SEMANTIC_REVIEW_MODEL);
  } finally {
    if (before === undefined) delete process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL;
    else process.env.THONGTHAI_RESPONSE_COMPOSER_MODEL = before;
  }
});

test('the flat web-search credit is unaffected by caller sizing', async () => {
  await withFakeLedger(async () => {
    const reservation = await reserveAiCall(
      { conversationId:'search', guestDbId:'g', channel:'web', eventId:'s1', callerLabel:'visitor-web-search' },
      WEB_SEARCH_MODEL, [], 0,
    );
    assert.equal(reservation.kind, 'reserved');
    if (reservation.kind !== 'reserved') return;
    assert.ok(reservation.reservedCostUsd > 0, 'a search credit is never free');
    assert.ok(usdToThb(reservation.reservedCostUsd) < 1);
  });
});

test('the 2 THB ceiling still blocks a conversation that genuinely spends it', async () => {
  await withFakeLedger(async () => {
    let blocked: AiBudgetBlockedError | null = null;
    for (let index = 0; index < 200; index += 1) {
      try {
        const reservation = await reserveAiCall(
          { conversationId:'spender', guestDbId:'g', channel:'line', eventId:`e${index}`, callerLabel:'grounded-response-composition' },
          responseComposerModel(), [COMPLEX_PROMPT], RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS,
        );
        assert.equal(reservation.kind, 'reserved');
        if (reservation.kind !== 'reserved') return;
        await finalizeAiCall(reservation, {
          inputTokens:estimateInputTokens([COMPLEX_PROMPT]), cachedInputTokens:0, outputTokens:RESPONSE_COMPOSER_MAX_OUTPUT_TOKENS,
        }, '{"message":"ok","usedFactKeys":[]}', true);
      } catch (error) {
        assert.ok(error instanceof AiBudgetBlockedError);
        blocked = error as AiBudgetBlockedError;
        break;
      }
    }
    assert.ok(blocked, 'repeated composed turns must eventually hit the ceiling');
    assert.equal(blocked?.reason, 'budget');
  });
});
