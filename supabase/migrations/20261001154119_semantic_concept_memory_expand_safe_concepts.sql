-- ============================================================================
-- Kernel V2 Phase 3 completion increment -- expand the EXISTING semantic
-- concept-memory closed enum to the two additional safe concept families
-- already named by the roadmap: relaxed pace and consider-only intent.
--
-- This migration:
--   * DOES NOT create a new table;
--   * DOES NOT enable pgvector or add embeddings;
--   * DOES NOT alter business, booking, order, payment, inventory, member,
--     incident, or customer-profile data;
--   * changes only the concept_key CHECK constraint on the existing
--     language-only semantic_concept_memory table.
--
-- Application safety remains closed by construction: these new keys may only
-- produce entities.pace='relaxed' or constraints consider_only/no_transaction.
-- They cannot produce book/order/confirm-without-context, tool calls, prices,
-- availability, or any business write authority.
--
-- Rollback:
--   First retract/remove any pace_relaxed/consider_only learned rows if they
--   exist, then restore the old four-key CHECK constraint. No other schema
--   object is involved.
-- ============================================================================

alter table public.semantic_concept_memory
  drop constraint if exists semantic_concept_memory_concept_key_check;

alter table public.semantic_concept_memory
  add constraint semantic_concept_memory_concept_key_check check (
    concept_key in (
      'companion_partner',
      'companion_family',
      'companion_friends',
      'companion_solo',
      'pace_relaxed',
      'consider_only'
    )
  );
