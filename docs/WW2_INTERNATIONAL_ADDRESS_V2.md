# WW-2 — International Address V2

Status: implementation
Date: 2026-10-03

## Goal

Extend the existing member address book so it can represent international delivery addresses without breaking the current Thailand address contract or accidentally applying Thailand shipping rules to foreign destinations.

## Compatibility contract

### Address V1 — Thailand

Existing requests remain V1 when they omit `countryCode` or use `TH` without explicitly asking for V2.

V1 keeps the current required fields and behavior:

- Thai phone normalization
- address line 1
- district
- province
- 5-digit Thai postal code
- current domestic shipping calculation
- current `create_member_otop_order_v1` checkout path

Existing rows default to:

- `address_schema_version = 1`
- `country_code = TH`

No customer migration is required.

### Address V2 — International

V2 adds generic international concepts:

- `countryCode`
- `organization` (optional)
- `dependentLocality` (optional)
- `locality` (required)
- `administrativeArea` (optional)
- `postalCode` (optional because not every country uses one)
- E.164 recipient phone
- existing address lines and delivery notes

Sensitive free-text location fields remain encrypted at rest.

Country code is stored independently from market launch state. Saving an address does **not** mean Thammachat ships to that country.

## Feature gate

Creating or updating an Address V2 record requires both:

- `TAMMA_WW_ENABLED`
- `TAMMA_WW_ADDRESS_V2_ENABLED`

Missing/off flags keep production on the existing Thai form and V1 behavior.

The address API exposes the evaluated `features.addressV2` state so the account page can reveal the international form only when the server capability is enabled.

## Domestic checkout safety boundary

WW-2 deliberately does **not** launch international shipping.

Both application code and the database transaction RPC reject any selected address when:

- `country_code <> TH`, or
- `address_schema_version <> 1`

with:

`international_shipping_not_enabled`

This check occurs before the domestic shipping quote can be accepted. WW-6 and WW-8 will introduce versioned global shipping/checkout paths rather than weakening the V1 domestic rule.

## Applied production migrations

- `20261003035040_ww2_international_address_v2`
- `20261003035447_ww2_domestic_checkout_address_guard`

## Security

- Existing `customer_addresses` RLS remains enabled.
- Direct `anon` and `authenticated` grants remain absent.
- `service_role` remains the server data boundary.
- New organization/locality/administrative-area values are encrypted.
- Domestic checkout RPC remains `SECURITY DEFINER` with empty search path and explicit execute grants.
- Supabase advisor still reports the informational server-only `rls_enabled_no_policy` item; this is intentional because direct client grants are revoked.
- The new country index may show as unused immediately after creation because the address table currently has no production rows.

## Definition of Done

- [x] V1 Thailand address compatibility preserved.
- [x] V2 generic international normalization implemented.
- [x] Non-Thai phone requires E.164.
- [x] Postal code is optional for V2.
- [x] Address V2 persistence is WW feature-gated.
- [x] Account UI is feature-gated and five-language complete.
- [x] Address PII remains encrypted.
- [x] Domestic TypeScript checkout rejects V2/non-TH.
- [x] Domestic Postgres RPC independently rejects V2/non-TH.
- [x] Production migrations applied and verified.
- [x] RLS/grants and advisors reviewed.
- [ ] WW-2 CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
