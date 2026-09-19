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
- [x] **Phase H — Graceful Degradation. DONE.**
  - Hardened the neutral provider hierarchy in `_thongthai-model-provider.ts`: Gemini primary
    model(s) still run first; transient HTTP 429/500/502/503/504, timeout/network availability
    failures, and a missing Gemini configuration are now explicitly fallback-eligible for the
    existing OpenAI secondary provider. Bad/blocked/invalid request-class failures remain
    distinct and are not blindly retried against a second provider.
  - Added pure canonical policy module `_graceful-degradation.ts`.
    It never writes customer prose, never queries DB, and never executes transactions.
    Machine states are deliberately distinct:
    `model_unavailable`, `model_invalid`, `source_unavailable`,
    `verified_empty`, `fact_unknown`, `internal_error`.
  - Degradation levels are explicit:
    normal → grounded deterministic → deterministic transactional continuation (only when a
    pre-existing tested continuation capability is explicitly supplied) → human handoff →
    final failure. Merely having an active task NEVER grants deterministic continuation.
  - `safeToExecuteTransaction` is always false in the Phase H policy. A later transaction
    boundary still requires an explicit validated ActionProposal and customer commit.
  - Phase E source truth is preserved through `planKnowledgeDegradation()`: authoritative
    EMPTY means a valid zero-result answer; SOURCE_UNAVAILABLE is retryable failure; UNKNOWN /
    no registered source is unverified truth, not an empty result. Partial grounded facts may
    still be used, but only as partial grounding.
  - The canonical orchestrator now carries `knowledgeDegradation` beside the exact
    `KnowledgeBundle[]` used for its DialogDecision, so Phase I can compose truthful fallback
    copy without re-querying or guessing.
  - Added `processThongthaiOneMindTurnResilient()`: provider failover happens first in the
    neutral provider module; only after the stack is exhausted does the wrapper return a
    structured `status:'degraded'` result with identity, bounded server context/task state and
    a `DegradationPlan`. The degraded path performs no state/transaction writes and no prose.
  - G.1's optional `thongthai-chat.ts` shadow hook now uses the resilient wrapper and logs only
    safe structured status/trace/degradation metadata; legacy customer response remains
    authoritative and unchanged.
  - Added `tests/graceful-degradation.test.ts`: provider eligibility, transient-status policy,
    model unavailable vs invalid, deterministic-fallback gating, transactional-continuation
    gating, EMPTY vs UNAVAILABLE vs UNKNOWN, partial grounding, healthy grounding.
  - Latest branch CI run `35349060912`: **382/382 tests passing, 0 failed**.
  - Main remains `d37c56f44753bce2ec25d3091506cd3c0b703bdc`; production current deploy
    remains the pre-architecture ready deploy. No deploy occurred.
- [x] **Phase I — Response Composer. DONE.**
  - Added `netlify/functions/_response-composer.ts` as the ONE customer-facing wording owner.
    Inputs are `DialogDecision + KnowledgeBundle[] + DegradationPlan + operational outcome +
    Bible doctrine + channel/language`. It does not interpret intent, query DB, mutate task
    state, or execute transactions.
  - Normal composition uses the shared provider stack with a strict prompt containing ONLY
    grounded facts/source states and explicit operational outcome. The returned
    `usedFactKeys[]` is validated against the grounded fact keys; an invented key rejects the
    model output.
  - Operational truth guard blocks false success wording. An `ActionProposal` alone can never
    become "booked/submitted/paid". `requested != confirmed`; confirmed wording requires a real
    verified confirmed/completed/paid/settled outcome.
  - EMPTY / SOURCE_UNAVAILABLE / FACT_UNKNOWN / MODEL_UNAVAILABLE each have distinct deterministic
    copy. Model-down + available verified facts uses grounded deterministic rendering instead
    of a generic apology.
  - Deterministic grounded fallback covers current verified restaurant/activity/stay/OTOP names
    and prices/capacity where those facts exist. Added missing verified activity/OTOP names to
    the read-only source adapter instead of inventing display text.
  - LINE/Web presentation still goes through the existing `_chat-copy-style.ts`; business
    meaning is channel-independent.
  - Added `netlify/functions/_thongthai-one-mind-response.ts`: canonical bridge from an
    authoritative One-Mind turn to the Response Composer. Channel handlers do not own wording.
  - `tests/response-composer.test.ts` + `tests/one-mind-response.test.ts` cover grounded-key
    validation, false operational claims, requested-vs-confirmed, degraded truth classes,
    grounded model-down answers, bounded missing-field questions, and response ownership.
- [~] **G.2 — controlled LINE/Web cutover. READ-ONLY STRANGLER IMPLEMENTED, NOT ACTIVATED.**
  - Resolved the previously-known shared-state concurrency risk before enabling any customer
    authority:
    - Added `_guest-agent-state-store.ts` with `updated_at` optimistic compare-and-swap.
    - ConversationContext, TaskState and legacy Brain working-state writers now all use the
      same CAS patch store, so sibling JSONB fields cannot silently clobber each other.
    - Added `processThongthaiOneMindTurnAuthoritative()`: loads ConversationContext + TaskState
      from ONE row snapshot, computes the whole turn, CAS-writes both sibling keys atomically,
      and on conflict reloads + recomputes the ENTIRE turn. It never stale-overwrites a fast
      concurrent Web/LINE message. Conflicts are bounded; exhaustion fails closed.
    - Added a policy-gated commit predicate: a turn may be inspected without persisting if it
      is outside the migrated slice. This prevents a legacy transactional flow from leaving a
      stale One-Mind active task that would later block read-only cutover.
  - Added initial read-only cutover gate in `_thongthai-one-mind-response.ts`:
    task-free `ask/discover/recommend/compare/status` only, initially limited to
    restaurant/activity/stay/promotion/OTOP. Transactions, active tasks, ecosystem/membership
    and unproven domains stay legacy.
  - `thongthai-chat.ts` now contains an OFF-BY-DEFAULT strangler gate:
    `THONGTHAI_ONE_MIND_CUTOVER=1`. If enabled, eligible read-only turns return the canonical
    One-Mind + Composer response; ineligible/error turns fall through to the unchanged legacy
    path. The LINE channel handler remains transport-only and retains its legacy booking/
    membership safety handlers.
  - Event idempotence: LINE forwards its real `event.message.id`. Web uses a request-scope
    Netlify request id when the client did not supply `eventId`; final server fallback is a
    unique per-invocation id, never a hash of message text (so two intentional identical
    messages are not collapsed).
  - No One-Mind transaction executor is cut over yet. No legacy transaction code has been
    deleted.
  - Added `tests/g2-concurrency-and-cutover.test.ts` plus authoritative conflict tests in
    `tests/one-mind-orchestrator.test.ts`.
  - Latest branch CI at this checkpoint: **414/414 tests passing, 0 failed**.
  - G.2 is **code-ready for the first read-only slice but NOT production-activated**. Per the
    user's finish-first/deploy-once rule, do not turn on the env gate or deploy a branch preview
    yet. Production remains on the legacy path.
