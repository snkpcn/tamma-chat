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

## Completion gate

Phase 6.1 closes only when:

- production E2E workflow passes every case;
- full repository CI remains green;
- build guard remains green;
- cost stress remains green;
- synthetic guest IDs are checked read-only against transaction tables and show zero transactions;
- final checkpoint is persisted on `main`.

No runtime code change is required unless the production smoke exposes a real defect.
