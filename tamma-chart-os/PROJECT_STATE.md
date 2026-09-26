# PROJECT_STATE.md — ตำมา-ชาติ OS

Read this file first in any future session before making changes.

## Project identity

- **Name:** ตำมา-ชาติ OS — private restaurant backoffice / operations system.
- **Isolation:** This is a brand-new, standalone project per the original
  master prompt. It must never be connected to, deployed into, or share
  infrastructure with `tamma-chat`, `snk-life-os` (any variant),
  `tamma-backoffice`, `tamma-customer-data`, or any Thongthai AI project.

## Repo location — BLOCKED on extraction, action needed

The Claude Code session that built this had a GitHub App installation whose
write access is scoped only to `snkpcn/tamma-chat`. It has **no permission to
create new repositories** on the account (`create_repository` fails with
`403 Resource not accessible by integration` — this is a hard permission
boundary of the GitHub App installation, not something fixable from inside a
session).

**Current state:** the code lives at `tamma-chat/tamma-chart-os/` as a fully
self-contained subtree (its own `package.json`, `node_modules`,
`.gitignore`) — it shares zero code, dependencies, or build config with the
`tamma-chat` site around it — but it is still physically inside that repo,
which violates the master prompt's isolation requirement.

**Action needed from a human to unblock this:**
1. Create a new **empty, private** GitHub repo named `tamma-chart-os` under
   the `snkpcn` account (https://github.com/new — do not initialize with a
   README/gitignore/license, so the push below is clean).
2. Tell the next Claude Code session it exists — it can then attach it and
   push the full contents of `tamma-chart-os/` there as the initial commit,
   and that becomes the canonical repo going forward.

## Supabase project — BLOCKED on capacity, action needed

