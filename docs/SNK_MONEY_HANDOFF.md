# SNK MONEY × THONGTHAI — private personal-finance LINE channel

Scope: `PERSONAL_FINANCE_PRIVATE`. Built inside the existing Thongthai stack (Netlify Functions + Supabase + LINE).
No new app, repo, Supabase/Vercel project or domain. **Default OFF** (`SNK_MONEY_ENABLED=0`).

## What it is (and is not)

* An **internal ledger** driven by what the owner says in one private LINE group. There is **no bank connection, no bank API,
  no transfers, no live bank balance**. Every balance is `CONFIRMED` (owner stated it), `DERIVED` (confirmed balance + later
  recorded movements) or `UNKNOWN`. **Unknown is never 0** (DB constraint: `UNKNOWN ⇔ balance IS NULL`).
* Restating a balance writes an `ADJUSTMENT` for the gap — it never fabricates an expense/income to make numbers match.
* All arithmetic is in Postgres (`finance_*` RPCs). The LLM only *proposes* a structured intent; amounts must literally appear in
  the owner's message and a model-proposed write is capped at "medium" confidence, i.e. it always asks first.

## Where the data lives (decision: extend the EXISTING SNK OS Money model)

The ledger is **not** in the Thongthai/customer Supabase project. It extends the existing SNK LIFE OS project
(`snk-life-os-private`, `pbbihfipfbpiqbiqlagd`) that the Money dashboard already reads:

| Existing table | Extended with |
|---|---|
| `financial_accounts` | `current_balance`, `balance_status` (CONFIRMED/DERIVED/UNKNOWN), `balance_confirmed_*` |
| `transactions` | `type` now allows `transfer` + `adjustment`; `status`, `seq`, correction links, void fields, slip ref/hash, `source_*`, `idem_key`, generated `occurred_on`/`payee_key` |
| `recurring_transactions` | frequencies `once/custom_days/installment`, `reminder_days`, installments, `status`, nullable `amount` (variable bills) |
| `transaction_categories`, `user_settings`, `activity_log` | reused as-is (categories, reminder default, **audit trail**; finance audit rows are append-only) |

New tables: `finance_channel_bindings`, `finance_obligation_payments`, `finance_reminder_deliveries`, `finance_idempotency`,
`finance_pending_states`. Migration: `supabase/snk-os/20261005130000_snk_money_v1.sql` (identical copy tracked in
`snkpcn/snk-life-os/supabase/migrations/`; in production it was applied as 10 ordered parts named `snk_money_v1_*`, whose function bodies were verified byte-for-byte against this file). It is deliberately **not** under `supabase/migrations/` of this repo (that folder
belongs to the Thongthai project).

**Single balance path.** `current_balance` is a pure derivation: last owner-confirmed amount + non-archived `CONFIRMED`
movements recorded after it, recomputed by a trigger on every `transactions` change. Rows written by the chat engine *and*
rows edited in the dashboard go through the same derivation; clients cannot write the balance columns (guard trigger). Voiding
archives the row (`archived_at`, which the existing dashboard stats already exclude).

## Code map

| Piece | File |
|---|---|
| SNK OS migration (extensions, engine, binding, reminders, views, RLS) | `supabase/snk-os/20261005130000_snk_money_v1.sql` |
| Pure helpers (amounts, negation, dates, accounts, roles, persona) | `netlify/functions/_personal-finance-core.ts` |
| Interpreter (rules first, injectable LLM fallback, validator) | `netlify/functions/_personal-finance-nlu.ts` |
| Typed RPC client (`finance.*` tool contract, owner-scoped) | `netlify/functions/_personal-finance-ledger.ts` |
| Channel handler: binding, authz, state machine, slips, replies | `netlify/functions/_personal-finance.ts` |
| Reminders (scheduled, hourly 08:00–21:00 Bangkok) | `netlify/functions/personal-finance-reminders.ts`, `_personal-finance-reminders.ts` |
| Webhook hook (before every business handler) | `netlify/functions/line-webhook.ts` → `routePersonalFinanceEvent` |
| Test fixture = faithful copy of the existing SNK schema | `tests/fixtures/snk-os-base.sql` |

`finance.*` contract → `PfLedger`: get_accounts, get_balance, set_owner_balance, create_transaction, correct_transaction,
void_transaction, get_recent_transactions, create_recurring, update_recurring, mark_due_paid, list_upcoming, get_summary,
create_category.

## Secure group binding

1. Bot is added → LINE `join` event → `finance_binding_capture` stores the **hashed** group id (+ AES-GCM encrypted id for pushes)
   as `PENDING`. **Capturing grants nothing.** The bot stays silent.
2. The owner types `ยืนยันกลุ่มการเงิน` in that group. Activation requires a PENDING (or owner-recovered) row **and** either
   a sender whose LINE userId is in `PF_OWNER_LINE_USER_IDS`, or a valid one-time code (`finance_binding_issue_code`, stored as a
   hash, 5-attempt lockout, 30-min expiry).
3. Exactly one `ACTIVE` finance group is allowed (partial unique index). The group **name is never an identity**.
4. A group already bound to a business team (`ops_notification_channels`) can never become the finance group.
5. An ACTIVE finance group is routed **exclusively** to the finance handler — business handlers (owner expense, payroll,
   `ผูกทีม`, fuel, …) never see its messages. If the binding lookup fails the event is dropped (fail closed).
