# Phase 5 — Business + Incident Router

Status: **COMPLETE**

Base production checkpoint: `b429736` (Phase 4 closed by PR #465)

## Objective

Put one explicit operational router between language understanding and business execution so every customer turn is assigned to either:

- a normal business lane,
- an operational incident/customer-voice lane, or
- general conversation.

The important production gap closed by this phase is semantic incidents: OpenAI could correctly understand an unusual complaint/help/adverse-event wording that the older narrow deterministic phrase classifiers did not match, but the One-Mind response could return before a durable `ops_feedback_events` case was created.

Phase 5 converts trusted structured INCIDENT meaning into a durable case **before** a business/transaction continuation can execute.

## Non-negotiable invariants

1. **Phase 4 commercial consent is unchanged.** Only explicit current-turn COMMIT may authorize a transaction.
2. **INCIDENT wins over transaction-shaped language.** A complaint, incident report, or request for operational help is never transaction permission.
3. **Authority boundaries stay deterministic.** Refund, special discount, claim/liability, safety guarantee, severe medical risk, reputational threat, and unverified availability still use the existing guardrail wording before any LLM draft.
4. **No invented incident facts.** The semantic fallback case stores only validated structured routing fields plus the redacted original message; it does not invent staff names, assets, outcomes, or incident status.
5. **Notification claims remain truthful.** Customer wording reflects the actual stored/sent/failed result.
6. **OTOP is a first-class business unit.** Customer voice for OTOP routes to the existing OTOP LINE team and uses a widened DB enum; it no longer falls through to owner/general.
7. **Live Transaction remains OFF and Public Prepare remains 0%.** This phase changes routing safety, not transaction exposure.

## Architecture

### Pre-model routing

`classifyRawBusinessIncidentRoute()` runs once before the One-Mind/business cascade.

Precedence:

1. existing escalation/authority boundary,
2. existing service feedback / safety / lost-property / customer voice,
3. otherwise continue to semantic understanding.

The existing deterministic responders receive the router's preclassified object instead of re-running independent language classification.

### Post-understanding routing

`classifySemanticBusinessIncidentRoute()` consumes `SemanticMeaning`.

Precedence:

1. semantic incident / complaint / request_help,
2. normal business domain,
3. general.

For `domain=incident`, the semantic interpreter now preserves a clearly named owned business as the closed `entities.businessUnit` value. The router validates that enum before using it.

### Durable semantic incident bridge

When the semantic source is trusted (`openai_supervisor` or semantic concept memory) and the router returns INCIDENT:

1. build the minimum `ServiceFeedbackMatch` from closed semantic fields,
2. persist through the existing `createFeedbackEvent()`,
3. dispatch through existing `notifyFeedbackEventTargets()`,
4. return a deterministic acknowledgement derived from the real delivery result,
5. stop before any transaction executor.

No new notification system was created.

## OTOP schema/routing

Phase 5 adds `otop` to `BusinessUnit`, maps it to `otop_group`, and maps feedback delivery to the existing `otop` ops team.

Migration:

`20261002112000_phase5_otop_feedback_routing.sql`

It only widens the existing `business_unit` and `route_target` CHECK constraints.

## Certification gates

### Offline

`tests/phase5-business-incident-router.test.ts` proves:

- all normal business domains route correctly,
- INCIDENT outranks explicit transaction-shaped action,
- semantic safety/help creates a high-severity safety case without invented entities,
- deterministic authority precedence is preserved,
- OTOP customer voice routes to OTOP,
- raw OTOP complaint uses zero model calls,
- semantic-only OTOP complaint is durably stored before the model draft can escape,
- a semantic complaint with `action=order` creates no OTOP order/booking/preorder.

Full `npm test` must remain green.

### Live OpenAI

Workflow:

`.github/workflows/phase5-live-business-incident.yml`

Script:

`scripts/run-phase5-live-business-incident.ts`

The live matrix covers normal restaurant/activity/stay/cafe/OTOP/member/promotion routing, false-incident control, business-specific complaints, semantic English wording outside the Thai raw phrase tables, adverse events, and incident-vs-order/booking conflicts.

Hard gates:

- every expected business lane/business unit matches,
- every expected incident routes INCIDENT,
- zero incident cases cross the Phase 4 commercial boundary as current-turn commit.

## Final production certification — COMPLETE

Implementation PR: **#466**

Merged production commit:
`1107a0882de257cb428d788726d5d6fd089e63a9`

Final gates on the merged implementation line:

- One Mind full CI: **2,078 / 2,078 PASS**
- Netlify Build Guard: **PASS**
- Phase 3 cost stress regression: **PASS**
- Phase 5 real OpenAI live matrix: **17 / 17 PASS**
- incident cases in that live matrix: **9**
- incident false COMMITs: **0**
- Netlify production deploy: **READY**
- production deploy id: `6abf356f796efc000835844f`
- deploy commit_ref matches merged Phase 5 commit exactly
- `_business-incident-router` and updated `thongthai-chat` functions are present in the production deploy

Production database checkpoint:

- migration `phase5_otop_feedback_routing` applied successfully
- Supabase migration version recorded: `20261002043819`
- `ops_feedback_events.business_unit` now includes `otop`
- `ops_feedback_events.route_target` now includes `otop_group`
- OTOP LINE notification channel is bound and enabled
- `ops_feedback_events` remains RLS-enabled
- `anon` has no SELECT/INSERT privilege
- `authenticated` has no SELECT/INSERT privilege

Production transaction-safety configuration was re-read after deployment:

- `THONGTHAI_AGENT_LIVE_TRANSACTION_ENABLED=0`
- `THONGTHAI_AGENT_TRANSACTION_PREPARE_PERCENT=0`
- transaction prepare guest allowlist is empty

No Phase 5 change enabled public transaction execution.

### Bugs found and closed during certification

Certification exposed four additional real defects; all were fixed before merge:

1. trusted semantic incidents reached grounded response composition before durable routing, causing an unnecessary second paid model call;
2. transaction de-escalation could erase `complaint/request_help/incident_report` by rewriting the speech act to `statement`;
3. wrong-item OTOP fulfilment text such as “ได้ของผิด อยากให้ช่วยตรวจสอบ” could be downgraded to a suggestion because `อยากให้` matched the suggestion marker;
4. customer-voice extraction could fabricate a staff name from “แต่พนักงาน…” and could count `ดีมาก` as positive inside `ไม่ดีมาก`.

All four now have regression coverage.

### Security review note

Supabase security advisors were run after the migration. The project still has pre-existing broad security-advisor findings on unrelated legacy tables/functions. Phase 5 did not add public table access; the Phase 5 feedback table boundary was directly verified as service-role-only from the customer side.

## Completion decision

**Phase 5 = COMPLETE.**

Phase 5 is complete because the production system now has one explicit raw-then-semantic Business + Incident routing contract; operational incidents cannot authorize transactions; semantic open-world complaints/help/adverse events become durable operational cases before response composition; OTOP customer voice routes to its real OTOP team; live OpenAI certification passed with zero incident false commits; the required database migration is applied; and the exact merged commit is READY in production.

Next roadmap phase: **Phase 6 — Natural Response Brain.**

## Definition of done

Phase 5 closes only when:

- offline suite is green,
- live OpenAI Phase 5 matrix is green,
- normal repository CI is green,
- the merged main commit is verified,
- migration/deployment state is explicitly recorded,
- Live Transaction/Public Prepare remain unchanged.

Next roadmap phase after closure: **Phase 6 — Natural Response Brain**.
