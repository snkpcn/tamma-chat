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

## Secure group binding (v2: the owner is resolved from the binding, nothing to configure)

1. Bot is added → LINE `join` → `finance_binding_capture_pending` stores the **hashed** group id (+ AES-GCM encrypted id for pushes)
   as an **owner-less `PENDING`** row. **Capturing grants nothing.** Thongthai replies once ("พบกลุ่มใหม่ครับ …").
2. In SNK LIFE OS → Money → Overview the signed-in owner presses *Generate code* (`finance_issue_binding_code`, authenticated only):
   a 15-minute, single-use code, stored as a hash. The owner types `ยืนยันกลุ่มการเงิน SNK-xxxxxxxx` in the group.
   `finance_binding_activate_code` verifies the hash, expiry, single use and a 5-attempt per-group lockout, then makes the group
   `ACTIVE` for **the owner who minted the code** and records the typing LINE user (hashed) as `OWNER` in `finance_members`.
3. Exactly one `ACTIVE` finance group per owner (partial unique index). The group **name is never an identity**.
4. A group already bound to a business team (`ops_notification_channels`) can never become the finance group.
5. An ACTIVE finance group is routed **exclusively** to the finance handler — business handlers never see its messages. If the
   binding lookup fails the event is dropped (fail closed). Removing the bot (`leave`) or *Disconnect* in the dashboard revokes it.
6. Legacy/operator path (optional): if `SNK_MONEY_OWNER_ID` **and** `PF_OWNER_LINE_USER_IDS` are both set, that LINE user may activate
   with the bare phrase (no code). Normally unset.

Roles: `OWNER` (DB member created by code activation, or env), `AUTHORIZED_FINANCE_MEMBER` (`PF_FINANCE_MEMBER_LINE_USER_IDS`; record,
mark paid, read), `UNAUTHORIZED_MEMBER` (gets no data; one neutral refusal + audit row for finance-looking text).

## Daily life + money coach (verified SNK MONEY group only)

