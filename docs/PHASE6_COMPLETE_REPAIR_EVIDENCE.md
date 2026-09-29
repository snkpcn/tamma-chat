# Phase 6 complete repair evidence

Verification date: 2026-09-29 UTC (updated after post-merge production smoke)

Baseline: `a5d612d204fe5552c79e24c1bc7580b4f8aaeab0` (merged PR #250)

Repair branch: `hotfix/phase6-production-smoke-state-precedence`

This document records deterministic engineering evidence. Final PR-head CI,
merge, production deploy, production smoke, and owner-operated LINE acceptance
remain separate gates and must be reported from their actual results.

## Actual shared pipeline

Web (`thongthai-chat.ts`) and LINE (`line-webhook.ts` /
`_line-webhook-core.ts`) converge on `processThongthaiChatCore`, then use the
One-Mind response/orchestrator, semantic interpreter (including the reviewed
deterministic path), reference/conversation context, dialog manager and
canonical task state, knowledge resolver/source adapters, response composer,
transaction boundary, guest-state persistence, and One-Mind/cost telemetry.
The repair adds no second brain or state store.

## Root causes and repair status

| Class | Status at baseline | First meaning loss / unsafe authority | Repair |
|---|---|---|---|
| stale restaurant context stealing horse comparison | already repaired by #249 | semantic fallback/domain precedence | preserved and replayed through the real core |
| tentative horse selection and short continuation | partially repaired by #249 | deterministic no-transaction branch discarded same-turn slots | retain bounded date/time/headcount/duration while revoking transaction authority |
| referenced horse correction | newly found | active-task deterministic entity reference carried only an ID, not `horseName` | carry canonical name and exclusions; absent/`undefined` entity values cannot erase grounded slots |
| unsupported horse duration | newly found | dialog accepted any syntactically parsed duration and skipped catalog resolution once a value existed | validate current and persisted duration against authoritative `activity_offerings`; remove unsupported value and commitment; give verified choices |
| stale confirmation after material change | newly found | historical `commitmentIntent` stayed true after replacing an approved slot | bind authorization to material details; replacement clears commitment until a fresh explicit request |
| reset / AI-ledger boundary | newly found | reset deleted `aiCostLedger` but retained canonical and legacy temporary planning state | reset discourse/task/planning state, preserve current accounting ledger and submitted operational records |
| legacy LINE duration split-brain | newly found | legacy parser/executor hardcoded 30/60/90 while canonical catalog offers horse 30/45 | parse syntax generically, validate both LINE collection and executor against live offerings, and compute exact contiguous schedule duration |
| omitted prior-plan reference | newly exposed by final-head live LINE gate | model understood a journey edit but omitted `references[]`; the trust boundary discarded the otherwise correct meaning and asked again | recover only a concrete edit against exactly one canonical active journey task; retain clarification when another journey task competes |
| conditional primary/fallback alias collision | newly exposed by the next final-head live LINE gate | model preserved the fallback horse but copied it into both the primary and fallback slots | structurally materialize two explicitly named current-turn roles and reconcile them before composition; keep the availability turn read-only and preserve the active selection |
| compound correction dropped grounded answer | newly exposed after the conditional roles were repaired | the response bridge treated every correction as a pure state-update fast path, bypassing the availability bundle and its deterministic fallback when the paid composer was blocked by the cost ledger | use the acknowledgement fast path only when `informationNeed` is `none`; compound corrections continue through grounded composition and fail closed to the named availability renderer |
| selection promoted to booking in production | newly exposed by the read-only production smoke after #250 | the model labelled “เอาอีกตัว” as `book`; closed-field validation accepted the label and continued exposing the model's booking/slot-collection draft even after state normalization | require a current standalone transaction request for `book`/`order`; preserve the choice as planning state and discard any now-incoherent transaction draft |
| explicit food topic stolen by stale horse task | newly exposed by the read-only production smoke after #250 | deterministic topic switching required restaurant phrasing containing “ร้าน”, so “ขอถามเรื่องอาหารก่อน” fell back to the old activity referent | recognize explicit topic-navigation structure plus the canonical restaurant category and suspend, rather than erase, the horse task |
| remembered dietary safety ignored by fluent composer | newly exposed by the read-only production smoke after #250 | memory retained the shrimp allergy, but the paid response composer remained authoritative and could omit remembered food-safety constraints | route allergy/spice-constrained restaurant turns through the centralized grounded menu renderer before model composition |
| mild-spice phrasing was not durable | newly exposed by the end-to-end regression for the production sequence | the restaurant advisor parsed “กินเผ็ดไม่เก่ง”, but the canonical preference-capture boundary did not persist the same meaning | store `mild_spice` in the existing customer constraint memory and remove it on an explicit later correction |
| resume wording falsely implied booking | newly exposed by the read-only production smoke after #250 | task-subject copy inferred “กำลังช่วยจอง” from task type alone | booking wording now also requires current `commitmentIntent`; planning tasks say only that the topic is being discussed |
| spaced availability-only question lost its need | newly exposed by the read-only production smoke after #250 | the narrow marker missed “เช็กว่างเฉย ๆ ได้ไหม” and the detected side-question omitted `informationNeed=availability` | broaden the structural availability form and carry the availability facet into knowledge routing while preserving `no_transaction` |
| duplicate activity writes | already repaired before this branch | retry after a successful write | preserved executor duplicate check and replayed it with catalog validation enabled |

## Requirement-to-evidence matrix

| # | Required coverage | Evidence |
|---:|---|---|
| 1 | fresh conversation | `phase5-live-allergy-reset-hotfix.test.ts`, canonical core harness |
| 2 | long-lived stale restaurant state | `owner-live-line-249-regression.test.ts` |
| 3 | two-horse comparison | owner regression plus `deterministic-semantic-turn.test.ts` |
| 4 | reject one / resolve the other | `activity-16-turn-canonical-state.test.ts`, deterministic semantic regressions |
| 5 | tentative selection without booking | owner regression asserts state and zero booking writes |
| 6 | short duration continuation | owner regression asserts activity state, not restaurant fallback |
| 7 | unsupported duration | `phase6-unsupported-duration-dialog-regression.test.ts` and executor rejection in `create-booking-retry-idempotency.test.ts` |
| 8 | allergy and mild spice | owner regression now replays both as separate turns, asserts a grounded safe menu response, and proves both durable constraints are applied |
| 9 | topic switch and return | owner regression and 16-turn canonical state test |
| 10 | bounded clarification / short answer | `phase5-live-allergy-reset-hotfix.test.ts`, `conversation-coverage-hardening.test.ts`, and the omitted-reference regression (one active journey resumes; two competing journey tasks still clarify) |
| 11 | grounded summary | owner regression and Phase 6 final transaction-safety suite |
| 12 | old consent revoked by current negation | `phase6-final-transaction-safety.test.ts` |
| 13 | later slot fill cannot transact | same suite; final response, commitment state and action proposal asserted |
| 14 | fresh commitment can re-arm | same suite and canonical 16-turn proposal boundary |
| 15 | reset with confirmed record | `phase5-live-allergy-reset-hotfix.test.ts` preserves submitted session/booking code and asserts zero booking writes |
| 16 | provider outage / budget exhaustion | `human-conversation-phase6-multiturn-e2e-acceptance.test.ts`, `thongthai-ai-cost-guard.test.ts`, `cost-guard-true-zero-cost.test.ts` |
| 17 | Web/LINE parity | `web-line-channel-equivalence.test.ts` |
| 18 | unrelated active-task price lookup | `pedal-boat-price-hotfix.test.ts` |
| 19 | ledger/session/notifier preservation | reset regression plus AI cost ledger/notifier suites |
| 20 | duplicate delivery idempotency | `create-booking-retry-idempotency.test.ts` and LINE webhook idempotency suites |

## Before/after proof

An isolated test against baseline `0ade6d9` demonstrated that an explicit
60-minute horse request remained persisted as `durationMinutes: 60` even when
the injected authoritative catalog contained only 30 and 45 minutes. The same
assertion passes on this branch: no action proposal, duration removed,
commitment false, and reason `activity_duration_rejected`. The executor-level
test independently proves rejection occurs before any POST to `bookings`.

The production-smoke regression also scripts the real model failure observed
after #250: a non-transactional “เอาอีกตัว” is returned as `action=book` with
booking-style copy. Before the repair, the real core exposed that copy. After
the repair, the same model output is normalized to a non-transactional
selection, its unsafe draft is discarded, the following unsupported 60-minute
slot is removed against the 30/45 catalog, and no `bookings` POST occurs.

## Local gates

- Full Node test suite: 1799/1799 passed, including the production-smoke-shaped
  core regression with deliberately unsafe model output, final response,
  persisted state, catalog rejection, remembered allergy/spice constraints,
  suspend/resume wording, availability routing, and zero booking writes.
- Exact Netlify build command completed locally. Phase-O live and semantic
  certification correctly reported skipped because the local invocation was
  not a configured CI/live context; this is not counted as a live PASS.
- Diff hash before and after the exact build command was identical.
- `git diff --check`: passed.

## Transaction write boundaries

Planning state and telemetry writes are allowed and tested separately from
business transactions. Negative flows assert no booking/allocation creation.
Reset only cancels an unfinished adapter session; it does not modify bookings,
allocations, inventory, payments, notifications, or submitted sessions. A
duration is validated again inside `createBooking`, so a model/dialog defect
cannot cross the final executor boundary.

## Production checkpoint that triggered this hotfix

PR #250 was tested at `1cd8b4c384d2d41b14df900395093fdaa612f79d`,
merged as `a5d612d204fe5552c79e24c1bc7580b4f8aaeab0`, and deployed by Netlify as
`6abc19385dfc3e00086f96ed` with an exact commit match. A unique, read-only
16-turn request sequence against that production commit exposed the six rows
above. That run created no transaction, but it is recorded as a failed
acceptance checkpoint, not as proof of completion. This hotfix must pass final
head CI, merge, deploy with an exact commit match, and pass the same controlled
production smoke before engineering verification can be declared complete.
