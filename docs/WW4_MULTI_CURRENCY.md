# WW-4 — Multi-Currency

Status: implementation
Date: 2026-10-03

## Goal

Add an exact, auditable multi-currency pricing layer without changing the current Thailand commerce path.

The core rule is:

**transaction price is an explicit stored price, never a live FX calculation.**

FX can help staff prepare a price, but checkout must only use an approved price revision.

## Domestic price ownership

`otop_products.price` remains the canonical THB price for the Thailand business.

WW-4 creates a mirrored THB price revision in `commerce_product_prices` for consistency with the global data model, but current domestic catalog and checkout still read the existing `otop_products.price` field.

A database trigger keeps the THB revision synchronized when the canonical domestic price changes.

The server price-revision RPC refuses THB writes with:

`domestic_thb_price_owned_by_otop_products`

This prevents two competing sources of truth.

## Currency reference data

WW-4 seeds reference metadata for:

- THB
- USD
- EUR
- GBP
- SEK
- CNY
- LAK
- VND
- JPY

A currency existing in `commerce_currencies` does **not** mean it is available to a customer.

Market availability is controlled separately by `commerce_market_currencies`.

Thailand is seeded with only:

`TH → THB → enabled/default`

No foreign currency is enabled for the live Thailand market in WW-4.

## Exact money representation

Product prices use integer minor units.

Examples:

- THB 2,500.00 → `250000`
- USD 79.00 → `7900`
- JPY 5,000 → `5000`

This avoids binary floating-point values becoming transaction evidence.

The runtime rejects amounts containing precision beyond the currency's configured minor unit.

## Explicit product price revisions

`commerce_product_prices` stores:

- product
- currency
- amount in minor units
- price source
- optional FX audit context
- effective window
- active state

Only one active revision per product/currency is allowed.

Supported price sources:

- `domestic_base`
- `manual`
- `fx_assisted`

`fx_assisted` still stores a final explicit amount. Its rate/source fields are audit context only.

## FX quotes

`commerce_fx_quotes` stores reference rates with provider and observation time.

Its schema hard-locks:

`usage_scope = reference_only`

WW-4 does not seed an exchange rate and does not call a public FX service at checkout.

## Price revision writer

`set_commerce_product_price_v1` is a service-role-only RPC.

It:

1. validates product and currency,
2. rejects THB because Thailand price is owned by `otop_products.price`,
3. validates optional FX audit data,
4. closes the prior active revision,
5. inserts a new immutable revision.

A rollback-only production probe successfully created USD 99.99 for the inactive TEST product and left zero persisted USD rows afterward.

## Order currency evidence

WW-4 adds to `otop_orders`:

- `market_code` (default TH)
- `currency_code` (default THB)
- `pricing_source` (default domestic_v1)

And to `otop_order_items`:

- `currency_code` (default THB)
- optional `price_revision_id`

The existing numeric order/item amounts stay in place for backward compatibility; currency is now explicit transaction evidence.

All existing orders backfilled automatically as:

- market TH
- currency THB
- pricing source domestic_v1

## Payment boundary

WW-4 is **not** the global payments phase.

The existing payment contract remains:

- currency THB
- method `promptpay_owner_qr`

The existing database check constraints are deliberately retained.

OTOP payment trigger code now copies the order currency explicitly and rejects any non-THB order with:

`global_payment_not_enabled`

WW-5 will own the versioned global payment-provider path.

## Feature gate

The DB-backed multi-currency price loader requires:

- `TAMMA_WW_ENABLED`
- `TAMMA_WW_MULTI_CURRENCY_ENABLED`

It also requires:

- currency active
- market/currency enabled
- market pricing capability live
- one current explicit product price

Missing price fails closed. Runtime never derives a transaction price from THB.

## Applied production migrations

- `20261003042445_ww4_multi_currency_core`
- `20261003042706_ww4_multi_currency_fk_indexes`
- `20261003042747_ww4_price_revision_rpc`

## Production verification

Verified on 2026-10-03:

- 9 currency reference rows
- TH market has exactly one enabled currency: THB
- 11/11 OTOP product rows have matching active THB price revisions
- 0 FX quote rows
- all existing OTOP orders are TH / THB / domestic_v1
- all existing OTOP payment requests remain THB / PromptPay
- new commerce pricing tables are service-role-only
- price revision RPC: anon=false, authenticated=false, service_role=true
- rollback-only foreign price probe left zero persisted rows

Supabase advisor `rls_enabled_no_policy` findings are intentional for these server-only tables. Client roles are explicitly revoked.

## Definition of Done

- [x] Exact minor-unit money contract implemented.
- [x] Currency reference layer contains multiple currencies.
- [x] Market currency availability separated from currency existence.
- [x] Explicit product price revision store implemented.
- [x] THB domestic source of truth preserved.
- [x] FX quote store is reference-only.
- [x] Safe foreign-price revision RPC implemented.
- [x] Order and line-item currency evidence added.
- [x] Existing PromptPay payment remains THB-only.
- [x] Production migrations applied and verified.
- [x] RLS/grants reviewed.
- [x] Advisor FK index findings caused by WW-4 repaired.
- [ ] WW-4 audit passes.
- [ ] Full repository CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