* **Morning** (hourly cron `5 0-3,14-16 * * *` UTC; window 07:00–10:59 Bangkok; claimed once per owner/day in
  `finance_coach_deliveries`): one brief from real SNK LIFE OS rows — today's priorities, open/overdue tasks, today's schedule
  (one-off + recurring expansion identical to the app's `generateOccurrences`, honouring skip/modify exceptions), upcoming deadlines,
  important goals, money due ≤3 days (+ the 7/3/1/0 reminders, folded in so there is one message), known balances (UNKNOWN stays "ยังไม่ทราบยอด").
* **During the day** the owner talks naturally: expenses/income/payments (existing engine) and `ข้อ 2 เสร็จแล้ว`, `<task name> เสร็จแล้ว`,
  `ข้อ 3 ด่วน`, `ย้ายไปพรุ่งนี้` — executed by audited, idempotent RPCs on the real `tasks` rows.
* **Evening** (window 21:00–23:59): one close — today's income/expense, pending clarifications, due/overdue, derived balances, a real-balance
  question for DERIVED accounts that moved today ("ผมไม่เชื่อมธนาคาร"), tasks done/open with numbering, offer to carry work over.
  Replies: `ยอดตรง` (confirms, **no transaction**), `จริงเหลือ 80200` / `SCB จริงเหลือ …` (gap → `OWNER_RECONCILIATION` adjustment, never an
  expense), `ข้อสองยังไม่เสร็จ`, `ย้ายไปพรุ่งนี้`, `วันนี้พอแล้ว` / `ปิดวัน` (day closed), `กระทบยอด`.
* Failure retries (≤3, next hourly run); disabled / outside window / no verified group ⇒ nothing is sent.

## Enabling in production (safe order — nothing activates partially)

1. DB ready: migrations v1 + v2 applied to `snk-life-os-private` (done, tracked).
2. Backend deployed: `tamma-chat` merged to `main` (Netlify auto-deploys; flag still OFF ⇒ inert).
3. Dashboard deployed: `snk-life-os` merged to `main` (Vercel project `snk-life-os-final-stable2`; no new env vars needed).
4. Env (Netlify site `tamma-chat` → Site configuration → Environment variables, Functions scope):
   * `SNK_OS_SERVICE_ROLE_KEY` — **required**, secret (SNK OS project service-role key). Never put it in chat or git.
   * `SNK_MONEY_ENABLED=1` — **last**, after the health checks below pass.
   * Optional: `SNK_OS_SUPABASE_URL` (defaults to the SNK project URL), `SNK_MONEY_OWNER_ID` (auth user UUID, normally unset),
     `PF_OWNER_LINE_USER_IDS` (LINE *userId*s `U…`, never a groupId), `PF_FINANCE_MEMBER_LINE_USER_IDS`.
5. Health checks, then verify existing Thongthai business/customer flows, then invite Thongthai to the private group, press *Generate code*
   in the dashboard and type `ยืนยันกลุ่มการเงิน SNK-xxxxxxxx` in the group.
6. Live acceptance: `SCB ตอนนี้เหลือ 100000` → `จ่ายค่าประกัน 18500 จาก SCB` (SCB 81,500) → `SCB เหลือเท่าไหร่` → replay of the same LINE event adds nothing.

If the service-role key is missing the feature stays inert and business groups are unaffected.
Rollback: `SNK_MONEY_ENABLED=0` (routing, reminders and the coach stop; data stays). Migrations are additive.

## Dashboard (SNK OS Money)

The existing Money overview now shows account balances with CONFIRMED / DERIVED / UNKNOWN badges, total available (known
balances only), month income/expense/net, today/week/month, upcoming 7/30 days and overdue, with drill-down into the existing
Transactions tab (`snkpcn/snk-life-os`, `components/money-cash-overview.tsx`). It reads owner-scoped, security-invoker views
(`finance_account_balances_v1`, `finance_month_cashflow_v1`, `finance_upcoming_v1`, `finance_recent_transactions_v1`) through RLS as
the logged-in owner. Forecasts are always labelled as forecasts and never overwrite a balance.

## Tests

`npm run audit:snk-money` (also part of `npm test`). The migrations are executed for real against PGlite (Postgres in WASM), so balance
arithmetic, idempotency, constraints, audit immutability, grants, reminder claiming, binding-by-code, coach data and task RPCs are tested
against the actual SQL (`personal-finance-*.test.ts`, incl. the owner's exact 18 acceptance cases and a mocked join→pending→code→active fixture).

**Real concurrency** (`personal-finance-concurrency.test.ts`): a real PostgreSQL server (embedded-postgres, 24 connections) runs the same migrations
and proves — same idempotency key ×30 in parallel ⇒ one transaction; 60 parallel different expenses ⇒ exact balance, no lost update; opposing
transfers + income/expense mix ⇒ no deadlock, money conserved; stored balances equal an independent recomputation; set-balance racing
expenses ⇒ consistent; 12 parallel redeliveries of one LINE message ⇒ one expense; repeated "paid" ⇒ balance equals payments recorded;
25 parallel coach claimers ⇒ one winner; 15 parallel reminder crons ⇒ each reminder once; one-time code across 4 groups ⇒ one binding;
brute-force lockout. embedded-postgres is intentionally **not** a dependency (binary download, refuses root): the file SKIPS without it;
run `npm i --no-save embedded-postgres pg` and execute as a non-root user (or `PF_PGTEST_DIR=…`).

Residual (not provable offline): live LINE delivery semantics, live Netlify/Supabase latency under real load, and LINE retries arriving
after very long delays beyond the idempotency table's lifetime.

## Production status (snk-life-os-private)

* v1 (10 tracked parts) and v2 (`snk_money_v2_p1…p9`) applied; function bodies tested; Supabase security advisor: only the intentional
  `finance_issue_binding_code / finance_binding_status / finance_unbind_active` (authenticated owner-only, `auth.uid()`-scoped) and the
  pre-existing Auth "leaked password protection" warning.
* Verified on production inside rolled-back transactions (no residue): v1 engine paths, and v2 code binding, owner resolution, coach reads,
  task done, claim-once.
* The owner's two pre-existing same-named accounts were not touched; they stay `UNKNOWN` until a balance is stated.
