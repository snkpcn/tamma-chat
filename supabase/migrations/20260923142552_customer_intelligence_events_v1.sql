-- ============================================================================
-- APPLIED 2026-09-25 TO tamma-customer-data
-- project: upaokrprawzhgzeqsdke
-- Supabase migration version: 20260925094049
-- Owner explicitly approved Phase 2.7 in chat before application.
--
-- Phase 2.7 — aggregate customer intelligence storage.
--
-- Purpose:
--   * guest_memory remains the per-guest personalization source of truth.
--   * customer_intelligence_events is a separate append-style aggregate log
--     for cross-guest phrase / demand / risk analysis.
--
-- Privacy:
--   * never stores a full raw conversation transcript.
--   * redacted_example is hard-capped at 80 chars and direct identifiers are
--     removed in _customer-intelligence-events.ts before insert.
--   * raw LINE/web transport event ids are never stored; source_event_key is
--     a one-way SHA-256 key.
--
-- Reliability:
--   * LINE/core retries must not inflate counts.
--   * UNIQUE(source_event_key,event_type,category,domain) plus
--     PostgREST resolution=ignore-duplicates makes the aggregate write
--     idempotent for one transport turn while still allowing one turn to
--     produce multiple distinct normalized signals.
--
-- Security:
--   * RLS enabled.
--   * anon/authenticated/public receive no privileges.
--   * service_role gets only SELECT + INSERT (no UPDATE/DELETE), matching the
--     table's aggregate append-log role and future server-side dashboard use.
--
-- This migration is additive and does not modify any existing customer-facing
-- table, trigger, function, or policy.
-- ============================================================================

create table if not exists public.customer_intelligence_events (
  id uuid primary key default gen_random_uuid(),

  event_type text not null check (
    event_type in ('phrase', 'demand', 'risk')
  ),

  category text not null,

  domain text not null check (
    domain in ('restaurant', 'activity', 'stay', 'cafe', 'system', 'general')
  ),

  guest_id uuid null references public.guests(id) on delete set null,

  channel text not null check (
    channel in ('web', 'line', 'other')
  ),

  -- SHA-256(channel + ':' + transport event id). The raw transport id is
  -- deliberately never stored.
  source_event_key text not null check (
    source_event_key ~ '^[a-f0-9]{64}$'
  ),

  -- Short customer-language example only, never a full transcript.
  redacted_example text not null check (
    char_length(redacted_example) between 1 and 80
  ),

  created_at timestamptz not null default now(),

  constraint customer_intelligence_events_source_signal_key
    unique (source_event_key, event_type, category, domain)
);

-- Dashboard/trend queries: time window + normalized signal dimensions.
create index if not exists customer_intelligence_events_created_at_idx
  on public.customer_intelligence_events (created_at desc);

create index if not exists customer_intelligence_events_signal_idx
  on public.customer_intelligence_events
  (event_type, category, domain, created_at desc);

-- Supports distinct-guest / returning-pattern analysis without exposing
-- customer identity to client-side callers.
create index if not exists customer_intelligence_events_guest_idx
  on public.customer_intelligence_events (guest_id, created_at desc)
  where guest_id is not null;

alter table public.customer_intelligence_events enable row level security;

revoke all on table public.customer_intelligence_events
  from public, anon, authenticated, service_role;

grant select, insert on table public.customer_intelligence_events
  to service_role;
