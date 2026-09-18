# Thongthai One-Mind Architecture — Handoff

Working state for the multi-phase architecture program (Bible → Semantic Interpreter →
Conversation Continuity → ... → final integration). Read this file first on every resume.
Update it at every checkpoint: commit + push code, then commit + push this file's update in
the same or next commit.

## Ground rules (do not violate)

- **Integration branch only.** All Phase A–O work lives on
  `feature/thongthai-one-mind-architecture`, branched from `main` at `d37c56f`. Do not merge to
  `main`. Do not deploy to Netlify production. Do not create a new repo/project/database/site.
  The `index.html` hotfix (PR #40, `d37c56f`) was the last exception — emergency only.
- **Strangler migration, not big-bang.** Do not delete existing deterministic
  booking/order/payment/promo code. New layers sit beside old routing until proven equivalent
  by golden/E2E tests, domain by domain.
- **Layer discipline** (do not mix these back together):
  Semantic layer (understands meaning) → Dialog Manager (goal/missing info) → Knowledge
  Resolver (which source) → Deterministic domain code (prices/availability/rules) →
  Transaction layer (idempotent writes) → Response composer (natural language) → Channel
  adapter (transport only).
- **If `main` moves while this branch is in progress**: do NOT auto-rebase/merge. Fetch, inspect
  every intervening commit's diff by hand, reconcile deliberately, re-run the baseline
  regression. `5e3fbbe` silently destroyed unrelated production code in a bad merge earlier in
  this program — never repeat that.

## Baseline (captured before Phase A started)

- Base commit: `d37c56f44753bce2ec25d3091506cd3c0b703bdc`, confirmed == `origin/main` and ==
  live production content (verified via direct fetch: 5/5 `<script>` tags, `ConciergeProvider`
  present).
- `npm test`: 111/111 passing.
- `thongthai-chat.ts` bundle: clean, 263.6kb. `line-webhook.ts` bundle: clean, 297.2kb.
- Full critical-file hash manifest + migration inventory: see the task's earlier checkpoint
  report in conversation (not duplicated here to keep this file short); re-derivable any time
  via `sha256sum` on the file list in that report against `d37c56f`.

## Phase status

- [x] **Phase 0 — Audit.** Done. Findings reported to user; all 7 "known issues" confirmed
  true against real code (not assumed). One P0 found and fixed as an emergency exception:
  `index.html` had 0 opening `<script>` tags in production (silently gutted by `5e3fbbe`) —
  restored, hotfixed via PR #40 (`d37c56f`).
- [x] **Phase A — Bible / Brain contract.** Done, committed on this branch (see "Last commit"
  below). Details in the checkpoint report already sent to the user; summary:
  - `THONGTHAI_BRAIN.md` restructured: doctrine now lives under 10 exact-named `##` sections
    (Identity, Personality, Conversation Doctrine, Ecosystem Vocabulary & Relationships,
    Customer Service Doctrine, Recommendation Doctrine, Operational Truth Doctrine, Memory &
    Privacy Doctrine, Failure Doctrine, Channel Presentation Doctrine). Everything below
    `## Production components` is human/dev reference, not compiled into the prompt.
  - `scripts/_bible-compiler.mjs` (pure, importable) + `scripts/compile-thongthai-bible.mjs`
    (CLI) extract those sections, guard against mutable-fact patterns (price/promo-code/etc.),
    and compile a content hash → `bible-v1-<hash>` version string.
  - `netlify/functions/_thongthai-bible-generated.ts` is the generated, committed artifact.
    Regenerate with `node scripts/compile-thongthai-bible.mjs` after any edit to
    `THONGTHAI_BRAIN.md`'s doctrine sections.
  - `_thongthai-brain-v3.ts`'s `buildBrainPrompt()` now interpolates
    `THONGTHAI_BIBLE_SECTIONS.*` directly (by name, per-section) instead of a hand-typed
    paraphrase. Prompt header now reads `THONGTHAI BRAIN — <brain version> — BIBLE <bible
    version>`.
  - `THONGTHAI_BIBLE_VERSION` now also persisted into `guest_agent_state.state.
    updated_by_bible_version` on every turn (`_thongthai-runtime-v3.ts`), alongside
    `updated_by_brain_version` — which was itself fixed from a stale hardcoded string to the
    real `THONGTHAI_BRAIN_VERSION` constant as part of this same change (real bug found while
    wiring diagnostics, fixed inline, not deferred).
  - `tests/bible-sync.test.ts`: 6 new tests — drift detection (generated file must exactly
    match a fresh compile of the .md), all 10 sections present/non-empty, mutable-fact guard,
    static proof `buildBrainPrompt` references every `THONGTHAI_BIBLE_SECTIONS.<key>` by name,
    version format, and diagnostics persistence wiring.
  - `npm test`: **117/117 passing** (111 baseline + 6 new). Both bundles clean
    (`thongthai-chat.ts` 275.7kb, `line-webhook.ts` 297.4kb — the ~12kb growth is the compiled
    Bible text, expected).
  - Confirmed: zero mutable business facts in any doctrine section (compiler throws if any
    doctrine section matches a price/promo-code/stock pattern — compile succeeded, so none
    were introduced). `main`/production untouched (only this integration branch has these
    commits).
- [x] **Phase B — Semantic Interpreter.** Done, committed on this branch (see "Last commit"
  below). Summary:
  - `netlify/functions/_semantic-interpreter.ts`: the one reusable `SemanticTurn` contract
    (domain/intent/action/entities/references/constraints/confidence/needsClarification) plus
    `SemanticContext`/`SemanticContextEntity` (a minimal precursor of Phase C's real
    conversation-continuity store — passed in by the caller for now, tests build it by hand).
    `buildSemanticInterpreterPrompt()` (pure) + `parseSemanticTurnResponse()` (pure, validates
    enums and deterministically resolves flagged references against real context entities —
    never guesses an id) + `interpretSemanticTurn()` (the real async entry point, reuses
    `_thongthai-brain-v3.ts`'s existing `callPreferredModel`/Gemini→OpenAI stack, now exported
    for this reuse — NOT a second independent LLM integration). Never calls a business tool;
    only understands the turn.
  - `netlify/functions/_semantic-interpreter-shadow.ts`: read-only comparison harness
    (`legacyShadowRoute`) reusing the existing legacy routers' own matching logic
    (`isExperienceDiscoveryIntent`, `isPromotionDiscoveryIntent`/`isPromotionAcceptIntent`, a
    copy of `thongthai-chat.ts`'s inline food-keyword regex) so tests can compare new vs. old
    without wiring the interpreter into production routing. `thongthai-chat.ts` and
    `line-webhook.ts` are completely untouched by Phase B (verified via `git diff --stat`).
  - `tests/fixtures/semantic-eval-corpus.ts`: **49 cases** (>= 40 required), covering all 8
    required categories (formal/colloquial/typo/follow_up/correction/topic_switch/ambiguous/
    multi_intent) and all 4 required domains (restaurant/activity/stay/promotion), plus
    membership/otop/cafe/payment/journey/support. Each case pairs a real message with a
    `simulatedModelOutput` (the JSON a correctly-functioning model should produce) — this is
    both today's test fixture AND the ground truth a live acceptance pass should verify the
    real model against before Phase O (no API keys in this dev environment; `npm test` stays
    network-free per this repo's existing convention — see `interpretStayBookingTurn` for the
    same established pattern).
  - `tests/semantic-interpreter-corpus.test.ts`: corpus-size/coverage checks, per-case
    validation-layer tests (all 49), 3 semantic-equivalence-group tests (broad_discovery x7,
    restaurant_recommendation x3, stay_availability x2 — all classify identically), the exact
    "ตัวไหนนิสัยดีกว่า" reference-resolution worked example from the brief, prompt-builder
    structural checks (grounds in real context, never asks the model to invent values, no
    chain-of-thought), instrumentation/metadata tests, and shadow-comparison tests — which
    surfaced two REAL, honest gaps in the current legacy routers (documented as findings, not
    hidden): "แถวนี้ทำไรดี" isn't caught by the legacy experience-discovery matcher, and
    "โปรมีไร" (question-before-mention word order) isn't caught by the legacy promotion
    matcher. Both are exactly the class of gap the semantic layer is meant to close.
  - `npm test`: **186/186 passing** (117 baseline + 69 new). Both new modules bundle cleanly
    standalone (14.8kb / 7.2kb). Production routing files (`thongthai-chat.ts`,
    `line-webhook.ts`) unchanged — legacy behavior is completely untouched by this phase.
- [x] **Phase B.1 — Hardening (3 architecture corrections requested after Phase B review).**
  Done, committed. Summary:
  1. **Circular dependency prevention**: extracted all provider-calling concerns (Gemini/
     OpenAI calls, `LLMRequestError`/`LLMAvailabilityError`/`ProviderNotConfiguredError`,
     `callPreferredModel`, `stripCodeFences`, `ChatTurn`) out of `_thongthai-brain-v3.ts` into
     a genuinely neutral `netlify/functions/_thongthai-model-provider.ts` (zero business/
     semantic logic, zero imports from brain-v3 or the semantic interpreter). Both
     `_thongthai-brain-v3.ts` and `_semantic-interpreter.ts` now import FROM this module
     instead of the interpreter importing from brain-v3 directly — this is what breaks the
     future Brain → Semantic Interpreter → Brain cycle. `brain-v3.ts` re-exports what
     `thongthai-chat.ts` already imports from it, so that file needed zero changes.
     `tests/model-provider-no-cycle.test.ts` statically proves the import graph has no cycle
     (checks actual import specifiers via regex, not just "it compiles") and that both esbuild
     bundles succeed standalone. Behavior/timeouts/fallback order unchanged from before.
  2. **Ecosystem vocabulary dedup**: `_semantic-interpreter.ts`'s prompt no longer hand-types
     its own paraphrase of ecosystem relationships — it interpolates
     `THONGTHAI_BIBLE_SECTIONS.ecosystemVocabulary` directly from the same generated Bible
     artifact the Brain prompt uses. One authored copy, not three.
  3. **Precise eval claims**: added `SEMANTIC_EVAL_STATUS` (a mechanically-checkable constant
     in `_semantic-interpreter.ts`, tested in `tests/semantic-interpreter-corpus.test.ts`)
     explicitly distinguishing `staticNetworkFreeSemanticContract: 'pass_fail_in_npm_test'`
     (what the 49-case corpus actually proves today — the validation layer) from
     `liveModelSemanticConformance: 'not_yet_executed'` (whether the real model classifies
     each corpus message correctly — deferred to a live acceptance job before Phase O).
  - `npm test`: **193/193 passing** (186 + 7 new). `thongthai-chat.ts`/`line-webhook.ts`
    bundles unaffected (`git diff --stat` empty on both throughout B.1).
- [ ] Phase C — Server-side Conversation Continuity. NOT STARTED. This is the exact next
  action — see the detailed design brief the user gave for it (bounded conversation_context,
  privacy/retention rules, context builder producing SemanticContext, cross-channel identity
  tests, 15 required test areas, the horse-booking multi-turn golden scenario) — treat that
  brief as binding detail, not optional flavor, when implementing.
- [x] **Phase C — Server-side Conversation Continuity.** Done, committed. Summary:
  - **Storage**: no new table, no migration. Extends the EXISTING `guest_agent_state.state`
    JSONB with a new `conversationContext` field, additive, same pattern
    `restaurantProposedSet`/`pendingPromotionRedemption` already use. Keyed by canonical
    `guest_id` (via existing identity resolution), never by channel — this is what makes
    cross-channel continuity automatic rather than something to separately build.
  - `netlify/functions/_conversation-context.ts`: `ConversationContextState` (schemaVersion,
    bounded recentTurns, rollingSummary, activeDomain/activeTopic/openQuestion,
    recentEntities, lastAction, currentTaskReference, lastRecommendationReference,
    lastToolResultSummary, recentEventIds, updatedAt/expiresAt). Pure reducer
    `applyConversationContextUpdate()` (idempotent on `eventId` — a retried/duplicated
    webhook delivery is a no-op). Pure `buildSemanticContext()` — the context builder the
    review asked for, converting persisted state into exactly Phase B's `SemanticContext`
    shape; the Semantic Interpreter still never touches the DB itself. Thin DB I/O
    (`loadConversationContext`/`persistConversationContext`), untested by `npm test` per this
    repo's existing convention for such wrappers (same as `loadBrainRuntime`/
    `persistBrainRuntime`).
  - **Retention**: `CONTEXT_TTL_MS` = 2 hours of inactivity; `isContextExpired`/`pruneExpired`
    treat stale context as absent (application-level expiry, no DB TTL/cron needed for
    correctness). `MAX_RECENT_TURNS=8`, `MAX_TURN_CHARS=400`, `MAX_RECENT_ENTITIES=6`. Every
    turn passes through `redactSensitiveContent()` (phone/email/long-digit-run redaction)
    before storage — found and fixed a real regex bug here (trailing-whitespace consumption)
    via the test suite, not shipped broken. No payment secrets, image/slip content, passwords,
    or tokens ever reach this module (they don't flow through `request.message` text at all).
  - **Entity honesty**: `SemanticContextEntity` (Phase B's type) extended additively with
    `source?: 'catalog'|'tool_result'|'conversation'` and `canonical?: boolean`. An entity only
    mentioned in conversation (not yet resolved against a real catalog/tool result — Phase C
    doesn't execute real tool calls) gets a `conv:`-prefixed id and `canonical:false`, never a
    fabricated-looking operational id.
  - `tests/conversation-context.test.ts`: all 15 required test areas, each explicitly labeled
    `[area N]`. `tests/fixtures/semantic-multiturn-scenarios.ts` +
    `tests/semantic-multiturn-golden.test.ts`: the exact 6-turn horse-booking scenario from the
    brief, driven through the REAL reducer + REAL Phase B validation layer turn-by-turn,
    asserting continuity end-to-end (including a channel switch web→LINE mid-scenario at turn
    5) plus a dedicated duplicate-delivery replay test proving the whole scenario is
    idempotent, not just a single turn.
  - **Correction to the Phase B report**: the corpus was reported as 49 cases; recounting
    found the accurate number is **51** (manual tally error, not a code bug). Total eval
    scenarios now: 51 (corpus) + 6 (multi-turn golden) = **57**, growing toward the Phase L
    target of 150+.
  - `npm test`: **221/221 passing** (193 baseline + 28 new). New module bundles cleanly
    standalone (7.3kb). `thongthai-chat.ts`/`line-webhook.ts` bundles and diffs unaffected —
    Phase C does not wire continuity into the actual request-handling path yet (deliberate;
    see "Exact next action" below for why and what's left for Phase F/G).
- [x] Phase D — Working/Task State + Memory boundaries. **DONE.**
  - **New module**: `netlify/functions/_task-state.ts`. Formalizes the 4-layer memory model as
    documented boundaries (no new code needed for 3 of the 4 — they already exist):
    1. **Conversation Continuity** = Phase C's `_conversation-context.ts` (recent turns, rolling
       summary, active topic/domain, recent entities, open question, last recommendation).
    2. **Working/Task State** = this phase's new `ActiveTask`/`TaskStateContainer` (current
       goal, slots, missing fields, status).
    3. **Durable Preference Memory** = existing `guest_semantic_memory`, gated by the existing
       `SAFE_MEMORY_KEYS` allow-list in `_thongthai-runtime-v3.ts` (now exported for testing).
    4. **Operational State** = existing `bookings`/`orders`/`preorders`/promotion
       redemption/payment/settlement/membership tables — untouched, still the only source of
       transactional truth.
  - **Memory ownership matrix** (one authoritative owner per field, no duplication):
    | Info | Owner |
    |---|---|
    | customer name/phone/email | operational contact fields on the booking/order/preorder row itself (never semantic memory, never task slots beyond the in-flight draft) |
    | selected horse / requested date (mid-booking) | `ActiveTask.slots` (Working/Task State) |
    | "likes quiet trips" | `guest_semantic_memory` via `SAFE_MEMORY_KEYS` (Durable Preference Memory) |
    | "อันเมื่อกี้" (referent resolution) | `ConversationContextState.recentEntities` (Conversation Continuity) |
    | booking confirmed / paid / settled | the operational table row's own `status` column ONLY |
  - **`ActiveTask`/`TaskStateContainer`**: matches the brief's shape (`taskId`, `type`, `domain`,
    `status`, `slots`, `missingFields`, `selectedEntities`, `constraints`, `sourceChannel`,
    `createdAt`, `updatedAt`). Deliberately kept domain-agnostic in the core: `ActiveTaskType` is
    only an identifier union and `TASK_TYPE_DOMAIN`/`TASK_TRANSITIONS` are plain data tables —
    no per-domain business logic (e.g. "a horse booking needs X") lives inside the core. Required
    fields are supplied BY THE CALLER per invocation (`requiredFields`), so the core never
    invents a business rule about what a booking needs; that stays with domain code.
  - **Transitions**: `collecting→{ready,cancelled}`, `ready→{executing,collecting,cancelled}`,
    `executing→{requested,completed,failed,cancelled}`, `requested→{completed,failed,cancelled}`;
    `completed`/`cancelled`/`failed` are all terminal (no outgoing edges) — reopening a finished
    task is unsupported by design; a new task must be started instead. `requested→collecting`
    and `completed→executing` are explicitly rejected, matching the brief's disallowed list.
  - **Topic switch / suspend-resume**: one active task + exactly one suspended task (bounded, no
    stack). `suspendActiveTask` moves active→suspended; if a task is already suspended it is
    evicted (transitioned to `cancelled`) to make room — explicit, tested, not silent data loss.
    `resumeSuspendedTask` swaps active↔suspended if both are occupied, so neither is destroyed.
    Corrections update the SAME task (slot overwrite, since `slots` is a keyed object — no
    duplication risk) rather than creating a new one; `startNewActiveTask` throws
    `TaskStateError` if an unfinished task is already active, so a new task can never silently
    contaminate/overwrite one still in progress.
  - **Idempotence**: `applyTaskStateEvent(container, event, now)` — one dispatch point keyed on
    `eventId`, mirroring Phase C's `applyConversationContextUpdate`; a replayed eventId is a
    full no-op.
  - **Legacy adapters** (one-directional, read-only, NOT wired into any request handler — same
    strangler posture as Phase C): `adaptBookingSessionToTask` (LINE's `booking_sessions` row →
    `ActiveTask`), `adaptRestaurantProposedSetToTask`, `adaptPendingPromotionRedemptionToTask`.
    The latter two REUSE the existing real business logic (`missingRestaurantPreorderFields`,
    `missingPromotionFields`) for `missingFields` rather than re-deriving a second copy of it —
    "must not invent business facts" honored by reuse, not restatement. `booking_sessions`,
    `restaurantProposedSet` and `pendingPromotionRedemption` are not read from or written to by
    any other Phase D code path; they keep working exactly as today.
  - **Horse multi-turn task-state result** (`tests/task-state-horse-scenario.test.ts`, same
    canonical 6-turn fixture Phase C uses): no task exists through turns 1-3 (pure discovery);
    turn 4 ("เอาภาราดร") creates the task with the horse selected; turn 5 ("พรุ่งนี้สองคน") merges
    date+partySize into the SAME `taskId`; turn 6 ("บ่ายสามได้ปะ") merges the requested time into
    the SAME task; `status` never leaves `'collecting'` — no real booking is executed, matching
    the brief. A second test proves the topic-switch scenario end-to-end: starting the booking,
    suspending it for a restaurant question, then recovering it fully via `resume`.
  - **Correction tests**: horse selection replacement (ทองไทย→ภาราดร, not both), partySize
    2→3, date พรุ่งนี้→วันเสาร์ (overwrite, not duplicate) — all same `taskId`.
  - **Privacy/memory isolation tests**: `SAFE_MEMORY_KEYS` contains no transactional/PII-shaped
    key; `ActiveTask` and `ConversationContextState` share no overlapping fields (structurally
    cannot be confused for each other); a completed task's status is untouched by conversation
    context expiry (independently serialized under sibling `guest_agent_state.state` keys); a
    fresh task started after a prior one completes has empty slots (no cross-task leakage);
    `addTaskConstraint` is bounded+deduplicated so corrections can never grow state unboundedly.
  - **Real pre-existing bug found and fixed while stabilizing this checkpoint** (per "fix it now,
    don't just ask" instruction): `tests/semantic-multiturn-golden.test.ts`'s duplicate-eventId
    replay test called `applyConversationContextUpdate` without pinning `now`, defaulting to
    real wall-clock time on every call. Two full 6-turn traversals run back-to-back could
    straddle a millisecond boundary, producing a flaky ~1-in-10 failure (a turn's `at` field off
    by 1ms) — verified via 15 consecutive `npm test` runs before (1 failure) and after (0
    failures) the fix. Root cause was in the TEST, not in `_conversation-context.ts` itself;
    fixed by pinning a shared `fixedNow` across both traversals. This was a genuine flake, not a
    tolerated one — root-caused and fixed, not retried away.
  - `npm test`: **258/258 passing** (221 baseline + 37 new: 32 in `task-state.test.ts`, 2 in
    `task-state-horse-scenario.test.ts`, 3 in `task-state-no-cycle.test.ts`), verified
    flake-free over 15 consecutive runs. New module bundles standalone cleanly (15.9kb).
    `thongthai-chat.ts`/`line-webhook.ts` bundle sizes unchanged from Phase C (277.2kb/298.8kb)
    — `_task-state.ts` is not imported by either yet (deliberate; not wired into request
    handling, same posture as Phase C's conversation-context module).
  - Static import-graph tests (`tests/task-state-no-cycle.test.ts`) prove `_task-state.ts` only
    imports from `_semantic-interpreter.ts`/`_promotion-dialog.ts`/`_restaurant-preorder-dialog.ts`
    (never the runtime/brain/model-provider layer), and that none of those three import back
    from `_task-state.ts`.
- [x] **D.1 — correction: system eviction must never be reported as customer cancellation.
  DONE.** User caught a real correctness bug in Phase D's `suspendActiveTask`: when a second
  task got suspended while one was already suspended, the older one was transitioned to
  `cancelled` — conflating "the customer explicitly cancelled" with "the system discarded
  superseded conversational work to keep the bounded single-slot stack." Worse, that transition
  result was computed and then discarded via `void evicted` — the evicted task's status was
  never actually reachable anywhere, a dead-code artifact from the original implementation.
  - Added a new distinct terminal `ActiveTaskStatus` value: `'superseded'`. It is NOT listed as
    a valid target in `TASK_TRANSITIONS` from any status — the ONLY way to reach it is the new
    internal `supersedeTask(task, now)` function, called exclusively from `suspendActiveTask`'s
    eviction path. A caller can never reach `superseded` via `transitionTask` — a new test
    (`canTransitionTask(from, 'superseded')`) proves this is false from every status.
  - `supersedeTask` is idempotent on an already-terminal task (a real `cancelled` task passed
    through it stays `cancelled` — it can never relabel a genuine customer cancellation).
  - The evicted task is no longer silently dropped: `TaskStateContainer` gained a new field,
    `lastSupersededTask` (holds only the most recent eviction, bounded, same posture as
    `suspendedTask` itself — not a growing log), so the distinction is actually observable, not
    just correctly named in code nobody could see.
  - No operational booking/order/payment status is touched by any of this — a new static test
    (`tests/task-state.test.ts`) regex-scans `_task-state.ts`'s `dbFetch` calls and asserts every
    one targets `guest_agent_state` only, never an operational table.
  - `parseTaskState`/`serializeTaskState` updated to carry `lastSupersededTask` through the
    round-trip; defensive parsing unaffected (an invalid task in that slot falls back to `null`,
    same as `activeTask`/`suspendedTask`).
  - 3 new regression tests added (eviction produces `superseded` + is preserved, no
    generic-graph path reaches `superseded`, `supersedeTask` never overwrites a real
    `cancelled`/other terminal status) plus 1 static operational-table-isolation test. `npm
    test`: **261/261 passing**, verified flake-free over 5 consecutive runs. New module bundles
    standalone cleanly (16.4kb, was 15.9kb). Production bundles
    (`thongthai-chat.ts`/`line-webhook.ts`) unaffected — still not wired in.
- [x] Phase E — Knowledge Resolver / Source-of-Truth graph. **DONE.**
  - **New modules**: `netlify/functions/_knowledge-resolver.ts` (routing/orchestration core),
    `netlify/functions/_ecosystem-entity-graph.ts` (structural entity graph), and
    `netlify/functions/_domain-task-policy.ts` (Phase D's deferred required-fields policy,
    authored here). Owns ZERO storage and makes ZERO direct DB calls of its own — proven by a
    static test asserting no bare global `fetch(` call exists anywhere in
    `_knowledge-resolver.ts`'s code. All real I/O is injected via `KnowledgeSourceAdapters`; in
    a later production-wiring phase these would be thin wrappers around the ALREADY-EXISTING
    functions (`listRestaurantMenu`, `loadActivityWorldFacts`, `listBookingOptions`,
    `loadActivePromotionsWorldFact`, etc.) — no new unified facts table, no copy of live data
    into `world_facts` or the Bible. Not wired into any request handler yet.
  - **`KnowledgeRequest`/`KnowledgeBundle`**: match the brief's shapes. Every `GroundedFact`
    carries `sourceId`/`sourceType`/`authoritative`/`fetchedAt` provenance — nothing in a bundle
    is a resolver-synthesized value; everything traces back to a real `SourceResult` an adapter
    returned.
  - **Source registry**: `SOURCE_REGISTRY` documents ownership per `KnowledgeNeed`; the actual
    dispatch is `routeNeed(domain, need, adapters)` — one (domain, need) pair maps to exactly
    ONE adapter call, which is what makes "no overfetching" true structurally, not just by
    convention (tested with call-count spies across every registered adapter).
  - **Precedence**: `SOURCE_PRECEDENCE` ranks `booking_operational`/`order_operational`/
    `payment_operational`/`membership_operational` (100) > `promotion_runtime` (90) >
    `*_live` domain sources (80) > `bible` (50) > `conversation_memory` (10).
    `pickByPrecedence` resolves conflicts deterministically — tested: a live promotion beats a
    stale conversation-remembered price; an operational booking status beats a rolling summary.
  - **EMPTY vs UNAVAILABLE vs UNKNOWN**: `SourceResult` has three distinct statuses
    (`ok`/`empty`/`unavailable`); a genuinely empty authoritative result never lands in
    `bundle.missing` (it's an answer, just zero records) while an `unavailable` source does
    (real missing information) — kept structurally separate so a later phase (Phase H) can
    phrase them differently instead of both collapsing into "ไม่มีสินค้า".
  - **Anti-hallucination**: `getGroundedFactValue(bundle, key)` is the only correct way to ask
    "do we have a verified value for X" — absence means `{status:'unverified'}`, never filled
    in by guessing. Directly proven on the brief's own acceptance case: a fake
    `activity_assets`-shaped source with real horse names/prices but NO temperament field —
    `getGroundedFactValue(bundle, 'temperament:horse:paradon')` returns `unverified`, and no
    fact anywhere in the bundle even mentions "temperament". Also proven for the null-price
    case: a source explicitly reporting `price: null` grounds as `known` with value `null`
    (a real fact — "not configured") — distinct from `unverified` (no source answered at all);
    the resolver never invents a number either way.
  - **Entity resolution**: `resolveEntityIdentity(conversational, candidates)` — exact match on
    name/domain (or alias) → canonical; multiple matches → `ambiguous:true`, `canonicalId:null`
    (never guessed); no match → honestly retained non-canonical, original name preserved, never
    a fabricated id. Tested against a real `activity_assets`-shaped candidate list for
    ทองไทย/ภาราดร/ATV/ยิงธนู, a restaurant, and an ambiguous two-candidate stay-room case.
  - **Ecosystem entity graph**: `_ecosystem-entity-graph.ts` represents the business-unit →
    activity-group → activity → resource-slot STRUCTURE (sourced from `THONGTHAI_BRAIN.md`'s
    existing production-components section) but deliberately holds no specific named
    instance/price — `resource_slot` nodes literally say "(from activity_assets, live)", not
    "ทองไทย"/"ภาราดร". A static test asserts no resource_slot label ever hardcodes a name or a
    price — Bible/doctrine structure is not allowed to become mutable inventory.
  - **Domain task policy** (`_domain-task-policy.ts`, closes Phase D's deferred item):
    `computeTaskMissingFields(task)` reuses the REAL existing `missingRestaurantPreorderFields`/
    `missingPromotionFields` for `restaurant_preorder`/`promotion_redemption` (including
    promotion's real `requiresDateTime` conditional — proven with a test where
    `requiresDateTime:false` correctly demands nothing) rather than re-deriving a second copy.
    For `activity_booking`/`stay_booking`/`restaurant_booking`, where no such function existed
    yet, the required list is grounded directly in `createBooking`'s real validation in
    `_operations-db.ts` (`resourceCode`+`durationMinutes` hard-thrown for activity; `date`
    non-optional on the input type for all service types) — read off real code, not invented.
    `_task-state.ts`'s `adaptPendingPromotionRedemptionToTask` gained one additive field
    (`requiresDateTime` now carried into `slots`) so this recomputation is faithful.
  - **No overfetching**: tested directly — a single-need `restaurant`/`catalog` request with
    every domain's adapter registered (restaurant/activity/stay/promotion/otop/cafe/bible)
    triggers exactly one call, to `restaurant.menu`, and nothing else.
  - **Degraded-source honesty**: an adapter throwing is caught and converted to a structured
    `unavailable` result (never an unhandled rejection, never silently reinterpreted as empty).
  - **Architecture guards** (`tests/knowledge-resolver-no-cycle.test.ts`): Semantic Interpreter
    does not import the resolver; the resolver imports no Response Composer (doesn't exist yet)
    and no runtime/brain/model-provider layer; `_task-state.ts` still doesn't import either new
    Phase E module (task core stays domain-agnostic); no circular dependency among the three new
    modules or back into the modules they depend on.
  - **Horse golden continuation** (`tests/knowledge-resolver-horse-scenario.test.ts`): the three
    specific lines from the brief — "ตัวไหนนิสัยดีกว่า" returns unverified temperament for both
    horses (not invented); "เอาภาราดร" resolves to a real canonical id; "บ่ายสามได้ปะ" routes to
    the LIVE activity source (`freshness:'live'`), never Bible/static catalog, and no
    transactional adapter is ever supplied or called — no booking is executed.
  - **Total eval scenarios**: unchanged at 57 — Phase E added resolver/policy unit+architecture
    coverage (36 new test cases: 20 in `knowledge-resolver.test.ts`, 3 in
    `knowledge-resolver-horse-scenario.test.ts`, 7 in `knowledge-resolver-no-cycle.test.ts`, 6 in
    `domain-task-policy.test.ts`), not new SemanticTurn corpus cases.
  - `npm test`: **297/297 passing**, verified flake-free over 8 consecutive runs. New modules
    bundle standalone cleanly (`_knowledge-resolver.ts`: 9.3kb).
    `thongthai-chat.ts`/`line-webhook.ts` bundle sizes unchanged from Phase D
    (277.2kb/298.8kb) — none of Phase E's modules are imported by either yet (deliberate; per
    the user's explicit Phase E closing instruction, production request routing is not wired
    until Phase F explicitly requires it).
- [x] Phase F — Universal Dialog Manager. **DONE** (shadow/orchestration only, NOT wired into
  production request routing).
  - **New modules**: `netlify/functions/_dialog-manager.ts` (the orchestration core),
    `netlify/functions/_dialog-source-adapters.ts` (real, read-only adapters wrapping existing
    functions), `netlify/functions/_activity-sot.ts` (extraction, see below).
  - **`DialogInput`/`DialogPlan`/`DialogDecision`**: match the brief's contracts.
    `reasons`/`DialogReasonCode` are bounded machine codes only (e.g. `missing_field`,
    `cannot_verify_comparison`, `task_suspended_for_topic_switch`) — never natural-language
    reasoning or chain-of-thought.
  - **Two-step plan/resolve**: `planDialogTurn` (pure, sync) does the SemanticTurn→ActiveTask
    merge, missing-field computation, and knowledge-need planning. `resolveDialogDecision`
    (pure, sync) takes the caller's already-resolved `KnowledgeBundle[]` and produces the final
    decision. `processDialogTurn` is the ONLY function that performs I/O — it calls
    `resolveKnowledge` (Phase E) via injected adapters between the two pure steps. Zero direct
    DB calls of its own (static test: no bare global `fetch(` anywhere in the file).
  - **SemanticTurn → ActiveTask merge**: generic, reused for provide_information/select/
    correction/modify/cancel/confirm. Corrections overwrite the same task's slots (tested:
    horse replacement, partySize 2→3). Every task mutation routes through
    `_task-state.ts`'s `applyTaskStateEvent`, keyed on `` `${eventId}:<operation>` `` sub-ids —
    **found and fixed a real idempotence bug** here: the original code derived a DIFFERENT
    sub-id depending on whether a task already existed (`:start` vs `:update_slots`), so a
    genuine duplicate-delivery replay (which naturally sees post-first-application state) took
    a different branch and was never deduped. Fixed by giving each logical operation ONE stable
    id (`:task_merge`, `:topic_transition`) regardless of which branch fires — since
    `applyTaskStateEvent` dedups purely on the eventId string before even inspecting `kind`,
    this makes a resent duplicate a true no-op again. Also threaded `now: Date` explicitly
    through `planDialogTurn`/`mergeTaskState` (previously relied on `applyTaskStateEvent`'s
    wall-clock default) — the same class of flaky-timestamp bug already found once in Phase C,
    caught and fixed here before it could bite.
  - **Domain policy, not hardcoded rules**: missing-field computation calls
    `computeTaskMissingFields`/`DOMAIN_TASK_REQUIRED_FIELDS` from `_domain-task-policy.ts`
    (Phase E) — the Dialog Manager itself contains no per-domain business rule.
  - **Knowledge-need planning**: `planKnowledgeNeeds(turn, container)` — a small decision table
    keyed on (domain, action), returning at most one `KnowledgeRequest` per implicated domain.
    Tested: a single-need request triggers exactly the ONE matching adapter across every
    registered adapter (no overfetch).
  - **READY != EXECUTE**: only `book`/`order` actions count as `customerCommitPresent`
    (`confirm`, e.g. "เอาภาราดร", is a selection, not a commitment). A proposal requires
    commit present + zero missing fields + (if availability was requested) a verified
    `available:true` fact — never merely "all fields happen to be filled in."
  - **ActionProposal**: `{toolName, validatedArgs, requiresExplicitConfirmation,
    customerCommitPresent, idempotencyKey}`. Phase F stops here — no transactional write
    anywhere in this module or its tests.
  - **Topic switch/resume**: reuses Phase D's bounded suspend/resume exactly. Tested: a domain
    switch suspends the active task without destroying it; returning to the suspended domain
    resumes the SAME taskId, never creating a new one.
  - **Discovery never creates fake tasks**: `TASK_WORTHY_ACTIONS` excludes discover/ask/compare/
    recommend/status — tested directly, including the exact original bug regression (repeated
    "มีโปรอะไร" never creates or advances a task on either asking).
  - **Ambiguity**: `needsClarification` or any `ambiguous` reference short-circuits straight to
    `mode:'clarify'` before any task/knowledge work happens — never a guess.
  - **Anti-hallucination**: for a `compare` action, checks the PRECISE fact key per candidate
    entity (`` `${attribute}:${entityId}` ``) rather than a coarse "were any facts returned at
    all" guess — a catalog answering with names/prices but no temperament is still correctly
    treated as unverified (`responseIntent:'cannot_verify_comparison'`). A `null` (unconfigured)
    price is flagged `known_unconfigured_price`, never coerced into an invented number.
  - **EMPTY/UNAVAILABLE/UNKNOWN propagation**: an empty promotion-eligibility source produces
    `responseIntent:'no_active_promotion'` (a valid answer); an unavailable source produces
    `'source_unavailable_apology'` and `knowledge_unavailable` — kept structurally distinct,
    tested directly.
  - **Real read-only source adapters** (`_dialog-source-adapters.ts`): restaurant/activity/
    promotion/otop catalogs, each a thin wrapper reusing the exact existing function
    (`listRestaurantMenu`, `loadActivityWorldFacts`, `loadActivePromotionsWorldFact`,
    `listOtopProducts`) — no duplicate queries. `loadActivityWorldFacts` was extracted out of
    `_thongthai-runtime-v3.ts` into a new neutral module, `_activity-sot.ts` (mirroring the
    existing `_restaurant-sot.ts` pattern) — importing it from the brain/runtime module would
    have pulled the entire LLM-calling Brain in as a transitive dependency of the Dialog
    Manager's adapters, which the architecture guards forbid. Availability/booking-status/stay/
    membership/cafe real adapters are deliberately deferred (need per-request argument mapping
    beyond a bare `KnowledgeRequest`) — tracked below, not silently dropped. Not network-tested
    (matches this codebase's existing DB-I/O-wrapper convention); not wired into any handler.
  - **Horse full-flow result** (all 7 turns, through the REAL pipeline — `parseSemanticTurnResponse`
    + `applyConversationContextUpdate` + `processDialogTurn`, mock adapters only): no task
    through turns 1-3; turn 3's "ตัวไหนนิสัยดีกว่า" returns `cannot_verify_comparison` (no
    temperament source); turn 4 creates the task with ภาราดร selected, NOT a booking proposal;
    turns 5-6 merge date/partySize/time into the SAME taskId; turn 6 correctly asks for the
    still-missing `durationMinutes` (real domain policy) rather than proceeding; only after
    duration is supplied AND an explicit "จองเลย" arrives does `mode:'propose_action'` fire,
    with verified availability backing it — still the same taskId throughout.
  - **Restaurant multi-turn result**: party size, budget, and a `no_pork` constraint all survive
    intact across 5 turns on one task; selecting "เอาชุดเมื่อกี้" doesn't lose anything gathered.
  - **Stay multi-turn result**: an availability inquiry alone creates no task; concrete
    party-size/duration is task-worthy; selecting a resource completes the only real requirement
    (`date`); fields-complete is proven NOT sufficient for a proposal; only "จองเลย" produces one.
  - **Promo regression result**: repeated "มีโปรอะไร" (the ORIGINAL production bug from earlier
    in this program) never creates a task on either asking, and both askings plan the identical
    correct knowledge request — no drift toward name-collection. A genuine accept phrase after
    discovery still correctly starts the redemption task.
  - **Cross-channel continuity result**: web turn 1 → LINE turn 2 with `chatHistory: []` never
    constructed at all — turn 2 is still correctly understood as continuing the same activity
    task, driven entirely by server-loaded `conversationContext`/`taskState`. Concrete proof
    Phase G needs before simplifying the channel adapters.
  - **Idempotence**: replaying the identical eventId against post-first-application state
    produces a byte-identical `taskStateContainer` (the bug described above, now fixed and
    tested); `processDialogTurn` replayed end-to-end never produces a second/duplicate
    `ActionProposal`.
  - **Shadow-vs-legacy findings** (`tests/dialog-manager-shadow-comparison.test.ts`, extends
    Phase B's harness): แถวนี้ทำไรดี and โปรมีไร — both classified `expected_improvement` (the
    legacy stateless regex router still can't catch either, documented already in Phase B). A
    bare contextual reference ("พรุ่งนี้สองคน") is classified `expected_improvement` — the
    legacy router has literally no state to resolve it from; the new pipeline resolves it via
    real `conversationContext.activeDomain`. A correction turn is classified similarly — the
    legacy system has no correction concept at all. One `equivalent` case included (explicit
    dish mention) to prove the classifier isn't just always claiming improvement.
  - **Architecture guards**: Semantic Interpreter/Task core/Knowledge Resolver do not import the
    Dialog Manager; the Dialog Manager imports no Response Composer, raw DB client, LINE
    webhook, web frontend, or payment transport code, and only the 5 expected leaf modules; no
    circular dependency anywhere in the new graph.
  - **Eval corpus growth**: 51 → **74** corpus cases (+23, avoiding trivial wording duplicates;
    2 originally-planned ids collided with pre-existing ones and were renamed, not silently
    overwritten) across the 10 requested families (activity booking, restaurant
    recommendation→preorder, stay availability→booking intent, promotion repeated discovery,
    correction, topic switch, cancel, ambiguous reference, no-action informational,
    explicit-confirmation gating). Total eval scenarios: 74 + 6 multi-turn = **80**, meeting the
    Phase F target exactly. 3 new `SemanticEvalCategory` values added (`cancel`, `informational`,
    `confirmation_gating`) since none of the 8 original categories honestly fit these shapes.
  - `npm test`: **358/358 passing** (297 baseline (which already includes D.1) + 38 new Dialog
    Manager test cases across the 8 new test files + 23 additional corpus-driven subtests from
    the eval corpus growth), verified flake-free over 12 consecutive full-suite runs. Production
    bundles: `thongthai-chat.ts` 277.9kb (small, expected increase from the `_activity-sot.ts`
    extraction's module-boundary crossing — no behavior change), `line-webhook.ts` 298.8kb
    unchanged — neither Phase F module is imported by either yet.
- [~] **Phase G — Channel migration. SPLIT INTERNALLY.**
  - [x] **G.1 — Channel Integration Foundation. DONE.**
    - Added the canonical server-side orchestration entrypoint:
      `netlify/functions/_thongthai-one-mind-orchestrator.ts`.
      It composes canonical identity → bounded server ConversationContext → Semantic Interpreter
      → ActiveTask → real read-only Knowledge adapters → Dialog Manager, and returns a structured
      `OneMindTurnResult` + safe trace metadata. It never writes a booking/order/payment and never
      generates customer-facing prose.
    - `processDialogTurnDetailed()` was added to `_dialog-manager.ts` so the canonical
      orchestrator receives the exact grounded `KnowledgeBundle[]` used for the decision instead
      of re-querying sources later.
    - Completed the read-only source-adapter foundation by REUSING existing canonical functions:
      restaurant menu, activity catalog, activity/stay availability via `listBookingOptions`,
      stay resources via `listServiceResources`, active promotions, booking status via
      `loadLatestBookingStatus`, membership status via `loadMembershipStatus`, and OTOP.
      No transactional write is present in `_dialog-source-adapters.ts`. Café remains deliberately
      without a fabricated live adapter: the current DB has inquiry workflow/policy but no verified
      café-live catalog source equivalent to restaurant/activity/stay, so UNKNOWN is preferred over
      invented truth.
    - Added canonical read-only models to `_operations-db.ts` next to the existing owner of those
      tables: `listServiceResources`, `loadLatestBookingStatus`, `loadMembershipStatus`.
      Production create/update behavior was not changed.
    - LINE still deliberately sends `chatHistory: []`; instead it now forwards the stable
      `event.message.id` to `thongthai-chat` (including on retry). Server continuity, not a
      LINE-local history array, is the authority.
    - `thongthai-chat.ts` now has an **opt-in shadow hook only**:
      `THONGTHAI_ONE_MIND_SHADOW=1` runs the One-Mind pipeline but its decision is NEVER used for
      the customer response. Bounded state persistence additionally requires
      `THONGTHAI_ONE_MIND_SHADOW_PERSIST=1` AND a real transport event id. With env flags absent
      (the current production state), legacy behavior is unchanged.
    - Cross-channel identity tests prove genuinely linked Web/LINE identities can share canonical
      server context while unrelated/unlinked provider identities remain isolated.
    - Replay/idempotence tests prove duplicate event ids do not duplicate bounded conversation/task
      state or create an action. The orchestrator cannot call `executeBrainTools` or any create/
      redeem transaction function.
    - A real state-write race was found while building G.1: Phase C and D persist sibling fields
      inside the same `guest_agent_state.state` JSON object using read-modify-write wrappers.
      Parallel `Promise.all` persistence inside one turn could clobber one sibling field. G.1 now
      persists conversation context then task state sequentially. **Known future cutover concern**:
      two truly concurrent requests can still race at the shared JSON-object level; before G.2
      enables authoritative persistence for customer traffic, add/verify an atomic/versioned
      strategy or otherwise serialize canonical guest turns.
    - Network-free tests added:
      `tests/one-mind-orchestrator.test.ts` and
      `tests/g1-integration-foundation.test.ts`, covering canonical identity, shadow/no-write
      default, Web→LINE server continuity without client history, unlinked isolation, duplicate
      event idempotence, availability shaping, adapter registry, architecture boundaries and
      shadow gating.
    - Added branch-only GitHub Actions CI:
      `.github/workflows/one-mind-branch-ci.yml`, triggered ONLY on
      `feature/thongthai-one-mind-architecture`; it performs `npm ci` + `npm test` and never
      deploys. First run `35348457126` completed SUCCESS.
    - Current test result: **369/369 passing, 0 failed** in GitHub Actions.
    - G.1 implementation branch head before this handoff update:
      `43d706d61b79eb6e06c642bb86ef11c4a9625c00`.
    - `main` remains `d37c56f44753bce2ec25d3091506cd3c0b703bdc`.
      Netlify production current deploy remains the same pre-architecture deployment; no G.1
      production deploy occurred.
  - [ ] **G.2 — Actual customer-visible LINE/Web cutover. NOT STARTED.**
    Must wait until Phase H degradation + Phase I Response Composer are complete and tested.
- [ ] **Phase H — Graceful Degradation. NOT STARTED.** Exact next phase.
- [ ] **Phase I — Response Composer. NOT STARTED.**
- [ ] Phase J — Observability (trace object, no chain-of-thought). NOT STARTED.
- [ ] Phase K — Backoffice Control Plane (tamma-backoffice: health/diagnostics view +
  Conversation Inspector). NOT STARTED. Conversation Inspector must remain bounded/expiring,
  not permanent raw transcript storage.
- [ ] Phase L — Golden conversation eval (150+ cases). NOT STARTED as final suite; corpus is
  already being grown phase-by-phase (80 scenarios as of Phase F; G.1 focused on integration
  foundation tests rather than padding the semantic corpus).
- [ ] Phase M — Full E2E. NOT STARTED.
- [ ] Phase N — Legacy cleanup (retire superseded regex/channel logic only after equivalent
  golden/E2E tests pass). NOT STARTED.
- [ ] Phase O — Final production integration/deployment. NOT STARTED.

## Exact next action

Start **Phase H — Graceful Degradation** on this SAME integration branch.

Sequence is now deliberately:
**G.1 → H → I → G.2 → J → K → L → M → N → O**.

Reason: a customer-visible cutover before a canonical fallback policy and Response Composer exist
would force ad-hoc prose/fallback logic back into LINE/Web handlers, recreating the fragmentation
this architecture is removing.

Phase H must be designed around the canonical One-Mind orchestrator, not around channel-specific
fallback strings. Required degradation hierarchy:
1. primary model provider
2. secondary model provider
3. validated semantic/task state + grounded deterministic knowledge
4. deterministic transactional continuation only where already safe/validated
5. graceful human handoff / final generic failure

Keep these states distinct end-to-end:
- MODEL_UNAVAILABLE
- SOURCE_UNAVAILABLE
- VERIFIED_EMPTY
- FACT_UNKNOWN / UNVERIFIED

Never turn source failure into "ไม่มี", and never turn unknown into an invented answer.

**Known gaps carried forward**:
1. G.1 shadow hook is OFF by default and not customer authoritative; this is intentional.
2. The shared `guest_agent_state.state` persistence wrappers still need cross-request
   concurrency hardening before G.2 customer cutover; sequential same-turn writes fixed only the
   intra-turn clobber.
3. Response Composer does not yet exist; do not add customer prose to Dialog Manager/orchestrator
   during Phase H.
4. Café has no verified live catalog SOT today; preserve UNKNOWN/hand-off behavior rather than
   manufacturing a `cafe_live` source.
5. Existing LINE membership/booking handlers and Web ConciergeProvider remain legacy-authoritative
   until G.2; do not delete them during H/I.

## Last commit on this branch

- G.1 CI head before handoff update: `43d706d61b79eb6e06c642bb86ef11c4a9625c00`.
- Phases A, B, B.1, C, D, D.1, E, F, G.1 complete and pushed.
- Phase H is the exact next action.
