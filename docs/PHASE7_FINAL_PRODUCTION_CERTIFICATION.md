# Phase 7 — Final Production Certification

Status: **CERTIFICATION IN PROGRESS**

Base production checkpoint:
`1676477676320f1c127eb75c9244800cf9c3022f`

Production deploy at certification start:
`6abf55be5638c20009f9e055`

Verified before certification:

- Netlify state: **READY**
- context: **production**
- branch: **main**
- deploy `commit_ref` matches the base production checkpoint exactly
- deploy validation: **ready**
- secret scan matches: **0**
- `THONGTHAI_AGENT_LIVE_TRANSACTION_ENABLED=0`
- `THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT=0`
- transaction prepare guest allowlist is empty

## Objective

Phase 7 is the final roadmap gate. It does not add a new business feature.
It certifies the complete Human Core on the real deployed customer gateway,
in one connected multi-turn conversation, after Phases 1–6.2 are already
closed.

## Production conversation

The canonical certification contract is defined in:

- `scripts/phase7-production-certification-contract.ts`
- `scripts/run-phase7-production-certification.ts`

It runs one synthetic production guest through **16 sequential turns**:

1. reset prior conversation context;
2. shrimp-allergy restaurant recommendation;
3. mild-spice constraint;
4. list the two verified horses;
5. compare horse characteristics;
6. reject Thongthai and resolve to Pharadon;
7. hold Pharadon without booking;
8. reject unsupported 60-minute duration and offer verified durations;
9. hold 45 minutes without booking;
10. explicitly switch to restaurant;
11. recommend food while preserving allergy + spice constraints;
12. return to the horse task and recover Pharadon + 45 minutes;
13. summarize cross-domain state without inventing stay/multi-day facts;
14. check availability only, while remaining explicitly unbooked;
15. change the held horse to Thongthai without booking;
16. confirm the final state still has no booking.

## What Phase 7 certifies

- current intent outranks stale context;
- conversation reset actually clears temporary routing state;
- durable dietary constraints survive topic changes;
- entity/reference continuity survives side topics;
- correction changes only the intended selection;
- task state survives Activity -> Restaurant -> Activity transitions;
- unsupported activity duration is rejected from verified catalog truth;
- cross-domain summary uses only real customer state;
- availability questions do not become booking consent;
- requested/considered selections remain distinct from completed transactions;
- no generic provider/fallback failure appears in an understandable turn;
- no false booking success wording appears;
- public response intent never becomes `booking` in this read-only certification.

## Required gates

Phase 7 closes only when all of the following are true:

- Phase 7 production conversation: **16 / 16 PASS**
- false transactions detected: **0**
- full repository CI: **PASS**
- Netlify Build Guard: **PASS**
- Phase 3 cost stress: **PASS**
- deploy preview: **PASS**
- synthetic production guest is checked read-only in Supabase;
- bookings / cafe inquiries / OTOP orders / OTOP sessions / payment requests are all **0** for that guest;
- production transaction flags remain OFF / 0%;
- final closeout evidence is merged into `main`;
- Netlify production becomes READY at the exact closeout commit.

## Completion decision

Pending certification.
