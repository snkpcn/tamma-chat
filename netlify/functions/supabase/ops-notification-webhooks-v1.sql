-- Queue operational notification dispatch only after durable business records exist.
-- Secret value is stored separately in Supabase Vault as ops_notification_webhook_secret.

create or replace function public.enqueue_tamma_ops_notification()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_secret text;
  v_entity text;
  v_entity_id uuid;
  v_environment text;
begin
  if tg_table_name = 'booking_allocations' then
    v_entity := 'booking';
    v_entity_id := new.booking_id;
    select b.environment into v_environment
    from public.bookings b
    where b.id = new.booking_id;
  elsif tg_table_name = 'cafe_inquiries' then
    v_entity := 'cafe_inquiry';
    v_entity_id := new.id;
    v_environment := new.environment;
  elsif tg_table_name = 'otop_order_items' then
    v_entity := 'otop_order';
    v_entity_id := new.order_id;
    select o.environment into v_environment
    from public.otop_orders o
    where o.id = new.order_id;
  else
    return new;
  end if;

  if coalesce(v_environment, 'live') <> 'live' then
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
    body := jsonb_build_object('entity', v_entity, 'id', v_entity_id::text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-notification-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'Could not enqueue Tamma ops notification: %', sqlerrm;
    return new;
end;
$$;

revoke all on function public.enqueue_tamma_ops_notification() from public, anon, authenticated;

drop trigger if exists ops_notify_booking_after_allocation on public.booking_allocations;
create trigger ops_notify_booking_after_allocation
after insert on public.booking_allocations
for each row execute function public.enqueue_tamma_ops_notification();

drop trigger if exists ops_notify_cafe_after_insert on public.cafe_inquiries;
create trigger ops_notify_cafe_after_insert
after insert on public.cafe_inquiries
for each row execute function public.enqueue_tamma_ops_notification();

drop trigger if exists ops_notify_otop_after_item on public.otop_order_items;
create trigger ops_notify_otop_after_item
after insert on public.otop_order_items
for each row execute function public.enqueue_tamma_ops_notification();