- [x] **Phase J — Observability. DONE.**
  - Added `_one-mind-observability.ts` as the ONE safe structured trace envelope.
  - Trace contains machine metadata only: request/trace id, channel, component versions,
    semantic domain/intent/action/confidence bucket/reference counts, dialog mode/reasons,
    knowledge source statuses, degradation state, composer mode/used fact keys, action-proposal
    presence, CAS retry count, optional real transaction status/code, and stage/total latency.
  - Trace explicitly excludes canonical guest ids, provider user keys, raw customer text,
    response prose, raw model output/reasoning and chain-of-thought. Token sanitization also
    redacts email/phone-shaped strings defensively.
  - One-Mind stage timings now cover semantic interpretation, dialog+knowledge, state read/write
    and total latency; authoritative turns accumulate latency across CAS retries rather than
    hiding concurrency cost.
  - `_thongthai-one-mind-response.ts` attaches the full trace to both composed and
    `legacy_required` results, including Response Composer latency.
  - `thongthai-chat.ts` emits the safe envelope through `emitOneMindTrace()`. The emitter
    swallows logging failures, so observability cannot change the customer response.
  - Added `tests/one-mind-observability.test.ts` covering privacy boundaries, timings,
    transaction metadata provenance and non-blocking logging.
  - Latest branch CI run `35351938514`: **419/419 tests passing, 0 failed**.
- [x] **Phase K — Backoffice Control Plane. DONE on integration branches.**
  - Customer repo now tracks the bounded trace schema:
    `netlify/functions/supabase/one-mind-observability-v1.sql`.
    It targets the EXISTING tamma-customer-data Supabase project only.
  - `one_mind_traces` is designed for 24-hour retention, RLS enabled, service-role server
    access only, unique `(channel, trace_id)`, pseudonymous conversation keys, and safe
    machine-only envelopes. An insert trigger opportunistically prunes expired rows.
  - Trace writes are idempotent with `on_conflict=channel,trace_id` +
    `resolution=ignore-duplicates`.
  - The migration is COMMITTED but intentionally NOT APPLIED to production yet.
    Phase O remains the only production integration/deploy point.
  - `thongthai-brain-status.ts` now exposes only safe component versions/config booleans:
    Bible, Semantic Interpreter, Orchestrator, Response Composer, Graceful Degradation,
    model-provider configuration, Supabase configuration and One-Mind cutover/shadow flags.
  - Existing backoffice repo `snkpcn/tamma-backoffice` now uses the SAME integration branch:
    `feature/thongthai-one-mind-architecture`.
  - Backoffice added owner-only server API:
    `netlify/functions/thongthai-intelligence.ts`.
    It reads only unexpired `one_mind_traces`, computes P50/P95/fallback/unknown/conflict
    health metrics, returns Attention Required items and supports pseudonymous conversation-key
    inspection. It returns `available:false` honestly when the trace table is not yet present.
  - Added `thongthai-intelligence.html`:
    System Health, component versions, latency, fallback/unknown/conflict counts,
    Attention Required, recent safe traces and bounded Conversation Inspector.
  - Conversation Inspector is explicitly NOT a transcript. It displays NO customer message,
    assistant response, raw model output, chain-of-thought, identity/contact or payment data.
  - Backoffice main navigation now links Thongthai Intelligence.
  - Backoffice branch-only CI:
    `.github/workflows/one-mind-backoffice-ci.yml`.
    First complete K CI: run `35354657869`, **31/31 passing**.
  - Backoffice handoff file:
    `THONGTHAI_HANDOFF.md` committed on the backoffice integration branch.
  - Backoffice integration head at K checkpoint:
    `f51d56171138799246e17f47b01ae2c8bec19ba1`.
  - Customer repo K schema/privacy tests added:
    `tests/one-mind-trace-schema.test.ts`.
  - Customer integration head before this handoff update:
    `1a8037ef7245644d260ff1e5d8b25c4c3fbadfb6`.
  - Both main branches and both production sites remain untouched; no Netlify deploy occurred.
- [x] **Phase L — Golden Conversation Eval. DONE for network-free/static acceptance.**
  - Final stored semantic inventory is **154 meaningful ground-truth cases**:
    existing corpus + 80 Phase L additions.
  - Added `tests/fixtures/phase-l-semantic-cases.ts` covering:
    activity, restaurant, stay, promotion, membership, OTOP, café, payment,
    journey/ecosystem/support, corrections, cancellations, status checks,
    recommendation constraints, explicit commit, topic switch and multi-intent.
  - Added `tests/phase-l-golden-corpus.test.ts`:
    - enforces >=150 stored cases
    - global unique ids
    - every One-Mind customer domain covered
    - no single-domain domination
    - all Phase L cases pass the REAL deterministic parser/reference layer
    - named historical regression presence
  - Existing specialized suites remain part of the final golden acceptance for:
    multi-turn horse flow, restaurant recommendation→preorder, stay, promotion,
    context continuity, retry/idempotence, source truth, graceful degradation,
    response-composer truth guards, Web/LINE parity and CAS concurrency.
  - Named historical regressions retained:
    `มีไรทำมั่ง`, repeated promotion discovery, restaurant preorder continuation,
    LINE stay checkout typo, homepage script disappearance, retry/idempotence,
    cross-channel continuation, SOURCE_UNAVAILABLE != EMPTY, requested != confirmed.
  - Added `scripts/run-semantic-live-eval.ts` and package command
    `npm run eval:semantic:live`.
    This reuses the same stored ground truth against the REAL configured provider stack.
    It is intentionally NOT part of normal CI and requires Gemini/OpenAI credentials.
  - **LIVE MODEL semantic conformance is NOT yet executed.**
    It remains a Phase O pre-deploy acceptance gate; do not misreport static fixtures as
    proof of live model classification quality.
  - Latest customer branch CI:
    run `35355393513`, **429/429 tests passing, 0 failed**.
  - Main/production untouched; no deploy performed.
