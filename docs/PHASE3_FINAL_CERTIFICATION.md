# Phase 3 Final Certification — COMPLETE

Updated: 2026-10-02

## Final status

**Phase 3 = COMPLETE.**

Phase 3 scope: Semantic Learning + Cost Efficiency.

Merged implementation:
- PR #438
- merged production SHA: `07e08e7590e29dd3efb9e6e1fce9992b3cf4d815`
- Netlify Production: READY on that SHA

Production migration applied:
- `semantic_concept_memory_expand_safe_concepts`
- Supabase migration version: `20261001154119`

## Semantic-learning architecture decision

Closed reusable concept families:
- companion
- `pace_relaxed`
- `consider_only` / `no_transaction`

The embedding/pgvector design was explicitly **not shipped** after real
calibration showed no safe separating threshold:
- same-concept and different-concept cosine ranges overlapped;
- negated phrases could score more similar than affirmative ones;
- larger embeddings and content-span-only embeddings did not repair the
  separation problem.

Therefore:
- OpenAI remains the authority for genuinely unseen cross-vocabulary meaning.
- Once a closed concept is safely confirmed, exact replay and sufficiently
  trusted near-identical variants may become zero-call.
- No synonym table, pgvector extension, embedding API, or unsafe semantic guess
  was added merely to save cost.

## Learned-memory safety

- Learned outcomes cannot emit book/order/tool/payment/price/availability.
- `consider_only` can only add `consider_only` + `no_transaction`.
- Referential consider-only reuse is allowed only when bounded canonical
  context proves one unique entity; otherwise it falls through to OpenAI.
- Multi-clause turns are excluded from learned-memory ownership.
- Family-specific privacy gates reject unknown residual/personal payload before
  any cross-customer storage write.
- Contradiction/retraction is same-family only.
- Formal stress found **0 accidental learned transactions**.

## Production database

The existing `semantic_concept_memory` table was reused; no second learning
store was introduced.

The production CHECK now allows:
- companion_partner
- companion_family
- companion_friends
- companion_solo
- pace_relaxed
- consider_only

Preflight before migration: table contained 0 rows. No business, booking,
payment, order, inventory, membership, incident, or customer-profile row was
rewritten.

Security advisor after migration showed no new migration-specific WARN/ERROR.

## Formal 20 / 50 / 100-turn stress

5 independent samples were run at each length.

20 turns:
- learned hit rate: 35%
- zero-call rate: 45%
- arbitrary fixed-call cliffs: 0
- accidental learned transactions: 0
- max synthetic conversation cost: 4.3137 THB
- conversations above 5 THB: 0

50 turns:
- learned hit rate: 35.6%
- zero-call rate: 45.6%
- arbitrary fixed-call cliffs: 0
- accidental learned transactions: 0
- conversations above 5 THB: 0

100 turns:
- learned hit rate: 35%
- zero-call rate: 45%
- arbitrary fixed-call cliffs: 0
- accidental learned transactions: 0
- conversations above 5 THB: 0

Long synthetic conversations may degrade when the monetary safety envelope is
exhausted. That is the owner hard-cap behavior, not a small fixed call-count
cliff. `maxCallsPerConversation` remains 2000.

## Real OpenAI semantic calibration

Final live calibration:
- 20 probes
- 21 real API calls
- 20 Terra primary + 1 Sol review
- input avg: 2,897.05 tokens
- input p95: 3,149
- input max: 3,371
- output avg: 174.57
- output p95: 276
- output max: 443
- max actual/estimator ratio: 0.6359
- estimator underestimates: 0
- total cost: 2.2032 THB
- avg cost/call: 0.1049 THB
- p95 cost/call: 0.1401 THB
- max cost/call: 0.3932 THB

Calibrated guard:
- semantic input reservation = 1.5x canonical conservative estimate,
  capped by the unchanged absolute ceiling;
- semantic output ceiling = 700;
- grounded-response composer stays at 900 + old absolute reservation;
- owner hard cap remains <= 5 THB.

## Current Production Saved-Agent path

Architecture changed after the original Kernel-V2 roadmap: ordinary
Web/LINE/Facebook traffic now enters the Saved Agent at 100% before the older
One-Mind semantic path.

Phase 3 therefore **does not** force learned semantic shortcuts ahead of the
Saved Agent. Doing that would make the Agent miss the skipped customer turn in
its own session context and could reduce conversation quality. The learned
concept mechanism remains a safe fallback capability rather than a forced
primary shortcut.

Real production Agent cost audit:
- 123 completed primary-Agent turns measured
- 68 active sessions after splitting >=30-minute idle gaps
- avg cost/call: 0.6446 THB
- p95 cost/call: 1.3191 THB
- p99 cost/call: 1.4502 THB
- max cost/call: 1.4644 THB
- avg active-session cost: 1.1946 THB
- p95 active-session cost: 2.0147 THB
- max active-session cost: 2.3712 THB
- max calls in one active session: 6
- sessions above 5 THB: 0

The Agent's existing 2.75-THB pre-turn reserve remains unchanged. It is
conservative, but lowering it from observational data alone would weaken the
hard 5-THB guarantee without a true provider-side worst-case bound.

## Final live gates

All passed on PR #438 final head:
- One Mind full CI
- Netlify Build Guard
- Formal Phase 3 20/50/100 cost stress
- Phase 3 real OpenAI cost calibration
- OpenAI regression acceptance
- frozen hidden open-world holdout
- Phase 6 live multi-turn semantic acceptance
- real LINE 16-turn human-conversation acceptance

Production deployed the merged SHA and is READY.

## Broad production-smoke diagnostic — carried to Phase 7

A separate one-shot broad Phase-7-style production smoke (PR #440) was run
after Phase 3 deployed. It was intentionally **not merged**.

It exposed intermittent HTTP 504s and wording/grounding variability in broader
activity/restaurant/general scenarios. It detected **no false transaction
success marker**. Phase-3-specific companion/privacy cases passed.

Those broad reliability/response issues are not hidden or reclassified as
green; they are explicitly carried forward to **Phase 7 — Brutal
Certification / Shadow Cutover**, where the broad production-smoke contract
belongs.

They do not invalidate Phase 3's semantic-learning/cost proof because the
failing cases were outside the learned-concept/cost implementation and the
Phase 3 final-head language, cost, safety, and LINE gates all passed before
merge.

## Completion decision

Phase 3 is complete because:
1. the semantic generalization question was resolved with real calibration;
2. pace + consider-only learning was implemented safely;
3. formal 20/50/100-turn cost evidence exists;
4. no arbitrary fixed-call cliff or learned transaction escalation was found;
5. the real OpenAI token/cost envelope was calibrated and guarded;
6. the current 100%-Agent production architecture was audited rather than
   ignored;
7. production DB migration and production deploy are verified.

Next roadmap phase: **Phase 4 — Human Intent / Commercial Boundary.**
