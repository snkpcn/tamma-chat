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
- Production Netlify deploy: **not independently verified in this session.**
  This session's outbound network egress to `tamma-chat.netlify.app` returns
  HTTP 403 at the proxy layer (`recentRelayFailures` logs a policy-level
  `connect_rejected`, not an application error -- confirmed by a uniform 403
  across every request, including a bare unrelated probe). Per this
  environment's own operating rule for a 403/407 egress denial, this is
  reported rather than retried or routed around. A deploy ID/commit_ref for
  Phase 2 should be captured by whichever session/environment next has live
  access to that host, and this line updated then.

Open PRs observed through GitHub API before Phase 2 PR creation (not
re-verified this pass -- carried over from the prior checkpoint):

- `#213` Final perfection: eliminate remaining generic production fallbacks
- `#201` [run live] Post-merge final certification for PR #200
- `#146`, `#113`, `#87`, `#49`, `#10` remain open from older branches/checkpoints

## Current Phase

Kernel V2 Phase 2: Conversation State V2 -- **COMPLETE, merged, verified on
`main`.**

Starting Phase 3: Semantic Learning + Cost Efficiency (see below).

This is not project completion. Phases 4-7 remain after Phase 3.

## Completed Phases

- Phase 1: Single Language Brain foundation, merged in PR `#215`.
- Phase 2: Conversation State V2, merged in PR `#216`. Verified on `main` at
  `ce4ceb0cb7a359c793d837f41c40de831be5eae0` with a clean 1616/1616 suite run
  in this session.

## Current Architecture

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

- `netlify/functions/_conversation-context.ts`
- `netlify/functions/_dialog-manager.ts`
- `netlify/functions/_thongthai-one-mind-orchestrator.ts`
- `tests/dialog-manager-horse-scenario.test.ts`
- `tests/human-brain-real-line-failure-regression.test.ts`
- `tests/kernel-v2-phase2-conversation-state.test.ts`
- `THONGTHAI_KERNEL_V2_HANDOFF.md`

## Migrations

None.

No business database tables were modified. No production migration is needed. Rollback is code-only.

## Test Evidence

Focused Phase 2/regression suite:

```bash
node --import tsx --test tests/dialog-manager-cross-channel.test.ts tests/dialog-manager-shadow-comparison.test.ts tests/dialog-manager-stay-scenario.test.ts tests/kernel-v2-phase2-conversation-state.test.ts tests/human-brain-real-line-failure-regression.test.ts tests/dialog-manager-horse-scenario.test.ts tests/conversation-context.test.ts tests/final-certification-cross-domain-sequence.test.ts
```

Result: `8/8` files passed.

Full suite:

```bash
npm test
```

Result: `1616/1616` passed, `0` failed.

Note: full suite needed escalated execution because some `tsx`/`esbuild` subprocess tests create IPC pipes under `/tmp`; sandboxed execution produced EPERM false failures for those wrapper tests.

## Cost Measurements

No Phase 2 cost-policy constants changed.

Relevant existing Phase 1 cost contract remains:

- Hard monetary cap: `DEFAULT_MAX_CONVERSATION_AI_COST_USD = 0.05`
- Max paid semantic calls per turn: `1`
- Conversation call ceiling is no longer the arbitrary production IQ cliff from the old max-6 behavior.

Phase 2 tests are local deterministic/structured semantic tests and do not add paid semantic calls.

## PRs

- Phase 1 PR: `#215`, merged (squash `a8bbcb3`).
- Phase 2 PR: `#216`, merged (merge commit `ce4ceb0`, now `main` tip).

## Known Failures / Gaps

- Production deploy SHA for Phase 2 has not been independently verified from
  any session with live egress to `tamma-chat.netlify.app` since the merge.
- Phase 3 semantic learning and cost reuse are not implemented here.
- Phase 4 Human Intent / Commercial Boundary is not implemented here.
- Phase 5 incident case creation/staff routing is not implemented here.
- Phase 6 natural response brain is not implemented here.
- Phase 7 shadow cutover/certification is not implemented here.

## Next Required Step

1. Whichever session/environment has live egress to `tamma-chat.netlify.app`
   should confirm the post-#216 production deploy SHA and record it above.
2. Begin Phase 3 (Semantic Learning + Cost Efficiency) design-first audit:
   current semantic interpreter prompt size, which turns use OpenAI today,
   existing customer-phrase/intelligence-event infrastructure, existing
   guest/customer memory stores, whether existing state can host semantic
   learning without contaminating business/customer memory, current AI cost
   ledger, call caching/duplicate-event replay, and any existing
   embedding/vector capability -- before creating any new schema.
3. Implement Phase 3 incrementally behind its own PR(s), each with full
   regression + cost-stress evidence, per this file's own completion gate.

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