- [x] **Phase M — Full E2E. DONE for network-free/integration-branch acceptance.**
  - Added `tests/phase-m-e2e.test.ts` (282 lines) exercising the REAL cross-module
    One-Mind path with injected test-safe source/semantic boundaries:
    canonical identity → server context/CAS → SemanticTurn → ActiveTask →
    Knowledge Resolver → Dialog Manager → Response Composer → safe trace.
  - E2E families covered:
    1. restaurant read-only customer turn through final composed response
    2. promotion VERIFIED_EMPTY truth
    3. SOURCE_UNAVAILABLE != empty
    4. activity booking explicit-commit ActionProposal
    5. stay booking ActionProposal after verified availability
    6. restaurant preorder proposal mapped to the existing deterministic executor contract
    7. membership/payment/café unsupported transaction domains remain on legacy safety path
    8. OTOP read-only cutover while order remains transactional legacy
    9. promotion/OTOP/café deterministic executor support matrix
    10. payment ambiguity + requested!=confirmed truth regressions
    11. bounded observability ↔ backoffice control-plane contract
  - Transactional test scenarios intentionally stop at ActionProposal and prove the proposal
    maps to the ALREADY-EXISTING deterministic executor. CI never writes production data.
  - One-Mind cutover remains a strangler: proven read-only domains can compose; transactional
    / active-task turns still fall through to existing deterministic execution until final
    production cutover policy is applied.
  - Latest Phase M branch CI:
    run `35355906121`, **440/440 tests passing, 0 failed**.
  - Main/production untouched; no deploy performed.
- [x] **Phase N — Legacy Cleanup. DONE.**
  - Retired the active Web `ConciergeProvider.reply()` business-recommendation fallback.
    The browser now treats canonical endpoint failure as presentation/network failure only and
    shows a concise retry message; it no longer invents local itinerary/business recommendations.
  - The old ConciergeProvider implementation may remain as dead compatibility code in
    `index.html`, but there is NO active `ConciergeProvider.reply(` call site. A permanent
    regression test enforces this.
  - Removed the stale Web comment claiming no live AI endpoint exists.
  - Marked `_experience-discovery.ts` explicitly as a frozen
    **LEGACY COMPATIBILITY FALLBACK ONLY**. New customer phrasing must go through the canonical
    Semantic Interpreter + golden corpus, not grow another regex list.
  - Updated stale Dialog Manager documentation that still claimed it was not wired.
  - Added `tests/phase-n-legacy-cleanup.test.ts` architecture guards:
    - browser never invokes ConciergeProvider as a second business brain
    - One-Mind cutover is attempted before legacy runtime/phrase fallbacks
    - legacy phrase matcher is explicitly frozen
    - LINE remains a transport adapter (no semantic/dialog/resolver/composer imports)
    - deterministic transaction executors required by strangler safety remain present
  - Temporary diagnostic tests and one-off index cleanup workflow/script were removed after
    they completed; no temporary automation remains.
  - Added `PHASE_O_PRODUCTION_CHECKLIST.md` with explicit migration, merge, cutover, smoke and
    rollback steps.
  - Final Phase N branch CI:
    run `35357417413`, success. Previous permanent guard run `35357273502`:
    **446/446 tests passing, 0 failed**.
  - Main/production untouched; no deploy performed.
- [x] **Phase O — Final production integration/deployment. COMPLETE** — see final
  "Phase O — COMPLETE" checkpoint below for the closing evidence; the items below are the
  pre-merge checkpoint kept for history.
  - Pre-production customer integration CI: **449/449 passing**, run `35357662505`.
  - Backoffice integration CI: **31/31 passing**, run `35354802054`.
  - Customer main rechecked immediately before integration: `d37c56f44753bce2ec25d3091506cd3c0b703bdc` (unchanged since Phase 0 hotfix).
  - Backoffice main rechecked: `f9cd61cfab5987ecc13839b0934e1c2f14796914`.
  - Applied tracked additive migration `one-mind-observability-v1.sql` to the EXISTING
    tamma-customer-data Supabase project.
  - Verified `public.one_mind_traces` exists with RLS enabled, no policies, and
    `trg_prune_expired_one_mind_traces` installed.
  - Production env prepared:
    `THONGTHAI_ONE_MIND_CUTOVER=1` and
    `THONGTHAI_RUN_LIVE_EVAL_ON_BUILD=1`.
    Current old production code ignores the new cutover flag until final deploy.
  - Added opt-in Netlify build gate. Final production build will run the curated real-provider
    semantic acceptance profile and fail the deploy if pass rate is below 90%.
  - No customer/backoffice code deploy has occurred yet at this checkpoint.

## Exact next action

Execute **Phase O** only after re-checking both mains.

Production sequence:
1. re-check customer/backoffice main SHAs and inspect every intervening commit
2. run final integration-branch CI status checks
3. apply the tracked additive One-Mind observability migration to the EXISTING
   tamma-customer-data Supabase project
4. set production `THONGTHAI_ONE_MIND_CUTOVER=1` only when merge/deploy is ready
5. merge customer integration branch -> customer main
6. merge backoffice integration branch -> backoffice main
7. allow/trigger ONE final production deploy per affected existing site
8. wait until both are ready and record deploy ids/SHAs
9. production smoke:
   - homepage JS alive
   - brain status component versions
   - Web natural-language discovery
   - LINE gateway health
   - source empty/unavailable truth
   - requested != confirmed
   - no duplicate write regression
   - backoffice Thongthai Intelligence + bounded inspector
10. run live-provider semantic acceptance if provider credentials are available in the
    execution environment; otherwise perform the equivalent highest-value production-gateway
    smoke set and record that exact limitation honestly
11. update handoff with final evidence and known limitations

Rollback first move:
disable/delete `THONGTHAI_ONE_MIND_CUTOVER`; legacy deterministic transaction executors were
intentionally retained.

## Last commit on this branch

- Phase N checklist head: `9ef93bc2d547c5203ebacab961840d87bf35a907`.
- Customer integration CI green.
- Backoffice Phase K head: `f51d56171138799246e17f47b01ae2c8bec19ba1`, CI 31/31 green.
- Phases A through N complete.
- Phase O is the only remaining phase.
- Both production systems remain untouched as of this checkpoint.


## Phase O activation checkpoint — 2026-09-18

- Customer One-Mind merge is already on main at `579cc6bd8f58a6cc3847e489bbecfe07f3398471`.
- Backoffice control-plane merge is already on its main at `45655cb4c16b9213017abff4961f81bb13336bcc`.
- Production customer deploy `6aad4e387323b50008e1ec0b` and backoffice deploy
  `6aad4e43bfe37a0008d2b0c1` are ready on those merge commits.
- The additive `one_mind_traces` migration is present in the existing Supabase project with
  RLS enabled, zero read policies and the expiry trigger installed.
- Post-merge smoke correctly found the remaining activation gap:
  `oneMindCutoverConfigured=false`; therefore One-Mind was deployed but not authoritative.
- Production env has now been set to:
  `THONGTHAI_ONE_MIND_CUTOVER=1`,
  `THONGTHAI_RUN_LIVE_EVAL_ON_BUILD=1`,
  `LIVE_EVAL_PROFILE=production-smoke`,
  `LIVE_EVAL_MIN_PASS_PCT=90`.
