-- ============================================================================
-- NOT YET APPLIED. Do not run against production until the owner explicitly
-- confirms in chat -- matching this repo's own established convention (see
-- 20260923142552_customer_intelligence_events_v1.sql's own "Owner explicitly
-- approved ... in chat before application" precedent).
--
-- Kernel V2 Phase 3 increment 1 -- semantic concept memory.
--
-- Purpose:
--   Cross-customer, LANGUAGE-ONLY learning: once the real OpenAI semantic
--   supervisor has confidently confirmed what a short, standalone customer
--   statement means (e.g. "มากับแฟน" -> companion: partner), remember that
--   confirmed meaning so a similar future phrase from a DIFFERENT customer
--   can often be understood without paying for another model call.
--
-- What this table is NOT:
--   * NOT business truth (contrast world_facts, which is owner-verified
--     operational fact -- prices, hours, ecosystem structure). A row here is
--     a model-confirmed LANGUAGE pattern, never authoritative about the
--     business, and must never be read as if it were.
--   * NOT customer memory (contrast guest_memory / guest_semantic_memory,
--     both keyed by a NOT NULL guest_id -- per-guest personalization). This
--     table intentionally has no guest_id column at all, so it can never
--     carry a personal fact about one customer.
--   * NOT a phrase dictionary. concept_key is a small CLOSED enum (the
--     application's own SAFE_CONCEPT_OUTCOMES map in
--     netlify/functions/_semantic-concept-memory.ts) -- a row's
--     normalized_signature is one CONFIRMED EXEMPLAR of that concept, used
--     for fuzzy matching, never an exact-sentence lookup key.
--
-- Safety model (mirrors guest_semantic_memory's proven confidence/evidence
-- shape, minus its guest_id, plus supersede-not-delete):
--   * source is restricted to 'openai_confirmed' or 'human_reviewed' -- a
--     row can never claim to have been learned from the fuzzy matcher's own
--     inference (that would be circular self-reinforcement of a possible
--     mistake).
--   * status/superseded_by allow a wrong learned concept to be retracted
--     with a full audit trail instead of silently vanishing.
--   * concept_key's CHECK constraint is a closed enum matching the
--     application's own SAFE_CONCEPT_OUTCOMES map -- a row can only ever
--     resolve to entities.companion, never to an action, domain, or anything
--     that could be read as a transaction.
--
-- No embedding/vector column in this version. Enabling pgvector and moving
-- to real embedding similarity is a SEPARATE decision (new Supabase
-- extension, new OpenAI embeddings-call cost line item) flagged for explicit
-- owner review in THONGTHAI_KERNEL_V2_HANDOFF.md, not bundled into this
-- migration. v1 matching is bounded edit-distance/token-overlap over a
-- normalized signature (see conceptSimilarity in the application module).
--
-- This migration is additive and does not modify any existing customer-
-- facing table, trigger, function, or policy.
-- ============================================================================

create table if not exists public.semantic_concept_memory (
  id uuid primary key default gen_random_uuid(),

  concept_key text not null check (
    concept_key in ('companion_partner', 'companion_family', 'companion_friends', 'companion_solo')
  ),

  -- One confirmed exemplar's normalized text, used for fuzzy matching only.
  -- Never a full raw transcript; bounded to a short standalone statement by
  -- the application layer before insert.
  normalized_signature text not null check (
    char_length(normalized_signature) between 1 and 80
  ),

  -- SHA-256(concept_key + ':' + normalized_signature). Lets a retried write
  -- for the exact same confirmed exemplar dedupe without a read-then-write
  -- race; the application's own read-then-reinforce path is the primary
  -- generalization mechanism, this is only a safety net for exact repeats.
  source_signal_key text not null check (
    source_signal_key ~ '^[a-f0-9]{64}$'
  ),

  confidence numeric(4,3) not null default 0.700 check (confidence >= 0 and confidence <= 1),
  evidence_count integer not null default 1 check (evidence_count >= 1),

  source text not null check (
    source in ('openai_confirmed', 'human_reviewed')
  ),

  status text not null default 'active' check (
    status in ('active', 'superseded', 'retracted')
  ),
  superseded_by uuid null references public.semantic_concept_memory(id),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint semantic_concept_memory_source_signal_key unique (source_signal_key)
);

create index if not exists semantic_concept_memory_active_idx
  on public.semantic_concept_memory (concept_key, status)
  where status = 'active';

alter table public.semantic_concept_memory enable row level security;

revoke all on table public.semantic_concept_memory
  from public, anon, authenticated, service_role;

-- No delete: a wrong learned concept is retracted (status='retracted') or
-- replaced (status='superseded' + superseded_by), never erased, so a bad
-- inference is always auditable rather than silently disappearing.
grant select, insert, update on table public.semantic_concept_memory
  to service_role;
