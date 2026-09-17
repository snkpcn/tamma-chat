-- ทำมา-ชาติ payment layer v1
-- Single accepted payment channel: owner PromptPay QR only.
-- Customer slips remain private in Supabase Storage and are reviewed by staff through LINE.

create table if not exists public.payment_requests (
  id uuid primary key default gen_random_uuid(),
  payment_code text not null unique default (
    'PAY-' || to_char(now(), 'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  entity_type text not null check (entity_type in ('booking','restaurant_preorder','otop_order','cafe_order','manual')),
  entity_id uuid not null,
  entity_code text not null,
  guest_id uuid references public.guests(id) on delete set null,
  customer_id uuid references public.customer_accounts(id) on delete set null,
  team_code text not null check (team_code in ('restaurant','stay','activity','cafe','otop')),
  amount numeric(12,2) check (amount is null or amount > 0),
  currency text not null default 'THB' check (currency = 'THB'),
  method text not null default 'promptpay_owner_qr' check (method = 'promptpay_owner_qr'),
  status text not null default 'quote_required' check (
    status in ('quote_required','awaiting_payment','proof_submitted','verified','rejected','cancelled')
  ),
  source_channel text not null default 'line',
  environment text not null default 'live' check (environment in ('live','test')),
  note text,
  quoted_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  rejected_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id)
);

create index if not exists payment_requests_guest_idx
  on public.payment_requests (guest_id, created_at desc);
create index if not exists payment_requests_team_status_idx
  on public.payment_requests (team_code, status, created_at desc);
create index if not exists payment_requests_entity_code_idx
  on public.payment_requests (entity_code);

create table if not exists public.payment_receipts (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.payment_requests(id) on delete cascade,
  source_provider text not null default 'line' check (source_provider in ('line','backoffice')),
  source_message_id text,
  submitted_by_hash text,
  object_path text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 10485760),
  created_at timestamptz not null default now(),
  unique (source_provider, source_message_id)
);

create index if not exists payment_receipts_request_idx
  on public.payment_receipts (payment_request_id, created_at desc);

alter table public.payment_requests enable row level security;
alter table public.payment_receipts enable row level security;
revoke all on public.payment_requests from anon, authenticated;
revoke all on public.payment_receipts from anon, authenticated;

-- Private storage. Only server-side service-role code may upload/read directly.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-slips',
  'payment-slips',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.touch_payment_request_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists payment_requests_touch_updated_at on public.payment_requests;
create trigger payment_requests_touch_updated_at
before update on public.payment_requests
for each row execute function public.touch_payment_request_updated_at();

