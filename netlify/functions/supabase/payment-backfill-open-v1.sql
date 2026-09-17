-- Backfill payment requests for currently-open operations created before payment v1.
-- Safe/idempotent via unique (entity_type, entity_id).

insert into public.payment_requests (
  entity_type, entity_id, entity_code, guest_id, customer_id, team_code,
  amount, status, source_channel, environment, note
)
select
  'booking', b.id, b.booking_code, b.guest_id,
  coalesce(b.customer_id, public.payment_customer_for_guest(b.guest_id)),
  b.service_type,
  null,
  'quote_required',
  b.source_channel,
  b.environment,
  'Backfilled open booking: staff must set the payment amount before payment.'
from public.bookings b
where b.status in ('requested','confirmed')
  and b.service_type in ('restaurant','stay','activity')
on conflict (entity_type, entity_id) do nothing;

insert into public.payment_requests (
  entity_type, entity_id, entity_code, guest_id, customer_id, team_code,
  amount, status, source_channel, environment, quoted_at
)
select
  'restaurant_preorder', p.id, p.preorder_code, p.guest_id,
  public.payment_customer_for_guest(p.guest_id),
  'restaurant',
  case when coalesce(p.total_amount, 0) > 0 then p.total_amount else null end,
  case when coalesce(p.total_amount, 0) > 0 then 'awaiting_payment' else 'quote_required' end,
  p.source_channel,
  p.environment,
  case when coalesce(p.total_amount, 0) > 0 then now() else null end
from tamma_chart_os.restaurant_preorders p
where p.status in ('requested','confirmed','preparing','ready')
on conflict (entity_type, entity_id) do nothing;

insert into public.payment_requests (
  entity_type, entity_id, entity_code, guest_id, customer_id, team_code,
  amount, status, source_channel, environment, quoted_at
)
select
  'otop_order', o.id, o.order_code, o.guest_id,
  coalesce(o.customer_id, public.payment_customer_for_guest(o.guest_id)),
  'otop',
  case when coalesce(o.total_amount, 0) > 0 then o.total_amount else null end,
  case when coalesce(o.total_amount, 0) > 0 then 'awaiting_payment' else 'quote_required' end,
  o.source_channel,
  o.environment,
  case when coalesce(o.total_amount, 0) > 0 then now() else null end
from public.otop_orders o
where o.status not in ('cancelled','completed')
on conflict (entity_type, entity_id) do nothing;
