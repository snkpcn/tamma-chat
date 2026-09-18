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
- [ ] **Phase B — Semantic Interpreter.** NOT STARTED. This is the exact next action.
  - Design target: a reusable `SemanticTurn` contract (domain/intent/action/entities/
    references/constraints/confidence/needsClarification) per the user's Phase 2 spec, NOT
    another `_experience-discovery.ts`-style hand-rolled phrase/regex matcher.
  - Must handle reference resolution as a first-class case (ตัวไหน / แล้วม้าล่ะ / สองคน /
    พรุ่งนี้ / corrections like "ไม่ใช่ หมายถึงภาราดร") — this depends on Phase C
    (conversation continuity/context) existing to have something to resolve references
    *against*, so Phase B and C are likely intertwined in practice even though listed
    separately; expect to build a minimal version of C's context object alongside B's first
    cut, then deepen C properly in its own pass.
  - Must be tested via semantic-equivalence-group assertions (classify correctly), not
    exact-string assertions — this is the acceptance gate the user set.
  - Should run *beside* existing deterministic routing at first (shadow mode / comparison in
    tests), not replace it yet — strangler discipline.
  - Three existing hand-rolled regex intent modules it will eventually make redundant (do NOT
    delete yet): `_experience-discovery.ts`, parts of `_promotion-dialog.ts`'s intent
    detection, `isRestaurantAdvisorTurn()`'s gate in `thongthai-chat.ts`. Also the LINE-layer
    regex handlers in `_operations-db.ts` (`handleLineBookingMessage`,
    `handleLineMembershipMessage`) are a later (Phase G) concern, not Phase B's.
- [ ] Phase C — Server-side Conversation Continuity. NOT STARTED.
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

Start Phase B (Semantic Interpreter). Read this file's Phase B notes above first. Do not
create a new phrase-matcher module. Design the `SemanticTurn` type, decide where it lives
(likely `netlify/functions/_semantic-interpreter.ts` or similar, LLM-backed with structured
output, validated deterministically), and write the first eval cases for the exact phrase
cluster the user specified (มีอะไรทำบ้าง / มีไรทำมั่ง / มีไรทำมั้ง / มีไรให้เล่น / etc. — one
semantic equivalence group).

## Last commit on this branch

- Commit: `e4220be` — "Phase A: Bible/Brain contract — one canonical doctrine source, actually
  consumed at runtime"
- Phase A complete, pushed. Phase B not started.
