# WW-7 — Customs & Compliance

Status: implementation  
Date: 2026-10-03

## Goal

Create a fail-closed customs/compliance gate for future international checkout.

WW-7 deliberately does **not** guess:

- HS/tariff classification
- country of origin
- destination legality
- food/cosmetic/agricultural restrictions
- required permits/documents
- import duty, VAT/GST or landed cost

Story copy, product category, product name and AI output are not customs evidence.

## Decision model

The compliance engine returns only:

- `eligible`
- `review_required`
- `prohibited`

`eligible` requires every product line to have:

1. an active customs profile,
2. `verification_status = verified`,
3. a valid explicit classification code,
4. a live/enabled destination rule,
5. destination rule decision = `allowed`.

Missing profile or missing destination rule is **review_required**, never implicitly allowed.

Any explicit prohibited product makes the whole snapshot `prohibited`.

## Product customs profile

`commerce_product_customs_profiles` stores explicit evidence:

- product
- origin country
- classification system
- 6–12 digit classification code
- customs description
- verification state
- evidence metadata
- verification timestamp

WW-7 backfills **zero** profiles.

Production product story/category metadata is not used to derive these values.

## Destination rule

`commerce_customs_destination_rules` binds:

`product + destination country`

to:

- `allowed | review_required | prohibited`
- certification status
- enabled flag
- required document codes
- reason code
- evidence
- validity window

No rule = no automatic export eligibility.

## Market policy

`commerce_customs_market_policies` holds market-level operating policy.

It separates:

- `duty_tax_mode = not_configured | recipient_on_import | prepaid_assessment`
- importer responsibility
- optional terms code
- disclosure key

WW-7 seeds **zero** market policies.

## Duty/tax boundary

WW-7 does not calculate duty/tax.

Every compliance snapshot is locked to:

`duty_tax_status = not_calculated`

There are no duty, VAT/GST or landed-cost amount columns in WW-7.

This prevents a compliance decision from being mistaken for a landed-cost quote.

## Compliance snapshot

`commerce_customs_compliance_snapshots` stores:

- market
- destination
- currency
- exact requested items
- enriched profile/rule evidence per line
- decision
- reasons
- duty/tax status
- environment
- idempotency key

The follow-up migration binds idempotency to the exact request item list. Reusing the same key with changed quantity/items raises:

`customs_snapshot_idempotency_conflict`

## Runtime gate

The server client requires:

- `TAMMA_WW_ENABLED`
- `TAMMA_WW_CUSTOMS_ENABLED`

The database snapshot RPC additionally requires:

- live destination market
- live customs market capability
- enabled market currency
- live/enabled customs market policy
- active/verified OTOP products

Production WW flags remain off.

## Product profile writer

`set_commerce_product_customs_profile_v1` is service-role-only.

It accepts only explicit product/origin/classification/description/verification inputs.

It does not call AI or infer from catalog metadata.

## Production state after WW-7

Production contains:

- product customs profiles: 0
- destination rules: 0
- customs market policies: 0
- compliance snapshots: 0

Therefore no current OTOP item is being claimed as internationally customs-cleared.

This is intentional because current catalog facts are not sufficient to certify HS codes, origin and destination restrictions.

## Rollback-only certification probe

A synthetic TEST-product flow temporarily enabled the inactive test product inside one DB transaction and created a temporary Sweden market/policy.

Observed:

1. missing customs profile/rule → `review_required`
2. synthetic verified profile + live allow rule → `eligible`
3. repeated identical idempotency key → same snapshot
4. same key with changed quantity → idempotency conflict
5. explicit prohibited rule → `prohibited`
6. duty/tax status remained `not_calculated`
7. required document code was preserved in snapshot evidence

After rollback:

- TEST product returned to inactive/unverified
- Sweden rows = 0
- customs profiles = 0
- destination rules = 0
- snapshots = 0

No probe data remains.

## Security

All WW-7 tables:

- RLS enabled
- no anon/authenticated grants
- service_role CRUD only

Customs profile/snapshot RPCs:

- SECURITY DEFINER
- empty search path
- public/anon/authenticated execute revoked
- service_role execute only

Supabase advisors report no WW-7 unindexed FK issue.

Remaining findings are intentional `rls_enabled_no_policy` and expected unused-index INFO while no customs traffic exists.

## Applied production migrations

- `20261003053617_ww7_customs_compliance_core`
- `20261003053715_ww7_customs_snapshot_idempotency_fix`

## Definition of Done

- [x] Explicit product customs profile model implemented.
- [x] Explicit product/destination eligibility rules implemented.
- [x] Missing evidence fails closed.
- [x] Prohibited rule overrides other states.
- [x] Required document codes preserved as evidence.
- [x] Duty/tax calculation separated and left uncalculated.
- [x] Idempotent compliance snapshots implemented and hardened.
- [x] No customs facts backfilled from story/category/AI.
- [x] Service-role-only profile/snapshot RPCs implemented.
- [x] Rollback certification probe passed with zero residue.
- [x] RLS/grants/advisors reviewed.
- [ ] WW-7 audit passes.
- [ ] Full repository CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
