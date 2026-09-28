# Thongthai Kernel V2 Handoff

## CURRENT AUTHORITATIVE UPDATE — 2026-09-28 FINAL HUMAN BRAIN CUTOVER

This section supersedes the older Phase-3/cost-focused narrative below for
the current mission. Keep the historical notes, but do **not** resume the
embedding/cost optimization track until live human conversation quality is
accepted.

### Owner Decision

- Priority is now **intelligence first / open-world human conversation first**.
- Stop treating Phase 3 cost efficiency, embeddings, and semantic-learning
  expansion as the current priority.
- The model-first conversation path must own both current-turn meaning and
  normal customer-facing wording for conversation-only turns.
- Business truth remains downstream and authoritative. The model reply must
  never invent price, availability, inventory, booking/order/payment state,
  promotion eligibility, membership state, staff dispatch, incident status,
  refund, or compensation.
- Cost logging/guards remain, but do not reintroduce an IQ cliff or reduce
  understanding to save money during certification.

### Verified Baseline For This Pass

- Repo: `snkpcn/tamma-chat`
- Local clean worktree for this pass:
  `/workspace/scratch/71f662a5fc19/tamma-chat-main`
- Current `HEAD` and local `origin/main`:
  `9234ba70e0081947c7607272e936539f00954b17`
- Last verified production deploy at mission start:
  `6aba5680503cfd0008f4386f`, commit
  `9234ba70e0081947c7607272e936539f00954b17`
- Open PRs observed at mission start:
  `#213`, `#201`, `#146`, `#113`, `#87`, `#49`, `#10`
- Do **not** merge stale historical PRs for this mission.

### Current Branch / PR State

- Local branch:
  `human-brain/final-open-chat-cutover`
- Local implementation checkpoint commit:
  `a010182070bbf9290e0115f544b8abf1b8f3988e`
  (`Cut over open-chat replies to the language brain`)
- Remote branch content was persisted through the GitHub connector because
  this execution environment has no GitHub git credential (`git push` failed
  with `could not read Username for 'https://github.com': No such device or
  address`; `gh` CLI is not installed; no `GITHUB_TOKEN`/`GH_TOKEN` env var is
  present).
- Remote implementation commit created by connector:
  `28573c6455aea65fe43d29e847b61a160ca9e8ed`
  (`Cut over open-world human brain live path`)
- Connector verification after write:
  `main...human-brain/final-open-chat-cutover` = `ahead_by: 1`,
  `behind_by: 0`, `changed files: 7`.
- No production deployment has been made in this pass.
- No database migration or business-table/schema change has been made.

### Live-Path Audit Result

The actual production cutover path is:

`processThongthaiChatCore` → One-Mind orchestration → semantic interpreter →
dialog/state/knowledge → response composer → `oneMind.response.message`.

The structural bug found here was not that the model could not understand the
turn. In the real failure class, the model/semantic layer often understood the
meaning and stored useful state, but the final customer response path still
discarded model-owned natural wording and fell into deterministic/generic
legacy copy.

Concrete audited blockers fixed in this pass:

- `_response-composer.ts` explicitly treated OpenAI as "not the
  customer-facing voice" and could return generic fallback even when semantic
  understanding was correct.
- `thongthai-chat.ts` had an early One-Mind branch for `general`, `local`, and
  `incident` that used `supervisedOpenWorldResponse(...)`, bypassing the
  One-Mind response composer and causing casual chat to get canned/generic
  wording.
- `_thongthai-one-mind-response.ts` let clarify/state-update deterministic
  fast paths preempt the model's conversation reply even when the turn was
  non-transactional and the model supplied safe customer wording.

### Implemented Cutover Increment

- `SemanticTurn` now has optional `reply`.
- The same open-world semantic model pass now returns both:
  - strict canonical meaning/control fields
  - a short Thai customer-facing reply draft for conversation-only turns
- Response composer now accepts that model reply only through
  `safeModelConversationReply(...)`, which rejects it when:
  - an action proposal/tool execution exists
  - the dialog is collecting/proposing/executing
  - verified business truth is required
  - knowledge requests are present
  - an active task has commitment intent
  - operational claim safety fails
- Business/knowledge-grounded deterministic responses still own verified facts.
- The `general/local/incident` early bypass in `thongthai-chat.ts` was removed
  so the One-Mind response message remains authoritative.
- Deterministic clarify/state-update fast path no longer preempts safe
  conversation model replies.
