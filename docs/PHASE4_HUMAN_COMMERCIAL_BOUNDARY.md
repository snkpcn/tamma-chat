# Phase 4 — Human Intent / Commercial Boundary Checkpoint

Updated: 2026-10-02

## Goal

One human-intent contract must separate:
- CHAT
- ASK
- DISCOVER
- CONSIDER
- COMMIT
- INCIDENT

from the commercial boundary that decides whether the CURRENT turn may enter
transaction preparation/execution.

## Non-negotiable rule

Only a current-turn explicit COMMIT may cross the commercial boundary.

The following are never fresh transaction consent:
- asking how/if booking or ordering works;
- availability/price/status questions containing commercial verbs;
- bare "ยืนยัน" without a transaction object;
- selecting an option / accepting it for consideration;
- "ไว้ก่อน" / "ยังไม่จอง" / "ยังไม่สั่ง";
- resuming an unfinished booking conversation;
- correcting a slot;
- cancelling/abandoning working state;
- complaint / incident / safety help.

## Shared implementation

New module:
`netlify/functions/_commercial-intent-boundary.ts`

It exposes:
- raw pre-Agent boundary classification;
- semantic boundary classification from the existing SemanticMeaning contract;
- a single semantic commit-authorization predicate.

Production routing now distinguishes:
1. explicit commercial COMMIT;
2. prepare-supported COMMIT;
3. boundary-sensitive non-commit language that must reach One-Mind before the
   100% read-only Saved Agent.

This closes the prior split where raw "ยืนยัน" / business-topic markers could
be treated as transaction intent before the richer semantic/dialog contract.

## Safety ordering

Same-turn latest explicit signal remains authoritative:
- "จองเลย ... ยังไม่จอง" => WITHHOLD
- "ยังไม่จอง ... จองเลย" => COMMIT

Questions are checked before legacy commit-marker compatibility:
- "ยืนยันการจองต้องทำยังไง" => READ_ONLY
- "จองได้ไหม" => READ_ONLY

Cafe staff handoff remains an explicit prepare-capable operational request,
including polite "...ได้ไหม" phrasing.

Promotion redemption may be COMMIT but is not Agent prepare-eligible; it keeps
its existing executor boundary.

## Completion gates

1. Full One Mind CI green.
2. Netlify Build Guard green.
3. Existing Phase 4 transaction-safety acceptance green.
4. Existing frozen hidden transaction holdout green.
5. New raw + semantic commercial-boundary matrix green.
6. Real OpenAI human-intent matrix across ASK/DISCOVER/CONSIDER/COMMIT/
   INCIDENT green.
7. Real production read-only/consider/withhold proof shows no false
   transaction-success signal and correct One-Mind ownership for
   boundary-sensitive language.
8. Final production deploy READY and evidence recorded.

No schema migration is planned for Phase 4.


## Live certification trigger

PR title carries `[run phase4 live]`. This checkpoint commit intentionally
re-triggers CI so the real OpenAI human-intent matrix runs on the same final
Phase 4 head after all static contracts are already green.


## Final full-live gate trigger

After Phase 4's own 16/16 real OpenAI matrix passed with 0 false COMMIT and
0 missed COMMIT, this checkpoint re-triggers the repository's full live
language suite under `[run live]`, including the real LINE 16-turn human
conversation acceptance, on the same final Phase 4 implementation.


## Final Production certification — COMPLETE

Phase 4 implementation merged through PR #449.

Final live semantic gate on PR #449:
- 16 / 16 real OpenAI human-intent probes PASS
- false COMMIT on non-commit human intent: 0
- missed explicit COMMIT: 0

The same final Phase 4 head also passed the full live language suite:
- real OpenAI regression acceptance
- frozen hidden open-world holdout
- Phase 6 live multi-turn semantic acceptance
- real LINE 16-turn human-conversation acceptance

### Real Production commercial-boundary proof

Certification-only PR #464 exercised the deployed customer endpoint with:
- booking ability question
- confirmation/how-to question
- ordering/how-to question
- selection + explicit no-booking
- resume + explicit no-booking
- bare confirmation
- earlier commit revoked by later "ยังไม่จอง"
- cancellation of working state

Result:
- 8 / 8 HTTP customer turns PASS
- false transaction-success signals: 0
- generic fallback responses: 0

Production response/cost evidence:
- none of the 8 events used `thongthai_agent_primary`
- none used `agent_primary_turn_aggregate`
- boundary-sensitive turns instead used the semantic-interpreter / One-Mind
  path (and grounded composition where facts were required)

Observed examples:
- "จองได้ไหมครับ" -> explains that asking/choosing does not create a real
  transaction
- "เอาภาราดรครับ ยังไม่จองนะ" -> keeps ภาราดร as a selection but explicitly
  says no booking is performed
- "กลับไปเรื่องจองต่อครับ แต่ยังไม่จองนะ" -> resumes the topic while keeping
  no-booking state
- "จองเลยครับ ... ยังไม่จอง" -> latest revoke wins
- bare "ยืนยันครับ" -> asks what is meant instead of treating it as commercial
  authorization

Database check for the synthetic certification guests:
- bookings: 0
- OTOP orders: 0
- committed café inquiry sessions: 0

Production safety configuration during certification:
- public prepare rollout: 0%
- synthetic prepare allowlist: empty
- live transaction: OFF

### Final Production state

Production remained READY on current main after Phase 4 merged. A later
five-language public-page deployment advanced the production SHA without
removing the Phase 4 runtime changes; the commercial-boundary module and
routing integration remain present on current main.

## Completion decision

**Phase 4 = COMPLETE.**

Phase 4 is complete because:
1. one shared commercial-boundary contract now exists for raw pre-Agent and
   structured semantic decisions;
2. only current-turn COMMIT can authorize commercial transition;
3. ASK / DISCOVER / CONSIDER / WITHHOLD / MANAGE / INCIDENT stay outside the
   transaction boundary;
4. commercial questions containing "จอง/สั่ง/ยืนยัน" are not treated as
   consent;
5. latest same-turn revoke/recommit ordering is preserved;
6. selection/resume/bare-confirm/correction/cancellation do not become fresh
   transaction consent;
7. Production Agent 100% rollout no longer swallows boundary-sensitive
   non-commit language before semantic reasoning;
8. live OpenAI human-intent matrix passed 16/16 with 0 false and 0 missed
   COMMIT;
9. full live language + LINE acceptance stayed green;
10. real Production proof passed 8/8 with 0 false transaction signals and
    zero business transaction rows for the certification guests.

Next roadmap phase: **Phase 5 — Business + Incident Router.**
