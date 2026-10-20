import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LLMAvailabilityError,
  LLMBudgetBlockedError,
  callResponseComposer,
} from '../netlify/functions/_thongthai-model-provider';
import {
  composeGroundedModelResponse,
  type ResponseComposerInput,
} from '../netlify/functions/_response-composer';
import type { DialogDecision } from '../netlify/functions/_dialog-manager';
import type { DegradationPlan } from '../netlify/functions/_graceful-degradation';
import type { KnowledgeBundle } from '../netlify/functions/_knowledge-resolver';
import { emptyTaskStateContainer } from '../netlify/functions/_task-state';

type Captured = { stream:'log'|'error'; name:string; payload:string };

/** Capture the exact console lines an operator would see for one turn. */
async function captureComposerLogs(run: () => Promise<unknown>): Promise<Captured[]> {
  const captured:Captured[] = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (name?:unknown, payload?:unknown) => {
    captured.push({ stream:'log', name:String(name ?? ''), payload:String(payload ?? '') });
  };
  console.error = (name?:unknown, payload?:unknown) => {
    captured.push({ stream:'error', name:String(name ?? ''), payload:String(payload ?? '') });
  };
  try {
    await run();
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  return captured;
}

const NOW = '2026-10-20T12:00:00.000Z';

// Same builder shape tests/response-composer.test.ts already uses, so this
// exercises the real ResponseComposerInput contract rather than a stub.
function decision(overrides: Partial<DialogDecision> = {}): DialogDecision {
  return {
    mode:'answer',
    taskStateContainer:emptyTaskStateContainer(),
    knowledgeRequests:[],
    missingFields:[],
    responseIntent:'grounded_answer',
    reasons:[],
    ...overrides,
  };
}
function degradation(): DegradationPlan {
  return {
    version:'degradation-v1', condition:'none', level:'normal', reasonCodes:[],
    retryable:false, safeToExecuteTransaction:false, sourceStates:[],
  };
}
function bundle(): KnowledgeBundle {
  return {
    domain:'activity',
    sources:[{ need:'price', sourceId:'activity_sot', sourceType:'activity_live', status:'ok' }],
    facts:[
      { key:'activity:horse:price', value:300, domain:'activity', sourceId:'activity_sot', sourceType:'activity_live', authoritative:true, fetchedAt:NOW },
    ],
    entities:[], missing:[], warnings:[], freshness:'live',
  };
}

/** Grounded input that really reaches the paid model-composer stage. */
function composerInput(overrides: Partial<ResponseComposerInput> = {}): ResponseComposerInput {
  return {
    channel:'line', language:'th', userMessage:'ขี่ม้าราคาเท่าไหร่',
    dialogDecision:decision(), knowledgeBundles:[bundle()], degradation:degradation(),
    allowModelComposition:true,
    aiCallContext:{
      conversationId:'c', guestDbId:'g', channel:'line',
      eventId:'e1', callerLabel:'grounded-response-composition',
    },
    ...overrides,
  };
}

test('LLMBudgetBlockedError stays an availability error so existing handlers are unaffected', () => {
  const error = new LLMBudgetBlockedError('budget');
  assert.ok(error instanceof LLMAvailabilityError, 'existing instanceof checks must keep matching');
  assert.ok(error instanceof Error);
  assert.equal(error.budgetReason, 'budget');
  assert.equal(error.name, 'LLMBudgetBlockedError');
  // The message is preserved verbatim from before this change.
  assert.equal(error.message, 'OpenAI blocked by cost guard: budget');
});

test('the provider raises a structured budget error instead of a generic availability error', async () => {
  const keys = ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
  const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const originalFetch = global.fetch;
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.SUPABASE_URL = 'https://block.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
  // Ledger reads return a conversation that has already spent the ceiling.
  const spent = { state:{ aiCostLedger:{
    version:'ai-cost-ledger-v1', conversationId:'c',
    startedAt:new Date().toISOString(), lastActivityAt:new Date().toISOString(),
    cumulativeCostUsd:0.0555, reservedCostUsd:0, callCount:1, events:[],
  } }, updated_at:new Date().toISOString() };
  global.fetch = (async (input, init) => {
    if (!String(input).startsWith('https://block.test/')) {
      throw new Error('a budget-blocked call must never reach the provider');
    }
    if (String(input).includes('ai_api_cost_events')) return new Response('', { status:201 });
    if (!init?.method || init.method === 'GET') return new Response(JSON.stringify([spent]));
    return new Response(JSON.stringify([spent]));
  }) as typeof fetch;
  try {
    await assert.rejects(
      callResponseComposer('system', [{ role:'user', content:'x' }], 'grounded-response-composition', {
        conversationId:'c', guestDbId:'g', channel:'line',
        eventId:'e1', callerLabel:'grounded-response-composition',
      }),
      error => {
        assert.ok(error instanceof LLMBudgetBlockedError, 'must be the structured budget error');
        assert.equal((error as LLMBudgetBlockedError).budgetReason, 'budget');
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
    for (const key of keys) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  }
});

test('a budget-blocked composer logs its own metric and NOT the generic error line', async () => {
  const captured = await captureComposerLogs(async () => {
    const original = global.fetch;
    const keys = ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SUPABASE_URL = 'https://block2.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    const spent = { state:{ aiCostLedger:{
      version:'ai-cost-ledger-v1', conversationId:'c',
      startedAt:new Date().toISOString(), lastActivityAt:new Date().toISOString(),
      cumulativeCostUsd:0.0555, reservedCostUsd:0, callCount:1, events:[],
    } }, updated_at:new Date().toISOString() };
    global.fetch = (async (input, init) => {
      if (!String(input).startsWith('https://block2.test/')) throw new Error('unexpected provider call');
      if (String(input).includes('ai_api_cost_events')) return new Response('', { status:201 });
      if (!init?.method || init.method === 'GET') return new Response(JSON.stringify([spent]));
      return new Response(JSON.stringify([spent]));
    }) as typeof fetch;
    try {
      const result = await composeGroundedModelResponse(composerInput());
      assert.equal(result, null, 'a blocked composer still falls back, it never throws at the caller');
    } finally {
      global.fetch = original;
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });

  const names = captured.map(entry => entry.name);
  assert.ok(
    names.includes('THONGTHAI_GROUNDED_COMPOSER_BUDGET_BLOCKED'),
    `expected a dedicated budget metric, saw: ${names.join(', ')}`,
  );
  assert.ok(
    !names.includes('THONGTHAI_GROUNDED_MODEL_COMPOSER_ERROR'),
    'a budget outcome must not be reported as a provider error',
  );

  const metric = captured.find(entry => entry.name === 'THONGTHAI_GROUNDED_COMPOSER_BUDGET_BLOCKED');
  const fields = JSON.parse(metric!.payload) as Record<string, unknown>;
  assert.equal(fields.composer_budget_blocked, 1);
  assert.equal(fields.reason, 'budget');
  assert.equal(fields.caller_label, 'grounded-response-composition');
  assert.equal(fields.channel, 'line');
  assert.equal(metric!.stream, 'log', 'a cost-policy outcome is not an error-stream incident');
});

test('a genuine provider failure still uses the generic composer error line', async () => {
  const captured = await captureComposerLogs(async () => {
    const original = global.fetch;
    const keys = ['OPENAI_API_KEY','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'] as const;
    const before = Object.fromEntries(keys.map(key => [key, process.env[key]]));
    process.env.OPENAI_API_KEY = 'test-key';
    process.env.SUPABASE_URL = 'https://fail.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test';
    let row:{state:Record<string,unknown>;updated_at:string}|null = null;
    global.fetch = (async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://fail.test/')) {
        if (url.includes('ai_api_cost_events')) return new Response('', { status:201 });
        if (!init?.method || init.method === 'GET') return new Response(JSON.stringify(row ? [row] : []));
        row = JSON.parse(String(init.body));
        return new Response(JSON.stringify([row]));
      }
      // Budget is fine; OpenAI itself is down.
      return new Response('upstream boom', { status:503 });
    }) as typeof fetch;
    try {
      const result = await composeGroundedModelResponse(composerInput());
      assert.equal(result, null);
    } finally {
      global.fetch = original;
      for (const key of keys) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });

  const names = captured.map(entry => entry.name);
  assert.ok(
    names.includes('THONGTHAI_GROUNDED_MODEL_COMPOSER_ERROR'),
    `a provider outage must still report as an error, saw: ${names.join(', ')}`,
  );
  assert.ok(
    !names.includes('THONGTHAI_GROUNDED_COMPOSER_BUDGET_BLOCKED'),
    'a provider outage must not be mislabelled as a budget block',
  );
});
