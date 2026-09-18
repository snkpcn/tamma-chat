import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration=readFileSync('netlify/functions/supabase/one-mind-observability-v1.sql','utf8');
const source=readFileSync('netlify/functions/_one-mind-observability.ts','utf8');

test('One-Mind trace schema is bounded, pseudonymous and RLS-protected',()=>{
  assert.match(migration,/create table if not exists public\.one_mind_traces/i);
  assert.match(migration,/expires_at timestamptz not null/i);
  assert.match(migration,/enable row level security/i);
  assert.match(migration,/unique \(channel, trace_id\)/i);
  assert.match(migration,/prune_expired_one_mind_traces/i);
  assert.match(migration,/where expires_at <= now\(\)/i);
  const tableBlock=migration.slice(
    migration.indexOf('create table if not exists public.one_mind_traces'),
    migration.indexOf(');',migration.indexOf('create table if not exists public.one_mind_traces'))+2,
  );
  assert.doesNotMatch(tableBlock,/raw_message|customer_message|response_text|email|phone|payment/i);
});

test('trace persistence is idempotent by channel + trace id and retains only 24 hours',()=>{
  assert.match(source,/ONE_MIND_TRACE_RETENTION_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(source,/on_conflict=channel,trace_id/);
  assert.match(source,/resolution=ignore-duplicates/);
  assert.match(source,/conversationKeyFromGuestId/);
  assert.doesNotMatch(source,/rawCustomerMessage|responseProse|modelOutput/);
});