6. Removing the bot (`leave`) revokes the binding.

Roles: `OWNER` (full), `AUTHORIZED_FINANCE_MEMBER` (`PF_FINANCE_MEMBER_LINE_USER_IDS`; record, mark paid, read — no balance
setting, history edits, structure/settings), `UNAUTHORIZED_MEMBER` (gets no data; finance-looking text gets one neutral
refusal and an `UNAUTHORIZED_ATTEMPT` audit row). With no owner ids configured nobody is an owner (fail closed).

## Enabling in production (owner / operator checklist)

1. The SNK OS migration is applied to `snk-life-os-private` (tracked in `snkpcn/snk-life-os`).
2. Netlify env (site that serves `line-webhook`): `SNK_OS_SUPABASE_URL` (https://pbbihfipfbpiqbiqlagd.supabase.co),
   `SNK_OS_SERVICE_ROLE_KEY` (the SNK OS project's service-role key — a secret, never committed), `SNK_MONEY_OWNER_ID`
   (the owner's `auth.users.id` in the SNK OS project — NOT guessed; two users exist there), `PF_OWNER_LINE_USER_IDS`
   (owner's LINE userId), optional `PF_FINANCE_MEMBER_LINE_USER_IDS`, and finally `SNK_MONEY_ENABLED=1`.
   Existing `LINE_CHANNEL_*`, `CUSTOMER_PII_ENCRYPTION_KEY`, `OPENAI_API_KEY`/`GEMINI_API_KEY` are reused. The Thongthai
   `SUPABASE_*` variables are never used for the ledger.
3. Merge/deploy `tamma-chat` (webhook + scheduler) and `snk-life-os` (dashboard).
4. Only then invite Thongthai to the "SNK MONEY" group and type `ยืนยันกลุ่มการเงิน`.
5. Say `บัญชีใช้จ่ายตอนนี้เหลือ 85,000`, then `ช่วยอะไรได้บ้าง`.

If any of the three ledger env vars is missing the feature stays inert and business groups are unaffected.
Rollback: `SNK_MONEY_ENABLED=0` (routing and reminders stop; data stays). The migration is additive.

## Dashboard (SNK OS Money)

The existing Money overview now shows account balances with CONFIRMED / DERIVED / UNKNOWN badges, total available (known
balances only), month income/expense/net, today/week/month, upcoming 7/30 days and overdue, with drill-down into the existing
Transactions tab (`snkpcn/snk-life-os`, `components/money-cash-overview.tsx`). It reads owner-scoped, security-invoker views
(`finance_account_balances_v1`, `finance_month_cashflow_v1`, `finance_upcoming_v1`, `finance_recent_transactions_v1`) through RLS as
the logged-in owner. Forecasts are always labelled as forecasts and never overwrite a balance.

## Tests

`npm run audit:snk-money` (also part of `npm test`). The migration is executed for real against PGlite (Postgres 18 in WASM), so
balance arithmetic, idempotency, constraints, audit immutability, grants and reminder claiming are tested against the actual SQL.
Includes the owner's exact 18 acceptance cases (`personal-finance-spec22.test.ts`), the broader scenario suite and the mocked join→pending→verify→active binding fixture (no bot invited).

Known limits: PGlite is single-connection, so true multi-connection races are covered by design (row `FOR UPDATE` locks +
transaction-scoped advisory lock on the idempotency key) and by retry-idempotency tests, not by a concurrent-connection test.

## Production status (snk-life-os-private, applied this session)

* Migration applied (10 tracked parts); function bodies verified identical to the tested file; Supabase security advisor clean for this
  change (only the pre-existing Auth "leaked password protection" warning remains).
* Verified on production inside a rolled-back transaction: set balance, expense/income/transfer arithmetic, webhook-retry idempotency,
  correction, adjustment-not-expense, unknown-is-not-zero, pending-clarification parking, void semantics, recurring payment + next due,
  dashboard (authenticated) writes flowing through the same derivation and being audited, clients unable to write balances, group
  binding (unverified activation refused, owner activation works, second group refused), append-only audit. No residue was left.
* The owner's two pre-existing, same-named accounts were not touched; they stay `UNKNOWN` until the owner states a balance. Because of
  them there is deliberately no unique index on account names (the engine de-duplicates names for NEW accounts); the interpreter will
  ask which one is meant if a name is ambiguous — rename one of them in the dashboard.
* Which auth user is the owner? The user that owns the existing accounts is `3a2fc42f-0170-4cdf-a7f2-ee43f680663b`
  (a second auth user exists). Set `SNK_MONEY_OWNER_ID` explicitly; this repo never guesses it.

## Not done / needs the owner

* Netlify env vars (secrets) and `SNK_MONEY_ENABLED=1`; merging/deploying `tamma-chat` and `snk-life-os` (branches
  `claude/snk-life-os-audit-u77d7n` / `claude/snk-money-dashboard`; no PR was opened).
* End-to-end test with a real LINE group (the bot is not in it yet, by design); LINE signature verification is the existing
  `line-webhook` gate and was not changed.
