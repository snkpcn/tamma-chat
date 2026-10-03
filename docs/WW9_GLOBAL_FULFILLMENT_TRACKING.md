# WW-9 — Global Fulfillment & Tracking

Status: complete
Date: 2026-10-03

## Goal

Add the post-payment international fulfillment layer after WW-8 without changing Thailand domestic shipping v1.

WW-9 owns:

- carrier booking evidence after a captured global payment
- one order-level shipment with one or more parcel/package records
- encrypted tracking numbers
- carrier label references
- immutable/idempotent tracking events
- safe order shipping-status synchronization
- customer notification outbox
- explicit international return policy + return request boundary

It does not invent a carrier, rate, tracking number, label, return policy, or outbound notification provider.

## Fail-closed booking

A global fulfillment booking can be recorded only when:

1. the order is checkout version 2
2. the order is an international shipping order
3. the payment intent is captured for the full order amount
4. the WW-6 shipping quote is consumed and still matches the order
5. the quote's provider is active + live
6. the provider adapter key exactly matches the certified provider record
7. the shipping service is enabled, live, and execution_mode = global_v2
8. the number of provider packages exactly matches the immutable quote parcel snapshot
9. package indexes are contiguous
10. the carrier result includes a stable idempotency key and SHA-256 evidence hash

WW-9 does not seed any global provider. Production remains unable to record a fake global shipment until a real carrier adapter is certified and configured.

## Tracking model

Provider events are immutable evidence.

Repeated provider_event_id with identical evidence returns the original event. Reusing the same ID with changed evidence fails with tracking_event_idempotency_conflict.

Out-of-order events are still stored, but state_applied=false prevents a late IN_TRANSIT event from rewinding a DELIVERED or RETURNED shipment.

Shipment state is synchronized into the existing otop_orders.shipping_status contract so current backoffice queues keep working.

The global tracking timeline remains the authoritative international evidence.

## Packages and labels

Each shipment can contain multiple packages.

A package may hold:

- provider package ID
- encrypted tracking number
- HTTPS tracking URL
- provider label reference
- label format: PDF / PNG / ZPL

WW-9 stores label references, not guessed or expiring signed label URLs.

## Notification outbox

Every applied customer-visible tracking state creates one idempotent notification outbox item.

WW-9 intentionally does not enable email/SMS/LINE delivery by itself. A later certified channel worker can consume the outbox without changing carrier state.

## International returns

WW-9 introduces per-market return policies.

No policy is seeded.

A member return request is accepted only when:

- the order belongs to that member
- checkout_version = 2
- the shipment and order are delivered
- a market return policy is enabled + live
- the configured return window is still open
- the requested resolution is explicitly allowed

Creating a return request does not automatically refund money. Payment refund execution stays behind the payment-provider boundary.

## Feature gates

Runtime access requires:

- TAMMA_WW_ENABLED
- TAMMA_WW_GLOBAL_PAYMENTS_ENABLED
- TAMMA_WW_GLOBAL_SHIPPING_ENABLED
- TAMMA_WW_CHECKOUT_ENABLED
- TAMMA_WW_FULFILLMENT_ENABLED

All remain fail-closed unless explicitly enabled.

## Security

All WW-9 tables:

- RLS enabled
- no anon/authenticated grants
- explicit service-role grants only

All WW-9 privileged RPCs:

- SECURITY DEFINER
- empty search_path
- PUBLIC/anon/authenticated execute revoked
- service_role execute only

Tracking numbers are encrypted in the server layer before they are written to the database.

## Domestic isolation

No domestic shipping table, fee calculation, PromptPay path, or checkout-v1 RPC is modified.

The legacy Thailand carrier stays legacy_v1 and cannot pass the WW-9 global booking gate.


## Applied production migrations

Production schema is installed and remains dormant until worldwide fulfillment is explicitly enabled.

- `20261003082949_ww9_global_fulfillment_tracking`
- `20261003083446_ww9_tracking_notification_conflict_fix`
- `20261003083705_ww9_fulfillment_fk_indexes`

The conflict hotfix fixes a PL/pgSQL name collision discovered by the rollback-only tracking probe before any real global shipment existed.

## Rollback-only E2E certification

A synthetic test transaction exercised the production RPCs end to end:

1. authorized test member + test guest
2. synthetic Sweden/SEK market
3. synthetic captured global payment
4. synthetic consumed global shipping quote
5. carrier booking with one package + label
6. `PICKED_UP` -> order `shipped`
7. `DELIVERED` -> order `delivered/completed`
8. late `IN_TRANSIT` event stored with `state_applied=false` and did not rewind delivery
9. explicit live test return policy
10. member replacement return request accepted

The probe intentionally ended by raising `WW9_PROBE_PASS`, rolling back the whole transaction.

Post-probe production counts:

- fulfillment shipments: 0
- packages: 0
- tracking events: 0
- notification outbox: 0
- return policies: 0
- return requests: 0
- synthetic markets/providers/users/test actors: 0
- live global-v2 shipping services: 0
- live non-legacy global carriers: 0

## Advisor verification

- WW-9 tables are RLS-enabled with no anon/authenticated table grants.
- WW-9 privileged RPCs are service-role-only.
- Foreign-key advisor findings introduced by WW-9 are fully covered by indexes.
- Remaining WW-9 advisor notices are INFO-only:
  - RLS enabled with no policies: intentional for service-role-only server tables.
  - unused indexes: expected while fulfillment is dormant and tables are empty.

## Definition of Done

- [x] Provider-neutral carrier booking evidence exists.
- [x] Booking requires checkout v2, captured payment, consumed quote, and a live global-v2 carrier service.
- [x] Multi-package tracking and label references are supported.
- [x] Tracking numbers are encrypted server-side.
- [x] Tracking events are immutable and idempotent.
- [x] Out-of-order events cannot rewind terminal shipment state.
- [x] Existing order shipping status remains synchronized for backoffice compatibility.
- [x] Customer notification outbox is idempotent and does not auto-enable a delivery channel.
- [x] International returns require an explicit live market policy.
- [x] Domestic checkout/shipping v1 remains unchanged.
- [x] Production migration + conflict hotfix + FK indexes are applied.
- [x] Rollback-only E2E certification passed with zero residue.
- [x] Security and performance advisors reviewed.
- [x] Worldwide carrier/service/return data remains fail-closed.
