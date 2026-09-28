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

**This is PR #218 = Phase 3 increment 1, NOT Phase 3 completion.** The
original Phase 3 completion gate is untouched and still requires (none of
this is done yet): formal 20/50/100-turn cost stress runs; paid-call counts;
zero-call rate; learned-memory hit rate; average and p95 semantic input
tokens; average/p95/max conversation cost; count of conversations exceeding
the cap; proof of no arbitrary intelligence cliff; proof of no unsafe
transaction from learned semantics at scale. Increment 1's tests prove the
MECHANISM is safe (acceptance criteria A-F, each mapped to a test below);
they are not a substitute for that formal stress-test evidence, which is
more meaningful once there is more than one concept family to measure
against. Phase 3 also has more scope beyond increment 1 (pace/consider-only
concept keys, a real embedding-based v2), and Phases 4-7 remain after Phase 3.

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

**Schema proposal** (written and reviewed before the migration was finalized,
per the mandate's own "write the schema proposal, explain each column, prove
why existing tables are unsuitable, define rollback, retention/invalidation,
promotion, conflict-demotion" requirement):

| Column | Purpose |
|---|---|
| `id` | Versioned concept-instance identity (one row = one confirmed exemplar of one concept). |
| `schema_version` | Schema/version marker -- lets a future migration tell "no rows" apart from "rows written under an incompatible earlier shape" without inspecting column existence. |
| `concept_key` | Canonical semantic meaning signature -- a CLOSED enum (`companion_partner`/`_family`/`_friends`/`_solo`) matching the application's own `SAFE_CONCEPT_OUTCOMES` map. Never a free-form label. |
| `normalized_signature` | The generalized pattern/evidence record: one confirmed exemplar's normalized text, used only for fuzzy matching (see `conceptSimilarity`), never as a literal-sentence key. |
| `evidence_count` | How many confirmed real-world instances have reinforced this exact signature. Gates trust (`MIN_TRUSTED_EVIDENCE_COUNT`). |
| `confidence` | Blended trust score, nudged up on each reinforcement, gates trust (`MIN_TRUSTED_CONFIDENCE`). |
| `contradiction_count` | Counts a confirmed disagreement (a DIFFERENT concept's exemplar closely resembling this row's signature) -- the conflict/demotion signal. |
| `source` | Provenance -- restricted to `openai_confirmed`/`human_reviewed`; a row can never claim to be self-learned from the fuzzy matcher's own inference. |
| `status` / `superseded_by` | Invalidation/supersede state -- `active`/`superseded`/`retracted`, never a physical delete. |
| `created_at` / `updated_at` | Standard lifecycle timestamps. |
| `source_signal_key` | SHA-256(concept_key + signature); the unique constraint that makes a repeat write for the same exemplar a harmless no-op (also closes the ai-cost-ledger replay duplicate-write case found during testing). |

Why existing tables are unsuitable (full reasoning in the design-first audit
above): `guest_agent_state`/`guest_memory`/`guest_semantic_memory` are all
per-guest (two have a `NOT NULL guest_id` FK) -- reusing them would either
fake a shared guest identity or duplicate the same learned concept once per
customer, defeating the "pay once" goal, and would blur personal
preferences with generic language understanding. `world_facts` is
owner-verified business truth (`verified boolean`, `source='owner_verified'`
in every seed row) -- mixing in self-learned, probabilistic language
inference would blur exactly the trust boundary the mandate protects.
`customer_intelligence_events` has the right cross-customer/RLS/redaction
shape but is a closed-enum COUNTER table with no confidence/evidence/
matchable-signature design at all.

**Rollback:** `drop table public.semantic_concept_memory;` -- nothing else
reads or writes it, so this is a clean, data-loss-only-of-learned-language
(never business or customer data) rollback.

**Retention/invalidation:** a row is retracted (not deleted) the first time
a confirmed contradiction is found against it (`CONTRADICTION_RETRACT_
THRESHOLD = 1`); the read path additionally treats any row with
`contradiction_count >= 1` as untrustworthy even if its `status` somehow
didn't flip (defense in depth). There is no time-based expiry in increment
1 -- a stale-but-uncontradicted concept simply keeps being confirmed
correct indefinitely, which is the intended behavior for something like
"companion" that doesn't go stale the way a price or an availability fact
would.

**Promotion:** a new confirmed exemplar is written as `status='active'`,
`confidence=0.7`, `evidence_count=1` -- NOT yet trusted for matching
(`MIN_TRUSTED_CONFIDENCE=0.85`, `MIN_TRUSTED_EVIDENCE_COUNT=3`). It is
"promoted" to trusted only by accumulating reinforcements from further
independent confirmed instances (each reinforcement nudges confidence up
and increments evidence_count) -- there is no single-shot promotion path,
by design: one confirmation is evidence, not proof.

**Conflict/demotion:** see `contradiction_count` above and
`recordSemanticConceptEvidence`'s cross-concept check -- when OpenAI
confirms a DIFFERENT concept for text that closely resembles an existing
row's stored signature, that existing row is immediately retracted.

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
- **Safety fix found during testing:** pure surface similarity cannot tell
  "X" from "not X" -- calibration showed "ไม่มากับแฟน" (NOT coming with a
  partner) scoring 0.73 against the seeded "มากับแฟน" exemplar, well above
  the 0.6 trust threshold. Fixed with a structural negation-marker veto
  (`hasNegationMismatch`) inside `conceptSimilarity` itself, so every caller
  (matching AND the write path's own reinforcement check) is covered by
  construction. This is acceptance criterion D.
- **Contradiction/demotion:** the write path also checks the newly confirmed
  exemplar against every OTHER concept key's stored signatures; a close
  match to a DIFFERENT concept is a confirmed contradiction and immediately
  retracts the stale row (`contradiction_count`, `CONTRADICTION_RETRACT_
  THRESHOLD = 1`) -- see the schema proposal above.
- Wired into `resolveSemanticTurn` (`_thongthai-one-mind-orchestrator.ts`):
  a read-path lookup between the exact-deterministic zero-cost check and the
  real model call (only when nothing else already classified the turn, and
  only against a fresh real call, never a `cachedSemantic` reuse); a
  write-path hook right before the model-owned turn is returned, gated on
  high confidence (>=0.85), a short standalone (non-multi-clause) message,
  and a non-mutating action -- the write is `await`ed, raced against a
  `SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS = 1500ms` bound so a stuck
  Supabase round trip can never add unbounded latency to the customer
  response, with the outcome (`write_awaited` / `write_timeout`) always
  logged. (Corrected from an earlier draft of this document that described
  this write as "fire-and-forget / never awaited" -- that was true only
  before the durability fix in the second structural review round below; see
  structural issue 3 there for what replaced it.)
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

**Structural issues found and fixed in PR review, before any merge/migration
decision** (all four confirmed against the actual implementation, not just
argued about):

1. **Multi-clause read-path gap.** The write path already refused to learn
   from a multi-clause message; the read path only checked length, so a
   SHORT but multi-clause message could still reach `matchLearnedConcept`.
   Fixed with one shared predicate (`isShortStandaloneConceptCandidate`) used
   by both call sites, so they can never diverge again.
2. **Confidence cross-exemplar leak.** Reinforcing a matched exemplar
   computed its new confidence from `Math.max` across every row the concept
   key had, so a weak, rarely-confirmed exemplar could inherit trust from an
   unrelated strong sibling. Fixed to advance strictly from the MATCHED
   row's own prior confidence.
3. **Fire-and-forget write was not durable.** The learning write used to be
   `.catch(() => undefined)` with no `await` -- nothing guarantees an
   unawaited promise survives a serverless process being frozen right after
   the customer response is sent. Fixed to `await` the write, raced against
   a `SEMANTIC_CONCEPT_MEMORY_WRITE_TIMEOUT_MS = 1500ms` bound (so a
   stuck write can never add unbounded latency), with the outcome always
   logged. A second, related bug this surfaced: the SAME customer turn can
   trigger the write-path hook twice (the early gate and the later cutover
   attempt both call the real interpreter for the same event; the AI
   cost-ledger replays the first result for the second rather than paying
   twice) -- without deduping, a stuck write could time out TWICE
   sequentially, adding ~2x the bound to one response. Fixed with
   `claimWriteAttemptForEvent`, keyed by conversation+event, so at most one
   write attempt (and one timeout wait) ever happens per real customer turn.
4. **Cross-customer privacy boundary.** No `guest_id` column is necessary
   but not sufficient -- nothing previously stopped a phone/email/URL/handle
   riding along in an otherwise-clean companion statement from being
   persisted into the cross-customer store. Fixed: `recordSemanticConceptEvidence`
   now rejects (never redacts-and-stores) any candidate containing one of
   these, reusing the exact same closed detector `_direct-identifier-redaction.ts`
   already uses for `customer_intelligence_events` -- not a new NER project.

Also explicitly re-verified per the review: a retracted concept never
matches (not just superseded); a confirmed contradiction still lets the
turn resolve correctly via the real model, never a wrong zero-call answer;
a contradiction can never create transaction authority (true by
construction -- `safeConceptEntities` has no action/domain field to escalate
through in the first place).

**Tests:** `tests/kernel-v2-phase3-semantic-concept-memory.test.ts`, 33/33
passing (9 new from the second review pass below). Full suite: 1649/1649
(1640 baseline + 9 new), 0 failed.

**Structural issues found and fixed in a SECOND PR review round, before any
merge/migration decision** (independent review after the first round's four
fixes above were already verified present and CI green):

1. **"Ask once, reuse next time" was not actually met.** The single trust
   bar (confidence >= 0.85 AND evidence_count >= 3, +0.02 confidence per
   reinforcement, starting from 0.70/1) meant a newly learned phrasing needed
   roughly 9 confirmed occurrences before becoming zero-call -- too slow for
   the owner's actual cost goal. Fixed with a **two-tier trust policy**,
   NOT by lowering every threshold (that would have let the riskier fuzzy
   path reach zero-cost just as fast as a true exact repeat):
   - **Tier A ("exact replay"):** the current message's normalized form is
     CHARACTER-FOR-CHARACTER IDENTICAL to a stored exemplar's own signature
     (decided by exact string equality, never a similarity score close to
     1). A genuine exact replay carries essentially no interpretation risk,
     so the DEFAULT values a freshly-promoted row is written with
     (confidence 0.7, evidence_count 1) already clear this bar --
     `MIN_TIER_A_CONFIDENCE = 0.7`, `MIN_TIER_A_EVIDENCE_COUNT = 1`. This
     closes the actual gap: politeness-variant repeats of the SAME
     underlying sentence (which normalize identically) become free after
     just one confirmation.
   - **Tier B ("fuzzy generalized"):** any match that is not an exact
     replay keeps today's unchanged, slower bar (`MIN_TRUSTED_CONFIDENCE =
     0.85`, `MIN_TRUSTED_EVIDENCE_COUNT = 3`).
   - Critical intents still can never gain transaction authority under
     either tier -- unaffected by this change, since `safeConceptEntities`
     has no action/domain field regardless of which tier matched.
2. **Privacy boundary was still incomplete.** `containsDirectIdentifier`
   only covers phone/email/URL/handle -- a personal name (worked example:
   "มากับแฟนชื่อหนิง", "comes with my partner named Ning") carries none of
   those and would have been persisted verbatim into a table with no
   guest_id at all. Fixed by adding a SECOND, independent check,
   `containsUnrecognizedPersonalDetail`: it strips every recognized
   companion-domain structural word (`SAFE_COMPANION_TOKENS` -- a small
   closed set of prepositions/verbs, the counting vocabulary, and the
   concept's own closed relationship vocabulary plus a few near-synonyms
   this module's own tests already exercise) and rejects outright if
   ANYTHING is left over. This is fail-safe, not fail-open: it never removes
   text it does not recognize, so a non-empty residual always means "this
   carries something beyond the closed companion vocabulary" -- a name, an
   address, a number, anything -- and a genuine companion phrase using an
   unlisted synonym is merely under-learned (falls through to OpenAI again),
   never persisted with personal content attached. Both checks (direct
   identifier + unrecognized residual) must pass for a write to proceed.
3. **Handoff document contradiction (this document).** An earlier draft of
   the "what increment 1 actually does" section above still described the
   learning write as "fire-and-forget / never awaited" from before the first
   review round's durability fix. Corrected in place above; the write has
   been `await`ed with a bounded timeout and per-event dedup since the first
   review round (see structural issue 3 above), and this document's own
   contradiction was the bug, not the code.

Also explicitly re-verified per the second review round: a Tier-A-eligible
(fast-path) match still can only ever produce `entities.companion`, never an
action/domain/transaction field (true by construction, independent of tier);
a fuzzy (non-exact) variant of a low-evidence row still requires Tier B's
higher bar, never inheriting Tier A's fast path; all four first-round fixes
(multi-clause gate, confidence isolation, awaited+bounded write, direct-
identifier reject) remain intact and covered by their original tests.

**STANDING REMINDER, not resolved by this round, must not be forgotten:**
increment 1's surface-similarity matching still cannot bridge a genuine
vocabulary substitution with no shared characters (e.g. "มากับแฟน" vs
"มากับคนรู้ใจ" -- both mean "with a partner," share no text). This is
acceptable for increment 1 (see the honesty note on `conceptSimilarity`) but
is NOT acceptable as a claim of Phase 3 *completion*. Before Phase 3 can be
declared complete, the true unseen cross-vocabulary generalization question
must be resolved with an architecture that actually understands semantic
similarity -- embedding/vector retrieval (pgvector) is one candidate, but
must not be adopted merely because it is fashionable; the smallest safe
approach must be compared first, exactly as this increment itself was
designed. Not started yet.

**Required acceptance criteria (owner-specified), each mapped to a passing test:**

| # | Criterion | Test |
|---|---|---|
| A | Unseen phrase: MISS -> OpenAI -> canonical meaning -> learning candidate | "the write path accumulates a genuinely new confirmed exemplar as its own row" |
| B | Safe repeated concept: HIT -> 0 paid call | "an UNSEEN near-identical variant ... resolves at zero cost" (Tier B path) and "a safe repeat of a once-confirmed exact phrase does not pay for a full semantic call again" (Tier A path, added second review round) |
| C | Unseen paraphrase generalizes without exact-string matching | same Tier B test as B (a genuinely different sentence, not the seeded literal string) -- honestly bounded to near-identical surface variants, not cross-vocabulary synonyms (see the honesty note and the standing reminder above) |
| D | Contradictory phrase must NOT incorrectly reuse a prior concept -> supervisor/clarification | 4 tests: two unit (`conceptSimilarity`/`matchLearnedConcept` negation + contradiction-count veto), two integration (a negated phrase still pays for the real model; a confirmed cross-concept contradiction retracts the stale row) |
| E | Critical intent: learned fuzzy match must NOT directly create a transaction | "negative control: a real commit/booking message is never routed through the fuzzy concept matcher" -- also true by construction (`safeConceptEntities` is a closed map with no action/domain field to escalate through) |
| F | Cost: paid-call reduction without an IQ cliff | demonstrated qualitatively (a matched turn costs exactly zero calls, an unmatched one behaves exactly as before); no formal 20/50/100-turn stress numbers yet -- explicitly deferred below, more meaningful once pace/consider-only add real concept variety |

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
project. The privacy/storage decision that previously gated this migration
(second review round, structural issue 2 above) is now closed with the
`containsUnrecognizedPersonalDetail` fix, but the migration remains
**NOT APPLIED** and awaits explicit owner approval regardless -- this is not
an automatic unblock. Until applied, this table does not exist in production
and the read path (`loadActiveSemanticConcepts`) degrades to "no learned
memory available" exactly as it does today with zero concepts learned. Do
not merge or apply without that explicit confirmation, and Phase 3 must not
be described as complete even after merge/migration -- see the standing
reminder above (true cross-vocabulary generalization) and the still-pending
formal 20/50/100-turn cost-stress evidence (acceptance criterion F).

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

Result (first review round): `24/24` passed. Result (after the second review
round's two-tier trust policy + privacy fixes): `33/33` passed (9 new tests).

Full suite (after Phase 3 increment 1, on top of Phase 2's `main`):

```bash
npm test
```

Result (first review round): `1640/1640` passed, `0` failed (1616 Phase-2
baseline + 24 Phase 3 tests). Result (after the second review round):
`1649/1649` passed, `0` failed (1640 + 9 new).

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