- The production prompt was compacted slightly after adding `reply` so the
  existing cost guard still passes without reducing the intelligence contract.

### Files Changed In This Pass

- `netlify/functions/_semantic-interpreter.ts`
- `netlify/functions/_response-composer.ts`
- `netlify/functions/_thongthai-one-mind-response.ts`
- `netlify/functions/thongthai-chat.ts`
- `tests/helpers/canonical-core-harness.ts`
- `tests/final-human-brain-cutover-open-chat.test.ts`
- `THONGTHAI_KERNEL_V2_HANDOFF.md`

### Tests / Exact Totals

Dependency note: this clean worktree does not have its own `node_modules`.
Tests were run with the existing loader from the sibling worktree:

```bash
node --import /workspace/scratch/71f662a5fc19/tamma-chat/node_modules/tsx/dist/loader.mjs --test tests/final-human-brain-cutover-open-chat.test.ts
```

Result: `4/4` passed.

```bash
node --import /workspace/scratch/71f662a5fc19/tamma-chat/node_modules/tsx/dist/loader.mjs --test \
  tests/final-human-brain-cutover-open-chat.test.ts \
  tests/one-mind-orchestrator.test.ts \
  tests/one-mind-response.test.ts \
  tests/conversation-context.test.ts \
  tests/human-brain-real-line-failure-regression.test.ts \
  tests/kernel-v2-phase2-conversation-state.test.ts \
  tests/kernel-v2-phase3-semantic-concept-memory.test.ts \
  tests/final-perfection-pass-conversational-fixes.test.ts
```

Result: `100/100` passed.

```bash
node --import /workspace/scratch/71f662a5fc19/tamma-chat/node_modules/tsx/dist/loader.mjs --test tests/*.test.ts
```

Result after compact prompt adjustment: `1653/1653` passed, `0` failed,
duration `41201.6698ms`.

`npm test` in this clean worktree fails before tests run because `tsx` is not
installed in this worktree; this is a dependency/worktree setup issue, not a
test regression.

### Cost / Token Measurements

Cost optimization is paused, but the existing guard remains green.

- `buildProductionSemanticInterpreterPrompt(emptyContext)` estimate:
  `2209` input tokens for the normal probe.
- Complex bounded-context prompt estimate:
  `3974` input tokens, under the existing `<= 4000` test guard and under the
  `absoluteInputTokens <= 5000` policy.
- Full-suite OpenAI semantic logs show typical scripted input token counts
  around `2190-2500` after this pass.

### Known Remaining Work / Failures Not Claimed Fixed

- This is **not** live certification and **not** production-ready proof.
- No real 50-turn or 100-turn LINE/Web conversation has been run in this pass.
- Owner must still live-test LINE after a reviewed PR/CI/deploy.
- Business-truth/tool-required turns still correctly route to grounded
  deterministic/business helpers; this pass intentionally did not make the
  model invent availability, catalog, price, policy, membership, payment,
  incident, or dispatch facts.
- Some older tests still exercise legacy fallback paths under provider outage
  or deterministic fixtures. Those are not removed yet; the current fix is the
  safe authoritative path for model-understood, conversation-only turns.

### Next Required Step If Interrupted

1. Open a PR from `human-brain/final-open-chat-cutover` to `main` if it is not
   already open.
2. Review full diff carefully.
3. Run CI. Merge only if green.
4. After merge/deploy, run real LINE/Web acceptance conversations using real
   model calls:
   - one 50-turn open-world conversation
   - one 100-turn open-world conversation
   - multiple hidden 20-30 turn conversations
   - include casual Thai, slang, typos, topic switches, references, corrections,
     considering without buying, explicit not-booking, food constraints,
     activity/restaurant/stay/promo/non-business chat
5. Keep handoff updated with branch, PR, SHA, production deploy, and live
   failures. Do not resume embedding/cost Phase 3 until human conversation
   quality is accepted.

### Copy-Ready Continuation Prompt If This Agent Stops

Continue from `/workspace/scratch/71f662a5fc19/tamma-chat-main` on current
local changes for "FINAL HUMAN BRAIN CUTOVER". Owner decision: intelligence
first, cost optimization later. Do not restart Phase 3 embeddings/cost work.
The current local change adds model-owned natural replies to the single
semantic model output and lets the response composer use those replies only
for safe conversation-only turns, while business truth remains downstream.
Full suite passed with:

`node --import /workspace/scratch/71f662a5fc19/tamma-chat/node_modules/tsx/dist/loader.mjs --test tests/*.test.ts`

