# Phase 6.1 — Production E2E Natural Response

Status: **COMPLETE**

Base production checkpoint:
`688318dbb6633f75da6198a91227df9ffd1f24f0`

Phase 6 already certified the final composer and deterministic rails in isolation and deployed them to production. Phase 6.1 adds the missing end-to-end proof through the real public `thongthai-chat` gateway.

## Goal

Prove that the deployed production gateway preserves:

- Natural-response language correctness
- Web / LINE / Facebook channel parity
- Verified business truth
- No transaction leakage
- No false booking/order/public intent

This phase remains read-only.

## Production matrix

The production smoke covers:

- Thai price answer on LINE
- English price answer on LINE
- English price answer on Web
- English price answer on Facebook
- Chinese price answer on Facebook
- Lao price answer on LINE
- Vietnamese price answer on Web
- Thai stay-availability clarification on Web
- English stay-availability clarification on LINE
- Chinese stay-availability clarification on Facebook
- Lao stay-availability clarification on LINE
- Vietnamese stay-availability clarification on Web

All price probes must return the same verified 30-minute horse price.

All availability probes deliberately omit the date and must ask for the missing date rather than claim a booking or fabricate availability.

## Safety contract

- no test message contains booking/order/payment consent;
- each request uses a synthetic guest UUID;
- no public `booking`, `order`, or `payment` intent is permitted;
- no completed transaction wording is permitted;
- no test triggers refund/complaint/safety notification routing;
- production data may create only ordinary synthetic guest/conversation state.

## Language purity

Canonical proper names may remain in their original spelling.

For non-Thai output, ordinary Thai wording must not leak into the answer after canonical names are removed. This specifically catches regressions such as:

- `300 บาทครับ` inside Vietnamese
- Thai polite particles inside English/Chinese/Lao/Vietnamese

## Channel parity

English price is tested independently on Web, LINE, and Facebook.

All three must preserve the same verified numeric truth: **300**.

## Deployment / certification order

Production E2E cannot certify an implementation branch against the old production deployment.
Therefore the gate is intentionally split:

1. implementation PR: full CI / build / cost + offline regression;
2. merge implementation;
3. wait for Netlify production to deploy the exact merge commit;
4. open a documentation-only certification PR with title `[run phase6 prod]`;
5. run this same production E2E script against the now-updated real production endpoint;
6. verify synthetic guest IDs have zero rows in transaction tables;
7. persist the final Phase 6.1 checkpoint on `main`.

This avoids the false process of testing old production and pretending it represents branch code.

## First production RED finding

The first real production run exposed:

`A 30-minute horse ride is ฿300 per personครับ.`

The semantic answer and price were correct, but Thai polite-particle residue leaked into English.
Phase 6.1 adds a last-mile response-language surface guard that strips non-factual Thai politeness
residue from non-Thai output and normalizes exact Thai currency/time unit residue without changing
the numeric business fact.

The production smoke now collects the entire matrix before failing, so one defect does not hide
later defects in the same run.

## Completion gate

Phase 6.1 closes only when:

- implementation full repository CI is green;
- build guard remains green;
- cost stress remains green;
- implementation merge is deployed READY at the exact commit;
- post-deploy production E2E workflow passes every case;
- synthetic guest IDs are checked read-only against transaction tables and show zero transactions;
- final checkpoint is persisted on `main`.


## Production certification RED #2 — global egress bypass

Certification PR #471 tested exact production deploy `6abf4d7a4c017d00086e1874`.

Result:

- total: **12**
- passed: **8**
- failed: **4**
- false transactions detected: **0**
- English price parity across LINE/Web/Facebook remained **300**

Failed customer replies:

- English LINE price appended Thai `ครับ`
- English Web price appended Thai `ครับ`
- English Facebook price appended Thai `ครับ`
- Chinese Facebook stay clarification appended Thai `ครับ`

Read-only database verification for all 12 synthetic guests showed:

- bookings = **0**
- cafe_inquiries = **0**
- otop_orders = **0**
- otop_order_sessions = **0**
- payment_requests = **0**

### Root cause

The Response Composer's Phase 6.1 surface normalization was correct but not globally terminal.
Several production response paths return directly through `thongthai-chat.ts` without passing
through Response Composer parsing.

The canonical `coreResult()` function is the one final gateway shared by every successful
customer-facing path. Phase 6.2 therefore applies `normalizeResponseLanguageSurface()` inside
`coreResult()`, before bot-quality telemetry, response persistence, and public return.

This makes the language guard a true egress invariant rather than a composer-specific feature.


## Phase 6.2 production deployment checkpoint

Global egress implementation PR #472 merged as:

`14cbf1578dea4383955138967ea008c3ac821d34`

Netlify production deploy:

`6abf501de1d34800080a9588`

Verified before re-certification:

- state: **READY**
- context: **production**
- branch: **main**
- deploy `commit_ref` matches the Phase 6.2 merge exactly
- deploy validation status: **ready**
- secret scan matches: **0**

The same 12-case production matrix will now be replayed unchanged.


## Phase 6.2 final production certification — COMPLETE

Final runtime implementation:

- PR #472
- merge commit: `14cbf1578dea4383955138967ea008c3ac821d34`
- production deploy: `6abf501de1d34800080a9588`
- deploy state: **READY**
- deploy `commit_ref` matched implementation exactly
- secret scan matches: **0**

Production re-certification used the unchanged 12-case matrix.

Result:

- total: **12**
- passed: **12**
- failed: **0**
- false transactions detected: **0**
- English price parity across LINE / Web / Facebook: **true**
- verified 30-minute horse price on all three English channels: **300**
- Thai / English / Chinese / Lao / Vietnamese coverage: **PASS**
- non-Thai Thai-particle leakage: **0**

The earlier production defects are closed:

- English LINE no longer appends `ครับ`
- English Web no longer appends `ครับ`
- English Facebook no longer appends `ครับ`
- Chinese Facebook clarification no longer appends `ครับ`

Read-only Supabase verification for all 12 passing synthetic guests:

- bookings = **0**
- cafe_inquiries = **0**
- otop_orders = **0**
- otop_order_sessions = **0**
- payment_requests = **0**

The one certification-detector false positive found during re-test was also closed:
the international baht symbol `฿` is Unicode U+0E3F inside the Thai block but is not Thai-language prose. The detector now removes only that currency symbol before testing for actual Thai-script leakage; Thai words and polite particles remain fully detected.

### Phase 6.2 completion decision

**Phase 6.2 = COMPLETE.**

The canonical final response invariant is now:

`all customer response paths -> thongthai-chat coreResult -> requested-language surface guard -> channel presentation -> public response`

No response path is permitted to bypass the final language surface guard.
