# Thongthai Kernel V2 Handoff

Updated: 2026-09-28 15:47 Asia/Bangkok

## Current State

- Repo: `snkpcn/tamma-chat`
- Branch: `kernel-v2/phase1-single-language-brain`
- Base main SHA before Phase 1: `74fda2b41cba900e8e30eefc37f63a1fe73da263`
- Phase 1 implementation commit: `3c87cdf6edf6f26f00ad6c2833be0c48df54f9bc`
- Handoff update commit: see branch HEAD after committing this file
- Production URL: https://tamma-chat.netlify.app
- Production public status: reachable; reports `semantic-v30`, `one-mind-g1-v1`, `response-composer-v1`
- Production deploy SHA: not exposed by public headers/status endpoint in this session

Open PRs observed through GitHub API before this branch:
- `#213` Final perfection: eliminate remaining generic production fallbacks, head `fix/final-grounded-fallback-gaps@8248dc6`, base `main@74fda2b`
- `#201` Post-merge final certification for PR #200, head `ops/post-merge-final-cert-200@0f95914`, stale base `92843d7`
- `#146`, `#113`, `#87`, `#49`, `#10` remain open from older branches/checkpoints

## Current Phase

Kernel V2 Phase 1: Single Language Brain foundation.

This is not project completion. Phases 2-7 remain.

## Completed In This Checkpoint

- Added `SemanticMeaning.conversationalMode` as a closed contract:
  - `CHAT`
  - `ASK`
  - `DISCOVER`
  - `CONSIDER`
  - `COMMIT`
  - `INCIDENT`
- Updated One-Mind response eligibility to use the closed conversational mode for non-executing turns.
- Preserved transaction safety:
  - `ActionProposal` still blocks One-Mind response cutover and stays on existing transaction executor path.
  - Explicit commit that is only collecting fields can still persist canonical working task state.
- Fixed preference/context-only turns so they do not open booking/preorder task state merely because they contain party size or constraints.
  - Example protected: `มากับแฟนสองคน ไม่อยากทำอะไรเหนื่อยมาก`
  - Budget planning remains allowed as bounded planning state, preserving existing restaurant planning tests.
- Raised default `THONGTHAI_MAX_AI_CALLS_PER_CONVERSATION` reviewed ceiling from `6` to `256`.
  - Hard monetary cap remains `<= 0.05 USD` per conversation.
  - Per-turn cap remains `1` paid semantic call.
  - This removes the arbitrary 6-call intelligence cliff without increasing the money ceiling.

## Files Changed

- `netlify/functions/_semantic-meaning.ts`
- `netlify/functions/_thongthai-one-mind-response.ts`
- `netlify/functions/_dialog-manager.ts`
- `netlify/functions/_ai-cost-policy.ts`
- `tests/semantic-meaning.test.ts`
- `tests/thongthai-ai-cost-guard.test.ts`
- `tests/human-brain-real-line-failure-regression.test.ts`
- `THONGTHAI_KERNEL_V2_HANDOFF.md`

## Migrations

None.

No business database tables were modified.

## Test Evidence

Focused tests:

```bash
node --import tsx --test tests/semantic-meaning.test.ts tests/thongthai-ai-cost-guard.test.ts tests/human-brain-real-line-failure-regression.test.ts
```

Result: passed.

Full suite:

```bash
npm test
```

Result: `1615/1615` passed, `0` failed.

Note: full suite needed escalated execution because `tests/model-provider-no-cycle.test.ts` spawns `npx esbuild`; sandboxed execution produced `spawnSync npx EPERM`.

## Cost Measurements

- Policy hard cap remains `DEFAULT_MAX_CONVERSATION_AI_COST_USD = 0.05`.
- `DEFAULT_MAX_AI_CALLS_PER_TURN = 1`.
- `DEFAULT_MAX_AI_CALLS_PER_CONVERSATION = 256`.
- Cost guard tests verify long 20/50/100-turn simulations remain under the monetary cap.

## Known Failures / Gaps

- Production deploy SHA could not be verified from public endpoint/headers.
- No production deploy or production smoke was performed in this checkpoint.
- Phase 1 does not implement semantic learning memory; that belongs to Phase 3.
- Incident routing/backoffice case creation is not completed here; Phase 1 only preserves INCIDENT as authoritative conversation meaning and prevents legacy transaction routing.

## Next Required Step

1. Push branch `kernel-v2/phase1-single-language-brain`.
2. Open Phase 1 PR against `main`.
3. Review diff and CI.
4. Merge only if green.
5. Verify `main`.
6. Continue to Phase 2: Conversation State V2.

## Commands To Rerun

```bash
git status --short --branch
node --import tsx --test tests/semantic-meaning.test.ts tests/thongthai-ai-cost-guard.test.ts tests/human-brain-real-line-failure-regression.test.ts
npm test
```

## Rollback Notes

Rollback is code-only:

- Revert the Phase 1 commit.
- No migration rollback is needed.
- No production DB cleanup is needed.
