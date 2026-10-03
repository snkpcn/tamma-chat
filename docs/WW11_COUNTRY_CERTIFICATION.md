# WW-11 — Country Certification

Status: implementation
Date: 2026-10-03

## Goal

A foreign market is not launch-ready merely because individual WW tables are configured.

WW-11 adds one fail-closed country/market certification gate above WW-1 through WW-10. International checkout-v2 must have a current certification matching the exact product price revisions in the order.

## Certification readiness

A market can enter certification only when all of these are true:

- non-domestic market is live
- country and default currency relationship is active
- default market currency and locale are enabled
- catalog, storefront, pricing, payments, shipping, customs, checkout, fulfillment, and Thongthai capabilities are live
- a live global-v2 payment method has a live provider
- a live global-v2 shipping service has a live non-legacy provider and destination zone
- shipping uses provider quoting or an active manual rate table
- customs market policy is live and compatible with WW-8 recipient-on-import checkout
- an international return policy is live
- every certified product is live, verified, in stock, and has exactly one current price in the market currency
- every certified product has an active canonical shipping profile
- every certified product has a verified customs profile
- every certified product has a live destination rule with decision=allowed
- required customs document codes are empty because WW-8 does not automate customs documents

## Certification evidence

Certification additionally requires:

- a real WW-6 shipping quote for the exact certified SKU set
- a WW-7 customs snapshot for the same product set with decision=eligible
- a live WW-5 payment method
- an explicit SHA-256 probe evidence hash
- a bounded validity period

## Stale-evidence protection

Each certified product stores:

- price revision ID
- price amount in minor units
- hash of the current shipping profile
- hash of the current customs profile
- hash of the current destination rule

If any of those facts changes, the old certification no longer resolves for checkout.

## Checkout enforcement

WW-11 adds deferred database guards to checkout-v2 orders and order items.

The deferred timing is intentional because WW-8 creates the order before inserting line items in the same transaction.

At commit, a checkout-v2 order must resolve to an unexpired certification covering every exact product + price revision. Otherwise the transaction fails with country_certification_required.

Thailand checkout-v1 is untouched.

## Thongthai

WW-10 remains the customer-facing read bridge.

WW-11 exposes a narrow certification read seam so get_worldwide_offer distinguishes between configured commerce authorities and a country actually certified for the exact product price revisions.

Thongthai must never describe an uncertified country as checkout-ready.

## Production baseline

At the start of WW-11 production currently has:

- 10 live verified OTOP products
- 0 active product shipping profiles
- 0 verified customs product profiles
- 0 live foreign markets

Therefore no real country is certified by the WW-11 rollout itself. This is deliberate.

## Definition of Done

- [ ] certification schema + service-role RPCs deployed
- [ ] exact product/price/profile evidence captured
- [ ] quote + customs snapshot evidence required
- [ ] return policy required
- [ ] checkout-v2 database guard active
- [ ] WW-10 offer reports certification readiness
- [ ] rollback-only synthetic country certification probe passes
- [ ] zero synthetic residue
- [ ] Supabase security/performance advisors checked
- [ ] full CI + Netlify deploy preview pass
- [ ] merged and production deployed
