# Thongthai Kernel V2 Handoff

Updated: 2026-09-28 (this pass corrects the Phase 2 checkpoint below to
post-merge reality; the prior "Current State" section was written just
before PR #216 finished merging).

## Current State

- Repo: `snkpcn/tamma-chat`
- Local branch: `main` (working tree clean, fast-forwarded to `origin/main`)
- Current remote `main` SHA, verified directly via `git fetch origin main` in
  this session: `ce4ceb0cb7a359c793d837f41c40de831be5eae0`
- Phase 1 PR: `#215`, verified merged via GitHub API (`merged: true`,
  `merged_by: snkpcn`), squash commit `a8bbcb3ad620fd8c9a88e02cb820b40df14ab092`
- Phase 2 PR: `#216`, verified merged via GitHub API (`merged: true`,
  `merged_by: snkpcn`), merge commit `ce4ceb0cb7a359c793d837f41c40de831be5eae0`
  (this is the current `main` tip)
- Full suite on this exact `main` SHA, run directly in this session:
  `1616/1616` passed, `0` failed (matches the number PR #216 reported)
- Production Netlify deploy: **VERIFIED**, by the owner directly through
  Netlify (not by this Claude session, which has no egress path to
  `tamma-chat.netlify.app` -- see the environment-limitation note below):
  - Deploy ID: `6aba32fd5c75940008e8c0e5`
  - Deploy state: `READY`
  - Production `commit_ref`: `ce4ceb0cb7a359c793d837f41c40de831be5eae0`
    (matches `main` above)
  - Branch: `main`
  - Netlify secret scan: `0` matches
- Environment limitation (distinct from the verification above, not a
  substitute for it): this Claude session's own outbound network egress to
  `tamma-chat.netlify.app` returns HTTP 403 at the proxy layer
  (`recentRelayFailures` logs a policy-level `connect_rejected`, not an
  application error -- confirmed by a uniform 403 across every request,
  including a bare unrelated probe). Per this environment's own operating
  rule for a 403/407 egress denial, this is reported rather than retried or
  routed around. It means THIS session cannot itself run production smoke or
  re-run the Real LINE HTTPS certification against the live endpoint; it does
  not mean production is unverified -- the owner's direct Netlify check above
  is authoritative.

Open PRs observed through GitHub API before Phase 2 PR creation (not
re-verified this pass -- carried over from the prior checkpoint):

- `#213` Final perfection: eliminate remaining generic production fallbacks
- `#201` [run live] Post-merge final certification for PR #200
- `#146`, `#113`, `#87`, `#49`, `#10` remain open from older branches/checkpoints

## Current Phase

Kernel V2 Phase 3: Semantic Learning + Cost Efficiency -- **increment 1
(companion-concept memory) implemented, tested, PR open, NOT merged. Its
migration is NOT applied to production -- see "Phase 3 increment 1" below.**

This is not project completion. Phase 3 has more scope beyond increment 1
(pace, consider-only markers, a real embedding-based v2), and Phases 4-7
remain after Phase 3.

## Completed Phases

- Phase 1: Single Language Brain foundation, merged in PR `#215`.
- Phase 2: Conversation State V2, merged in PR `#216`. Verified on `main` at
  `ce4ceb0cb7a359c793d837f41c40de831be5eae0` with a clean 1616/1616 suite run
  in this session.

## Phase 3 increment 1: semantic concept memory (companion only)

Owner goal restated: ask OpenAI once when needed, safely learn the
confirmed concept, so similar future language is often free -- never a
brittle exact-sentence dictionary, never confidently wrong.

**Design-first audit** was completed before any code (full 9-point report in
this session's own record; summary below) -- per the mandate's own "do NOT
automatically create a new DB table; first determine whether existing
infrastructure can support this cleanly" instruction:

1. Production semantic prompt (`buildProductionSemanticInterpreterPrompt`,
   `_semantic-interpreter.ts`) is already compact and budget-enforced
   (2,500/4,000/5,000 token tiers, `_ai-cost-policy.ts`) -- no changes needed.
2. The zero-cost/paid-call boundary today is narrow (`EXACT_ZERO_CALL_INTENTS`
   / `EXACT_READ_ONLY_DETERMINISTIC_INTENTS` in
   `_thongthai-one-mind-orchestrator.ts`) -- most "coarse" deterministic
   intents still pay for a model call. This is exactly the gap increment 1
   targets.
3. No existing table can safely host cross-customer language learning:
   `guest_agent_state`/`guest_memory`/`guest_semantic_memory` are all
   per-guest (two have a `NOT NULL guest_id` FK); `world_facts` is
   owner-verified BUSINESS truth and must never be blurred with self-learned
   LANGUAGE inference; `customer_intelligence_events` has the right
   cross-customer/redaction/RLS shape but the wrong column design (closed
   enum counters, not a matchable concept store). A new, isolated table is
   the correct architecture.
4. No embedding/vector infrastructure exists anywhere in this repo (no
   pgvector, no embedding calls). Real semantic/lexical paraphrase bridging
   needs this and is explicitly NOT part of increment 1 -- flagged below as
   its own future decision, never silently bundled in.

**What increment 1 actually does:**

- New module `netlify/functions/_semantic-concept-memory.ts`: a CLOSED
  companion vocabulary (`companion_partner` / `_family` / `_friends` /
  `_solo`) that can only ever contribute `entities.companion` to a
  `SemanticTurn` -- there is no code path in this module that can produce a
  domain, an action, or anything resembling a transaction.
- Matching (`conceptSimilarity`) is bounded edit distance + order-independent
  bigram overlap over a normalized signature, calibrated empirically
  (`MIN_SIMILARITY = 0.6`). **Honesty, not oversell:** this reliably catches
  a typo, an appended detail, or a reordering of an ALREADY-CONFIRMED
  exemplar (e.g. "มากับแฟน" -> "มากับแฟนสองคน"). It does NOT bridge a genuine
  vocabulary substitution with no shared characters (e.g. "แฟน" vs
  "คนรู้ใจ" -- both mean partner but share no text); that correctly falls
  through to a fresh OpenAI call, which then becomes its OWN additional
  exemplar via the write path. Coverage grows from real confirmed usage, not
  from a hand-written synonym table -- true single-example paraphrase
  bridging needs embedding similarity (see "Deferred" below).
- Wired into `resolveSemanticTurn` (`_thongthai-one-mind-orchestrator.ts`):
  a read-path lookup between the exact-deterministic zero-cost check and the
  real model call (only when nothing else already classified the turn, and
  only against a fresh real call, never a `cachedSemantic` reuse); a
  write-path hook right before the model-owned turn is returned, gated on
  high confidence (>=0.85), a short standalone (non-multi-clause) message,
  and a non-mutating action -- fires best-effort, never awaited, never
  blocking the customer-facing turn.
- The write is naturally idempotent even under the ai-cost-ledger's own
  same-eventId replay (see point 8 of the audit): the migration's
  `unique(source_signal_key)` + `on_conflict=ignore-duplicates` makes a
  repeat write for the same confirmed exemplar a harmless no-op, never a
  duplicate row.
- New migration `supabase/migrations/20260928120000_semantic_concept_memory_v1.sql`
  -- **NOT YET APPLIED to production.** Matches this repo's own established
  convention (see `20260923142552_customer_intelligence_events_v1.sql`'s own
  "Owner explicitly approved ... in chat before application" precedent): the
  file is committed and reviewable, but nothing in this codebase runs it
  against the live Supabase project without that explicit step.

**Tests:** `tests/kernel-v2-phase3-semantic-concept-memory.test.ts`, 12/12
passing -- unit coverage of the matching/safety primitives, an end-to-end
integration proving an unseen near-identical variant resolves at zero paid
calls, an integration proving a genuinely different-vocabulary phrasing
correctly still pays for the real model (no false positive), a write-path
test proving a new confirmed exemplar is stored as its own row, and a
negative control proving a commit/booking message is never routed through
the fuzzy matcher. Full suite: 1628/1628 (1616 + 12), 0 failed.

**Explicitly deferred, not bundled into increment 1:**

- Pace and consider-only concept keys (same mandate, different worked
  examples) -- same architecture, separate PR once increment 1 is reviewed.
- Real embedding-based matching (pgvector) for true cross-vocabulary
  paraphrase bridging -- requires enabling a new Supabase extension and adds
  a new OpenAI embeddings-call cost line item to `_ai-cost-policy.ts`'s
  pricing table. This is a distinct decision for explicit owner review, not
  something to fold into a table-creation migration.
- Bounded-growth pruning policy beyond the current
  `MAX_ACTIVE_SIGNATURES_PER_CONCEPT = 20` per-concept cap (new confirmations
  beyond the cap are currently just not written, rather than superseding a
  weaker existing exemplar).

**Owner action needed before this reaches production:** review PR (branch
`kernel-v2/phase3-semantic-concept-memory`) and explicitly confirm applying
`20260928120000_semantic_concept_memory_v1.sql` to the live Supabase
project. Until then this table does not exist in production and the read
path (`loadActiveSemanticConcepts`) degrades to "no learned memory available"
exactly as it does today with zero concepts learned.

## Current Architecture (Phase 2)

Phase 2 keeps the Phase 1 single meaning authority intact and adds bounded working conversation memory downstream of the Language Brain:

- `SemanticTurn` remains the current-turn meaning input.
- `ConversationContextState.workingMemory` now stores short-lived state:
  - current topic
  - suspended topics
  - party size
  - companion
  - pace
  - considered selections
  - rejected selections
  - constraints
  - transaction commitment marker
- Working memory is stored inside the existing bounded `conversationContext` state, not business tables.
- `buildSemanticContext` exposes a compact working-memory summary to the semantic layer for reference resolution.
- Dialog task creation now respects explicit non-transaction evidence:
  - `not_yet_booking`
  - `no_transaction`
  - `not_booking`
  - `consider_only`
- A turn after "remember this / not yet booking" stays in working memory unless the current turn is an explicit commit.
- Normal slot continuation without a no-transaction memory marker still preserves existing draft-task behavior.
- Business executors, booking/payment tables, and production operational tables were not changed.

## Files Changed

Phase 2 (merged):
- `netlify/functions/_conversation-context.ts`
- `netlify/functions/_dialog-manager.ts`
- `netlify/functions/_thongthai-one-mind-orchestrator.ts`
- `tests/dialog-manager-horse-scenario.test.ts`
- `tests/human-brain-real-line-failure-regression.test.ts`
- `tests/kernel-v2-phase2-conversation-state.test.ts`
- `THONGTHAI_KERNEL_V2_HANDOFF.md`

Phase 3 increment 1 (branch `kernel-v2/phase3-semantic-concept-memory`, PR open, not yet merged):
- `netlify/functions/_semantic-concept-memory.ts` (new)
- `netlify/functions/_thongthai-one-mind-orchestrator.ts` (read/write-path hooks)
- `netlify/functions/_semantic-interpreter.ts` (`semanticSource` union extended)
- `supabase/migrations/20260928120000_semantic_concept_memory_v1.sql` (new, NOT applied)
- `tests/kernel-v2-phase3-semantic-concept-memory.test.ts` (new)
- `THONGTHAI_KERNEL_V2_HANDOFF.md`

## Migrations

Phase 2: none.

Phase 3 increment 1: `20260928120000_semantic_concept_memory_v1.sql` -- written,
committed, reviewable, **NOT APPLIED to production**. Additive only (a new
table, no existing table/trigger/function/policy touched). Rollback if ever
applied and reverted: `drop table public.semantic_concept_memory;` -- no
data migration needed since nothing else reads or writes it.

## Test Evidence

Focused Phase 2/regression suite:

```bash
node --import tsx --test tests/dialog-manager-cross-channel.test.ts tests/dialog-manager-shadow-comparison.test.ts tests/dialog-manager-stay-scenario.test.ts tests/kernel-v2-phase2-conversation-state.test.ts tests/human-brain-real-line-failure-regression.test.ts tests/dialog-manager-horse-scenario.test.ts tests/conversation-context.test.ts tests/final-certification-cross-domain-sequence.test.ts
```

Result: `8/8` files passed.

Phase 3 increment 1 focused suite:

```bash
npx tsx --test tests/kernel-v2-phase3-semantic-concept-memory.test.ts
```

Result: `12/12` passed.

Full suite (after Phase 3 increment 1, on top of Phase 2's `main`):

```bash
npm test
```

Result: `1628/1628` passed, `0` failed (1616 Phase-2 baseline + 12 new Phase 3 tests).

## Cost Measurements

No Phase 2 cost-policy constants changed.

Relevant existing Phase 1 cost contract remains:

- Hard monetary cap: `DEFAULT_MAX_CONVERSATION_AI_COST_USD = 0.05`
- Max paid semantic calls per turn: `1`
- Conversation call ceiling is no longer the arbitrary production IQ cliff from the old max-6 behavior.

Phase 2 tests are local deterministic/structured semantic tests and do not add paid semantic calls.

Phase 3 increment 1 does not change any cost-policy constant either -- it
only ever REMOVES a paid call (when a learned concept matches) or leaves
behavior unchanged (when it doesn't). No stress test at 20/50/100 turns has
been run yet for this narrow, single-concept increment; that is more
appropriate once pace/consider-only are added and there is a meaningful
number of concept keys to measure hit-rate against.

## PRs

- Phase 1 PR: `#215`, merged (squash `a8bbcb3`).
- Phase 2 PR: `#216`, merged (merge commit `ce4ceb0`, now `main` tip).
- Phase 3 increment 1 PR: branch `kernel-v2/phase3-semantic-concept-memory`,
  open, NOT merged -- pending review of the companion-memory migration
  before it goes to production.

## Known Failures / Gaps

- Production deploy for Phase 2 is owner-verified (deploy `6aba32fd...`,
  `READY`, `commit_ref` matches `main`) but no Claude session in this
  engagement has been able to independently re-run production smoke or the
  Real LINE HTTPS certification against it, since every session so far has
  had its egress to `tamma-chat.netlify.app` blocked at the proxy layer.
- Phase 3 increment 1 (companion concept memory) is implemented and tested
  but NOT merged and its migration is NOT applied -- see above.
- Phase 3's own remaining scope (pace/consider-only concepts, a real
  embedding-based v2, cost-stress evidence at 20/50/100 turns) is not done.
- Phase 4 Human Intent / Commercial Boundary is not implemented here.
- Phase 5 incident case creation/staff routing is not implemented here.
- Phase 6 natural response brain is not implemented here.
- Phase 7 shadow cutover/certification is not implemented here.

## Next Required Step

1. Whichever session/environment has live egress to `tamma-chat.netlify.app`
   should re-run production smoke and the Real LINE HTTPS certification
   against the owner-verified Phase 2 deploy (`6aba32fd...`), since no Claude
   session has been able to do this directly yet.
2. Owner reviews the Phase 3 increment 1 PR (branch
   `kernel-v2/phase3-semantic-concept-memory`) and explicitly confirms
   applying `20260928120000_semantic_concept_memory_v1.sql` before merge --
   this is a genuine production-schema decision, not something to wave
   through automatically.
3. After merge + migration apply + production deploy verification, extend
   Phase 3 to pace/consider-only concepts and run the mandate's own
   20/50/100-turn cost-stress conversations.
4. Real embedding-based matching (pgvector) is a SEPARATE decision for
   explicit owner review, not bundled into increment 1 or its extensions.

## Commands To Rerun

```bash
git status --short --branch
node --import tsx --test tests/dialog-manager-cross-channel.test.ts tests/dialog-manager-shadow-comparison.test.ts tests/dialog-manager-stay-scenario.test.ts tests/kernel-v2-phase2-conversation-state.test.ts tests/human-brain-real-line-failure-regression.test.ts tests/dialog-manager-horse-scenario.test.ts tests/conversation-context.test.ts tests/final-certification-cross-domain-sequence.test.ts
npm test
```

## Rollback Notes

Rollback is code-only:

- Revert the Phase 2 PR/commit after it is merged.
- No schema rollback is needed.
- No production DB cleanup is needed.
