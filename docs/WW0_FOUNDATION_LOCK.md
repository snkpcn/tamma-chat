# WW-0 — Worldwide Foundation Lock

Status: implementation baseline  
Date: 2026-10-03  
Production baseline: `main` at WW-0 start = `0e807b3ba0374be0aeb253eef54194a74fb13625`

## Goal

Prepare the existing Thammachat / OTOP commerce system for worldwide expansion without changing the behavior of Thai production.

WW-0 is an architecture and rollout lock, not a worldwide launch. It deliberately avoids a database rewrite, new project, new site, new checkout, or destructive migration.

## Non-negotiable rules

1. Existing Thai production remains the source of truth and must continue to work unchanged.
2. Worldwide work is additive: extend the current repo, Netlify site, Supabase project, checkout, backoffice, and Thongthai.
3. No downtime migration and no destructive rewrite.
4. Every future schema change must remain backward-compatible with the currently deployed domestic code until its owning capability flag is enabled.
5. All worldwide capabilities are fail-closed behind `TAMMA_WW_ENABLED` plus their own capability flag.
6. Existing live OTOP products stay LIVE. Development and certification use TEST where transaction testing is needed.
7. No RLS/access-model redesign in WW-0. Existing server-only/service-role boundaries stay intact.
8. A conversation or remembered preference never authorizes a transaction.

## Production architecture audit

| Area | Decision | WW-0 lock |
| --- | --- | --- |
| SKU + OTOP master product identity | KEEP | Existing SKU remains canonical. |
| Inventory + stock locking | KEEP | Do not create a second stock system. |
| Atomic/idempotent OTOP checkout | KEEP | Existing idempotency and row locking remain transaction authority. |
| `otop_orders` / `otop_order_items` | KEEP + EXTEND LATER | Global fields are additive; old rows and domestic writes remain valid. |
| Payment request lifecycle | KEEP + EXTEND LATER | Current PromptPay/THB path remains domestic. Global providers are additional paths. |
| Shipping state machine + tracking | KEEP + EXTEND LATER | Status semantics stay shared; quote/routing logic gains global providers/zones later. |
| Customer accounts + encrypted PII | KEEP | Reuse current account and encryption boundary. |
| Customer addresses | EXTEND | Current schema/normalizer is Thai-shaped; WW-2 adds International Address V2 without breaking old Thai writes. |
| Product pricing | EXTEND | Current `otop_products.price` remains the domestic THB price. Multi-currency uses an additive price layer; do not reinterpret the existing column. |
| Currency on payments | KEEP + EXTEND | `payment_requests.currency` already defaults to THB; global payment paths must set explicit transaction currency. |
| OTOP shipping settings | EXTEND | Current singleton remains domestic config. Global shipping gets separate zones/rates/providers. |
| Promotions | KEEP | Shared Promotion OS and `business_scope` remain; OTOP policy guard stays OTOP-specific. |
| Supabase + backoffice | KEEP | No parallel database/backoffice. |
| Thongthai | KEEP + EXTEND | Same brain/channels; worldwide knowledge/actions are capability-gated. |
| Domestic checkout UI/API | KEEP | No route or contract replacement in WW-0. |
| REPLACE items | NONE | WW-0 authorizes no core replacement. |
| DEPRECATE items | NONE | Deprecation requires a later migration with proven replacement and rollback. |

## Runtime rollout contract

Master kill switch:

- `TAMMA_WW_ENABLED=0` by default.

Capability switches, also default OFF:

- `TAMMA_WW_DATA_CORE_ENABLED`
- `TAMMA_WW_ADDRESS_V2_ENABLED`
- `TAMMA_WW_STOREFRONT_ENABLED`
- `TAMMA_WW_MULTI_CURRENCY_ENABLED`
- `TAMMA_WW_GLOBAL_PAYMENTS_ENABLED`
- `TAMMA_WW_GLOBAL_SHIPPING_ENABLED`
- `TAMMA_WW_CUSTOMS_ENABLED`
- `TAMMA_WW_CHECKOUT_ENABLED`
- `TAMMA_WW_FULFILLMENT_ENABLED`
- `TAMMA_WW_THONGTHAI_ENABLED`

A capability is enabled only when both the master switch and that capability switch are explicitly truthy. Missing variables always mean OFF.

