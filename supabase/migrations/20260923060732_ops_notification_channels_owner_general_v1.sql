-- ============================================================================
-- APPLIED directly to tamma-customer-data (project upaokrprawzhgzeqsdke) via
-- the Supabase MCP tool on 2026-09-23, under explicit owner authorization
-- from the "FINAL LINE STABILIZATION FIX" task (Fix 1: DB constraint must
-- accept owner_general). This file is kept as the reviewed record of that
-- change, matching this repo's migration convention.
--
-- THE BUG: `ops_notification_channels_team_code_check` --
--   CHECK (team_code = ANY (ARRAY['restaurant','stay','activity','cafe','otop','all']))
-- -- was never extended when the 'owner_general' team code was added
-- (application code: netlify/functions/_ops-notifications.ts's OpsTeamCode
-- type and parseTeamCode's owner/general/admin/เจ้าของ/ทั่วไป/แอดมิน/ผู้ดูแล
-- alias group). Every real "ผูกทีม เจ้าของ"/"owner"/"admin" bind attempt in
-- production failed with Postgres error 23514 (check_violation) -- LINE
-- delivery, webhook routing, command parsing, and authorization all worked
-- correctly (confirmed from real production line-webhook function logs:
-- LINE_EVENT_RECEIVED, LINE_ROUTE_SELECTED=group_ops_command,
-- LINE_GROUP_BIND_ATTEMPT={teamCodeParsed:"owner_general",authorized:true,
-- result:"db_error"}) -- only the INSERT/UPSERT itself was rejected by this
-- constraint. See THONGTHAI_HANDOFF.md's "Final LINE Stabilization" entry.
--
-- THE FIX IS PURELY ADDITIVE: widens one existing CHECK constraint to also
-- accept 'owner_general', alongside the five values it already allowed. No
-- table, column, row, or other constraint is touched. A CHECK constraint
-- cannot be altered in place in Postgres, so this drops and immediately
-- recreates it with the same shape plus the one new allowed value --
-- existing rows (restaurant/stay/activity/cafe/otop, 5 rows as of this
-- writing) already satisfy the new, strictly broader constraint, so this
-- cannot reject or delete any existing data.
--
-- `ops_notification_channels_service_type_check` (a SEPARATE constraint on
-- the service_type column, restricted to the five real business-unit
-- codes) is deliberately left untouched -- 'owner_general' is a pseudo-team
-- like the pre-existing 'all', with no corresponding service_type row, so
-- the application code (this same fix) now maps it to NULL there instead of
-- widening a constraint that exists specifically to keep service_type
-- meaning "a real business unit."
--
-- Idempotent: `IF EXISTS`/`IF NOT EXISTS` guards make this safe to run more
-- than once. No RLS change, no grant change, no data migration.
-- ============================================================================

ALTER TABLE public.ops_notification_channels
  DROP CONSTRAINT IF EXISTS ops_notification_channels_team_code_check;

ALTER TABLE public.ops_notification_channels
  ADD CONSTRAINT ops_notification_channels_team_code_check
  CHECK (team_code = ANY (ARRAY[
    'restaurant'::text,
    'stay'::text,
    'activity'::text,
    'cafe'::text,
    'otop'::text,
    'all'::text,
    'owner_general'::text
  ]));
