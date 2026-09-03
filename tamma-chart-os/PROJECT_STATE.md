# PROJECT_STATE.md — ตำมา-ชาติ OS

Read this file first in any future session before making changes.

## Project identity

- **Name:** ตำมา-ชาติ OS — private restaurant backoffice / operations system.
- **Isolation:** This is a brand-new, standalone project per the original
  master prompt. It must never be connected to, deployed into, or share
  infrastructure with `tamma-chat`, `snk-life-os` (any variant), `tamma-backoffice`,
  or any Thongthai AI project.

## Repo location (important caveat)

The Claude Code session that built this had GitHub access scoped **only** to
`snkpcn/tamma-chat`, and no ability to provision a new GitHub repo, Vercel
project, or Supabase project on its own. Per the master prompt's own
isolation rule, this code should **not stay inside `tamma-chat` long-term**.

Current state: the app lives at `tamma-chat/tamma-chart-os/` as a
self-contained subtree (its own `package.json`, `node_modules`, git-ignored
independently) so it shares zero code, dependencies, or build config with
the `tamma-chat` site around it — but it is still physically inside that
repo.

**Next action for a human or a future session with broader access:**
extract `tamma-chart-os/` into its own GitHub repository (suggested name
`tamma-chart-os`), then set up its own Vercel project and Supabase project
named accordingly, and update this file's "Canonical" section below.

## Canonical infrastructure

| Resource | Value |
|---|---|
| GitHub repo | *not yet created — see caveat above* |
| Vercel project | *not yet created* |
| Supabase project | *not yet created* |
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
    using the cookie `getAll`/`setAll` API.
  - `src/lib/supabase/middleware.ts` + `src/proxy.ts` — session refresh and
    route protection (Next 16 renamed `middleware.ts` to `proxy.ts`; the
    exported function is `proxy`, not `middleware`).
- **Data access layer:** centralized under `src/server/*.ts` as Next.js
  Server Actions / server-only functions — UI components never call
  Supabase directly. `src/server/restaurant.ts` resolves the signed-in
  user's `restaurant_id` from their `profiles` row and throws
  `NoRestaurantError` (rendered as an explanatory empty state, never a
  crash) if the account has no restaurant set up yet.
- **Multi-tenancy model:** one `restaurants` row per deployment (with room
  for multiple `branches`), one `profiles` row per staff login pointing at
  that restaurant. RLS scopes every table by `restaurant_id` via the
  `auth_restaurant_id()` SQL function.

## Database schema

`supabase/migrations/0001_init.sql` creates the full conceptual schema from
the master prompt (section 26): identity/tenancy, units, investment OS,
suppliers, ingredient master + price history, recipe OS, menu OS, stock OS
(movements/lots/counts), waste, personnel, projects/tasks, opening
checklist, alerts, activity log, settings — all with RLS enabled and a
restaurant-scoped policy, `updated_at` triggers, and a
`bootstrap_restaurant_defaults(restaurant_id)` function that seeds the
default categories/positions/reasons listed in the master prompt.

**This migration has never been run against a live database** (no Supabase
project exists yet for this app — see caveat above). Before first use:

1. Create the new, isolated Supabase project.
2. Run `supabase/migrations/0001_init.sql` against it (via the Supabase CLI
   or SQL editor).
