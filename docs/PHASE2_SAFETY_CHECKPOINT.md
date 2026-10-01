# Phase 2 Safety Gauntlet Checkpoint

Updated: 2026-10-01

## CP0 — Process lock
- Work is checkpointed in repository history and PR #402.
- Public prepare rollout must remain 0% except for explicit synthetic certification windows.
- Live Agent commit must remain OFF until final certification.

## CP1 — LINE regression repair
Status: CODE COMPLETE, awaiting CI re-certification.

Repairs:
1. Compound calm-horse + rain-fallback turns reconcile structured horse evidence from domain=unknown to domain=activity without raw-text keyword routing.
2. Bounded active-task corrections (for example switching horse selection while retaining prior time) stay inside One-Mind when there is no ActionProposal and no commitment intent.
3. Dedicated regression tests added in tests/phase2-line-regression-guard.test.ts.

## CP2 — CI re-certification
Status: PENDING latest-head run.

Required gate:
- real LINE 16-turn live acceptance = 16/16
- Phase 1 live language acceptance green
- hidden holdout green
- Phase 6 live multi-turn green
- One Mind Branch CI green
- Netlify Build Command Guard green

## CP3 — Phase 2 code merge readiness
Status: BLOCKED on CP2.

## CP4 — Synthetic production window
Status: CLOSED.
- THONGTHAI_AGENT_TRANSACTION_PREPARE_GUESTS production allowlist is empty.

## CP5 — Five-vertical production gauntlet
Status: PENDING after CP2/CP3.
Required: Activity / Stay / Restaurant / OTOP / Café all complete prepare -> hold -> correction -> confirmation -> retry -> status.

## CP6 — Zero-leak verification
Status: PENDING.
Required: 0 real booking/order/inquiry success signals and no unintended business writes.

## CP7 — Cleanup
Status: PENDING final production run.
Required: clear synthetic allowlist immediately after certification.

## CP8 — Final record
Status: PENDING.
Required: record final 5/5 result, 0 leaks, final commit/deploy, and merge/close Phase 2.
