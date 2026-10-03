# WW-10 — Thongthai Worldwide

Status: production-certified / ready to merge
Date: 2026-10-03

## Goal

Make Thongthai the single multilingual customer-facing voice for worldwide commerce without making Thongthai a second commerce engine.

WW-10 composes the canonical WW-1 through WW-9 authorities and existing backoffice truth. It does not create duplicate market, price, payment, shipping, customs, checkout, fulfillment, order, or customer tables.

## Canonical service bundle

The read-only `get_worldwide_offer` tool accepts:

- explicit destination country code
- exact OTOP SKU quantities
- optional customer locale
- optional shipping service code

It resolves, in order:

1. live product and stock truth
2. WW market/currency/capability context
3. explicit multi-currency price revisions
4. canonical WW-6 product parcel profiles
5. WW-6 shipping quote
6. WW-7 customs eligibility snapshot
7. WW-5 live payment-method readiness
8. WW-8 checkout-readiness prerequisites

The tool never places an order, captures money, refunds money, changes stock, or commits a transaction.

## No guessing

Thongthai must not infer:

- destination country from language
- transaction currency from language
- parcel weight or dimensions from product name or category
- shipping price from a domestic rate
- customs duty/tax amount when the customs system says not calculated
- carrier or delivery time when no live WW shipping authority confirms them
- payment readiness without a live market payment method

A missing shipping profile returns `shipping_profile_required`. It never asks the customer to guess product dimensions for a catalog item.

## Language

The production Saved Agent is the multilingual customer voice for ordinary foreign-language service turns when the existing Agent master/channel/guest gates permit it.

This routing is script-agnostic: English, German, Swedish, Chinese, Lao, and other non-Thai text can use the same Agent. Language still never defines country, market, currency, or transaction intent.

Ordinary Thai routing remains unchanged. Explicit Thai worldwide commerce fact questions such as international shipping, currency, customs, and parcel tracking receive the same priority Saved-Agent fact path; task/transaction/weather/location guards still take precedence.

## Worldwide order status

For an authenticated/linked guest, the read seam can expose that same guest's checkout-v2 commerce status:

- order and shipping state
- market and currency
- payment intent state and captured/refunded amounts
- customs decision and duty-tax status
- shipment/package state
- verified tracking number/link
- immutable carrier timeline

The lookup is scoped through the guest's own customer account and does not select recipient, phone, or address PII.

## Domestic compatibility

Thailand keeps the existing domestic OTOP pricing and shipping settings. WW-10 does not route Thailand through a foreign quote engine.

Domestic transaction tools and confirmation gates are unchanged.

## Fail closed

WW-10 obeys both levels of rollout control:

1. runtime WW feature flags
2. per-market capability states

If a foreign market is not live, Thongthai can still converse naturally but must say the requested commerce fact cannot yet be verified.

Production WW flags remain off until a later rollout/country-certification decision.

## Audit chain

WW-10 restores the real WW-9 audit after the temporary WW-9 Netlify diagnostic skip and adds `audit:ww10` after it in the Netlify staged build gate.

A WW-10 build cannot deploy if the WW-9 fulfillment regression suite or the WW-10 worldwide Agent suite fails.

## Definition of Done

- [x] No duplicate WW/backoffice database ownership in Thongthai.
- [x] Explicit destination country stays separate from customer language.
- [x] Explicit product prices come from WW-4.
- [x] Product dimensions/weight come only from WW-6 shipping profiles.
- [x] International shipping quote comes from WW-6.
- [x] Customs eligibility comes from WW-7.
- [x] Payment-method readiness comes from WW-5.
- [x] Checkout readiness checks WW-8 prerequisites.
- [x] International order/payment/customs/fulfillment status is guest-owned.
- [x] Tool remains read-only with no international commit/refund surface.
- [x] Foreign-language Saved Agent routing uses existing production gates.
- [x] WW-9 real audit restored.
- [x] WW-10 Netlify deploy blocker added.


## Production certification

WW-10 introduces no new database table or migration. It composes the existing WW-1 through WW-9 authorities, so certification was performed against the production schema without enabling any foreign market.

### Fail-closed production baseline

Before certification, production reported:

- 0 live foreign markets
- 0 active product shipping profiles
- 0 live global-v2 shipping services
- 0 live non-legacy global shipping providers
- 0 live global-v2 payment methods
- 0 live customs market policies
- 0 live checkout-v2 production orders

This confirms WW-10 does not silently enable worldwide commerce.

### Rollback-only source-of-truth probe

A synthetic international product/market stack was created inside one database transaction and rolled back.

The probe verified the same authorities consumed by the WW-10 bridge:

- explicit destination market and SEK currency
- explicit WW-4 product price = 12,500 minor units
- measured WW-6 parcel profile = 800 g / 300 x 200 x 100 mm
- WW-6 shipping quote = 25,000 minor units
- WW-7 customs decision = eligible
- WW-7 duty/tax status = not_calculated
- one live WW-5 payment method is discoverable for the synthetic market
- source product stock remains unchanged
- no OTOP order is created
- no global payment intent is created

Result: `WW10_ROLLBACK_SOURCE_OF_TRUTH_PROBE_PASSED`.

After rollback, the synthetic country, market, product, carrier, payment provider, shipping quote, and customs snapshot were all verified at zero residue.

### Routing certification

Regression coverage verifies that:

- ordinary Thai cafe/task/Phase-3 routing remains ahead of the Saved Agent
- a generic Thai phrase such as "ถูกส่งไปที่ร้าน" is not treated as international shipping
- explicit Thai worldwide fact wording uses a narrow worldwide-read classifier
- non-Thai customer text can reach the same Saved Agent behind the existing master/channel/guest gates
- language never supplies the destination country or transaction currency
- transaction intent still uses the existing prepare/commit safety boundary

## Final Definition of Done

- [x] Canonical worldwide service bundle implemented.
- [x] Guest-owned international order/payment/customs/fulfillment readback implemented.
- [x] No duplicate Thongthai commerce database or transaction engine.
- [x] No international commit/refund tool added.
- [x] WW-6 no-guessed-parcel contract preserved.
- [x] WW-7 explicit-customs-source contract preserved.
- [x] Existing Thai Messenger/cafe routing contract preserved.
- [x] Existing Phase-3 learning-before-Agent contract preserved.
- [x] Saved Agent profile compatibility preserved.
- [x] Real WW-9 audit restored.
- [x] WW-10 audit added after WW-9 in Netlify build gate.
- [x] Exact Netlify build passed.
- [x] Full repository regression suite passed.
- [x] Netlify Deploy Preview passed.
- [x] Production rollback-only source-of-truth probe passed.
- [x] Production remained fail-closed with zero synthetic residue.
