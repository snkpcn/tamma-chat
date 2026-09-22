-- ============================================================================
-- NOT APPLIED. OWNER APPROVAL REQUIRED BEFORE RUNNING AGAINST tamma-customer-
-- data (project upaokrprawzhgzeqsdke). Apply AFTER v1
-- (20260922210000_ops_feedback_events_v1.sql) -- this migration ALTERs the
-- table v1 creates.
--
-- THE GAP: v1's `ops_feedback_events` stores the classification (type/
-- business_unit/severity) and the raw message, but not the structured
-- extraction the Feedback Operations phase needs for the backoffice "เสียงลูกค้า"
-- dashboard: which staff/role was mentioned, which business-unit keywords
-- fired, which sentiment/issue keywords were detected, which named assets
-- (horses, activities) came up, a short keyword-summary object for the
-- dashboard's "คำสำคัญ" section, a place to log a notification failure's
-- reason, an internal-notes log for staff triage, and the
-- acknowledged/resolved timestamps + wider status workflow (new ->
-- acknowledged -> in_progress -> resolved/dismissed) the dashboard's status
-- actions need. See THONGTHAI_HANDOFF.md's "Feedback Operations" section for
-- the full design writeup.
--
-- THE FIX IS PURELY ADDITIVE: every new column has a safe default (empty
-- jsonb array/object or null), so existing rows (there are none yet -- v1
-- itself isn't applied) and any INSERT that doesn't set these columns still
-- succeed unchanged. The one non-additive change is widening the `status`
-- CHECK constraint from 3 values to 5 -- strictly widening (every value v1
-- allowed is still allowed), so it cannot invalidate anything.
--
-- SAFE TO APPLY: no existing table, trigger, or function outside this one
-- table is touched. The new `updated_at` touch-trigger only fires on this
-- table's own UPDATEs.
--
-- TO APPLY (owner-authorized only, after v1): run via the Supabase MCP
-- server's apply_migration tool (or `supabase db push`) against project
-- upaokrprawzhgzeqsdke, then confirm `\d public.ops_feedback_events` shows
-- all new columns and the widened status check.
-- ============================================================================

alter table public.ops_feedback_events
  -- Structured extraction (see _service-mind-feedback-intent.ts's
  -- extractFeedbackKeywords) -- each an array of short strings, never free
  -- text, never a place for anything guess-y: only what the classifier
  -- actually found in the message.
  add column if not exists person_mentions jsonb not null default '[]'::jsonb,
  add column if not exists business_unit_mentions jsonb not null default '[]'::jsonb,
  add column if not exists sentiment_keywords jsonb not null default '[]'::jsonb,
  add column if not exists issue_keywords jsonb not null default '[]'::jsonb,
  add column if not exists named_assets jsonb not null default '[]'::jsonb,
  -- A small, dashboard-ready rollup object (e.g. {"top_positive": [...],
  -- "top_negative": [...]}) so the backoffice's "คำสำคัญ" section doesn't
  -- have to recompute this from the arrays above on every page load.
  add column if not exists keyword_summary jsonb not null default '{}'::jsonb,
  -- Set when notification_status = 'failed', so the dashboard can show WHY
  -- (never surfaced to the customer -- see redactWeatherUrl-style
  -- redaction discipline already established for other logged errors in
  -- this codebase; this column must never contain a secret).
  add column if not exists notification_error text null,
  -- Append-only staff triage log: [{"note": "...", "author": "...", "at":
  -- "2026-..."}]. Written only by the backoffice's own owner-gated
  -- function, never by the customer-facing Netlify function.
  add column if not exists internal_notes jsonb not null default '[]'::jsonb,
  add column if not exists acknowledged_at timestamptz null,
  add column if not exists resolved_at timestamptz null,
  add column if not exists updated_at timestamptz not null default now();

-- Widen the status workflow: new -> acknowledged -> in_progress ->
-- resolved/dismissed (v1 only had new/acknowledged/resolved).
alter table public.ops_feedback_events drop constraint if exists ops_feedback_events_status_check;
alter table public.ops_feedback_events add constraint ops_feedback_events_status_check
  check (status in ('new', 'acknowledged', 'in_progress', 'resolved', 'dismissed'));

create index if not exists ops_feedback_events_business_unit_idx on public.ops_feedback_events (business_unit);
create index if not exists ops_feedback_events_feedback_type_idx on public.ops_feedback_events (feedback_type);
create index if not exists ops_feedback_events_severity_idx on public.ops_feedback_events (severity);

create or replace function public.ops_feedback_events_touch_updated_at()
returns trigger
language plpgsql
as $function$
begin
  new.updated_at = now();
  return new;
end;
$function$;

drop trigger if exists ops_feedback_events_touch_updated_at on public.ops_feedback_events;
create trigger ops_feedback_events_touch_updated_at
before update on public.ops_feedback_events
for each row execute function public.ops_feedback_events_touch_updated_at();

-- RLS/grants are unchanged from v1 (service-role only, no anon/authenticated
-- policy) -- the backoffice's own owner-gated Netlify function uses the same
-- service-role key, same as every other privileged table in this schema, so
-- no new grant is needed here.
