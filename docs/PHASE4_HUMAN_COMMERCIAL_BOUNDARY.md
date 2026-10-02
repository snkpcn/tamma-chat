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