3. Create the first auth user (Supabase Auth → add user, or self-serve
   sign-up if one gets built later — none exists yet, see "Known
   limitations").
4. Insert one `restaurants` row (`owner_id` = that user's `auth.users.id`),
   one `profiles` row (`id` = same user id, `restaurant_id` = the new
   restaurant's id), then call
   `select bootstrap_restaurant_defaults('<restaurant_id>');` to seed
   default categories.
5. Copy `.env.example` to `.env.local` and fill in
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the new
   project's settings.

Once a live project exists, regenerate strict types with
`supabase gen types typescript` and reconcile with the hand-written
`src/types/database.ts` (see note in that file).

## Completed modules

- **Phase 1 — Foundation:** app shell (Thai sidebar nav matching section 4,
  topbar with sign-out), design system, Supabase auth (email/password login,
  logout, protected routes via proxy), dashboard page structure, full DB
  schema + RLS, this file.
- **Phase 2 — Investment OS:** category CRUD (create/rename/archive),
  investment record CRUD (all fields from section 6, all 8 statuses),
  budget/actual/remaining/% calculations, dashboard integration
  (totals + by-category table), archive-based "delete" that preserves
  history per section 25, form validation, loading/error states, confirm
  dialogs on destructive actions.

## Partial / not started

Everything else in the master prompt's phase plan is **schema-only** —
tables exist and are RLS-protected, but there is no UI or server logic yet.
Nav links to these routes currently render an honest
"ยังไม่เปิดใช้งานโมดูลนี้" placeholder rather than a fake button, per section 30/32:

- Phase 3 — ต้นทุนวัตถุดิบ (ingredients + price history) + ผู้ขาย (suppliers)
- Phase 4 — สูตรอาหาร (recipes + costing) + เมนูอาหาร (menu)
- Phase 5 — สต๊อก (receiving, movements, waste, valuation)
- Phase 6 — บุคลากร (employees) + งาน/โปรเจกต์ (projects/tasks) + เช็กลิสต์เปิดร้าน
- Phase 7 — รายงาน (reports), แจ้งเตือน (alerts), CSV export
- Phase 8 — final QA pass (the section 44/45/46/47 scenarios), mobile pass,
  production deploy

The dashboard's top cards for "ความพร้อมก่อนเปิดร้าน", "ต้นทุนวัตถุดิบวันนี้", and
"มูลค่าสต๊อกปัจจุบัน" intentionally show "—" with an explanatory hint instead of
fake numbers until those modules exist.

## Known limitations

- **No self-serve sign-up / restaurant provisioning UI.** The master
  prompt describes a private, owner-managed backoffice, not a public SaaS
  sign-up flow, so the first restaurant + profile + auth user must be
  created manually (see steps above). If a future phase needs a
  provisioning UI, add it under `/onboarding` and call
  `bootstrap_restaurant_defaults`.
- **`src/types/database.ts` is hand-written**, not generated from a live
  Supabase project (none has existed to generate from). It only types the
  tables actually queried so far (`profiles`, `restaurants`,
  `investment_categories`, `investments`). Extend it table-by-table as each
  phase's UI is built, or replace it wholesale with `supabase gen types`
  output once a live project exists.
- **Dependency versions were deliberately kept current rather than pinned
  to older "stable" majors:** Next.js 16.3.4 + React 19 (an initial Next
  14.2.15 pin turned out to carry disclosed CVEs; Next 15.5.x was
  evaluated as an intermediate step but 16.3.4 was chosen since it was the
  only version with zero `npm audit` findings). This means the async
  `cookies()`/`searchParams` APIs are in effect everywhere, and the route
  file is `src/proxy.ts` (exporting `proxy`), not the older
  `middleware.ts`/`middleware` convention — keep that in mind copying
  patterns from older Next.js tutorials or Supabase's official (slightly
  older) SSR guide.
- No automated tests exist yet (no test runner configured). QA so far is:
  `npm run typecheck`, `npx eslint .`, `npm run build`, and a manual
  `next start` smoke test confirming the login page renders and
  unauthenticated requests to `/dashboard` redirect to `/login` — all
  passing. The Investment CRUD flows have **not** been exercised against a
  live database (none exists yet); do that as the first task once a
  Supabase project is provisioned, using the exact QA scenario in the
  master prompt's section 47 (อุปกรณ์ครัว, budget 500,000, actual 350,000 →
  used 350,000 / remaining 150,000 / used% 70%).

## Environment variables (names only — see `.env.example`)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only; not currently used by any route,
  reserved for future admin operations — never expose to the browser)

## Latest commit

See `git log -1` in this repo at the time of reading — this file is updated
alongside code changes, not on a schedule, so trust `git log`/`git blame`
over any date written here.

## Next actions

1. Extract `tamma-chart-os/` into its own GitHub repo (true isolation).
2. Provision the isolated Supabase project, run the migration, bootstrap
   the first restaurant per the steps above.
3. Provision the isolated Vercel project, connect it to the new repo, set
   the env vars, deploy a Preview.
4. Run the section 47 QA scenario against the live Preview.
5. Start Phase 3 (ingredient master + suppliers + price history), since
   recipe costing (Phase 4) depends on it.
