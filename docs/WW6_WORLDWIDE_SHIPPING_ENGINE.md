# WW-6 — Worldwide Shipping Engine

Status: implementation
Date: 2026-10-03

## Goal

Create a provider-neutral worldwide shipping quote engine without replacing the current Thailand delivery path and without inventing parcel measurements, carrier rates, customs duties, or delivery promises.

WW-6 owns:

- shipping provider/service configuration
- origin/destination zones
- verified product shipping profiles
- parcel/volumetric weight math
- explicit rate tiers or future carrier-quote adapters
- immutable/idempotent shipping quote snapshots

WW-6 does **not** own:

- customs/tax/duties rules — WW-7
- international checkout/order creation — WW-8
- carrier booking/tracking/fulfillment — WW-9

## Domestic compatibility

Current Thailand shipping remains authoritative in:

`otop_shipping_settings`

Production remains:

- base fee: 60 THB
- free-shipping threshold: 1,500 THB
- estimated delivery: 2–5 days

WW-6 mirrors this only as descriptive legacy configuration:

- provider: `LEGACY_DOMESTIC_STATIC`
- zone: `TH_DOMESTIC`
- service: `TH_DOMESTIC_STANDARD`
- execution: `legacy_v1`
- rate mode: `domestic_v1`

The new global quote RPC explicitly rejects legacy services with:

`legacy_shipping_service_not_global`

The existing domestic checkout continues to use `calculateShippingQuote()` and `otop_shipping_settings` exactly as before.

## Product shipping measurements

There were no verified product weight/dimension fields in production at WW-6 start.

WW-6 therefore creates `commerce_product_shipping_profiles` but backfills **zero** profiles.

A profile requires:

- origin country
- weight in grams
- length/width/height in millimeters
- optional `ships_separately`

The service-role-only RPC:

`set_commerce_product_shipping_profile_v1`

allows backoffice/server workflows to add measured facts later.

No weight or dimensions are inferred from:

- product name
- category
- price
- image
- language
- AI guesses

If parcel facts are unavailable, global shipping cannot quote.

## Parcel math

The runtime and database use real parcel measurements.

For services with a volumetric divisor:

`volumetric grams = ceil(length_mm × width_mm × height_mm / divisor_cm3_per_kg)`

This is equivalent to the usual cm³/kg formula after unit conversion.

Each parcel uses:

`chargeable = max(actual grams, volumetric grams)`

Multi-parcel shipments sum chargeable weight parcel-by-parcel.

A quote accepts 1–20 parcels.

## Provider / zone / service model

### `commerce_shipping_providers`

Provider/adapter identity only. Credentials do not live here.

### `commerce_shipping_zones`

Origin country and zone lifecycle.

### `commerce_shipping_zone_destinations`

Explicit countries served by a zone.

### `commerce_market_shipping_services`

Binds:

`market + provider + zone + currency + service`

with:

- execution mode: `legacy_v1 | global_v2`
- rate mode: `domestic_v1 | manual_weight_table | provider_quote`
- certification status
- enabled state
- priority
- ETA
- volumetric divisor
- quote TTL

### `commerce_shipping_rate_tiers`

Authoritative manual weight-table rates in currency minor units.

Missing tier = no quote.

### Provider-quote mode

`provider_quote` is modeled but the DB manual-rate RPC refuses it with:

`shipping_provider_quote_adapter_required`

No external carrier/provider is invented or enabled in WW-6.

## Shipping quote snapshot

`commerce_shipping_quotes` records immutable evidence:

- market
- origin and destination country
- currency
- amount in minor units
- provider/service/zone/tier
- parcel snapshot
- actual/volumetric/chargeable weight
- ETA
- idempotency key
- environment
- expiry
- status

Quote state may move only:

`quoted → consumed | cancelled | expired`

All commercial/parcel evidence is immutable after creation.

## Customs boundary

WW-6 deliberately does not calculate import duty, VAT/GST, customs fees, or landed cost.

Every global quote is hard-coded to:

`duties_tax_scope = excluded`

WW-7 must explicitly add compliance/customs semantics before international checkout can treat a shipping quote as landed cost.

## Authoritative quote RPC

`create_commerce_shipping_quote_v1` requires all of:

- destination market is live and matches destination country
- market shipping capability is live
- requested currency is enabled for the market
- provider live/active
- zone live/active
- destination explicitly enabled in the zone
- service live/enabled
- `execution_mode = global_v2`
- supported rate mode
- valid parcel measurements
- configured rate tier
- valid idempotency key

No matching rate/service = fail closed.

## Runtime gate

The Netlify quote client requires:

- `TAMMA_WW_ENABLED`
- `TAMMA_WW_GLOBAL_SHIPPING_ENABLED`

Production WW flags remain off after WW-6, so the new quote engine is dormant to customers.

## Thongthai boundary

The existing Thongthai read seam only has country/subtotal today.

After WW-6 it no longer reports that the global quote source is missing. Instead it reports:

`global_shipping_package_data_required`

because the engine exists but Thongthai must not invent package weight or dimensions.

WW-10 can connect verified product/parcel facts before asking WW-6 for a quote.

## Applied production migrations

- `20261003051324_ww6_worldwide_shipping_core`
- `20261003051516_ww6_shipping_fk_indexes`
- `20261003051520_ww6_shipping_profile_rpc`

## Production probes

### TH → Sweden quote (rollback only)

Temporary certification data was created inside a transaction:

- origin: TH
- destination: SE
- currency: SEK
- execution: global_v2
- rate mode: manual_weight_table
- divisor: 5,000
- ETA: 5–9 days
- 5 kg tier: 150.00 SEK

Parcel:

- actual: 1,000 g
- dimensions: 400 × 300 × 200 mm
- volumetric: 4,800 g
- chargeable: 4,800 g

Observed quote:

- amount_minor: 15000 SEK
- duties/tax: excluded
- status: quoted
- repeated idempotency key returned the same quote
- changed parcel under the same key raised idempotency conflict
- legacy Thai service was rejected by the global RPC

Transaction rollback left:

- Sweden country rows: 0
- probe provider rows: 0
- probe quote rows: 0

### Product shipping profile (rollback only)

Temporary TEST product profile:

- 850 g
- 220 × 160 × 90 mm
- origin TH

The profile read back correctly and rollback left zero rows.

## Security / advisors

All WW-6 tables:

- RLS enabled
- no anon/authenticated table grants
- service_role CRUD only

Quote/profile RPCs:

- SECURITY DEFINER
- empty search path
- public/anon/authenticated execute revoked
- service_role execute only

WW-6-created unindexed-FK findings were fixed.

Remaining advisor items are:

- intentional `rls_enabled_no_policy` for server-only tables
- expected `unused_index` INFO while global shipping has no production traffic

Supabase's 2026 Data API change toward explicit grants is compatible with this model because every WW-6 object declares its grants explicitly.

## Definition of Done

- [x] Provider-neutral shipping model implemented.
- [x] Legacy Thailand shipping isolated from global_v2.
- [x] Zone/destination/service configuration implemented.
- [x] Exact product shipping-profile schema implemented with zero guessed backfill.
- [x] Parcel/volumetric/chargeable weight contract implemented.
- [x] Manual rate-tier quote engine implemented.
- [x] Provider-quote adapter boundary defined.
- [x] Immutable/idempotent shipping quote snapshots implemented.
- [x] Duties/tax explicitly excluded pending WW-7.
- [x] Service-role-only profile writer implemented.
- [x] End-to-end rollback quote/profile probes passed with zero residue.
- [x] RLS/grants/advisors reviewed.
- [ ] WW-6 audit passes.
- [ ] Full repository CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