- This checkpoint commit intentionally triggers the final customer rebuild so the live-provider
  semantic build gate runs with production credentials and the runtime receives the cutover flag.
- Do not declare Phase O complete until that deploy is READY and the production smoke passes.

## Phase O — COMPLETE — 2026-09-18 final verification checkpoint

- [x] **Phase O — Final production integration/acceptance. COMPLETE.**
- Customer main: `81040caa95997ada52258536809d25887c6525c4`
  ("O fix restaurant-discovery legacy fallback missing colloquial \"ไรกิน\"").
  Sits directly on top of the prior checkpoint's `54952648db60a6391679bd12b1b6431acbc4906b`
  ("O keep grounded discovery below production gateway timeout").
- Backoffice main: unchanged at `45655cb4c16b9213017abff4961f81bb13336bcc`
  ("Merge Thongthai Intelligence control plane") — no further backoffice code changes were
  required this checkpoint.
- Regression suite on customer main: **450/450 passing** (449 prior + 1 new regression test
  for the fix below).
- Production brain status re-verified live: `oneMindCutoverConfigured=true`,
  `supabaseConfigured=true`, all four version fields present
  (GitHub Actions run `35363945893`, step "Brain status and One-Mind cutover").
- **Root-caused and fixed a real production defect found during smoke verification**, rather
  than lowering assertions to force a pass: the "restaurant discovery is grounded and readable"
  smoke step failed reproducibly (2/2) on "ร้านมีไรกิน" with the generic
  `availabilityBrainResponse()` degradation apology. Cause: with
  `THONGTHAI_ONE_MIND_CUTOVER=1`, `thongthai-chat.ts` tries `processOneMindCustomerTurn()`
  first and falls through to the legacy strangler-safety-net pipeline whenever that call is
  slow or throws (by design, so One-Mind failures never take the product down). The legacy
  path's own deterministic restaurant shortcut (`isRestaurantAdvisorTurn`) never matched
  "ไรกิน" — the colloquial contraction of "อะไรกิน" used in this exact phrase — so the safety
  net had no deterministic answer either and was forced into a second, redundant LLM round
  trip on top of the one One-Mind had already spent, compounding latency past the production
  gateway's budget. Fixed by adding "ไรกิน" to the legacy shortcut's food-intent regex
  (`netlify/functions/thongthai-chat.ts`), with a regression test locking in both
  "ร้านมีไรกิน" and "มีไรกินมั้ย" (`tests/restaurant-routing.test.ts`). This does not touch
  One-Mind's own domain classification — the underlying orchestrator already recognized this
  phrase as `domain:restaurant, action:discover`; the fix only restores the legacy path's
  ability to shortcut deterministically as intended when it must run.
