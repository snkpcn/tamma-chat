# WW-8 — International Checkout

Status: implementation
Date: 2026-10-03

## Goal

Create a versioned international checkout path that atomically verifies every upstream worldwide decision before an order can exist.

WW-8 does not replace domestic checkout v1.

Domestic Thailand continues to use:

- `create_member_otop_order_v1`
- THB
- current domestic shipping settings
- PromptPay owner QR
- current slip verification flow

International checkout uses:

`create_member_otop_order_v2`

and is dormant until all WW capability flags and market configuration are explicitly enabled.

## Required checkout chain

An international order can be created only when the same transaction verifies:

1. member account
2. Address V2 owned by that member
3. non-domestic live destination market
4. checkout market capability live
5. exact cart/SKU/quantity
6. active/verified products and sufficient stock
7. explicit current product price revision in the transaction currency
8. cart-bound, unexpired WW-6 shipping quote
9. matching WW-7 customs snapshot with decision `eligible`
10. no unautomated required customs-document codes
11. live customs market policy
12. recipient-on-import duties disclosure and explicit customer acknowledgement
13. live global-v2 payment method/provider
14. idempotent order key
15. idempotent payment-intent key

Failure of any item aborts the transaction.

## Cart-bound shipping

WW-6 intentionally allowed generic parcel quotes.

WW-8 adds:

`commerce_shipping_quote_cart_bindings`

and:

`create_commerce_cart_shipping_quote_v1`

The cart quote RPC:

- normalizes duplicate SKUs
- loads verified product shipping profiles
- builds parcel evidence from measured product profiles
- uses one measured parcel per unit as a conservative packing rule
- limits auto-packing to 20 units
- calls the authoritative WW-6 quote engine
- binds the resulting quote to the exact normalized cart

International checkout rejects a generic/unbound or different-cart quote.

No client-supplied parcel weight can be substituted at checkout.

## Exact money evidence

WW-8 adds to `otop_orders`:

- checkout version
- destination country
- shipping quote ID
- customs snapshot ID
- global payment intent ID
- subtotal/shipping/total in minor units
- payment provider/method
- duties disclosure evidence
- encrypted Address V2 snapshot
- normalized checkout items

WW-8 adds to `otop_order_items`:

- unit price minor
- line total minor

Each global line item keeps its WW-4 `price_revision_id`.

The old numeric major-unit fields are still populated for backward-compatible backoffice/reporting, but minor-unit fields are the exact v2 transaction evidence.

## Legacy payment isolation

The existing `create_payment_for_otop_order` and `sync_otop_payment_amount` triggers now immediately return for `checkout_version=2`.

Therefore a non-THB/global order does not create a legacy `payment_requests` PromptPay row.

Global v2 checkout creates a WW-5 payment intent instead.

Domestic v1 behavior remains THB + PromptPay only.

## Payment confirmation boundary

For checkout v1, order confirmation still requires:

`payment_requests.status = verified`

For checkout v2, confirmation requires:

`commerce_payment_intents.status = captured`

A global payment capture also moves an international order shipping status from:

`awaiting_payment → packing`

Actual carrier booking/tracking remains WW-9.

## Customs / duties boundary

WW-8 accepts only WW-7 snapshots where:

- decision = `eligible`
- snapshot status = active
- market/destination/currency/cart match the order
- duty/tax status is still `not_calculated`

Because WW-7 does not calculate landed cost, WW-8 supports only a live policy explicitly configured as:

- `duty_tax_mode = recipient_on_import`
- `importer_responsibility = customer`
- terms code present
- disclosure key present
- customer acknowledgement = true

`prepaid_assessment` or an incomplete duty policy fails closed with:

`landed_cost_not_supported`

If the customs snapshot contains required document codes, checkout fails with:

`customs_documents_not_automated`

rather than pretending those documents exist.

## Deferred integrity guard

`otop_global_checkout_integrity_guard` is a deferred constraint trigger.

At transaction end every checkout-v2 order must still match:

- its global payment intent and amount
- its consumed shipping quote
- its eligible customs snapshot
- market/currency/destination evidence

This prevents an incomplete direct service-role insert from being committed.

## Feature gates

The Netlify checkout client requires all of:

- `TAMMA_WW_ENABLED`
- `TAMMA_WW_ADDRESS_V2_ENABLED`
- `TAMMA_WW_MULTI_CURRENCY_ENABLED`
- `TAMMA_WW_GLOBAL_PAYMENTS_ENABLED`
- `TAMMA_WW_GLOBAL_SHIPPING_ENABLED`
- `TAMMA_WW_CUSTOMS_ENABLED`
- `TAMMA_WW_CHECKOUT_ENABLED`

Production flags remain off after WW-8.

## Applied production migrations

- `20261003061720_ww8_international_checkout_core`
- `20261003062059_ww8_cart_quote_binding_alias_fix`

The second migration fixes a PL/pgSQL return-column/table-column ambiguity found by the first rollback-only E2E probe before any real international order existed.

## Rollback-only E2E probe

All foreign-market/legal values in this probe were synthetic and non-authoritative.

The probe temporarily created:

- Sweden market / SEK
- one synthetic global payment provider/method
- one synthetic global shipping provider/service/rate
- one measured shipping profile
- one synthetic customs classification/rule/policy
- one temporary member and Address V2

The real live product row was used only inside the transaction; every mutation was rolled back.

Checkout result before rollback:

- checkout version: 2
- market/currency: SE / SEK
- subtotal: 100000 minor = 1,000.00 SEK
- shipping: 20000 minor = 200.00 SEK
- total: 120000 minor = 1,200.00 SEK
- pricing source: multi_currency_v1
- customs: eligible
- duty/tax status: not_calculated
- shipping quote: consumed
- stock: 4 → 3 while order existed
- legacy PromptPay payment_requests created: 0

Before payment capture, order confirmation was rejected.

After a verified WW-5 capture event:

- payment intent = captured
- shipping status = packing
- order confirmation succeeded

After ROLLBACK:

- product stock returned to 4
- Sweden market rows: 0
- probe customer rows: 0
- probe orders: 0
- probe payment intents: 0
- probe shipping quotes: 0
- probe customs snapshots: 0

## Security / advisors

WW-8 cart bindings are RLS-on and service-role-only.

International checkout/cart-quote RPCs:

- SECURITY DEFINER
- empty search path
- public/anon/authenticated execute revoked
- service_role execute only

Supabase advisor reports no new unindexed foreign keys caused by WW-8.

Remaining RLS/no-policy and unused-index INFO is expected for server-only/dormant global checkout infrastructure.

## Definition of Done

- [x] Checkout v2 is separate from domestic v1.
- [x] Cart-bound shipping quotes prevent parcel/cart substitution.
- [x] Exact multi-currency price revisions are revalidated.
- [x] Address V2 ownership/destination is revalidated.
- [x] Customs eligible snapshot/cart is revalidated.
- [x] Required customs docs fail closed.
- [x] Recipient-on-import duties require explicit acknowledgement.
- [x] Global-v2 payment provider/method is revalidated.
- [x] Stock reservation remains atomic through existing stock trigger.
- [x] Legacy PromptPay is bypassed for checkout v2.
- [x] Global payment capture gates confirmation and packing.
- [x] Deferred integrity guard protects direct inserts.
- [x] Rollback-only E2E probe passed with zero residue.
- [x] Production migration/security/advisors verified.
- [ ] WW-8 audit passes.
- [ ] Full repository CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
