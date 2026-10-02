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

## Current Production routing after final Phase 3 bridge

Production Saved Agent remains at 100% rollout on WEB / LINE / Facebook.

Phase 3 does **not** disable or roll back that Agent rollout. Instead, one
narrow pre-Agent bridge now exists for the three CLOSED semantic-learning
families only:

- companion
- relaxed pace
- consider-only / no-transaction

The bridge is routing-only. Raw marker text never decides the meaning. A short
standalone candidate is sent to One-Mind first, where either:

1. trusted semantic_concept_memory owns the turn at zero paid-call; or
2. the real semantic supervisor pays once, confirms a closed concept, and may
   write one safe exemplar.

Mixed / multi-clause transaction language, weather, location, and ordinary
business turns remain on their existing routes.

The learned-source cutover gate is additionally constrained so it can never
own:
- transaction_request
- book / order / cancel
- any turn with ActionProposal
- unresolved consider-only references

A learned consider-only confirm requires both:
- explicit no-transaction constraint; and
- exactly one resolved prior entity.

## Final real Production learning proof

Production deployed the final runtime line through:
- PR #445 — production low-exertion canonical mapping
- PR #446 — human deterministic response for learned semantics
- PR #447 — learned-semantic cutover eligibility

Final production code SHA before documentation closeout:
`8d32872f6bfbcae958c957d24d63bea0b0c6a00a`.

### First confirmed learn

Production event:
`phase3-prod3-pace-first-a1`

Observed:
- semantic supervisor call completed successfully;
- model returned structured `constraints:['low_exertion']`;
- mapper canonicalized it to `pace_relaxed`;
- `semantic_concept_memory` inserted:
  - concept_key = `pace_relaxed`
  - normalized_signature = `ไม่อยากเหนื่อยมาก`
  - confidence = 0.700
  - evidence_count = 1
  - status = active.

### Final learned replay

Production events:
- `phase3-prod6-pace-first-a1`
- `phase3-prod6-pace-replay-a1`

Both were owned by:
- intent = `semantic_concept_match`
- action = `provide_information`
- dialog_mode = `answer`
- composer_mode = `deterministic`

Real customer-facing response:
`รับทราบครับ เดี๋ยวผมเน้นตัวเลือกสบาย ๆ ใช้แรงไม่มากให้ครับ`

Important cost evidence:
- **no ai_api_cost_events exist for either prod6 pace event**
- therefore both learned replay turns were **0 paid call**
- One-Mind total time was about 1.3–1.4 seconds for those turns.

### Transaction negative control

Production event:
`phase3-prod6-transaction-negative-a1`

Observed:
- learned memory did not own the transaction turn;
- normal semantic-interpreter path ran;
- cost = 0.0727 THB;
- no false transaction-success marker was emitted.

This is the Phase 3 contract in production:
**pay when genuinely unseen / learn safely / replay free / never convert
learned semantics into transaction authority.**

## Broad production-smoke diagnostic — carried to Phase 7

The broad Phase-7-style smoke exposed intermittent 504/provider latency and
wording variability in scenarios unrelated to the learned-concept mechanism.
Those failures are not hidden.

Across those runs:
- false transaction-success markers = 0;
- Phase-3-specific learned/cost behavior was proven separately by the targeted
  production certification above.

The broad smoke remains a Phase 7 reliability/cutover gate and is not used to
erase the narrower Phase 3 proof.

## Completion decision

**Phase 3 = COMPLETE.**

Phase 3 is complete because:
1. the semantic-generalization architecture was decided from real calibration,
   not fashion or guesswork;
2. companion + pace + consider-only concept families are implemented with
   closed, non-operational outcomes;
3. production DB migration is applied and verified;
4. formal 20/50/100-turn stress evidence exists;
5. no arbitrary fixed-call cliff or learned transaction escalation was found;
6. real OpenAI token/cost calibration exists and the semantic reservation was
   tightened while retaining conservative headroom;
7. 100% Saved-Agent production routing was audited and bridged rather than
   ignored;
8. real Production proved first-call learning into semantic_concept_memory;
9. real Production proved cross-customer learned replay at **0 paid call**;
10. the final learned response is human, deterministic, and non-transactional;
11. transaction negative control remained outside learned-memory ownership.

Next roadmap phase: **Phase 4 — Human Intent / Commercial Boundary.**
