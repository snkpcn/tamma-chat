-- RLS security hardening — closes a live public data exposure found during
-- the Backoffice operational-integration audit.
--
-- These 8 tables were created (by earlier promotion/settlement/fuel-session
-- migrations) WITHOUT row level security enabled, and Postgres/PostgREST
-- default grants left the `anon` and `authenticated` roles with full
-- INSERT/SELECT/UPDATE/DELETE/TRUNCATE on them. Since the Supabase anon
-- (publishable) key ships in client-side code (account.html), this meant
-- anyone on the internet could read or write team bank payout accounts,
-- settlements, internal cost basis, and promotion data directly against
-- PostgREST, bypassing every Netlify Function entirely.
--
-- Verified before writing this migration: every current read/write path to
-- each of these tables, in both snkpcn/tamma-chat and snkpcn/tamma-backoffice,
-- uses SUPABASE_SERVICE_ROLE_KEY exclusively (netlify/functions/_settlements.ts,
-- _promotions-runtime.ts, _restaurant-sot.ts, _settlement-line-proof.ts,
-- _ops-fuel-session-guard.ts, _ops-fuel-receipts.ts; backoffice's shared
-- netlify/functions/_db.ts `rest()` helper used by payments.ts/promotions.ts/
-- settlements.ts). No code path uses the anon key against these tables, so
-- this hardening changes zero legitimate behavior — it only removes public
-- access that nothing in the product actually relies on.
--
-- Same service-role-only pattern already used by every other table in this
-- schema (chess_games, ops_notification_channels, guests, bookings, ...).
--
-- Also closes the same gap on tamma_chart_os.restaurant_menu_intelligence_profiles
-- (the separate restaurant-OS schema shared with tamma-backoffice), which had
-- `authenticated` fully exposed. Only netlify/functions/_restaurant-sot.ts
-- reads it, via SUPABASE_SERVICE_ROLE_KEY.

alter table tamma_chart_os.restaurant_menu_intelligence_profiles enable row level security;
revoke all on table tamma_chart_os.restaurant_menu_intelligence_profiles from anon, authenticated;

alter table public.activity_line_fuel_sessions enable row level security;
alter table public.team_settlements enable row level security;
alter table public.team_payout_accounts enable row level security;
alter table public.promotion_campaigns enable row level security;
alter table public.promotion_items enable row level security;
alter table public.promotion_redemptions enable row level security;
alter table public.promotion_recommendations enable row level security;
alter table public.service_cost_basis enable row level security;

revoke all on table public.activity_line_fuel_sessions from anon, authenticated;
revoke all on table public.team_settlements from anon, authenticated;
revoke all on table public.team_payout_accounts from anon, authenticated;
revoke all on table public.promotion_campaigns from anon, authenticated;
revoke all on table public.promotion_items from anon, authenticated;
revoke all on table public.promotion_redemptions from anon, authenticated;
revoke all on table public.promotion_recommendations from anon, authenticated;
revoke all on table public.service_cost_basis from anon, authenticated;
