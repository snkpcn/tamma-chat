import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function source(path:string):string {
  return readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
}

test('AI telemetry persistence retries a slow/transient Supabase write', () => {
  const store=source('netlify/functions/_ai-cost-store.ts');
  assert.match(store,/POST_TIMEOUT_MS=2500/u);
  assert.match(store,/POST_ATTEMPTS=2/u);
  assert.match(store,/postWithPreference/u);
  assert.match(store,/if\(attempt\+1<POST_ATTEMPTS\)await sleep\(POST_RETRY_DELAY_MS\)/u);
});

test('Agent session never marks cost accounting complete when cost-event persistence failed', () => {
  const session=source('netlify/functions/_thongthai-agent-session.ts');
  assert.match(session,/persistAgentCost[\s\S]*Promise<boolean>/u);
  assert.match(session,/THONGTHAI_AGENT_COST_PERSIST_ERROR/u);
  assert.match(session,/costAccountingIncomplete: !usage\.available \|\| !costPersisted/u);
  assert.match(session,/usage cost persistence is still pending; refusing another paid turn/u);
});
