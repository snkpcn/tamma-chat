# WW-5 — Global Payment Core

Status: implementation
Date: 2026-10-03

## Goal

Create a provider-neutral payment core for future worldwide checkout without replacing or weakening the current Thailand PromptPay flow.

The existing domestic payment system remains:

- `payment_requests`
- THB only
- `promptpay_owner_qr` only
- slip upload
- staff Verify/Reject
- current LINE/backoffice workflow

WW-5 adds a separate global-v2 intent/event core that is dormant until a real provider is connected and certified.

## Provider registry

`commerce_payment_providers` records provider identity and adapter ownership.

WW-5 seeds only the provider that already exists operationally:

`legacy_promptpay_owner / legacy_promptpay_v1`

It is descriptive of the current system and contains no new credentials.

No external gateway provider is invented or seeded.

## Market payment methods

`commerce_market_payment_methods` binds:

`market + provider + currency + payment method`

to:

- execution mode
- certification status
- enabled state
- priority

Thailand is seeded as:

- market: TH
- currency: THB
- method: `promptpay_owner_qr`
- provider: `legacy_promptpay_owner`
- execution: `legacy_v1`
- status: live

There are **zero** live `global_v2` methods in production after WW-5.

This means the new global intent engine cannot accidentally take over PromptPay.

## Global payment intent

`commerce_payment_intents` stores immutable transaction evidence:

- source entity
- customer reference
- market
- currency
- amount in minor units
- provider
- payment method
- idempotency key
- environment
- provider intent reference
- payment status
- captured/refunded amount evidence

Core immutable fields cannot be changed after creation.

Allowed statuses:

- created
- requires_action
- processing
- authorized
- captured
- failed
- cancelled
- partially_refunded
- refunded

The database trigger enforces legal state transitions.

## Idempotency

Intent creation requires a strong idempotency key.

Calling the create RPC again with the same key and the same immutable transaction returns the existing intent.

Reusing the key with different market/currency/amount/provider/method raises:

`payment_intent_idempotency_conflict`

## Provider events / webhooks

`commerce_payment_events` stores normalized provider evidence only.

It stores:

- provider event ID
- event type
- provider object ID
- currency/amount when relevant
- money semantics
- signature verification result
- SHA-256 payload digest
- processing state

It deliberately does **not** store:

- raw card number / PAN
- CVC/CVV
- provider API secrets
- client secrets
- raw webhook payload as transaction authority

Provider event IDs are unique per provider, making webhook retry handling idempotent.

If the same event ID arrives with different normalized evidence/digest, the RPC raises:

`provider_event_id_conflict`

## Signature boundary

An unverified provider event can be recorded as rejected for audit, but it cannot change a payment intent.

`apply_commerce_payment_event_v1` requires:

- verified signature
- matching provider
- matching provider object when already known
- valid state transition
- matching currency
- matching intent total for authorization/capture evidence
- refund delta not exceeding captured amount

Only then can the payment state move.

## Money semantics

Provider adapters normalize event money into one of:

- `none`
- `intent_total`
- `refund_delta`

`intent_total` must equal the exact payment intent currency and amount.

`refund_delta` accumulates against captured amount and can never exceed it.

This prevents provider-specific webhook shapes from leaking directly into transaction logic.

## Runtime feature gate

The server loader requires:

- `TAMMA_WW_ENABLED`
- `TAMMA_WW_GLOBAL_PAYMENTS_ENABLED`

It also requires:

- live market
- live payments market capability
- enabled market currency
- enabled/live payment method
- `execution_mode = global_v2`
- active/live provider

Because production has zero live `global_v2` methods and all WW env flags remain off, this core is dormant.

## Credentials

WW-5 stores no external provider credentials in these tables or source files.

When a real payment provider is selected, its secret credentials must live only in server-side secret/environment configuration and the provider adapter must verify webhooks before recording/applying events.

## Rollback-only production probes

### Capture + refund probe

A temporary test provider/method was created inside a DB transaction.

Verified flow:

1. create payment intent
2. record verified capture event
3. apply captured state
4. record refund-delta event
5. apply partial refund
6. verify captured/refunded amounts
7. rollback

Observed before rollback:

- status: partially_refunded
- amount_minor: 12345
- captured_amount_minor: 12345
- refunded_amount_minor: 2345
- applied events: 2

After rollback:

- provider residue: 0
- intent residue: 0
- event residue: 0

### Idempotency + signature probe

Verified:

- repeated intent idempotency key → same intent
- repeated provider event ID + same evidence → same event, duplicate=true
- unverified event → rejected
- rejected event cannot move intent from created
- rollback left zero residue

## Legacy protection

Direct attempt to create a global-v2 intent with:

`legacy_promptpay_owner / promptpay_owner_qr`

was rejected with:

`global_payment_method_not_ready`

No intent was persisted.

The existing `payment_requests` THB and PromptPay database constraints remain unchanged.

## Applied production migrations

- `20261003044411_ww5_global_payment_core`
- `20261003044532_ww5_apply_event_alias_fix`
- `20261003044633_ww5_payment_fk_indexes`

The alias-fix migration was created after the first rollback-only probe found a PL/pgSQL column/output-name ambiguity in event application. The probe caught it before any real provider or customer transaction could use the core.

## Security

All new WW-5 tables:

- have RLS enabled
- expose no anon/authenticated table grants
- grant CRUD only to service_role

All transaction/event RPCs:

- are SECURITY DEFINER
- use an empty search path
- revoke execute from public/anon/authenticated
- grant execute only to service_role

Supabase advisor `rls_enabled_no_policy` findings are intentional for these server-only objects.

WW-5-created foreign-key index findings were repaired. Remaining `unused_index` INFO is expected while global payments have no production traffic.

## Definition of Done

- [x] Provider-neutral provider registry implemented.
- [x] Market/currency/payment-method configuration implemented.
- [x] Current PromptPay mapped as legacy_v1, not global_v2.
- [x] Global payment intent/idempotency model implemented.
- [x] Provider event dedupe/digest/signature model implemented.
- [x] Payment state machine implemented.
- [x] Capture/refund money evidence bounded.
- [x] Service-role-only intent/event RPCs implemented.
- [x] End-to-end rollback probes passed with zero residue.
- [x] No real external provider invented or enabled.
- [x] Existing THB/PromptPay constraints preserved.
- [x] Production migrations applied and advisors reviewed.
- [ ] WW-5 audit passes.
- [ ] Full repository CI passes.
- [ ] Production deploy on merged main is ready.
- [ ] WW flags remain deliberately controlled after deploy.
