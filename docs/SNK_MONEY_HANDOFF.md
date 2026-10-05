# SNK MONEY × THONGTHAI — private personal-finance LINE channel

Scope: `PERSONAL_FINANCE_PRIVATE`. Built inside the existing Thongthai stack (Netlify Functions + Supabase + LINE).
No new app, repo, Supabase/Vercel project or domain. **Default OFF** (`SNK_MONEY_ENABLED=0`).

## What it is (and is not)

* An **internal ledger** driven by what the owner says in one private LINE group. There is **no bank connection, no bank API,
  no transfers, no live bank balance**. Every balance is `CONFIRMED` (owner stated it), `DERIVED` (confirmed balance + later
  recorded movements) or `UNKNOWN`. **Unknown is never 0** (DB constraint: `UNKNOWN ⇔ balance IS NULL`).
* Restating a balance writes an `ADJUSTMENT` for the gap — it never fabricates an expense/income to make numbers match.
* All arithmetic is in Postgres (`pf_*` RPCs). The LLM only *proposes* a structured intent; amounts must literally appear in
  the owner's message and a model-proposed write is capped at "medium" confidence, i.e. it always asks first.

## Code map

| Piece | File |
|---|---|
| Migration (tables, guards, engine, binding, reminders, views, RLS) | `supabase/migrations/20261005120000_snk_money_personal_finance_v1.sql` |
| Pure helpers (amounts, negation, dates, accounts, roles, persona) | `netlify/functions/_personal-finance-core.ts` |
| Interpreter (rules first, injectable LLM fallback, validator) | `netlify/functions/_personal-finance-nlu.ts` |
| Typed RPC client (`finance.*` tool contract) | `netlify/functions/_personal-finance-ledger.ts` |
| Channel handler: binding, authz, state machine, slips, replies | `netlify/functions/_personal-finance.ts` |
| Reminders (scheduled, hourly 08:00–21:00 Bangkok) | `netlify/functions/personal-finance-reminders.ts`, `_personal-finance-reminders.ts` |
| Webhook hook (before every business handler) | `netlify/functions/line-webhook.ts` → `routePersonalFinanceEvent` |

`finance.*` contract → `PfLedger`: get_accounts, get_balance, set_owner_balance, create_transaction, correct_transaction,
void_transaction, get_recent_transactions, create_recurring, update_recurring, mark_due_paid, list_upcoming, get_summary,
create_category.

Data flow to AI vendors (existing pattern, no new vendor): the interpreter's LLM fallback sees only the single message text and
account *names* (never balances) and only when the rules cannot place finance-looking text; slip images go through the existing
`extractFinancialEvidence` (Gemini → OpenAI) and are **not stored** (only the SHA-256 is kept for de-duplication).

## Secure group binding

1. Bot is added → LINE `join` event → `pf_binding_capture` stores the **hashed** group id (+ AES-GCM encrypted id for pushes)
   as `PENDING`. **Capturing grants nothing.** The bot stays silent.
2. The owner types `ยืนยันกลุ่มการเงิน` in that group. Activation requires a PENDING (or owner-recovered) row **and** either
   a sender whose LINE userId is in `PF_OWNER_LINE_USER_IDS`, or a valid one-time code (`pf_binding_issue_code`, stored as a
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

1. Apply the migration to the **existing production Supabase** (`supabase db push` or the SQL editor).
2. Netlify env: `SNK_MONEY_ENABLED=1`, `PF_OWNER_LINE_USER_IDS=<owner LINE userId>` (comma list), optional
   `PF_FINANCE_MEMBER_LINE_USER_IDS`. Existing `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `LINE_CHANNEL_*`,
   `CUSTOMER_PII_ENCRYPTION_KEY`, `OPENAI_API_KEY`/`GEMINI_API_KEY` are reused.
3. Deploy. Only then invite Thongthai to the "SNK MONEY" group and type `ยืนยันกลุ่มการเงิน`.
4. Say `บัญชีใช้จ่ายตอนนี้เหลือ 85,000`, then `ช่วยอะไรได้บ้าง`.

Rollback: set `SNK_MONEY_ENABLED=0` (webhook routing and reminders stop instantly; data stays). The migration is additive.

## Dashboard (SNK OS Money)

Read-only, security-invoker views (service_role only; RLS denies clients): `pf_account_balances_summary_v1`,
`pf_recent_transactions_summary_v1`, `pf_upcoming_obligations_summary_v1`, `pf_month_cashflow_summary_v1`; plus RPCs
`pf_get_summary`, `pf_list_upcoming`, `pf_forecast`, `pf_get_accounts`. The SNK LIFE OS UI lives outside this repository and must
read them **server-side** with the service-role key. Forecasts are always labelled as forecasts and never overwrite a balance.

## Tests

`npm run audit:snk-money` (also part of `npm test`). The migration is executed for real against PGlite (Postgres 18 in WASM), so
balance arithmetic, idempotency, constraints, audit immutability, grants and reminder claiming are tested against the actual SQL.
Includes the 18 natural-language scenarios and the mocked join→pending→verify→active binding fixture (no bot invited).

Known limits: PGlite is single-connection, so true multi-connection races are covered by design (row `FOR UPDATE` locks +
transaction-scoped advisory lock on the idempotency key) and by retry-idempotency tests, not by a concurrent-connection test.