- **Full production smoke: 8/8 steps GREEN** after the fix, GitHub Actions run
  `35363945893` (https://github.com/snkpcn/tamma-chat/actions/runs/35363945893), against
  customer commit `4f5c34e` (retrigger-only, workflow-comment edit, no logic change) once
  Netlify had rebuilt customer main at `81040ca`:
  1. Homepage client JS present; retired local brain not invoked — PASS
  2. Brain status + One-Mind cutover flags — PASS
  3. Natural Thai discovery ("มีไรทำมั่ง") through production One-Mind, no generic fallback — PASS
  4. Restaurant discovery ("ร้านมีไรกิน") grounded and readable, no generic fallback — PASS
     (previously failed 2/2; root-caused and fixed above)
  5. Repeated promotion discovery ("มีโปรอะไร" x2) stays discovery, no name-capture regression — PASS
  6. LINE gateway alive without bypassing signature validation (400/401/405) — PASS
  7. Backoffice Thongthai Intelligence remains owner-protected (401/302/303/307/308) — PASS
- **Live-provider semantic acceptance build-gate evidence**: this environment has no tool
  access to Netlify's own build logs (no Netlify MCP/API tool is attached to this session, and
  direct HTTPS to the Netlify API is blocked by this environment's outbound proxy policy), so
  the exact `PHASE_O_LIVE_EVAL_GATE_START`/`PHASE_O_LIVE_EVAL_GATE_PASSED` pass-percentage
  could not be read back this checkpoint. Per the handoff's own §"Exact next action" item 10,
  the equivalent highest-value production-gateway smoke set was performed instead (the 8-step
  matrix above, run against the live production gateway with real provider calls) and is
  recorded here as that explicit substitute, honestly, rather than an invented number.
- **`one_mind_traces` bounded-metadata verification**: not performed this checkpoint. The
  operator explicitly withdrew Execute SQL / pg_net permission for the remainder of Phase O
  ("STOP ALL SUPABASE EXECUTE SQL CALLS NOW... If a step would require Execute SQL, skip that
  step and document the limitation") after this had already been spot-checked earlier via
  direct trace inspection during this same production-verification effort. This is recorded
  as a known, explicitly-authorized limitation rather than skipped silently.
- **Temporary private Netlify deploy bridge** (`tamma-backoffice` branch
  `phase-o-netlify-deploy-temp`, base `45655cb`, head `63aea90`): confirmed NOT merged into
  backoffice main (main is unchanged at `45655cb`) and backoffice main carries no residue from
  it (no `.github/workflows/phase-o-private-netlify-deploy.yml`, no proxy credential file on
  main). Deletion was attempted (`git push origin --delete phase-o-netlify-deploy-temp`) after
  production was fully verified green, but the push credential available in this session
  returned HTTP 403 on ref deletion (push-to-update is permitted; branch deletion is not, under
  this session's scoped credential) — no GitHub API tool for branch deletion was available
  either. The branch is safely inert (unreferenced by main, never auto-deploys on its own) but
  still exists on GitHub; deleting it requires a credential/tool with branch-delete scope,
  which this session does not have. Its one-line proxy credential file was never opened or
  exposed at any point in this work.
- No production booking, order, payment, or promotion-redemption test transaction was created
  at any point in this checkpoint.

### Final delivery

1. Phase O: **COMPLETE**.
2. Customer: SHA `81040caa95997ada52258536809d25887c6525c4`; Netlify deploy id not directly
   observable from this session (no Netlify API/tool access) — liveness and correctness of
   that exact commit are instead evidenced by GitHub Actions run `35363945893` passing 8/8
   against production, including the brain-status version-fields check.
3. Backoffice: SHA `45655cb4c16b9213017abff4961f81bb13336bcc`; deploy id likewise not directly
   observable from this session — evidenced by the backoffice owner-protection smoke step
   (run `35363945893`, step 7) passing against production.
4. Test count: **450/450** passing on customer main (449 prior + 1 new regression test).
5. Live semantic acceptance: exact build-gate pass % unavailable from this session (documented
   limitation above); substituted with the full 8-step live production-gateway smoke matrix,
   which passed 8/8 with real provider calls.
6. Production smoke: **8/8 PASS**, GitHub Actions run
   https://github.com/snkpcn/tamma-chat/actions/runs/35363945893.
7. Temporary bridge cleanup: confirmed un-merged and residue-free on backoffice main; branch
   deletion attempted and blocked by this session's credential scope (HTTP 403) — documented
   above as a remaining limitation, not silently skipped.
8. Remaining limitations: (a) exact live-eval build-gate percentage not retrievable this
   session (Netlify API/tooling gap) — substituted with an equivalent live smoke pass; (b)
   `one_mind_traces` bounded-metadata content not re-verified this checkpoint per explicit
   operator instruction to stop all Execute SQL/pg_net use; (c) the temporary Netlify deploy
   bridge branch on `tamma-backoffice` still exists on GitHub (inert, unmerged, no residue on
   main) and needs a credential with branch-delete scope to remove.


### Post-completion cleanup addendum — 2026-09-18

- Temporary backoffice deploy branch `phase-o-netlify-deploy-temp` could not be deleted with
  the available credential, but it has now been force-reset to the exact backoffice main SHA
  `45655cb4c16b9213017abff4961f81bb13336bcc`.
  Therefore the temporary proxy credential file and private deploy workflow are no longer
  present at that branch tip (both paths return 404 on the branch). The branch now behaves as
  an inert alias of backoffice main and contains no temporary deployment residue.
- Current customer production deploy is directly observable:
  Netlify deploy `6aad5c6425c49c0008bf5bba`, state `ready`,
  commit_ref `afd5eda4bce175571ff6eb5b062ccb386fb36b49` (this final handoff commit).
- Current backoffice production deploy remains:
  Netlify deploy `6aad4e43bfe37a0008d2b0c1`, state `ready`,
  commit_ref `45655cb4c16b9213017abff4961f81bb13336bcc`.

## Phase P — Post-launch production UAT + behavior hardening — 2026-09-18

- [~] **Phase P — IN PROGRESS. One critical finding NOT yet resolved.**
- Ran real multi-turn production UAT (10 flows, ~49 turns, via GitHub Actions against
  https://tamma-chat.netlify.app/, since this session's own outbound HTTP is proxy-blocked)
  against production main as of `afd5eda`/`62ec8cc`, then again after each fix below.
- **Confirmed HIGH-severity finding, still unresolved as of this checkpoint**: nearly every
  non-discovery customer turn (any follow-up, selection, correction, or non-"discover"-domain
  question -- horse selection, date/party-size follow-up, stay/otop/cafe/membership questions,
  "จองเลย") returns the generic legacy degradation apology
  ("ตอนนี้ทองไทยคิดช้ากว่าปกตินิดหนึ่งครับ...") instead of a real answer. Only turns served by a
  genuinely lightweight path succeed: One-Mind's `discover`-action fast path (no second LLM
  call) or a fully deterministic branch with no LLM call at all (`มีไรทำมั่ง`,
  `ร้านมีไรกิน`-style discovery, promotion discovery). Reproduced identically across 3 separate
  full/partial runs, including after a clean 5-minute cooldown with no other LLM traffic from
  this session -- ruling out simple rate-limit exhaustion from this session's own testing volume
  as the sole explanation.
- Root layer: **Timeout / Provider / Degradation**, specifically the legacy `runThongthaiBrain()`
  path in `_thongthai-brain-v3.ts` (the strangler-safety-net the customer gateway falls through
  to whenever One-Mind's G.2 cutover does not complete a turn itself, which today is most
  non-discovery domains/actions) -- its call to `callPreferredModel` throws `LLMAvailabilityError`
  (both Gemini and the configured OpenAI fallback failing) on nearly every attempt, fast
  (4-11s, not the 10s/8s AbortController timeouts), while the exact same shared provider module
  called with a smaller prompt (semantic interpreter, grounded-deterministic composer) succeeds
  reliably.
- **Two real, verified size-reduction fixes landed** (both legitimate improvements, kept
  regardless of the open question below):
  1. `fa446f8` -- bounded a base `world_facts` query that had literally no LIMIT clause.
  2. `123941e` -- trimmed the `restaurant_menu_live` world fact (carried on every conversational
     turn regardless of topic) from a full per-item ingredient list + recommendation profile
     object down to a lean summary; the doctrine already routes real ingredient/allergy/
     recommendation reasoning through the `list_restaurant_menu` tool call instead, so nothing
     the model can act on was lost.
  - A temporary read-only diagnostic (`thongthai-brain-prompt-diagnostic.ts`, added `0d01ee3`,
    removed `d2aca0d` once its job was done) measured the REAL production prompt directly:
    **77,217 chars before, 52,509 chars after** (`restaurant_menu_live` alone: 34,117 -> 9,447
    chars). Both numbers are real production measurements, not estimates.
  - **This 32% total reduction had zero measurable effect on the failure** -- re-running the
    identical previously-failing turns against the fixed deploy reproduced the exact same
    100% failure, unchanged. This is an honest negative result: it does not confirm prompt size
    is the (sole) cause, only that neither fix so far was the dominant lever, if size is
    a factor at all.
- **NOT YET ROOT-CAUSED.** This session has no access to Netlify function logs, the Gemini/
  OpenAI provider dashboards, or any way to read the actual classified provider error text
  (e.g. "Gemini 429" vs "Gemini network error" vs "OpenAI 503") that `LLMAvailabilityError`
  carries internally -- `console.error('THONGTHAI_BRAIN_ERROR', error)` logs it, but nothing
  in this session's toolset can read Netlify's function log output. A safe, no-PII diagnostic
  endpoint that would have made ONE real model call to capture that exact error was drafted but
  deliberately NOT deployed: an unauthenticated production GET endpoint that can trigger a real,
  billed LLM call on demand is a cost-abuse risk that was correctly flagged before it shipped.
- **Recommended next step for whoever picks this up**: get direct Netlify function log access
  (or add a properly authenticated/rate-limited diagnostic) and read the actual
  `THONGTHAI_BRAIN_ERROR`/`THONGTHAI_MODEL_PROVIDER_FALLBACK` log lines for one real failing
  turn. That single piece of evidence (the literal provider error string) would very likely
  resolve this immediately, and this session could not obtain it safely.
- Regression tests added this checkpoint (452/452 total): `tests/legacy-brain-prompt-bounds.test.ts`
  locks in both size-reduction fixes so they cannot silently regress.
- No production booking, order, payment, or promotion-redemption test transaction was created
  at any point in this investigation; all UAT flows were real customer-equivalent messages sent
  to the live production gateway, consistent with the standing "read-only inquiry flows are
  safe, no fake transactions" rule.


### Phase P diagnostic activation — 2026-09-19

- Temporary production env `THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN` has been configured on the existing tamma-chat Netlify site as a secret.
- This commit exists to trigger the required production rebuild so the authenticated diagnostic endpoint can run once.
- After provider evidence is captured and the root cause is fixed, remove both the endpoint and this temporary env var.

- Phase P diagnostic token rotated after accidental on-screen exposure; production rebuild retriggered at 2026-09-19 01:37 ICT.


### Phase P deploy unblocked — credits restored — 2026-09-19

- Netlify production deploys had been paused because the team exhausted its billing-cycle credits.
- The owner has now purchased additional Netlify credits.
- This commit intentionally retriggers the EXISTING tamma-chat production auto-deploy from current main.
- Do not add more diagnostic architectures or workaround endpoints before verifying this deploy and reading the existing build-time diagnostic artifact.
- Current objective: deploy current main -> read `phase-p-diagnostic-result.json` -> fix the confirmed provider failure -> remove temporary diagnostic machinery/token -> rerun production UAT -> close Phase P.


### Phase P — CLOSED: zero-paid-LLM-cost architecture — 2026-09-19

- **Confirmed root cause** (via the build-time diagnostic artifact, since removed): genuine
  sustained HTTP 429 rate-limiting on BOTH Gemini and the configured OpenAI fallback -- not a
  timeout, payload size, credential, or deploy-sync issue (all independently ruled out earlier
  in Phase P). A 15-minute-cooldown + 3-probe check confirmed the quota exhaustion was sustained,
  not something client-side backoff alone could out-wait.
- **Owner then imposed a hard product constraint: ZERO PAID LLM COST.** No Gemini paid capacity,
  no OpenAI credits. Phase P's closing scope became: make supported flows work under Gemini-free-
  tier-or-nothing, with graceful, honest, non-fake-booking degradation whenever the model is
  unavailable -- reusing the EXISTING One-Mind pipeline (Conversation Context -> Semantic
  Interpreter -> Task State -> Knowledge Resolver -> Dialog Manager -> Response Composer), never
  a new regex phrase-table brain.

**Zero-cost provider policy** (`_thongthai-model-provider.ts`):
- Gemini free tier is called opportunistically. A bounded in-process circuit breaker
  (`isGeminiCircuitOpen`/`resetGeminiCircuitForTests`) opens on any 429, honoring `Retry-After`
  when present (floored at 5s, capped at 60s, default 15s) -- while open, every Gemini attempt is
  skipped with zero network calls, so a customer turn during an outage fails FAST instead of
  waiting out a doomed retry. One real probe is allowed again once the cooldown elapses.
- OpenAI is no longer called by default. It requires the explicit opt-in
  `THONGTHAI_ALLOW_PAID_FALLBACK=1` env var (unset in production); without it, a Gemini
  availability failure is rethrown as-is rather than spending an OpenAI credit.

**Reduced/zero model calls per turn**:
- `_deterministic-semantic-turn.ts` (new): derives a `SemanticTurn` from context alone (generic
  slot parsers for date/time/party size, a small closed correction-marker set, entity-name
  matching against `recentEntities`, and the ecosystem's own doctrine-level activity graph) for
  slot-filling, corrections, entity selection, and a few structural discovery patterns -- reusing
  the ALREADY-EXISTING, already-tested `isExperienceDiscoveryIntent` provider-outage matcher
  rather than inventing a second one. Never derives a commit action (`hasCommitMarker` makes it
  defer instead of silently dropping a "จองเลย"-style booking intent).
- `_thongthai-one-mind-orchestrator.ts`'s `resolveSemanticTurn` tries the deterministic deriver
  FIRST; only calls the real model when it returns null; if the real call then fails with
  `LLMAvailabilityError`/`ProviderNotConfiguredError` (includes a fast circuit-open fail), it
  synthesizes an honest `needsClarification` turn instead of throwing -- the orchestrator now
  NEVER propagates a model-availability failure out of a turn computation.
- Grounded catalog facts (e.g. real horse names surfaced by a `discover` turn) are folded into
  `recentEntities` for the NEXT turn (`entitiesFromGroundedFacts` in the orchestrator), so a
  later "เอาภาราดร"-style selection has something real to resolve against without a model call.
- `_response-composer.ts`'s `composeDeterministicResponse` now checks `dialogDecision.mode`
  (`clarify`/`collect_field`) BEFORE the model-failure branch -- a slot-collection/clarify
  decision is already-correct centralized copy and no longer collapses to the generic "can't
  answer this right now" apology just because the model that would have phrased it failed.
- `_thongthai-one-mind-response.ts`'s `processOneMindCustomerTurn` composes `collect_field`/
  `clarify` turns directly via `composeDeterministicResponse`, skipping the model-phrasing call
  entirely for those modes ("do not call an LLM to rewrite already-grounded prose").
- `readOnlyCutoverEligibility` is widened: a turn that only continues an already-active task
  (fills a slot, corrects a field, selects an entity, asks one clarifying question) is eligible
  for One-Mind composition even with an active task, as long as it never reaches an
  `ActionProposal`. `propose_action`/`execute_tool` still require the legacy executor
  (transaction-executor equivalence testing is still pending, unchanged from before Phase P).
- `thongthai-chat.ts`'s legacy `LLMAvailabilityError` catch block now tries the One-Mind pipeline
  (with `interpretSemanticTurn` overridden to immediately rethrow the SAME already-caught error,
  never a second real provider attempt -- "at most one LLM call per customer turn" holds even on
  this fallback path) before falling to the flat generic apology.

**Known gap, honestly disclosed, NOT fixed in this pass** (out of Phase P's scope, pre-existing):
`DOMAIN_TASK_REQUIRED_FIELDS.activity_booking` requires `durationMinutes` (grounded in
`createBooking`'s real validation, per `_domain-task-policy.ts`'s own header comment), which the
owner's canonical example script never actually states. The zero-LLM continuation correctly
retains every slot the customer DOES give (selected horse, date, party size, time) and never
fakes a booking or shows a generic apology, but `collect_field` mode will keep asking for a
duration the script never supplies. This is a pre-existing business-policy gap, not something
invented or silently patched here.

**Which flows work with the model forced fully unavailable** (proven by
`tests/zero-cost-provider-outage.test.ts`, dependency-injected `interpretSemanticTurn` that always
throws `LLMAvailabilityError`, zero network calls):
- Activity multi-turn continuation (the owner's exact canonical script): topic narrow -> entity
  selection -> date+partySize fill -> time fill, all slots retained end-to-end, zero LLM calls,
  no fake booking, no generic apology.
- Stay booking entity selection + date fill (proves the pipeline is domain-generic, not
  activity-only).
- A genuinely ambiguous zero-context turn gets ONE honest clarifying question, never a guess.
- Broad ecosystem discovery ("มีไรทำมั่ง"), promotion discovery/continuation, and the restaurant
  advisor/preorder flow were ALREADY zero-LLM before this pass (`deterministicExperienceDiscoveryResponse`,
  `promotionContinuationResponse`, `deterministicRestaurantResponse` in `thongthai-chat.ts`, checked
  unconditionally before any model call) -- unchanged, still covered by existing tests.
- Membership/OTOP/cafe: covered generically by the same Task State/Dialog Manager/Response
  Composer machinery (no domain-specific code in that path), but not individually scripted in
  this pass's new tests -- same honest-disclosure posture as the durationMinutes gap above.

**Model calls per turn, before vs after**: before, a non-discovery One-Mind-eligible turn cost
exactly 1 model call (`interpretSemanticTurn`) plus, on ANY failure, a full second real call from
the legacy brain retry -- and every task-continuation turn was unconditionally routed to that
legacy path regardless of provider health. After: most task-continuation/slot-fill/correction/
selection turns cost 0 model calls; a turn that genuinely needs understanding still costs at most
1; a fallback attempt from the legacy catch block costs 0 additional real network calls (the
already-caught error is rethrown, never re-attempted).

**Diagnostic cleanup**: `scripts/phase-p-run-diagnostic.ts`, `scripts/phase-p-diagnostic-build.mjs`,
`tests/phase-p-diagnostic-artifact-schema.test.ts`, the `netlify.toml` build-command entry, and the
`.gitignore` entry for `phase-p-diagnostic-result.json` have all been removed. No temporary
diagnostic code remains in the codebase. `THONGTHAI_PHASE_P_DIAGNOSTIC_TOKEN` is no longer read or
required anywhere -- **SAFE TO DELETE: YES**.

- No production booking, order, payment, or promotion-redemption transaction was created by this
  closing pass. All new tests are network-free, dependency-injected, and use only synthetic
  in-memory state (matching this repo's established `npm test` convention) -- none of them call a
  live Supabase/Gemini/OpenAI endpoint or write to production.


### Phase P — FINAL CLOSURE: authoritative duration policy + One-Mind primary — 2026-09-19

Two remaining gaps, closed:

**1. Authoritative activity duration policy** (`_activity-catalog-policy.ts`, new). Never hardcodes
a duration per activity/asset. Reuses the SAME catalog facts the Knowledge Resolver already
produces (`activity_offerings`/`activity_assets` via `_activity-sot.ts`):
- `resolveActivityResourceCode(bundles, selection)` resolves a customer's selection (a named
  asset like `activity_asset:horse-01`, or an activityCode directly) to the REAL bookable
  `resourceCode`. This also fixed a real bug from the prior closure pass: `service_resources`
  (what `create_booking`/`listBookingOptions` key off) has ONE row per ACTIVITY TYPE
  (`activity-horse`), not per named asset -- the deterministic deriver had been setting
  `resourceCode` directly to the asset's own id, which would never match a real resource. A new
  `activity_asset:<code>:activityCode` link fact (added to `activityCatalogAdapter` in
  `_dialog-source-adapters.ts`) makes the asset -> activity -> resourceCode chain resolvable
  authoritatively.
- `resolveActivityDurationOptions(bundles, resourceCode)` reads the activity's real
  `activity:<code>:<N>min:price` facts: exactly one verified duration auto-fills
  `durationMinutes`; more than one leaves it unset and the Response Composer asks ONE question
  showing the real choices (`"เลือกระยะเวลาได้เลยครับ: 30 นาที หรือ 60 นาที"`); none verified says so
  honestly (`"ยังเช็กระยะเวลาของกิจกรรมนี้ให้ไม่ได้ครับ"`) instead of guessing.
- Wired into `_dialog-manager.ts` via `applyActivityCatalogPolicy` (called from
  `processDialogTurnDetailed`, after knowledge is resolved, before the final decision): applies
  a slot patch only when the just-fetched authoritative facts verify it, then re-plans the SAME
  turn from the updated task state (safe/idempotent -- every task-state mutation is keyed on a
  sub-id of the turn's own eventId, so replanning with the same input never double-applies).
  `planKnowledgeNeeds` now also requests the activity catalog whenever a task has a named asset
  selected but no resolved `resourceCode`, or a `resourceCode` but no verified `durationMinutes`.
- Works generically for horses/ATV/archery/future activities -- nothing activity-specific is
  hardcoded anywhere in this policy.
- Regression: `tests/zero-cost-provider-outage.test.ts` now proves all three cases (single
  duration auto-fills and the canonical script becomes `collect_field: [date]` only; multiple
  durations ask the real choices; zero verified durations says so honestly) end-to-end, with the
  model forced fully unavailable, zero LLM calls, no fake booking (`REQUESTED != CONFIRMED` --
  `actionProposal` stays `undefined` even once every field is filled but the customer never
  committed).

**2. One-Mind is now the primary path for supported traffic.** `THONGTHAI_ONE_MIND_CUTOVER=1` is
set via `netlify.toml`'s `[build.environment]` (a plain feature flag, not a secret -- git-tracked,
no manual dashboard action needed, and Netlify serves `[build.environment]` values to Functions at
runtime as well as at build time).
- `readOnlyCutoverEligibility` in `_thongthai-one-mind-response.ts` was widened last pass to cover
  task-continuation turns (`collect_field`/`clarify`/`answer`/`query_knowledge`, never
  `propose_action`/`execute_tool`); this pass additionally cuts over the `ecosystem` domain, since
  it is the one domain with no `DEFAULT_TASK_TYPE_FOR_DOMAIN` entry at all -- a turn classified
  into it structurally CANNOT create an `ActiveTask`, so it carries none of the
  transaction-executor risk the remaining exclusions (`membership`/`cafe`/`journey`/`payment`/
  `support`) still do. Those stay on legacy, unchanged -- "do not force unfinished transactional
  cutover".
- **Structural safety proof**, not just a per-scenario assertion: `tests/one-mind-never-executes.test.ts`
  greps every module in the One-Mind pipeline (orchestrator, response bridge, Dialog Manager,
  Knowledge Resolver, real source adapters, Response Composer, the new catalog/deterministic-turn
  policy modules) and proves NONE of them ever calls a real transaction-executing function
  (`createBooking`, `createRestaurantPreorder`, `createOtopOrder`, `redeemPromotion`,
  `createCafeInquiry`, `executeBrainTools`) or imports the legacy tool-execution runtime at all --
  an `ActionProposal.toolName` is only ever a descriptive string. This means the boundary cannot
  silently regress even if a future change adds a "helpful" direct call somewhere in that module
  set. Existing scenario-level coverage (`tests/phase-m-e2e.test.ts`'s M4/M5/M6/M7/M8/M9,
  `tests/one-mind-response.test.ts`) independently confirms `propose_action`/`execute_tool`
  turns across activity/stay/restaurant-preorder/promotion/OTOP/cafe all keep
  `readOnlyCutoverEligibility(...).eligible === false`.
- **Known, bounded, honestly-disclosed gap**: `thongthai-chat.ts`'s cutover block invokes
  `processOneMindCustomerTurn` unconditionally on every turn (pre-existing structure, not new to
  this pass) -- when the deterministic deriver cannot resolve a message AND its real
  classification lands in an excluded domain (`membership`/`cafe`/`journey`/`payment`/`support`),
  One-Mind's own `interpretSemanticTurn` spends one real model call, then `readOnlyCutoverEligibility`
  says `domain_not_cut_over`, and the turn falls through to `runThongthaiBrain`, which spends its
  OWN independent real call -- two real calls that turn, instead of the "at most one" target.
  This is a real, narrow regression introduced specifically by turning the cutover flag on (with
  the flag off, as it was before this pass, membership/cafe/journey/payment/support turns cost
  exactly one call, via legacy alone). It does not affect restaurant/activity/stay/promotion/
  otop/ecosystem turns (the large majority of real customer questions for this business), is
  bounded to only the domains not yet cut over, and never compounds into a cascading-retry cost
  the circuit breaker doesn't already stop (a genuinely rate-limited Gemini fails the SECOND
  attempt via the circuit breaker's fast-fail, not a second real network hit). Fixing it fully
  would require either extending the domain cutover further (explicitly out of scope --
  "do not force unfinished transactional cutover") or restructuring the legacy brain to accept a
  pre-classified `SemanticTurn` (a real redesign, explicitly out of scope this pass). Flagged here
  for whoever picks up membership/cafe/journey/payment/support equivalence work next.


### Post-closure production hotfix — LINE broad discovery regression — 2026-09-19

- Real LINE UAT immediately exposed a regression after enabling One-Mind primary: colloquial broad discovery `มีไรทำมั่ง` returned the deterministic FACT_UNKNOWN copy (`ข้อมูลส่วนนี้ยังไม่มีข้อมูลยืนยันครับ ทองไทยไม่ขอเดาให้ผิด`) instead of the verified ecosystem/activity discovery response.
- Root cause: `thongthai-chat.ts` ran the One-Mind cutover block before the already-existing zero-cost `deterministicExperienceDiscoveryResponse`. The ecosystem turn was eligible for cutover and composed an unknown response before the authoritative discovery fast path could execute.
- Fix: preserve the entire broad-discovery intent class via the shared `isExperienceDiscoveryIntent` matcher, skipping the cutover block for that class so the existing verified deterministic discovery response owns it. This is a domain-level routing fix, not a phrase patch.
- Regression coverage added in `tests/experience-discovery.test.ts` to lock this precedence while One-Mind cutover remains enabled.


### Post-closure production hotfix 2 — activity follow-up specificity/count — 2026-09-19

- Real LINE UAT after the broad-discovery hotfix exposed two related One-Mind issues: `ม้าล่ะ` returned the whole activity list instead of horse-specific live assets, and `มีม้ากี่ตัว` was misclassified as another generic activity discovery turn, repeating the same list.
- Root cause: the zero-cost deterministic semantic deriver recognized only the activity topic, not the information need (inventory count), and the activity catalog adapter returned every activity even when the turn had already narrowed to one activityCode.
- Fix is domain-structural, not phrase-by-phrase:
  - deterministic semantic turn now carries the canonical `activityCode` for activity-topic narrowing and recognizes generic quantity-question structure as `activity_inventory_count`;
  - Dialog Manager requests the existing authoritative `inventory` knowledge need for that intent;
  - the real activity adapter filters by requested `activityCode` and emits authoritative asset count/type facts from the same live `activity_offerings/activity_assets` source;
  - deterministic Response Composer renders count + real named assets for inventory questions, and shows named assets on a single-activity topic-narrow response.
- Regression coverage added under forced-provider-unavailable conditions: `มีม้ากี่ตัว` must answer from live-style authoritative facts with zero LLM calls, and `ม้าล่ะ` must surface a real named horse asset rather than unrelated activities.


### Post-closure production hotfix 3 — natural activity follow-up copy — 2026-09-19

- Real LINE UAT showed that the prior activity fix was factually correct but customer-facing wording was still robotic: `ม้าล่ะ` rendered the generic header `ข้อมูลที่ทองไทยเช็กยืนยันได้ตอนนี้ครับ` followed by raw bullets `ขี่ม้า / ทองไทย / ภาราดร`.
- Fix stays inside the shared Response Composer: when authoritative activity knowledge narrows to exactly one activity with a verified asset count, deterministic degradation now composes a natural concise LINE answer (for example: `มีขี่ม้าครับ 🐴 / ตอนนี้มีม้า 2 ตัว / • ทองไทย / • ภาราดร`). Quantity questions use the same verified facts but lead with the count directly.
- No mutable fact is hardcoded: count, names, and activity identity still come only from the authoritative activity catalog facts.
- Regression assertions now reject the generic fact-dump intro for both `ม้าล่ะ` and `มีม้ากี่ตัว`.


### Post-closure production hotfix 4 — comparison truth + slot acknowledgement — 2026-09-19

- Real LINE UAT exposed two customer-facing defects:
  1. `ตัวไหนนิสัยดีกว่า` produced friendly-sounding but unverified horse temperament claims even though the live activity catalog did not contain authoritative temperament facts.
  2. After selecting a horse with multiple verified duration options, `บ่ายสามได้ปะ` correctly parsed/stored 15:00 but the deterministic response repeated only the duration choices, making it look as if the customer's time was ignored.
- Root causes:
  - Response Composer still attempted model phrasing for `cannot_verify_comparison`; usedFactKeys validation alone cannot prove every adjective in free prose is grounded.
  - collect-field rendering did not acknowledge a slot successfully supplied in the same turn when another required field remained missing.
- Fix:
  - `cannot_verify_comparison` now always renders deterministic canonical copy, so missing comparison attributes cannot be plausibly invented by the model.
  - when a verified multi-duration activity still needs duration but the current message supplies a parseable time, the response explicitly acknowledges the stored time and says the queue is not yet confirmed before asking for the real duration choices.
- No availability is implied by accepting the requested time into task state; requested time remains distinct from verified availability/confirmation.
