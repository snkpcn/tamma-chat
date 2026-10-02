# Phase 6.1 — Production E2E Natural Response

Status: **certification in progress**

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


## Production deployment checkpoint

Implementation PR #470 merged as:

`6ef5d04b697a8b7dafbd2343d2c8460769ff97f7`

Netlify production deploy:

`6abf4d7a4c017d00086e1874`

Verified before production certification:

- state: **READY**
- context: **production**
- branch: **main**
- deploy `commit_ref` matches the implementation merge exactly
- deploy validation status: **ready**
- secret scan matches: **0**

Production E2E certification against this exact deployment is now pending.
