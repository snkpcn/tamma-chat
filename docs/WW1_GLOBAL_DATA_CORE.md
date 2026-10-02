# WW-1 — Global Data Core

Status: implementation
Date: 2026-10-03
Baseline: Thailand production remains canonical and unchanged.

## Purpose

WW-1 creates the canonical data model that later worldwide phases can depend on:

`country → currency → locale → market → market capability`

The model is intentionally separate from customer-facing launch state. A row existing in the database does **not** mean a country can buy.

## Canonical objects

### `commerce_currencies`

Reference data for transaction/settlement currency codes.

- ISO-like uppercase 3-letter code
- display name/symbol
- minor unit
- active flag

WW-1 seeds only THB. WW-4 owns expansion of sell/price currencies.

### `commerce_countries`

Country reference/config.

- uppercase 2-letter country code
- canonical English display name
- default currency reference
- active flag

WW-1 seeds only Thailand. New countries can be added without schema changes.

### `commerce_locales`

Presentation locale reference.

Locale is deliberately independent from payment currency and country.

WW-1 seeds the five public languages already certified in the current site:

- `th`
- `en`
- `zh`
- `lo`
- `vi`

### `commerce_markets`

A commercial market is the country-specific operating configuration.

Fields include:

- market code
- country
- settlement currency
- default locale
- status: `draft | certification | live | suspended`
- domestic marker

Only `status=live` is eligible to resolve as a ready market.

WW-1 seeds Thailand as the single live domestic market.

### `commerce_market_locales`

Defines which presentation locales are available for each market and which is the default.

### `commerce_market_capabilities`

Capabilities use three states:

- `disabled`
- `shadow`
- `live`

Supported capabilities:

- catalog
- storefront
- pricing
- payments
- shipping
- customs
- checkout
- fulfillment
- thongthai

Missing capability rows are always interpreted as disabled.

## Safety / rollout rules

1. WW-0 master + `dataCore` feature flag must both be enabled before the DB-backed resolver reads this core.
2. Existing domestic code does not depend on WW-1. If the WW flags stay off, existing Thai checkout/payment/shipping continues unchanged.
3. A country row is not launch permission.
4. A market in `draft`, `certification`, or `suspended` is not customer-ready.
5. A missing capability is disabled, never inferred.
6. Unsupported requested locale falls back only to the configured market default.
7. Currency is never derived from UI language.
8. Country and currency identifiers are normalized but never guessed.
9. Tables remain server/service-role managed in WW-1; no anon/authenticated Data API grants are introduced.
10. Global checkout cannot rely on this data alone; later phases add address, pricing, payment, shipping and compliance gates.

## Thailand seed

Thailand remains the current production baseline:

- country: `TH`
- market: `TH`
- currency: `THB`
- default locale: `th`
- additional locales: `en, zh, lo, vi`
- customs capability: disabled
- current domestic capabilities: live

This seed is descriptive of the existing domestic business. It does not reroute the existing Thai checkout through WW code.

## Definition of Done

- [x] Pure country/currency/locale/market resolver implemented.
- [x] Invalid identifiers fail closed.
- [x] Non-live markets fail closed.
- [x] Missing capabilities default disabled.
- [x] Locale and currency remain independent.
- [x] Thailand resolves to the locked TH/THB domestic baseline.
- [ ] Database migration applied and verified.
- [ ] RLS/grants verified service-role-only.
- [ ] Database advisors reviewed after migration.
- [ ] Repo migration artifact matches applied migration.
- [ ] Full CI passes.
- [ ] Production deploy is ready on merged main.
- [ ] WW flags remain deliberately controlled after deploy.