Domestic commerce baseline is locked to country `TH` and currency `THB`. Public UI language remains independent from transaction country/currency.

## Migration inventory for later WW phases

WW-0 itself applies **no production DDL**. The following inventory is the approved direction for later phases.

### WW-1 — Global Data Core

Additive global reference/config objects for supported countries, currencies, locales and per-country capability status. Existing product/order tables continue to operate if these objects are absent or disabled.

### WW-2 — International Address V2

Extend the address model with an explicit ISO country code and international administrative/locality fields. Existing Thai fields remain valid. Old clients that omit country must continue to resolve as Thailand during the compatibility window.

Do not remove or rename `district`, `province`, current encrypted address fields, or the existing address API until migration and rollback are certified.

### WW-3 — Multilingual Storefront

Extend presentation/content records only. No transaction schema rewrite. The existing five-language public foundation stays valid.

### WW-4 — Multi-Currency

Keep `otop_products.price` as the canonical domestic THB price.

Add a separate product price/currency layer for supported currencies. Orders must store the currency that was actually charged; historical `unit_price` remains immutable transaction evidence.

### WW-5 — Global Payment Core

Keep the current PromptPay owner QR path for domestic THB.

Add provider/payment-method routing rather than weakening the existing method contract. Global payment records must preserve provider reference, currency, amount, status, idempotency and auditability.

### WW-6 — Worldwide Shipping Engine

Keep the current domestic `otop_shipping_settings` singleton and shipping status machine.

Add shipping zones, service/provider quotes, destination eligibility and quote snapshots. A global quote must never silently fall back to the domestic 60 THB rule.

### WW-7 — Customs & Compliance

Add customs classification/origin/declaration data without embedding customs state into the domestic product price field. Country eligibility must fail closed when required data is missing.

### WW-8 — International Checkout

Build on the existing atomic/idempotent checkout boundary. Global checkout must not create an order unless address, shipping, currency, payment eligibility and country compliance all agree.

### WW-9 — Fulfillment & Tracking

Reuse the existing shipping lifecycle and tracking concepts. Add provider-specific metadata without forking customer-visible order truth.

### WW-10 — Thongthai Worldwide

Thongthai can explain and initiate only capabilities that the country/capability layer says are enabled. It must not invent taxes, duties, delivery promises, provider availability or payment success.

## Database compatibility policy

Every future WW migration must obey all of these:

- additive first: new nullable/defaulted columns, new tables, new indexes, or versioned RPCs;
- no rename/drop/type rewrite while old production code can still run;
- preserve current defaults needed by domestic callers;
- old RPC signatures remain callable until all deployed callers have moved;
- new public-schema objects get explicit grants/revokes; never rely on platform default exposure;
- RLS remains enabled on exposed tables; service-role-only objects stay service-role-only unless a reviewed customer access requirement exists;
- `SECURITY DEFINER` functions must use an empty/pinned search path, schema-qualified objects, and explicit execute grants;
- migrations must be reversible operationally through feature flags even when SQL rollback is not desirable;
- run regression tests and database advisors after every DDL phase.

## Live baseline verified during WW-0 audit

- `customer_addresses` is currently Thailand-shaped and server/service-role managed.
- `otop_products` has one current `price` field and existing live SKU/stock truth.
- `payment_requests.currency` exists with a THB default.
- `otop_shipping_settings` is currently a domestic singleton.
- `create_member_otop_order_v1` is a security-definer RPC restricted from anon/authenticated and executable by service role.
- Existing OTOP checkout computes authoritative product prices from live verified products and preserves stock/idempotency rules.

## WW-0 Definition of Done

- [x] Existing architecture audited as KEEP / EXTEND / REPLACE / DEPRECATE.
- [x] Domestic/global boundary documented.
- [x] Master worldwide feature flag exists and defaults OFF.
- [x] Capability flags exist and cannot bypass the master switch.
- [x] Domestic TH/THB baseline is explicit.
- [x] Thai address and domestic shipping regression contracts are covered by tests.
- [x] Future migration surface is inventoried.
- [x] Backward-compatibility rules are locked.
- [x] WW-0 itself requires no production DB migration or downtime.
- [ ] PR CI passes on the implementation branch.
- [ ] Merge/deploy verification passes on `main`.

WW-0 is complete only after the final two gates are green.
