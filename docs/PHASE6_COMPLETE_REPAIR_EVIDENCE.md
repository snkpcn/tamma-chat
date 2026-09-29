# Phase 6 complete repair evidence

Verification date: 2026-09-29 UTC

Baseline: `0ade6d981c61d145d0d71a8ea3e77c62098c25d1` (merged PR #249)

Repair branch: `repair/phase6-complete-state-transaction-safety`

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
| 8 | allergy and mild spice | owner regression and `phase5-live-allergy-reset-hotfix.test.ts` |
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

## Local gates

- `npm test`: 1795/1795 passed, including the dedicated unsupported-duration
  dialog regression, both sides of the omitted prior-plan reference repair,
  and the live conditional-role alias-collision regression.
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
