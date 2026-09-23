-- ============================================================================
-- NOT APPLIED. OWNER APPROVAL REQUIRED BEFORE RUNNING AGAINST tamma-customer-
-- data (project upaokrprawzhgzeqsdke).
--
-- Master Roadmap Phase 2 (Customer Intelligence Memory) -- see
-- THONGTHAI_HANDOFF.md's "Master Roadmap Phase 2" entry for the full
-- design writeup. This file is kept in the repo as the reviewed,
-- ready-to-apply storage for the AGGREGATE (cross-guest) phrase/demand/
-- risk signal log a future owner dashboard needs.
--
-- THE GAP: the existing guest_memory table is guest_id-scoped (one row
-- per memory_key, per guest, upserted) -- correct for "what does THIS
-- guest prefer," but it cannot represent "how many DIFFERENT guests said
-- this exact phrase" or "how often has this risk signal come up this
-- month" without attaching aggregate counters to every guest's own row,
-- which would conflate per-guest state with cross-guest business
-- intelligence. A new, purpose-built, append-only table is the correct
-- fit -- same design philosophy as the existing guest_events table
-- (event log, not a running counter; counting happens at QUERY time).
--
-- THE FIX IS PURELY ADDITIVE: one new table (this migration), no
-- existing table, trigger, function, or constraint is modified. Nothing
-- customer-facing depends on this table existing -- the actual
-- customer-facing personalization this phase ships (returning-guest
-- allergy/mobility awareness) reads ONLY the existing guest_memory
-- table via _customer-db.ts, completely independent of this one.
--
-- SAFE TO APPLY: a brand-new table with RLS enabled and all grants
-- revoked from anon/authenticated (service-role only, matching every
-- other operational table in this schema) cannot affect any existing
-- read/write path -- nothing references customer_intelligence_events
-- until this migration exists. Until it's applied, netlify/functions/
-- _customer-intelligence-events.ts's write attempt fails gracefully
-- (caught, logged, never thrown) and every customer-facing turn remains
-- fully functional without it, just without the aggregate signal log.
--
-- TO APPLY (owner-authorized only): run via the Supabase MCP server's
-- apply_migration tool (or `supabase db push`) against project
-- upaokrprawzhgzeqsdke, then confirm a real phrase/demand/risk-shaped
-- customer message produces exactly one row here.
-- ============================================================================

create table if not exists public.customer_intelligence_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('phrase', 'demand', 'risk')),
  category text not null,
  domain text not null check (
    domain in ('restaurant', 'activity', 'stay', 'cafe', 'system', 'general')
  ),
  guest_id uuid null references public.guests(id) on delete set null,
  -- A short, truncated snippet only -- never a full raw chat dump (see
  -- _customer-intelligence-events.ts's own redactExample, capped well
  -- below any real message length).
  redacted_example text not null,
  created_at timestamptz not null default now()
);

create index if not exists customer_intelligence_events_category_idx
  on public.customer_intelligence_events (event_type, category);
create index if not exists customer_intelligence_events_created_at_idx
  on public.customer_intelligence_events (created_at desc);

alter table public.customer_intelligence_events enable row level security;
revoke all on public.customer_intelligence_events from anon, authenticated;
