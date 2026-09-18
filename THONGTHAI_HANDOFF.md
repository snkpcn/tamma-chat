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
- [ ] Phase D — Working/Task State + Memory boundaries. NOT STARTED. (Note: audit found the
  *existing* memory architecture — guest_memory / guest_semantic_memory / guest_agent_state /
  operational tables — already maps cleanly onto the brief's 4-layer model. This phase is
  likely more "formalize and connect to the new Dialog Manager" than "build from scratch.")
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

Start Phase C (server-side conversation continuity). Read `THONGTHAI_HANDOFF.md`'s Phase C
bullet above first, and re-read `_semantic-interpreter.ts`'s `SemanticContext`/
`SemanticContextEntity` types before designing anything new — Phase C's real persistence
layer needs to produce exactly that shape (or a compatible one) so Phase B's interpreter can
consume it without a rewrite. Concretely:
- Design where bounded/expiring conversation context actually lives (likely extending
  `guest_agent_state` rather than a new table — audit found the existing memory architecture
  already maps cleanly onto this need; check before adding a new table).
- Must NOT create permanent raw-transcript storage — tamma-backoffice's product philosophy is
  explicitly "no raw chat storage" (see Phase K notes below); design short retention +
  automatic expiration/redaction from the start, not as a later patch.
- LINE currently sends `chatHistory: []` on every turn (`_line-webhook-core.ts`'s
  `askThongthai()`) — this is the concrete bug Phase C fixes. Web already sends real
  `chatHistory`/`guestContext`/`journeyContext` from `JourneyProvider`; the server becoming
  authoritative means thongthai-chat loads its own bounded context by canonical guest identity
  rather than trusting only what the channel provides.
- Needs: recent bounded turns, rolling summary, current topic, active entities/referents
  (feeds `SemanticContext.recentEntities`), unresolved need, current task id/state (Phase F
  precursor), last recommendation, last tool result status.
- Still strangler discipline: build this beside existing state, don't wire it into
  `thongthai-chat.ts`'s actual request handling yet unless doing so is low-risk and additive
  (e.g., LINE finally loading real context non-destructively could plausibly land in Phase C
  itself if it's a clean addition — use judgment, but do not remove/change existing
  deterministic routing behavior while doing it).

## Last commit on this branch

- Commit: `ba0edb4` — "Phase B.1: extract neutral provider module, dedupe ecosystem
  vocabulary, precise eval claims"
- Phases A, B, B.1 complete, pushed. Phase C not started.
