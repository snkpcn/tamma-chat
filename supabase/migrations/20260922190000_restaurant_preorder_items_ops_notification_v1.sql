-- ============================================================================
-- NOT APPLIED. OWNER APPROVAL REQUIRED BEFORE RUNNING AGAINST tamma-customer-
-- data (project upaokrprawzhgzeqsdke).
--
-- This file is kept in the repo as the reviewed, ready-to-apply fix for a
-- real operational-contract gap found during the Thongthai One-Mind
-- release-gate program (see THONGTHAI_HANDOFF.md, "Priority 5 Checkpoint --
-- Restaurant Notification Parity" and the later Gate 4 checkpoint). It has
-- been verified read-only against the live schema (pg_get_functiondef,
-- information_schema.triggers) but has never been run.
--
-- THE GAP: booking_allocations, cafe_inquiries, and otop_order_items each
-- have an AFTER INSERT trigger calling enqueue_tamma_ops_notification(),
-- which dispatches a staff LINE notification via net.http_post to this
-- site's own /.netlify/functions/ops-notify. restaurant_preorder_items has
-- NO such trigger -- confirmed still true as of this migration's authoring
-- (re-verified via read-only information_schema.triggers query; zero rows
-- for restaurant_preorder_items). A restaurant preorder created through the
-- app is currently notified only via the inline call path in
-- _restaurant-sot.ts's notifyRestaurantPreorderTeam (already idempotent via
-- ops_notification_deliveries' ignore-duplicates-on-idempotency_key
-- constraint) -- this migration adds the SAME database-trigger-driven path
-- the other three entity types already have, for operational parity/
-- defense-in-depth (e.g. a future direct DB write that bypasses the app's
-- own call path would still notify staff).
--
-- THE FIX IS PURELY ADDITIVE: one new `elsif` branch in the existing
-- dispatcher function (mirroring the otop_order_items branch exactly, same
-- shape: entity_id from the child table's own FK column, environment
-- resolved by joining to the parent table), plus one new trigger on
-- restaurant_preorder_items, matching ops_notify_booking_after_allocation /
-- ops_notify_otop_after_item's own naming and shape exactly. No existing
-- branch, trigger, or table is modified.
--
-- SAFE TO APPLY (verified idempotency argument, not just asserted): once
-- this trigger exists, EVERY restaurant_preorder_items insert will fire
-- BOTH the existing inline notifyRestaurantPreorderTeam call (in the app's
-- own request path) AND this new trigger. notifyRestaurantPreorderTeam's
-- own idempotency key
-- (`restaurant_preorder_created:<preorder.id>:restaurant`, inserted into
-- ops_notification_deliveries with Prefer: resolution=ignore-duplicates)
-- means the SECOND of those two calls for the same preorder resolves to a
-- no-op duplicate, not a second staff notification. This is the same
-- idempotency mechanism already relied on for booking_allocations/
-- cafe_inquiries/otop_order_items, which already have BOTH their own
-- trigger-driven path AND no inline duplicate-call risk -- restaurant is
-- the one entity type where the app also has its OWN inline call today, so
-- this is the one case actually worth this explicit note.
--
-- TO APPLY (owner-authorized only): run via the Supabase MCP server's
-- apply_migration tool (or `supabase db push`) against project
-- upaokrprawzhgzeqsdke, then watch the first real restaurant_preorder_items
-- insert's ops_notification_deliveries rows to confirm exactly one
-- delivered notification, not two.
-- ============================================================================

create or replace function public.enqueue_tamma_ops_notification()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'vault', 'net'
as $function$
declare
  v_secret text;
  v_entity text;
  v_entity_id uuid;
  v_environment text;
begin
  if tg_table_name = 'booking_allocations' then
    v_entity := 'booking';
    v_entity_id := new.booking_id;
    select b.environment into v_environment from public.bookings b where b.id = new.booking_id;
  elsif tg_table_name = 'cafe_inquiries' then
    v_entity := 'cafe_inquiry';
    v_entity_id := new.id;
    v_environment := new.environment;
  elsif tg_table_name = 'otop_order_items' then
    v_entity := 'otop_order';
    v_entity_id := new.order_id;
    select o.environment into v_environment from public.otop_orders o where o.id = new.order_id;
  elsif tg_table_name = 'restaurant_preorder_items' then
    v_entity := 'restaurant_preorder';
    v_entity_id := new.preorder_id;
    select p.environment into v_environment from public.restaurant_preorders p where p.id = new.preorder_id;
  else
    return new;
  end if;

  if coalesce(v_environment, 'live') not in ('live', 'test') then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ops_notification_webhook_secret'
  order by created_at desc
  limit 1;

  if v_secret is null or length(v_secret) < 24 then
    raise warning 'ops_notification_webhook_secret is missing; skipping notification enqueue';
    return new;
  end if;

  perform net.http_post(
    url := 'https://tamma-chat.netlify.app/.netlify/functions/ops-notify',
    body := jsonb_build_object('entity', v_entity, 'id', v_entity_id::text, 'environment', coalesce(v_environment, 'live')),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-ops-notification-secret', v_secret),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'Could not enqueue Tamma ops notification: %', sqlerrm;
    return new;
end;
$function$;

create trigger ops_notify_restaurant_after_item
after insert on public.restaurant_preorder_items
for each row execute function public.enqueue_tamma_ops_notification();