Result: `1653/1653` passed. Local implementation checkpoint commit:
`a010182070bbf9290e0115f544b8abf1b8f3988e` on
`human-brain/final-open-chat-cutover`. Remote branch has been populated via
GitHub connector at commit `28573c6455aea65fe43d29e847b61a160ca9e8ed`;
compare against main reported `ahead_by: 1`, `changed files: 7`. Next: open
PR, run CI, then live LINE/Web acceptance. Do not claim production-ready until
real long conversations pass.

Updated: 2026-09-28 (this pass records PR #218 merged, its migration applied
to production, and production re-verified via a real dispatched smoke run --
see "Current State" and "Phase 3 increment 1" below).

## Current State

- Repo: `snkpcn/tamma-chat`
- Current remote `main` SHA, verified directly via `git fetch origin main` in
  this session: `98fa91307b258a5a54465636f36f0b21e1834dd0`
  (squash-merge of PR #218, "Kernel V2 Phase 3 increment 1: companion
  semantic concept memory")
- Phase 1 PR: `#215`, merged, squash commit `a8bbcb3ad620fd8c9a88e02cb820b40df14ab092`
- Phase 2 PR: `#216`, merged, merge commit `ce4ceb0cb7a359c793d837f41c40de831be5eae0`
- Phase 3 increment 1 PR: `#218`, verified merged via GitHub API
  (`merged: true`, `merged_by: snkpcn`, squash method), squash commit
  `98fa91307b258a5a54465636f36f0b21e1834dd0` (this is the current `main` tip)
- Full suite on this exact `main` SHA, run directly in this session:
  `1649/1649` passed, `0` failed
- Migration `20260928120000_semantic_concept_memory_v1.sql`: **APPLIED to
  production** in this session via the Supabase MCP tool against project
  `upaokrprawzhgzeqsdke` (`tamma-customer-data`), with explicit owner
  authorization given in chat for this specific, reviewed, additive
  migration. Verified directly afterward (not assumed):
  - `information_schema.columns` matches the migration exactly (13 columns,
    correct types/defaults)
  - `pg_class.relrowsecurity = true` (RLS enabled)
  - All 8 CHECK constraints, the PK, the unique `source_signal_key`, and the
    `superseded_by` self-FK are present exactly as written
  - 3 indexes present: PK, unique `source_signal_key`, partial
    `(concept_key, status) where status='active'`
  - Grants: `service_role` has exactly `SELECT, INSERT, UPDATE` (no
    `DELETE`, matching the migration's "no delete" design); `anon` and
    `authenticated` have **no grants at all** on this table
  - `get_advisors(type: security)`: the only finding naming this table is
    the INFO-level "RLS enabled, no policy" lint -- the SAME pattern shared
    by 63 other pre-existing service-role-only tables in this schema
    (`world_facts`, `guest_semantic_memory`, `customer_intelligence_events`,
    etc.), not a new issue. No ERROR/WARN-level finding names this table.
  - No existing table, trigger, function, or policy was touched (confirmed
    both by reading the migration itself and by the PR's file list: exactly
    6 files changed, none of them a business-truth/booking/payment/
    membership/inventory table or migration)
- Production Netlify deploy: **VERIFIED in this session** via a real
  dispatched GitHub Actions run (this session has no direct egress to
  `tamma-chat.netlify.app` -- see the note below -- so verification goes
  through the repo's own `production-smoke.yml`, which runs on a
  GitHub-hosted runner with real network access):
  - Workflow run `36413592601`, dispatched against `main` after the merge,
    `head_sha: 98fa91307b258a5a54465636f36f0b21e1834dd0`
  - Result: **14/14 cases passed**, `0` false transactions detected,
    including the two new Phase-3-specific companion cases added in this
    session (`phase3-companion-01`, `phase3-companion-privacy-01`) -- see
    "Phase 3 increment 1" below for what this smoke can and cannot assert
  - For contrast: the two immediately PRIOR dispatches of this same
    workflow (runs `36385755550` and `36386332056`, on unrelated older
    commits before this session began) each failed on ONE case
    (`activity-03-conditional`, a generic-fallback/latency flake unrelated
    to Phase 3) -- confirming this is a pre-existing, commit-independent
    flake, not something this change introduced, and that this session's
    run on the new SHA is a genuine improvement (0 failures), not a fluke
- Environment limitation (unchanged from before, and now worked around
  rather than blocking verification): this Claude session's own outbound
  network egress to `tamma-chat.netlify.app` returns HTTP 403 at the proxy
  layer. This session cannot hit the production endpoint directly, so
  production verification in this session goes through the repo's own
  GitHub Actions `production-smoke.yml` dispatch (which has real network
  access) rather than a direct HTTP call from this session.

Open PRs observed through GitHub API before Phase 2 PR creation (not
re-verified this pass -- carried over from the prior checkpoint):

- `#213` Final perfection: eliminate remaining generic production fallbacks
- `#201` [run live] Post-merge final certification for PR #200
- `#146`, `#113`, `#87`, `#49`, `#10` remain open from older branches/checkpoints

## Current Phase

Kernel V2 Phase 3: Semantic Learning + Cost Efficiency -- **increment 1
(companion-concept memory) implemented, tested, PR #218 MERGED, migration
APPLIED to production, production re-verified (14/14 smoke). See "Phase 3
increment 1" below for full evidence.**

**PR #218 = Phase 3 increment 1, NOT Phase 3 completion.** The
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
- Phase 3 increment 1: companion semantic concept memory, merged in PR
  `#218` (squash commit `98fa91307b258a5a54465636f36f0b21e1834dd0`),
  migration applied to production, production re-verified 14/14. NOT Phase
  3 completion -- see "Current Phase" and "Phase 3 increment 1" below.

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
- Migration `supabase/migrations/20260928120000_semantic_concept_memory_v1.sql`
  -- **APPLIED to production** in this session, per this repo's own
  established convention (see `20260923142552_customer_intelligence_events_v1.sql`'s
  own "Owner explicitly approved ... in chat before application" precedent):
  the owner gave explicit authorization in chat for this specific, reviewed,
  additive migration, and it was applied only after the full pre-flight
  safety checklist (additive-only, no business table touched, RLS on,
  anon/authenticated have zero grants, service-role scoped to
  SELECT/INSERT/UPDATE, clean rollback) was re-verified against the live
  schema afterward. See "Current State" above for the full verification
  evidence.

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

**PR #218 merged, migration applied, production re-verified (this session).**
The owner explicitly authorized applying this specific, reviewed, additive
migration in chat. PR #218 (branch `kernel-v2/phase3-semantic-concept-memory`)
was merged via squash to `main` at `98fa91307b258a5a54465636f36f0b21e1834dd0`
after re-confirming CI green/mergeable-clean/no open review threads;
`20260928120000_semantic_concept_memory_v1.sql` was then applied to the live
Supabase project (`upaokrprawzhgzeqsdke`) and its schema/RLS/grants/indexes
verified directly against the live database (see "Current State" above);
production was re-verified via a dispatched `production-smoke.yml` run
(14/14 passed, 0 false transactions, `head_sha` matching the new `main`).
**Phase 3 is still NOT complete** even though increment 1 is merged and
live -- see the standing reminder above (true cross-vocabulary
generalization is not yet built) and the still-pending formal 20/50/100-turn
cost-stress evidence (acceptance criterion F). Do not describe Phase 3, or
this project, as complete on the strength of this merge alone.

## Phase 3 completion: semantic generalization architecture decision

**Status: decision made (embeddings), NOT yet implemented.** This is a
separate, explicit decision from increment 1's migration -- it introduces a
new Supabase extension (pgvector) and a new OpenAI cost line item
(embeddings calls), neither of which increment 1's owner authorization
covered. It requires its own explicit owner approval before any schema or
cost-policy change, exactly like increment 1's migration did.

**Options compared, per the mandate's own instruction not to choose
embeddings merely because they are fashionable, nor reject them just to
avoid an architectural change:**

- **A. Extend the current surface/edit-distance signature matching.**
  Ruled out for TRUE cross-vocabulary generalization, not by preference but
  by construction: `conceptSimilarity` is a character-level metric (bounded
  Levenshtein distance + bigram Jaccard overlap). "แฟน" and "คนรู้ใจ" share
  **zero characters**. No threshold, weighting, or tuning of a character-level
  metric can ever score two strings with a disjoint character set as
  similar -- this is a mathematical property of the metric, not a
  calibration gap the way `MIN_SIMILARITY` was. Tier A/Tier B stay exactly
  as they are for what they're honestly good at (exact replay and
  near-identical surface variants); they are not being replaced.
- **B. A hand-built synonym/keyword table** (e.g. a lexicon mapping "แฟน" /
  "คนรู้ใจ" / "คู่รัก" / etc. to one canonical concept). Explicitly forbidden
  by the mandate ("DO NOT implement a giant phrase table," "Fix GENERAL
  SEMANTIC CLASSES"). Also brittle in the same way increment 1's own honesty
  notes warn about: it only ever covers phrasings someone thought to add.
- **C. Embedding/vector similarity (pgvector).** The standard, non-lexicon
  solution to a lexical gap: a multilingual embedding model places
  semantically related phrases close in vector space independent of shared
  characters. This is the only option that can close the gap options A and
  B cannot, without inventing a hand-written synonym table.

**Decision: C (embeddings as a category) remains the right direction -- A
and B are still ruled out for the reasons above -- but the SPECIFIC design
(whole-sentence embedding + fixed similarity threshold) is NOT confirmed and
must NOT be implemented as originally planned.** Per this repo's own
established discipline (`MIN_SIMILARITY` and the negation veto in
`_semantic-concept-memory.ts` were both calibrated empirically, not
asserted), this was checked with a real calibration run rather than shipped
on the argument alone -- and the numbers below changed the plan:

- `scripts/run-embedding-calibration.ts` (new, read-only, no schema/table
  touched) calls the real OpenAI embeddings endpoint
  (`text-embedding-3-small`) for 8 fixed Thai phrase pairs covering the
  companion concept's own worked example, a consider-only worked example,
  cross-concept negative controls (must score LOW, e.g. partner vs family),
  the known negation hard case (must be checked against embeddings too --
  it is NOT assumed safe just because it worked as a structural veto for
  surface matching), and a totally unrelated-sentence control.
- `.github/workflows/phase3-embedding-calibration.yml` (new, manual
  `workflow_dispatch` only, mirrors `phase1-live-language-acceptance.yml`'s
  safety pattern exactly -- paid OpenAI usage is never automatic) dispatches
  it using the repository's existing `OPENAI_API_KEY` secret. Cost is a
  small fraction of a cent (roughly a dozen short phrases, well under 200
  tokens total, at ~$0.02/1M tokens).
- **Results (real, dispatched run, `text-embedding-3-small`,
  `2026-09-28T11:28Z`, workflow run `36415861451`):**

  | pair | similarity | expectation |
  |---|---|---|
  | "มากับแฟน" / "มากับคนรู้ใจ" | 0.382 | same concept, different vocabulary |
  | "มากับแฟน" / "มาด้วยกันกับคู่รัก" | 0.381 | same concept, different vocabulary |
  | "เอาอันนี้ไว้ก่อน" / "สนใจอันนี้อยู่ ขอจำไว้ก่อน" | 0.624 | same concept, different vocabulary |
  | "มากับแฟน" / "มากับครอบครัว" | 0.426 | **different** concept (family) |
  | "มากับแฟน" / "มากับเพื่อนกลุ่มใหญ่" | 0.428 | **different** concept (friends) |
  | "เอาอันนี้ไว้ก่อน" / "ไม่อยากเหนื่อย ขอชิลๆ" | 0.266 | different concept |
  | "มากับแฟน" / "ไม่ได้มากับแฟน" | **0.791** | negation (should score LOW -- opposite meaning) |
  | "มากับแฟน" / "พรุ่งนี้มีห้องว่างไหม" | 0.187 | unrelated sentence (correctly lowest) |

  **This does NOT cleanly confirm the embeddings-as-designed decision.**
  Two concrete problems, not a marginal calibration nudge:
  1. **No separating threshold exists for the companion concept's own
     worked example.** The lowest same-concept score (0.381, "แฟน" vs
     "คู่รัก") is BELOW the highest different-concept score (0.428, "แฟน" vs
     "เพื่อนกลุ่มใหญ่"). A same-concept pair and a wrong-concept pair
     overlap in the same similarity band -- a fixed-threshold (or even a
     naive nearest-neighbor) classifier built on raw full-sentence cosine
     similarity would sometimes prefer the WRONG concept. This is exactly
     the "confidently wrong" failure mode the whole mandate exists to
     prevent, so this specific design must NOT ship as-is.
  2. **Negation is not handled.** "มากับแฟน" vs "ไม่ได้มากับแฟน" (opposite
     meanings) scored 0.791 -- higher than every genuine same-concept pair.
     Sentence embeddings evidently do not inherently distinguish "X" from
     "not X" here any better than surface matching did; the same structural
     negation veto increment 1 already has would still be required on top
     of embeddings, not replaced by them.
  3. The one case that DID separate reasonably (consider-only: 0.624 vs its
     own different-concept control at 0.266) suggests the approach is not
     hopeless in general -- the companion concept specifically is the
     problem case here, likely because these are short, template-heavy
     sentences ("มากับ..." / "...ไว้ก่อน") where the shared scaffolding
     dominates a whole-sentence embedding more than the one differing
     content word does. This is a known failure mode of sentence-level
     embedding similarity on short, syntactically-templated inputs, not a
     sign that embeddings can never work here.

  **Conclusion: the plan below (whole-sentence embedding + fixed threshold)
  is NOT adopted as designed.** Do not implement it.

  **Three independent follow-up hypotheses were then calibrated with real
  data, in order, and ALL THREE disconfirmed the same way** (same-concept
  minimum similarity below different-concept maximum similarity -- no
  threshold or ranking rule separates them correctly):

  1. ~~A different embedding model~~ -- **disconfirmed.** Same 8 pairs
     re-run against `text-embedding-3-large` (workflow run `36417327219`,
     `2026-09-28T11:43Z`, PR #223):

     | pair | 3-small | 3-large |
     |---|---|---|
     | "แฟน"/"คนรู้ใจ" (same concept) | 0.382 | 0.565 |
     | "แฟน"/"คู่รัก" (same concept) | 0.381 | 0.470 |
     | "แฟน"/"ครอบครัว" (different concept) | 0.426 | 0.632 |
     | "แฟน"/"เพื่อนกลุ่มใหญ่" (different concept) | 0.428 | 0.558 |
     | negation | 0.791 | 0.714 |
     | unrelated | 0.187 | 0.167 |

     All scores shifted up with the larger model (absolute cosine
     similarity is not comparable across models), but the same overlap
     persisted: same-concept minimum (0.470) below different-concept
     maximum (0.632). Model capacity is not the cause.
  2. ~~Embed just the extracted content span (bare noun, no sentence
     scaffolding)~~ -- **also disconfirmed.** 4 new pairs added
     ("แฟน"/"คนรู้ใจ", "แฟน"/"คู่รัก", "แฟน"/"ครอบครัว", "แฟน"/"เพื่อนกลุ่มใหญ่",
     all as bare nouns), re-run against `text-embedding-3-small` (workflow
     run `36418230291`, `2026-09-28T11:52Z`, PR #224):

     | pair (bare noun) | similarity | expectation |
     |---|---|---|
     | "แฟน"/"คนรู้ใจ" | **0.224** | same concept |
     | "แฟน"/"คู่รัก" | 0.349 | same concept |
     | "แฟน"/"ครอบครัว" | 0.254 | different concept |
     | "แฟน"/"เพื่อนกลุ่มใหญ่" | 0.189 | different concept |

     Stripping the sentence scaffolding did NOT fix separability either --
     if anything it is worse in relative terms: "แฟน"/"คนรู้ใจ" (same
     concept, should score HIGH) scored 0.224, BELOW "แฟน"/"ครอบครัว"
     (different concept, should score LOW) at 0.254. Shared scaffolding
     dilution was the wrong hypothesis, or at least not the whole story.
  3. **The deeper, more likely explanation, surfaced by result 2 above:**
     "แฟน" (partner, the common colloquial word) and "คนรู้ใจ" (literally
     "person who understands the heart" -- soulmate/kindred-spirit) may
     simply not be as close a semantic pair as the owner's own worked
     example assumes. "คนรู้ใจ" is a broader, more abstract Thai expression
     that can describe a deeply understanding friend as much as a romantic
     partner -- general-purpose embedding models correctly reflect that
     looser real-world relationship, rather than the tighter
     "same-companion-concept" equivalence this system specifically needs in
     context. This is a genuine semantic ambiguity in the source language,
     not a tooling failure -- no embedding model recalibration fixes a case
     where the two phrases are not, in fact, reliably synonymous outside
     the specific conversational context that makes them so here.

  **Given three independent, real, negative results, further embedding-model
  or preprocessing tweaks are not recommended as the next step.** Two
  directions remain honestly open, neither yet attempted:
  - A margin/ranking approach (nearest concept must beat the SECOND-nearest
    by a calibrated margin) -- but note even this would still have picked
    the wrong concept on multiple pairs above, so it does not rescue the
    approach on its own.
  - Ask OpenAI's own semantic supervisor to output a canonical
    concept-identity judgment directly when given BOTH the new phrase and
    the stored concept's own confirmed exemplar(s) as context (a real
    language-understanding judgment, not a raw embedding-cosine proxy for
    one) -- fundamentally different from everything tried above, and not
    yet calibrated.
  - Alternatively: accept, honestly, that reliable unseen cross-vocabulary
    generalization is not currently achievable within the "smallest safe"
    constraint with the tools tried so far, and that increment 1's honest
    limitation (near-identical-variant generalization only, real
    cross-vocabulary paraphrase requires a fresh paid call every time) may
    need to stand as Phase 3's answer for longer than hoped, rather than
    force an approach the data does not support.
  Regardless of which path (if any) is pursued next, negation must still be
  handled by an explicit structural veto (as increment 1 already has),
  never assumed solved by any embedding-based mechanism -- negation
  similarity was high (0.71-0.79) in every sentence-level test run.

**The originally-planned smallest safe increment (NOT adopted, kept here
only as a record of what was considered and why it needs revision before
being built):**

1. A new, additive-only migration enabling the `pgvector` extension and
   adding an `embedding vector(1536)` column (or a separate table, TBD by
   whichever keeps the migration smallest) to `semantic_concept_memory` (or
   a new table if mixing concerns is worse than a new table).
2. A new cost line item in `_ai-cost-policy.ts` for the embeddings model
   (roughly 100x cheaper per token than the chat completion model already
   in use, so not a real budget threat, but must be accounted for
   explicitly).
3. Embedding generation gated behind the same trigger discipline as the
   write path today (`isShortStandaloneConceptCandidate` + high-confidence
   real-model confirmation), never a new source of paid calls.
4. Matching: Tier A (exact replay, free) first, then embedding similarity
   as a new tier before falling through to a fresh OpenAI call -- **this
   step specifically is what the calibration above shows is unsafe with a
   naive threshold on whole-sentence embeddings of this concept's own
   worked example.**
5. The SAME privacy boundary must gate embedding generation, not just raw
   text storage (an embedding of a personal-name-bearing sentence is just
   as much a leak, arguably harder to audit later).
6. The SAME transaction-authority closure applies regardless of matching
   mechanism.
7. Required tests unchanged in spirit (unseen cross-vocabulary paraphrase
   resolves safely; different-concept never falsely matches; negation
   fails safe; personal-name-bearing sentence never stored) -- but item 4's
   mechanism needs to change before these tests could pass honestly.

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
- `supabase/migrations/20260928120000_semantic_concept_memory_v1.sql` (new, APPLIED to production this session)
- `tests/kernel-v2-phase3-semantic-concept-memory.test.ts` (new)
- `THONGTHAI_KERNEL_V2_HANDOFF.md`

## Migrations

Phase 2: none.

Phase 3 increment 1: `20260928120000_semantic_concept_memory_v1.sql` --
**APPLIED to production** (project `upaokrprawzhgzeqsdke`) in this session
with explicit owner authorization. Additive only (a new table, no existing
table/trigger/function/policy touched -- confirmed both by reading the
migration and by re-checking the live schema afterward). Rollback if ever
reverted: `drop table public.semantic_concept_memory;` -- no
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
- Phase 3 increment 1 PR: `#218` (branch `kernel-v2/phase3-semantic-concept-memory`),
  merged via squash (`98fa91307b258a5a54465636f36f0b21e1834dd0`). Migration
  applied to production; see "Current State" and "Migrations" above.
- Phase 3 production-smoke extension: branch
  `kernel-v2/phase3-production-smoke-companion` (2 new read-only companion
  cases added to `scripts/run-production-smoke.ts`; see "Test Evidence").

## Known Failures / Gaps

- Production deploy for Phase 2 is owner-verified (deploy `6aba32fd...`,
  `READY`, `commit_ref` matches `main`) but no Claude session in this
  engagement has been able to independently re-run production smoke or the
  Real LINE HTTPS certification DIRECTLY (proxy-layer egress block to
  `tamma-chat.netlify.app`). **This session worked around that** for Phase 3
  increment 1's own verification by dispatching the repo's own
  `production-smoke.yml` via the GitHub API (runs on a GitHub-hosted runner
  with real egress) rather than calling production directly -- see "Current
  State" above. The Real LINE HTTPS certification specifically has still not
  been re-run by any Claude session; it could be dispatched the same way
  (`.github/workflows/line-transport-certification.yml`) if needed.
- Phase 3 increment 1 (companion concept memory) is merged and its migration
  is applied to production -- see above. Its own honest limitation (surface
  matching only, no true cross-vocabulary generalization) remains, by
  design, for this increment.
- Phase 3's own remaining scope (pace/consider-only concepts, a real
  embedding-based v2 or equivalent for true semantic generalization,
  cost-stress evidence at 20/50/100 turns) is NOT done -- Phase 3 is not
  complete.
- Phase 4 Human Intent / Commercial Boundary is not implemented here.
- Phase 5 incident case creation/staff routing is not implemented here.
- Phase 6 natural response brain is not implemented here.
- Phase 7 shadow cutover/certification is not implemented here.

## Next Required Step

1. ~~Merge the Phase 3 production-smoke extension PR~~ -- **done**: PR #219
   merged (squash `497b5099b5155356f145eb06b2ae963fe3e63e9c`).
2. ~~Dispatch the embedding calibration~~ -- **done**: workflow run
   `36415861451`, results recorded in "Phase 3 completion: semantic
   generalization architecture decision" above. **Outcome: the calibration
   did NOT confirm the planned design.** Whole-sentence embedding similarity
   does not cleanly separate the companion concept's own same-vocabulary
   vs. different-concept pairs (0.381 same-concept overlaps below 0.428
   different-concept), and does not handle negation (0.791, higher than any
   genuine same-concept pair).
3. ~~Re-test with `text-embedding-3-large`~~ -- **done, also disconfirmed**:
   workflow run `36417327219`, results recorded above. Same overlap persists
   at a larger model size, so model choice alone is not the fix.
4. ~~Run a follow-up calibration on content-span (bare noun) embedding~~ --
   **done, also disconfirmed**: workflow run `36418230291`, results
   recorded above (PR #224/#225). "แฟน"/"คนรู้ใจ" scored 0.224, BELOW
   "แฟน"/"ครอบครัว" (different concept) at 0.254 -- stripping sentence
   scaffolding did not fix separability, and the likely deeper reason is
   documented above (point 3: the two Thai words may genuinely not be as
   synonymous as the worked example assumes, outside conversational
   context). **Three independent embedding-based hypotheses have now been
   tried and disconfirmed with real data** (small model/full sentence,
   large model/full sentence, small model/content-span). Do not attempt a
   fourth embedding-model or preprocessing variant without a genuinely new
   idea -- the pattern is now well-established, not a coincidence of one
   bad run.
5. The two remaining honestly-open directions (neither yet attempted, see
   "Phase 3 completion" section above): (a) ask OpenAI's own semantic
   supervisor for a direct concept-identity judgment given both the new
   phrase and a stored exemplar as context (a real language-understanding
   call, not an embedding-cosine proxy), or (b) accept that reliable unseen
   cross-vocabulary generalization is not currently achievable within the
   "smallest safe" constraint and let increment 1's honest, narrower
   capability (near-identical-variant generalization, not true
   cross-vocabulary paraphrase) stand as Phase 3's answer for now. This is
   a genuine open decision point, not a default -- whichever is chosen,
   document the reasoning with the same rigor as this whole investigation,
   and if (a) is chosen, calibrate it with real data (e.g. does the
   supervisor correctly judge "แฟน" vs "คนรู้ใจ" as same/different depending
   on context) before implementing any schema or cost-policy change.
6. Extend Phase 3 to the pace/consider-only concept keys the mandate also
   names, using the same closed-vocabulary, safety-by-construction pattern
   (independent of the semantic-generalization architecture question above
   -- this can proceed with increment 1's existing surface-matching
   mechanism, honestly scoped the same way).
7. Run the mandate's own formal 20/50/100-turn cost-stress conversations
   (multiple independent samples per length, covering casual chat/known
   language/unseen language/unseen paraphrase/references/correction/topic
   changes/resume/consideration/explicit transaction wording/incident
   language) and report the full required metric set (paid-call counts,
   zero-call rate, hit rate by tier, token/cost percentiles, cap violations,
   intelligence-cliff check, accidental-transaction count). Only once this
   evidence exists, plus item 5 above being resolved one way or the other,
   may Phase 3 be declared complete.
8. Phases 4-7 (commercial-intent boundary, incident/backoffice routing,
   natural-response layer, brutal end-to-end certification) remain
   unstarted. Each is large enough to warrant its own design-first pass
   before implementation, following the same discipline used for Phase 3
   increment 1 (audit existing tables/mechanisms first, smallest safe
   change, explicit acceptance criteria, no giant keyword table, real tests
   before claiming done).

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
