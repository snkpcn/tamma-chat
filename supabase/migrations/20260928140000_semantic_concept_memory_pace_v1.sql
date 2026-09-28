-- ============================================================================
-- NOT YET APPLIED. Do not run against production until the owner explicitly
-- confirms in chat -- matching this repo's own established convention (see
-- 20260928120000_semantic_concept_memory_v1.sql's own precedent, which this
-- migration directly extends).
--
-- Kernel V2 Phase 3 increment 2 -- semantic concept memory, pace class.
--
-- Purpose:
--   Extends the SAME semantic_concept_memory table (see
--   20260928120000_semantic_concept_memory_v1.sql for its full design
--   rationale, which is unchanged here) to a second closed concept class:
--   pace / exertion preference (e.g. "ไม่อยากเหนื่อย" -> pace: 'relaxed').
--   This is purely a widened CHECK constraint -- no new table, no new
--   column, no new extension, no new cost line item. The table's own
--   design (versioned identity, confidence/evidence, contradiction
--   tracking, no guest_id, source restricted to openai_confirmed/
--   human_reviewed) already generalizes to any closed concept-key
--   vocabulary; only the closed vocabulary itself is widened here.
--
-- Why additive-only, not a new table:
--   A second table per concept class would fragment the contradiction
--   check (recordSemanticConceptEvidence's cross-concept-key contradiction
--   detection in netlify/functions/_semantic-concept-memory.ts reads ALL
--   active rows in one query specifically so a confirmed pace exemplar can
--   be checked against a stale companion exemplar and vice versa, in case a
--   future concept class's signature ever collides in surface form with an
--   unrelated one). One table, one closed concept_key vocabulary, is the
--   smallest safe way to keep that cross-class safety net working.
--
-- Rollback: narrow the CHECK constraint back to the increment-1 values
-- (see the down-migration equivalent below the up-migration). Any pace_*
-- rows already written would then need to be deleted or superseded before
-- the narrower constraint could be re-applied -- this migration does not
-- delete any data itself, so a rollback decision is left to whoever runs
-- it, with the exact statement provided.
-- ============================================================================

alter table public.semantic_concept_memory
  drop constraint semantic_concept_memory_concept_key_check;

alter table public.semantic_concept_memory
  add constraint semantic_concept_memory_concept_key_check
  check (
    concept_key in (
      'companion_partner', 'companion_family', 'companion_friends', 'companion_solo',
      'pace_relaxed', 'pace_moderate', 'pace_intense'
    )
  );

-- Rollback (not executed by this migration -- kept here for the record, run
-- manually only after confirming no pace_* rows remain active):
--   alter table public.semantic_concept_memory drop constraint semantic_concept_memory_concept_key_check;
--   alter table public.semantic_concept_memory add constraint semantic_concept_memory_concept_key_check
--     check (concept_key in ('companion_partner', 'companion_family', 'companion_friends', 'companion_solo'));