create or replace function public.payment_customer_for_guest(p_guest_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ca.id
  from public.customer_accounts ca
  where ca.guest_id = p_guest_id
  order by ca.updated_at desc nulls last, ca.created_at desc
  limit 1
$$;
revoke all on function public.payment_customer_for_guest(uuid) from public, anon, authenticated;

create or replace function public.create_payment_for_booking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.service_type not in ('restaurant','stay','activity') then
    return new;
  end if;

  insert into public.payment_requests (
    entity_type, entity_id, entity_code, guest_id, customer_id, team_code,
    amount, status, source_channel, environment, note
  ) values (
    'booking', new.id, new.booking_code, new.guest_id,
    coalesce(new.customer_id, public.payment_customer_for_guest(new.guest_id)),
    new.service_type,
    null, 'quote_required', new.source_channel, new.environment,
    'Booking payment amount must be quoted by staff before customer payment.'
  )
  on conflict (entity_type, entity_id) do nothing;

  return new;
end;
$$;
revoke all on function public.create_payment_for_booking() from public, anon, authenticated;

drop trigger if exists create_payment_after_booking on public.bookings;
create trigger create_payment_after_booking
after insert on public.bookings
for each row execute function public.create_payment_for_booking();

create or replace function public.create_payment_for_restaurant_preorder()
returns trigger
language plpgsql
security definer
set search_path = public, tamma_chart_os
as $$
declare
  v_status text;
begin
  v_status := case when coalesce(new.total_amount, 0) > 0 then 'awaiting_payment' else 'quote_required' end;

  insert into public.payment_requests (
    entity_type, entity_id, entity_code, guest_id, customer_id, team_code,
    amount, status, source_channel, environment, quoted_at
  ) values (
    'restaurant_preorder', new.id, new.preorder_code, new.guest_id,
    public.payment_customer_for_guest(new.guest_id),
    'restaurant',
    case when coalesce(new.total_amount, 0) > 0 then new.total_amount else null end,
    v_status,
    new.source_channel,
    new.environment,
    case when coalesce(new.total_amount, 0) > 0 then now() else null end
  )
  on conflict (entity_type, entity_id) do nothing;

  return new;
end;
$$;
revoke all on function public.create_payment_for_restaurant_preorder() from public, anon, authenticated;

drop trigger if exists create_payment_after_restaurant_preorder on tamma_chart_os.restaurant_preorders;
create trigger create_payment_after_restaurant_preorder
after insert on tamma_chart_os.restaurant_preorders
for each row execute function public.create_payment_for_restaurant_preorder();

create or replace function public.sync_restaurant_preorder_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = public, tamma_chart_os
as $$
begin
  if new.total_amount is distinct from old.total_amount and coalesce(new.total_amount, 0) > 0 then
    update public.payment_requests
    set amount = new.total_amount,
        status = case when status in ('quote_required','awaiting_payment') then 'awaiting_payment' else status end,
        quoted_at = coalesce(quoted_at, now())
    where entity_type = 'restaurant_preorder'
      and entity_id = new.id
      and status <> 'verified';
  end if;

  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.payment_requests
    set status = 'cancelled'
    where entity_type = 'restaurant_preorder'
      and entity_id = new.id
      and status in ('quote_required','awaiting_payment','proof_submitted','rejected');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_restaurant_preorder_payment_amount() from public, anon, authenticated;

drop trigger if exists sync_payment_after_restaurant_preorder_update on tamma_chart_os.restaurant_preorders;
create trigger sync_payment_after_restaurant_preorder_update
after update of total_amount, status on tamma_chart_os.restaurant_preorders
for each row execute function public.sync_restaurant_preorder_payment_amount();

create or replace function public.create_payment_for_otop_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  v_status := case when coalesce(new.total_amount, 0) > 0 then 'awaiting_payment' else 'quote_required' end;

  insert into public.payment_requests (
    entity_type, entity_id, entity_code, guest_id, customer_id, team_code,
    amount, status, source_channel, environment, quoted_at
  ) values (
    'otop_order', new.id, new.order_code, new.guest_id,
    coalesce(new.customer_id, public.payment_customer_for_guest(new.guest_id)),
    'otop',
    case when coalesce(new.total_amount, 0) > 0 then new.total_amount else null end,
    v_status,
    new.source_channel,
    new.environment,
    case when coalesce(new.total_amount, 0) > 0 then now() else null end
  )
  on conflict (entity_type, entity_id) do nothing;
  return new;
end;
$$;
revoke all on function public.create_payment_for_otop_order() from public, anon, authenticated;

drop trigger if exists create_payment_after_otop_order on public.otop_orders;
create trigger create_payment_after_otop_order
after insert on public.otop_orders
for each row execute function public.create_payment_for_otop_order();

create or replace function public.sync_otop_payment_amount()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.total_amount is distinct from old.total_amount and coalesce(new.total_amount, 0) > 0 then
    update public.payment_requests
    set amount = new.total_amount,
        status = case when status in ('quote_required','awaiting_payment') then 'awaiting_payment' else status end,
        quoted_at = coalesce(quoted_at, now())
    where entity_type = 'otop_order'
      and entity_id = new.id
      and status <> 'verified';
  end if;

  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.payment_requests
    set status = 'cancelled'
    where entity_type = 'otop_order'
      and entity_id = new.id
      and status in ('quote_required','awaiting_payment','proof_submitted','rejected');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_otop_payment_amount() from public, anon, authenticated;

drop trigger if exists sync_payment_after_otop_order_update on public.otop_orders;
create trigger sync_payment_after_otop_order_update
after update of total_amount, status on public.otop_orders
for each row execute function public.sync_otop_payment_amount();

create or replace function public.sync_booking_payment_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from new.status then
    update public.payment_requests
    set status = 'cancelled'
    where entity_type = 'booking'
      and entity_id = new.id
      and status in ('quote_required','awaiting_payment','proof_submitted','rejected');
  end if;
  return new;
end;
$$;
revoke all on function public.sync_booking_payment_cancel() from public, anon, authenticated;

drop trigger if exists sync_payment_after_booking_cancel on public.bookings;
create trigger sync_payment_after_booking_cancel
after update of status on public.bookings
for each row execute function public.sync_booking_payment_cancel();

-- Async notification hook. Reuses the existing Vault secret and calls the payment dispatcher.
create or replace function public.enqueue_tamma_payment_notification()
returns trigger
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  v_secret text;
begin
  if coalesce(new.environment, 'live') not in ('live','test') then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ops_notification_webhook_secret'
  order by created_at desc
  limit 1;

  if v_secret is null or length(v_secret) < 24 then
    raise warning 'ops_notification_webhook_secret is missing; skipping payment notification';
    return new;
  end if;

  perform net.http_post(
    url := 'https://tamma-chat.netlify.app/.netlify/functions/ops-payment-notify',
    body := jsonb_build_object('id', new.id::text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-notification-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'Could not enqueue payment notification: %', sqlerrm;
    return new;
end;
$$;
revoke all on function public.enqueue_tamma_payment_notification() from public, anon, authenticated;

drop trigger if exists payment_notify_after_insert on public.payment_requests;
create trigger payment_notify_after_insert
after insert on public.payment_requests
for each row execute function public.enqueue_tamma_payment_notification();

drop trigger if exists payment_notify_after_update on public.payment_requests;
create trigger payment_notify_after_update
after update of status, amount on public.payment_requests
for each row
when (old.status is distinct from new.status or old.amount is distinct from new.amount)
execute function public.enqueue_tamma_payment_notification();

-- Brain/source-of-truth policy: payment method is owner-controlled and not inferred by the model.
insert into public.world_facts (
  fact_key, category, fact_value, verified, active, source, updated_at
) values (
  'operations.payment_policy',
  'operations_policy',
  jsonb_build_object(
    'accepted_method', 'promptpay_owner_qr',
    'single_channel', true,
    'account_name', 'นาย ชานนท์ ปรีชานนท์',
    'qr_asset_url', 'https://tamma-chat.netlify.app/assets/payment/tamma-promptpay.jpg',
    'rules', jsonb_build_array(
      'When payment is requested, offer only the verified owner PromptPay QR. Do not invent cash, card, transfer accounts, or alternative QR codes.',
      'For restaurant preorder and OTOP orders with a known total, request payment using this QR and ask the customer to return the slip in LINE.',
      'For stay/activity bookings without a configured amount, do not invent a price. Wait for staff to quote the amount; then send the same PromptPay QR.',
      'A customer slip is only proof submitted. Payment becomes verified only after staff review.'
    )
  ),
  true,
  true,
  'owner_verified_single_payment_channel_2026-09-17',
  now()
)
on conflict (fact_key) do update
set category = excluded.category,
    fact_value = excluded.fact_value,
    verified = true,
    active = true,
    source = excluded.source,
    updated_at = now();
