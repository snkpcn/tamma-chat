# Phase 3 Final Certification Checkpoint

Updated: 2026-10-01

## Scope resolved

Phase 3 = Semantic Learning + Cost Efficiency.

Closed learning families:
- companion
- pace_relaxed
- consider_only / no_transaction

The embedding/pgvector option was explicitly rejected after real calibration:
same-concept and different-concept cosine distributions overlapped, and
negated phrases could score MORE similar than their affirmative originals.
Phase 3 therefore keeps OpenAI as the semantic authority for a genuinely
unseen cross-vocabulary phrase. Once OpenAI confirms the closed concept,
that exact exemplar (and safe near-identical variants after enough evidence)
can become zero-call. No unsafe semantic guess is introduced to save cost.

## Safety architecture

- Learned outcomes are closed and non-operational.
- Learned memory cannot emit book/order/tool/payment/price/availability.
- consider_only adds consider_only + no_transaction and may resolve a
  referential phrase only when canonical context proves one unique entity.
- Ambiguous consider-only references fall through to OpenAI.
- Multi-clause phrases are never read/written through concept memory.
- Privacy allowlists are family-specific and reject unknown residual text
  before any cross-customer storage I/O.
- Contradiction/retraction remains same-family only.
- No pgvector, embedding extension, embedding API, or second learning table.

## Production database

Migration applied successfully:
semantic_concept_memory_expand_safe_concepts
production version: 20261001154119

The existing semantic_concept_memory CHECK now allows:
companion_partner, companion_family, companion_friends, companion_solo,
pace_relaxed, consider_only.

Preflight table row count was 0; no business/customer row rewrite occurred.
Security advisor after migration showed no new migration-specific WARN/ERROR.

## Formal network-free stress

5 independent samples each at 20 / 50 / 100 customer turns.

After calibrated reservation policy:

20 turns:
- learned hit rate: 35%
- zero-call rate: 45%
- budget-blocked turns: 5 total across 5 samples
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

The synthetic cost envelope intentionally assumes uncached input and therefore
shows monetary-cap degradation on long conversations. It does NOT count those
as arbitrary IQ cliffs. The production hard cap remains authoritative.

## Real OpenAI cost calibration

Final pre-merge calibration before full live regression:
- 20 probes
- 21 API calls
- 20 Terra primary + 1 Sol review
- input avg 2,897.05 tokens
- input p95 3,149
- input max 3,371
- output avg 174.57
- output p95 276
- output max 443
- actual/estimator max ratio 0.6359
- estimator underestimates: 0
- total cost: 2.2032 THB
- avg cost/call: 0.1049 THB
- p95 cost/call: 0.1401 THB
- max cost/call: 0.3932 THB

## Calibrated cost guard

- Semantic input reservation = 1.5 x the canonical conservative estimator,
  capped by the unchanged absolute input ceiling.
- This is >2x headroom relative to the largest observed actual/estimate ratio.
- Semantic max output = 700 tokens (live max 443 on final calibration;
  earlier pre-policy max was 499).
- Grounded response composer remains at 900 and retains the old absolute
  input reservation.
- Agent cost reserve is unchanged.
- Owner hard cap remains <= 5 THB per customer conversation.
- maxCallsPerConversation remains 2000: no small fixed call-count cliff.

## Final gates still required before merge

- One Mind full CI green on final head.
- Netlify Build Guard green on final head.
- Formal Phase 3 cost stress green on final head.
- Phase 3 live cost calibration green on final head.
- Full [run live] language regression green:
  - OpenAI regression
  - hidden holdout
  - Phase 6 multi-turn
  - LINE 16-turn
- Merge PR.
- Production deploy ready at merged SHA/newer.
- Production smoke green with zero false transactions.
- Update this checkpoint to COMPLETE.
