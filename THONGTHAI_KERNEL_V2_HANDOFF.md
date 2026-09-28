# Thongthai Kernel V2 Handoff

Updated: 2026-09-28 16:18 Asia/Bangkok

## Current State

- Repo: `snkpcn/tamma-chat`
- Local branch: `kernel-v2/phase2-conversation-state-v2`
- Current remote `main` SHA verified through GitHub API: `59aba3a971191ed702fc3c7e6aca1f198fd3c66d`
- Current production Netlify deploy ID: `6aba2cb31f169b0009a18435`
- Current production Netlify commit_ref: `59aba3a971191ed702fc3c7e6aca1f198fd3c66d`
- Production URL: https://tamma-chat.netlify.app
- Phase 1 PR: `#215`, merged
- Phase 1 squash merge commit: `a8bbcb3ad620fd8c9a88e02cb820b40df14ab092`
- Phase 1 handoff finalization commit on `main`: `59aba3a971191ed702fc3c7e6aca1f198fd3c66d`

Open PRs observed through GitHub API before Phase 2 PR creation:

- `#213` Final perfection: eliminate remaining generic production fallbacks
- `#201` [run live] Post-merge final certification for PR #200
- `#146`, `#113`, `#87`, `#49`, `#10` remain open from older branches/checkpoints

## Current Phase

Kernel V2 Phase 2: Conversation State V2.

Phase 2 implementation is pushed in PR `#216` and fully tested locally. CI/merge are pending in this handoff checkpoint.

This is not project completion. Phases 3-7 remain.

## Completed Phases

- Phase 1: Single Language Brain foundation, merged in PR `#215`.
- Phase 2: Conversation State V2, pushed in PR `#216` from `kernel-v2/phase2-conversation-state-v2`, pending CI/merge.

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

- Phase 1 PR: `#215`, merged.
- Phase 2 PR: `#216`, open.
- Phase 2 PR head SHA: `257995f4dd37e61acb594c7408848abe45bfcd46`

## Known Failures / Gaps

- Phase 2 PR `#216` is open but not yet merged.
- No production deploy has been made for Phase 2.
- Phase 3 semantic learning and cost reuse are not implemented here.
- Phase 5 incident case creation/staff routing is not implemented here.
- Phase 6 natural response brain is not implemented here.
- Phase 7 shadow cutover/certification is not implemented here.

## Next Required Step

1. Let PR `#216` CI run and verify green.
2. Review full diff carefully.
3. Merge only if green.
4. Verify remote `main`.
5. Verify Netlify production deploy SHA after merge.
6. Update this handoff again with merge commit, production deploy, and final Phase 2 status.
7. Continue to Phase 3 if session capacity remains.

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
