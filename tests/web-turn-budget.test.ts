import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CUSTOMER_TURN_BUDGET_MS,
  WEB_CUSTOMER_TURN_BUDGET_MS,
  WEB_CUSTOMER_TURN_HARD_DEADLINE_MS,
  customerTurnTiming,
  CUSTOMER_MIN_RETRY_BUDGET_MS,
  TurnBudgetExhaustedError,
  remainingTurnBudgetMs,
  withinTurnBudget,
} from '../netlify/functions/_customer-turn-budget';
import {
  LINE_TURN_BUDGET_MS,
  LINE_MIN_RETRY_BUDGET_MS,
} from '../netlify/functions/_line-webhook-core';

const CHAT_SOURCE = readFileSync(
  new URL('../netlify/functions/thongthai-chat.ts', import.meta.url),
  'utf8',
);
const CORE_SOURCE = readFileSync(
  new URL('../netlify/functions/_line-webhook-core.ts', import.meta.url),
  'utf8',
);

const NETLIFY_SYNC_LIMIT_MS = 60_000;

test('web allows real provider and database latency while LINE retains its reply budget', () => {
  assert.equal(LINE_TURN_BUDGET_MS, CUSTOMER_TURN_BUDGET_MS);
  assert.equal(LINE_MIN_RETRY_BUDGET_MS, CUSTOMER_MIN_RETRY_BUDGET_MS);
  assert.ok(CUSTOMER_TURN_BUDGET_MS < NETLIFY_SYNC_LIMIT_MS);
  assert.equal(customerTurnTiming('line').answerMs, 8_000);
  assert.equal(customerTurnTiming('web').answerMs, WEB_CUSTOMER_TURN_BUDGET_MS);
  assert.ok(WEB_CUSTOMER_TURN_BUDGET_MS > CUSTOMER_TURN_BUDGET_MS);
  assert.ok(WEB_CUSTOMER_TURN_HARD_DEADLINE_MS + 750 + 2_500 < 30_000, 'claim, drain and error persistence fit the browser timeout');
});

test('the budget helper lives in one place, not duplicated per channel', () => {
  assert.ok(
    !CORE_SOURCE.includes('class TurnBudgetExhaustedError'),
    'the LINE module must consume the shared helper, not redeclare it',
  );
  assert.ok(
    !CORE_SOURCE.includes('function withinTurnBudget'),
    'withinTurnBudget must not be redefined in the LINE module',
  );
  assert.match(CORE_SOURCE, /from '\.\/_customer-turn-budget'/u);
  assert.match(CHAT_SOURCE, /from '\.\/_customer-turn-budget'/u);
});

test('withinTurnBudget resolves a fast attempt untouched', async () => {
  const value = await withinTurnBudget(Promise.resolve('answered'), 1_000);
  assert.equal(value, 'answered');
});

test('withinTurnBudget rejects once the budget runs out', async () => {
  const startedAt = Date.now();
  await assert.rejects(
    withinTurnBudget(new Promise(() => {}), 120),
    error => error instanceof TurnBudgetExhaustedError,
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 100, `gave up too early after ${elapsed}ms`);
  assert.ok(elapsed < 2_000, `took too long: ${elapsed}ms`);
});

test('an already-exhausted budget rejects without waiting', async () => {
  await assert.rejects(
    withinTurnBudget(new Promise(() => {}), 0),
    error => error instanceof TurnBudgetExhaustedError,
  );
  await assert.rejects(
    withinTurnBudget(new Promise(() => {}), -500),
    error => error instanceof TurnBudgetExhaustedError,
  );
});

test('a rejecting attempt keeps its own error, not a budget error', async () => {
  await assert.rejects(
    withinTurnBudget(Promise.reject(new Error('provider down')), 1_000),
    error => error instanceof Error && error.message === 'provider down',
  );
});

test('remainingTurnBudgetMs counts down from the turn start', () => {
  const startedAt = 1_000_000;
  assert.equal(remainingTurnBudgetMs(startedAt, 8_000, startedAt), 8_000);
  assert.equal(remainingTurnBudgetMs(startedAt, 8_000, startedAt + 3_000), 5_000);
  assert.ok(remainingTurnBudgetMs(startedAt, 8_000, startedAt + 9_000) < 0);
});

test('the web path bounds the shared core', () => {
  const entry = CHAT_SOURCE.indexOf('export async function processThongthaiChatCore(');
  assert.ok(entry > 0, 'the shared core entry point must still exist');
  const body = CHAT_SOURCE.slice(entry, entry + 4_000);
  assert.match(
    body,
    /withinTurnBudget\(\s*processThongthaiChatCoreInternal\((?:request|turnRequest), turnId\),\s*timing.answerMs,?\s*\)/u,
    'the core must run inside its channel deadline',
  );
  assert.match(body, /customerTurnTiming\(channel\)/u);
  // The existing honest fallback is what a budget overrun now reaches.
  assert.match(body, /outcome:'failed'/u);
  assert.match(body, /error_type:error instanceof Error \? error\.name : 'UnknownError'/u);
});

test('a budget overrun is recorded as a real failure outcome, not a silent 200', () => {
  const entry = CHAT_SOURCE.indexOf('export async function processThongthaiChatCore(');
  const body = CHAT_SOURCE.slice(entry, entry + 3_500);
  // persistCustomerTurnOutcome carries the error name, so a timeout shows up
  // in the monitor as TurnBudgetExhaustedError rather than an unknown gap.
  assert.match(body, /persistCustomerTurnOutcome\(\{[\s\S]{0,260}outcome:'failed'/u);
  assert.equal(new TurnBudgetExhaustedError(0).name, 'TurnBudgetExhaustedError');
});

test('LINE still races both attempts against its remaining budget', () => {
  const fn = CORE_SOURCE.slice(CORE_SOURCE.indexOf('async function askThongthaiReliably'));
  const raced = fn.match(/withinTurnBudget\(askThongthai\(/gu) ?? [];
  assert.equal(raced.length, 2, 'the first attempt and the retry must both stay bounded');
  assert.match(fn, /if \(remainingMs\(\) >= LINE_MIN_RETRY_BUDGET_MS\)/u);
  assert.match(fn, /turnUnfinishedMessage\(/u);
});
