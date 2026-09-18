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
- [ ] Phase E — Knowledge Resolver / Source-of-Truth graph. NOT STARTED. (Note: audit found
  `world_facts` is a small 27-row policy/config table, NOT the live business database — live
  menu/activity/promotion/room data lives in dedicated domain tables/views. The resolver must
  route by domain to those, not force everything through `world_facts`.)
- [ ] Phase F — Universal Dialog Manager. NOT STARTED.
- [ ] Phase G — Migrate channel intelligence to central Brain (LINE booking/membership
  handlers, web ConciergeProvider demotion). NOT STARTED.
- [ ] Phase H — Graceful degradation. NOT STARTED. (Note: promo + experience-discovery already
  have deterministic LLM-down fallbacks; everything else still hits the generic apology.)
- [ ] Phase I — Response composer. NOT STARTED.
- [ ] Phase J — Observability (trace object, no chain-of-thought). NOT STARTED.
- [ ] Phase K — Backoffice Control Plane (tamma-backoffice: health/diagnostics view +
  Conversation Inspector). NOT STARTED. (Note: audit found tamma-backoffice is explicitly
  built around "no raw chat storage" — README + in-app copy. Conversation Inspector must be a
  deliberately bounded/expiring diagnostic view, not permanent transcript storage. This needs
  explicit design, not a silent reversal of that stance.)
- [ ] Phase L — Golden conversation eval (150+ cases). NOT STARTED as a suite, but the user
  said start the corpus now / grow it every phase — Phase B should add its first real cases
  when it lands, not wait.
- [ ] Phase M — Full E2E. NOT STARTED.
- [ ] Phase N — Legacy cleanup (retire superseded regex modules only after equivalent
  golden/E2E tests pass). NOT STARTED.
- [ ] Phase O — Final production deployment (one merge, one deploy, after full integration
  review). NOT STARTED.

## Exact next action

Start Phase E (Knowledge Resolver / Source-of-Truth graph). Read this file's Phase D bullet
above first, then re-read the Phase E note already recorded further down this file: `world_facts`
is a small ~27-row policy/config table, NOT the live business database — live menu/activity/
promotion/room data lives in dedicated domain tables/views (`activity_offerings`,
`activity_assets`, restaurant menu tables, `promotions`/`promotion_items`, etc., the same ones
`loadBrainRuntime`/`loadActivityWorldFacts`/`loadRestaurantWorldFacts`/
`loadActivePromotionsWorldFact` already read in `_thongthai-runtime-v3.ts`). The resolver's job
is to decide, per domain/question, WHICH of these existing sources is authoritative and route to
it — not to force everything through `world_facts`, and not to invent a new unified facts table.

**Known gaps carried forward, explicitly not closed yet (by design, not oversight — do not let
either get lost)**:
1. `_conversation-context.ts` (Phase C) and `_task-state.ts` (Phase D) both exist and are fully
   tested, but neither is wired into `thongthai-chat.ts`'s request handling or
   `_line-webhook-core.ts`'s `askThongthai()` yet. LINE still sends `chatHistory: []` in
   production today. Wiring both in for real (including finally fixing that) is a Phase F/G
   concern — the Dialog Manager needs to exist to decide what to DO with a `SemanticTurn`
   merged against an `ActiveTask`, and wiring either module in half-finished risks exactly the
   "partial change to production routing" the review has repeatedly warned about.
2. Phase D's `ActiveTask` required-fields are supplied by the CALLER (`requiredFields` param) —
   the core deliberately does not hardcode per-domain business rules. Phase E/F's Knowledge
   Resolver / deterministic domain layer is where the REAL required-fields-per-domain rule
   should be authored once and then passed into `_task-state.ts`'s functions; Phase D's own
   tests only supply an illustrative `requiredFields` list for the horse-booking scenario,
   clearly commented as test-local, not authoritative.

## Last commit on this branch

- Commit: `d4896e6` — "Phase D: Working/Task State + memory-ownership boundaries"
- Phases A, B, B.1, C, D complete, pushed. Phase E not started.
