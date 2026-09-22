-- ============================================================================
-- NOT APPLIED. OWNER APPROVAL REQUIRED BEFORE RUNNING AGAINST tamma-customer-
-- data (project upaokrprawzhgzeqsdke).
--
-- This file is kept in the repo as the reviewed, ready-to-apply storage for
-- the Thongthai "Service Mind" feedback system (see THONGTHAI_HANDOFF.md's
-- "Service Mind System" section for the full design writeup). It has never
-- been run.
--
-- THE GAP: Thongthai had no deterministic way to detect a compliment,
-- complaint, suggestion, safety issue, or feedback about its own answers,
-- and no structured place to record one for staff triage. The only existing
-- adjacent precedent, `handoff_requests` (brain-v2.sql), is a different
-- concept -- "customer needs a human right now" (booking_help /
-- accessibility_help / complaint / other), written only by an LLM tool call,
-- never notified to staff, and missing fields this system genuinely needs
-- (feedback_type distinguishing compliment/suggestion, business_unit,
-- severity, a real customer_message, staff_name, route_target,
-- notification_status). `guest_events` (schema.sql) was also considered and
-- rejected: its `guest_events_no_chat_text` CHECK constraint deliberately
-- forbids storing raw chat text (`message`/`text`/`chat`/etc. keys), which
-- this system needs (`customer_message`) for staff to triage a complaint
-- with real context -- overriding that guardrail for this one purpose would
-- weaken a deliberate, hard privacy boundary that protects every other
-- `guest_events` write. A new, purpose-built table is the correct fit.
--
-- THE FIX IS PURELY ADDITIVE: one new table (this migration), no existing
-- table, trigger, function, or constraint is modified. Notification dispatch
-- reuses the EXISTING `_ops-notifications.ts` mechanism exactly (same
-- `ops_notification_channels` team-binding table, same `sendTeamMessage`/
-- `ops_notification_deliveries` idempotency-keyed delivery ledger, same
-- `'not_bound'` honest-degradation status when no team has bound a channel
-- yet) -- this migration adds the ONE new `OpsNotificationEntity` value
-- (`'feedback_event'`) as application code (netlify/functions/
-- _ops-notifications.ts), not as anything in this SQL file.
--
-- SAFE TO APPLY: a brand-new table with RLS enabled and all grants revoked
-- from anon/authenticated (service-role only, matching every other
-- operational table in this schema) cannot affect any existing read/write
-- path -- nothing references `ops_feedback_events` until this migration
-- exists. Until it's applied, netlify/functions/_service-mind-feedback-
-- events.ts's write attempt fails gracefully (caught, logged, never thrown
-- to the customer -- see that file's own header comment) and the customer
-- still receives a sincere acknowledgment; the app is fully functional
-- without this migration, just without the durable feedback record.
--
-- TO APPLY (owner-authorized only): run via the Supabase MCP server's
-- apply_migration tool (or `supabase db push`) against project
-- upaokrprawzhgzeqsdke, then confirm a real complaint/compliment/suggestion
-- message produces exactly one row here.
-- ============================================================================

create table if not exists public.ops_feedback_events (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid null references public.guests(id) on delete set null,
  feedback_type text not null check (
    feedback_type in ('compliment', 'complaint', 'suggestion', 'safety_issue', 'system_feedback')
  ),
  business_unit text not null check (
    business_unit in ('restaurant', 'activity', 'stay', 'cafe', 'membership', 'system', 'general', 'unknown')
  ),
  severity text not null check (severity in ('low', 'normal', 'high', 'urgent')),
  -- The original customer message. Deliberately allowed here (unlike
  -- guest_events' guest_events_no_chat_text guardrail) -- staff triage
  -- genuinely needs the real wording of a complaint/safety report; this
  -- table's own RLS (service-role only, below) is the access control.
  customer_message text not null,
  summary text not null,
  channel text not null check (channel in ('web', 'line', 'other')),
  staff_name text null,
  related_booking_id uuid null references public.bookings(id) on delete set null,
  related_order_id uuid null,
  route_target text not null check (
    route_target in ('owner_general', 'restaurant_group', 'activity_group', 'stay_group', 'cafe_group', 'admin_group')
  ),
  status text not null default 'new' check (status in ('new', 'acknowledged', 'resolved')),
  notification_status text not null default 'pending' check (
    notification_status in ('pending', 'sent', 'duplicate', 'not_bound', 'not_configured', 'failed')
  ),
  environment text not null default 'live' check (environment in ('live', 'test')),
  created_at timestamptz not null default now()
);

create index if not exists ops_feedback_events_guest_id_idx on public.ops_feedback_events (guest_id);
create index if not exists ops_feedback_events_status_idx on public.ops_feedback_events (status);
create index if not exists ops_feedback_events_created_at_idx on public.ops_feedback_events (created_at desc);

alter table public.ops_feedback_events enable row level security;
revoke all on public.ops_feedback_events from anon, authenticated;