The Supabase organization (`snkpcn's Org`, id `xpnanksktjjthaxkjclr`) is
already at its **free-tier cap of 2 active projects**:
- `tamma-customer-data` (do not touch — a different project's data)
- `snk-life-os-private` (do not touch — a different project's data)

Creating a 3rd project (`tamma-chart-os-private`) was attempted and rejected
by Supabase with exactly this reason. Project creation itself is free
($0/month per `get_cost`), so this is purely the free-plan project-count
limit, not a billing charge to approve.

**Action needed from a human to unblock this (pick one):**
1. Upgrade the Supabase organization to a paid plan (removes the 2-project
   cap), or
2. Pause or delete a project in that org that is safe to remove (NOT
   `tamma-customer-data` or `snk-life-os-private` unless you know those are
   disposable — a Claude session should never make that call unilaterally).

Once either happens, the next session can immediately run:
`create_project(name: "tamma-chart-os-private", region: "ap-southeast-1", organization_id: "xpnanksktjjthaxkjclr")`
then apply `supabase/migrations/0001_init.sql` via `apply_migration`.

## Vercel — not blocked, just waiting on the repo

The Vercel side (team `7hchbrnqkg-4613's projects`, id
`team_Xa2lB3AEknYc1qIFPeQ2IHtF`) has no project named `tamma-chart-os` yet
and plenty of room — it only needs the GitHub repo above to exist so
`create_git_project` can link to it and deploy a Preview.

## Canonical infrastructure

| Resource | Value |
|---|---|
| GitHub repo | *blocked — see above* |
| Vercel project | *blocked on GitHub repo — see above* |
| Supabase project | *blocked — see above* |
| Production URL | *none yet* |
| Latest Preview | *none yet* |

## Architecture

- **Framework:** Next.js 16 (App Router, Turbopack), TypeScript, React 19.
- **Styling:** Tailwind CSS with a custom design token set (cream background,
  forest green primary, muted gold accent) in `tailwind.config.ts` /
  `src/app/globals.css`, matching the master prompt's visual direction.
- **Auth/data:** Supabase (`@supabase/ssr` + `@supabase/supabase-js`).
  - `src/lib/supabase/client.ts` — browser client.
  - `src/lib/supabase/server.ts` — server client (Server Components/Actions),
    using the cookie `getAll`/`setAll` API (current @supabase/ssr contract).
  - `src/lib/supabase/middleware.ts` + `src/proxy.ts` — session refresh and
    route protection. **Next 16 renamed `middleware.ts` to `proxy.ts`** and
    the exported function from `middleware` to `proxy` — don't reintroduce
    the old convention when copying patterns from older docs/tutorials.
- **Data access layer:** centralized under `src/server/*.ts` as Next.js
  Server Actions / server-only functions — UI components never call
  Supabase directly. `src/server/restaurant.ts` resolves the signed-in
  user's `restaurant_id` from their `profiles` row and throws
  `NoRestaurantError` (rendered as an explanatory empty state, never a
  crash) if the account has no restaurant set up yet.
- **Pure calculations** (no DB access, safe to import anywhere) live in
  `src/lib/calc.ts` (`computePriceStats`, `foodCostPercent`,
  `grossMarginPercent`) — kept out of `"use server"` files because those
  may only export async functions; a sync helper in one breaks the build
  with "Server Actions must be async functions."
- **Multi-tenancy model:** one `restaurants` row per deployment (with room
  for multiple `branches`), one `profiles` row per staff login pointing at
  that restaurant. RLS scopes every table by `restaurant_id` via the
  `auth_restaurant_id()` SQL function.

### A sharp TypeScript/Supabase gotcha hit and fixed in this session

`src/types/database.ts` types every table's `Row` as `export type XRow = {...}`
(a type alias), **never** `export interface XRow {...}`. This is not a style
preference — it's required for correctness:

- `@supabase/postgrest-js`'s `.insert()`/`.update()` overloads resolve
  `Row extends Relation["Insert"] ? ... : never` structurally at the call
  site. If `Row` (or `Insert`) is declared via `interface` instead of
  `type`, or if `Insert`/`Update` are built through a generic helper (even
  something as simple as `Omit<Row, K> & Partial<Pick<Row, K>>`, even after
  wrapping it in a `Simplify<...>` mapped type), that resolution silently
  collapses to `never` — every `.insert()`/`.update()` call in the whole
  file fails with a confusing `TS2345`/`TS2353` pointing at the call site,
  not at the type definition, with zero indication that the root cause is
  in `database.ts`.
- The fix that actually works: every table's `Insert`/`Update` must be a
  **plain object type literal** written directly in the `Database`
  interface (not through a generic alias), and every `Row`/`Insert` type
  referenced by name must be declared with `type X = {...}`, not
  `interface X {...}`. `Update` may safely be
  `Partial<Database["public"]["Tables"]["x"]["Insert"]>` (a self-referential
  indexed-access type) — that pattern is fine; it was never the problem.
- If a future session is tempted to DRY this file up with a generic
  `Table<Row, DefaultedKeys>` helper (very tempting — the file is long),
  don't, or re-verify against a minimal repro first. It looks correct, it
  typechecks in isolation, and it silently breaks every mutation in the app.

## Database schema

`supabase/migrations/0001_init.sql` creates the full conceptual schema from
the master prompt (section 26) — identity/tenancy, units, investment OS,
suppliers, ingredient master + price history, recipe OS, menu OS, stock OS
(movements/lots/counts), waste, personnel, projects/tasks, opening
checklist, alerts, activity log, settings — all with RLS enabled and a
restaurant-scoped policy, `updated_at` triggers, and a
`bootstrap_restaurant_defaults(restaurant_id)` function that seeds the
default categories/positions/reasons listed in the master prompt.

**This migration has never been run against a live database** — no Supabase
project exists yet for this app (see blocker above). Before first use, once
a project exists:

1. Run `supabase/migrations/0001_init.sql` against it (Supabase CLI or SQL
   editor, or `mcp__Supabase__apply_migration`).
2. Create the first auth user (Supabase Auth → add user; there is no
   self-serve sign-up UI — see "Known limitations").
3. Insert one `restaurants` row (`owner_id` = that user's `auth.users.id`,
   `name` = 'ตำมา-ชาติ'), one `profiles` row (`id` = same user id,
   `restaurant_id` = the new restaurant's id), then call
   `select bootstrap_restaurant_defaults('<restaurant_id>');` to seed
   default categories. A branch row (`branches`, `name` = 'ตำมา-ชาติ สาขา 1',
   `is_main` = true) can be added too — the schema supports it but no UI
   consumes it yet (single-branch V1).
4. Copy `.env.example` to `.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the new
   project's settings; set the same two on the Vercel project once it
   exists.

Once a live project exists, regenerate strict types with
`supabase gen types typescript` and reconcile with the hand-written
`src/types/database.ts` (see note above — preserve the type-alias-not-
interface, literal-Insert pattern when merging).

## Completed modules — all of Phases 1-7 have real, working CRUD

Every module below has: a `src/server/*.ts` data-access layer (Server
Actions, restaurant-scoped, validated), a real UI (list + create/edit
modal + archive/delete with confirmation, or the equivalent), and compiles
clean under `npm run typecheck`, `npx eslint .`, and `npm run build`. None
of it has been exercised against a **live** database yet (no Supabase
project exists — see blocker above); that is the first task once one does.

- **Phase 1 — Foundation:** app shell (Thai sidebar nav, topbar with
  sign-out), design system, Supabase auth (login/logout, protected routes
  via `proxy.ts`), full DB schema + RLS, dashboard structure.
- **Phase 2 — Investment:** category CRUD, investment record CRUD (all
  fields/8 statuses), budget/actual/remaining/% calculations, dashboard
  integration, archive-based history preservation.
- **Phase 3 — Ingredients + Suppliers:** ingredient master CRUD (base/purchase
  unit + conversion factor, reorder point, minimum stock), ingredient
  category CRUD, supplier CRUD + search, ingredient price entry with full
  history (latest/previous/7-day avg/30-day avg/min/max/%-change + a small
  SVG sparkline), price entry never overwrites history, updating a price
  auto-recalculates every recipe that uses that ingredient.
- **Phase 4 — Recipes + Menu costing:** recipe CRUD, recipe-ingredient line
  editor (add/edit quantity/remove/reorder), live cost calculation from
  real ingredient prices (`computeRecipeCost`), append-only
  `recipe_cost_snapshots` on every price change, menu CRUD linked to
  recipes showing selling price / cost / Food Cost % / Gross Margin %,
  menu price changes logged to `menu_price_history`.
- **Phase 5 — Stock:** transaction-based stock (current quantity is always
  `SUM(stock_movements.quantity_base_unit)`, never a stored editable
  field), receiving flow (one action: creates the stock-in movement,
  records the price, updates the ingredient's latest cost, recalculates
  affected recipes), generic movement entry (เบิกใช้/ปรับยอด/โอน/คืนผู้ขาย),
  stock count with automatic variance-movement, waste recording (creates
  both a `waste_records` row and a stock-out movement), waste reason CRUD,
  low/out-of-stock status per ingredient.
- **Phase 6 — People + Projects:** employee CRUD + position CRUD, project
  CRUD, task CRUD (priority, status, overdue highlighting, inline status
  change), opening checklist CRUD (category CRUD + items with inline status
  toggle) feeding a real dashboard readiness %.
- **Phase 7 — Reports + Alerts:** a real alerts engine
  (`src/server/alerts.ts`) computing — not storing — alerts from live data:
  out-of-stock/low-stock, ingredient cost spikes (>10% vs 7-day average),
  menu items over the Food Cost threshold, investment categories
  near/over budget, overdue tasks, delayed checklist items; surfaced on the
  dashboard, severity-sorted. A reports page with 7 sections (investment,
  ingredient price history, stock/valuation, waste, menu profitability,
  supplier price comparison, opening readiness by category), a date-range
  filter for the date-based reports, and CSV export on every table.

## Known limitations / deliberate V1 simplifications

- **No self-serve sign-up / restaurant provisioning UI.** The master
  prompt describes a private, owner-managed backoffice, so the first
  restaurant + profile + auth user must be created manually (steps above).
- **`src/types/database.ts` is hand-written**, not generated from a live
  Supabase project (none has existed to generate from). It types every
  table the app queries. See the gotcha section above before touching it.
- **Recipe ingredient quantities are always in the ingredient's base
  unit** (e.g. กรัม), not an arbitrary unit needing its own conversion —
  the ingredient master already defines base_unit ↔ purchase_unit
  conversion, and recipe costing multiplies quantity × cost-per-base-unit
  directly. This matches the master prompt's own worked example (150 g of
  หมูสันนอก against a per-gram cost) without adding a second conversion
  layer.
- **No lot/expiry tracking in V1** (the `stock_lots` table exists in the
  schema but isn't wired to any UI) — so "ใกล้หมดอายุ/หมดอายุ" alerts from
  section 22 are **not implemented**; only stock-level and cost-spike
  alerts are real. Add lot expiry tracking before relying on that alert
  category.
- **"ต้นทุนวัตถุดิบวันนี้"** on the dashboard is defined concretely as: total
  baht spent on ingredient purchases whose `purchase_date` is today (sum of
  `ingredient_price_history.price` for today). This is one reasonable
  reading of an ambiguous spec line — revisit if the owner means something
  else (e.g. cost of ingredients consumed today, which isn't derivable
  without POS/sales integration per section 38-39).
- **Waste valuation is an estimate** (`quantity × current
  latest_cost_per_base_unit`), not the cost at the actual time of waste,
  since waste records don't snapshot a cost themselves.
- **Dependency versions were deliberately kept current rather than pinned
  to older "stable" majors:** Next.js 16.3.4 + React 19 + ESLint 9 (the
  initial Next 14.2.15 pin had disclosed CVEs; 16.3.4 was the only version
  with zero `npm audit` findings at build time). `eslint.config.mjs` uses
  the native flat config export from `eslint-config-next` directly — do
  NOT wrap it in `FlatCompat` (that combination throws
  `Converting circular structure to JSON` from inside the legacy
  `@eslint/eslintrc` validator).
- No automated test suite exists (no test runner configured). QA so far:
  `npm run typecheck`, `npx eslint .`, `npm run build` all pass cleanly;
  `next start` smoke-tested — login renders, and every protected route
  (`/dashboard`, `/investment`, `/ingredients`, `/suppliers`, `/recipes`,
  `/stock`, `/menu`, `/personnel`, `/projects`, `/reports`, `/settings`)
  correctly 307-redirects to `/login` when unauthenticated. **No CRUD flow
  has been exercised against a live database** — that's the first task
  once a Supabase project exists. Run the master prompt's own QA scenarios
  first (section 45: หมูสันนอก 190→200 บาท/กก., 150 g usage → 28.50→30.00
  บาท recipe cost; section 46: receive 10 kg, waste 0.5 kg → 9.5 kg
  remaining; section 47: อุปกรณ์ครัว budget 500,000 / actual 350,000 → 70%
  used).
- **`/settings` is still a placeholder** — none of section 23's settings
  (branches, units master, threshold editing UI, users/access, data
  backup) have UI yet, though the underlying data they'd edit (categories,
  `settings.food_cost_threshold_percent`, etc.) already exists and is
  used elsewhere (e.g. the Food Cost threshold is read on the dashboard
  and reports, just not editable from a UI yet).

## Environment variables (names only — see `.env.example`)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; not currently used by any route,
  reserved for future admin operations — never expose to the browser)

## Latest commit

See `git log -1` in this repo at the time of reading — this file is updated
alongside code changes, not on a schedule, so trust `git log`/`git blame`
over any date written here.

## Next actions, in order

1. **Unblock GitHub:** human creates the empty `snkpcn/tamma-chart-os` repo
   (see above); next session attaches it and pushes `tamma-chart-os/` as
   the initial commit there — that becomes canonical, not this subtree.
2. **Unblock Supabase:** human upgrades the org plan or frees a project
   slot (see above); next session runs `create_project`, applies
   `0001_init.sql`, bootstraps the restaurant per the steps above.
3. **Unblock Vercel:** once (1) exists, `create_git_project` linking the
   new repo into team `team_Xa2lB3AEknYc1qIFPeQ2IHtF`, set the two
   `NEXT_PUBLIC_SUPABASE_*` env vars, deploy a Preview.
4. Run the section 45/46/47 QA scenarios against the live Preview.
5. Build out `/settings` (section 23) and lot/expiry tracking for stock.
6. Only after all of the above: production deployment (section 43 — never
   before Preview QA passes).
