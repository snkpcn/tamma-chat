-- WW-9 Global Fulfillment & Tracking
-- Provider-neutral carrier booking evidence, immutable tracking timeline,
-- customer notification outbox, and fail-closed international returns.
-- Domestic checkout/shipping v1 remains authoritative and unchanged.

create table if not exists public.commerce_fulfillment_shipments (
  id uuid primary key default gen_random_uuid(),
  shipment_code text not null unique default (
    'FS-' || to_char(now(),'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  order_id uuid not null references public.otop_orders(id) on delete restrict,
  shipping_quote_id uuid not null references public.commerce_shipping_quotes(id) on delete restrict,
  market_code text not null references public.commerce_markets(market_code),
  destination_country_code text not null references public.commerce_countries(country_code),
  currency_code text not null references public.commerce_currencies(currency_code),
  provider_code text not null references public.commerce_shipping_providers(provider_code),
  service_code text not null,
  provider_adapter_key text not null
    check (provider_adapter_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  provider_shipment_id text not null
    check (char_length(provider_shipment_id) between 1 and 200),
  booking_idempotency_key text not null unique
    check (
      char_length(booking_idempotency_key) between 16 and 120
      and booking_idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$'
    ),
  provider_evidence_hash text not null
    check (provider_evidence_hash ~ '^[0-9a-f]{64}$'),
  booking_status text not null default 'booked'
    check (booking_status in ('booked','cancelled')),
  shipment_status text not null default 'booked'
    check (shipment_status in (
      'booked','label_ready','shipped','in_transit','out_for_delivery',
      'delivered','delivery_failed','returned','cancelled'
    )),
  environment text not null default 'live'
    check (environment in ('live','test')),
  booked_at timestamptz not null default now(),
  shipped_at timestamptz null,
  delivered_at timestamptz null,
  returned_at timestamptz null,
  cancelled_at timestamptz null,
  last_event_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(order_id),
  unique(provider_code,provider_shipment_id,environment),
  foreign key(market_code,service_code)
    references public.commerce_market_shipping_services(market_code,service_code)
);

create table if not exists public.commerce_fulfillment_packages (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null
    references public.commerce_fulfillment_shipments(id) on delete cascade,
  package_index integer not null check (package_index between 1 and 100),
  provider_package_id text null
    check (provider_package_id is null or char_length(provider_package_id) between 1 and 200),
  tracking_number_enc text null,
  tracking_url text null
    check (
      tracking_url is null
      or (
        char_length(tracking_url) between 8 and 1000
        and tracking_url ~ '^https://'
      )
    ),
  label_reference text null
    check (label_reference is null or char_length(label_reference) between 1 and 500),
  label_format text null
    check (label_format is null or label_format in ('pdf','png','zpl')),
  package_status text not null default 'booked'
    check (package_status in (
      'booked','label_ready','shipped','in_transit','out_for_delivery',
      'delivered','delivery_failed','returned','cancelled'
    )),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(shipment_id,package_index)
);

create table if not exists public.commerce_fulfillment_tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null
    references public.commerce_fulfillment_shipments(id) on delete cascade,
  provider_event_id text not null
    check (char_length(provider_event_id) between 1 and 200),
  event_code text not null
    check (event_code in (
      'BOOKED','LABEL_READY','PICKED_UP','IN_TRANSIT','CUSTOMS_HOLD',
      'CUSTOMS_RELEASED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED',
      'RETURN_TO_SENDER','CANCELLED'
    )),
  provider_status text null
    check (provider_status is null or char_length(provider_status) <= 200),
  customer_message text null
    check (customer_message is null or char_length(customer_message) <= 500),
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw_event_hash text not null
    check (raw_event_hash ~ '^[0-9a-f]{64}$'),
  state_applied boolean not null default false,
  environment text not null default 'live'
    check (environment in ('live','test')),
  metadata jsonb not null default '{}'::jsonb,
  unique(shipment_id,provider_event_id)
);

create table if not exists public.commerce_fulfillment_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null
    references public.commerce_fulfillment_shipments(id) on delete cascade,
  tracking_event_id uuid not null
    references public.commerce_fulfillment_tracking_events(id) on delete cascade,
  order_id uuid not null references public.otop_orders(id) on delete cascade,
  customer_id uuid null references public.customer_accounts(id) on delete set null,
  notification_key text not null
    check (notification_key ~ '^[a-z0-9][a-z0-9_.-]{1,79}$'),
  status text not null default 'pending'
    check (status in ('pending','sent','skipped','failed')),
  payload jsonb not null default '{}'::jsonb,
  attempt_count integer not null default 0 check (attempt_count between 0 and 100),
  last_error_code text null
    check (last_error_code is null or char_length(last_error_code) <= 120),
  environment text not null default 'live'
    check (environment in ('live','test')),
  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint commerce_fulfillment_notification_outbox_tracking_event_id_uq unique(tracking_event_id)
);

create table if not exists public.commerce_return_policies (
  market_code text primary key
    references public.commerce_markets(market_code) on delete cascade,
  enabled boolean not null default false,
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  return_window_days integer not null
    check (return_window_days between 1 and 365),
  allowed_resolutions jsonb not null default '["refund"]'::jsonb,
  terms_code text not null
    check (terms_code ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{1,119}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    jsonb_typeof(allowed_resolutions)='array'
    and jsonb_array_length(allowed_resolutions)>0
  )
);

create table if not exists public.commerce_return_requests (
  id uuid primary key default gen_random_uuid(),
  return_code text not null unique default (
    'RT-' || to_char(now(),'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  order_id uuid not null references public.otop_orders(id) on delete restrict,
  shipment_id uuid not null
    references public.commerce_fulfillment_shipments(id) on delete restrict,
  customer_id uuid not null references public.customer_accounts(id) on delete restrict,
  market_code text not null references public.commerce_markets(market_code),
  reason_code text not null
    check (reason_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  requested_resolution text not null
    check (requested_resolution in ('refund','replacement','store_credit','return_only')),
  status text not null default 'requested'
    check (status in (
      'requested','approved','rejected','in_transit','received','closed','cancelled'
    )),
  policy_terms_code text not null,
  idempotency_key text not null unique
    check (
      char_length(idempotency_key) between 16 and 120
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$'
    ),
  environment text not null default 'live'
    check (environment in ('live','test')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists commerce_fulfillment_shipments_order_idx
  on public.commerce_fulfillment_shipments(order_id,created_at desc);
create index if not exists commerce_fulfillment_shipments_provider_idx
  on public.commerce_fulfillment_shipments(provider_code,shipment_status,created_at desc);
create index if not exists commerce_fulfillment_shipments_status_idx
  on public.commerce_fulfillment_shipments(environment,shipment_status,updated_at desc);
create index if not exists commerce_fulfillment_packages_shipment_idx
  on public.commerce_fulfillment_packages(shipment_id,package_index);
create index if not exists commerce_fulfillment_tracking_events_timeline_idx
  on public.commerce_fulfillment_tracking_events(shipment_id,occurred_at asc,received_at asc);
create index if not exists commerce_fulfillment_notification_pending_idx
  on public.commerce_fulfillment_notification_outbox(environment,status,created_at asc)
  where status in ('pending','failed');
create index if not exists commerce_return_requests_customer_idx
  on public.commerce_return_requests(customer_id,status,created_at desc);
create index if not exists commerce_return_requests_order_idx
  on public.commerce_return_requests(order_id,created_at desc);

alter table public.commerce_fulfillment_shipments enable row level security;
alter table public.commerce_fulfillment_packages enable row level security;
alter table public.commerce_fulfillment_tracking_events enable row level security;
alter table public.commerce_fulfillment_notification_outbox enable row level security;
alter table public.commerce_return_policies enable row level security;
alter table public.commerce_return_requests enable row level security;

revoke all on table public.commerce_fulfillment_shipments from public,anon,authenticated,service_role;
revoke all on table public.commerce_fulfillment_packages from public,anon,authenticated,service_role;
revoke all on table public.commerce_fulfillment_tracking_events from public,anon,authenticated,service_role;
revoke all on table public.commerce_fulfillment_notification_outbox from public,anon,authenticated,service_role;
revoke all on table public.commerce_return_policies from public,anon,authenticated,service_role;
revoke all on table public.commerce_return_requests from public,anon,authenticated,service_role;

grant select,insert,update on table public.commerce_fulfillment_shipments to service_role;
grant select,insert,update on table public.commerce_fulfillment_packages to service_role;
grant select,insert on table public.commerce_fulfillment_tracking_events to service_role;
grant select,insert,update on table public.commerce_fulfillment_notification_outbox to service_role;
grant select,insert,update,delete on table public.commerce_return_policies to service_role;
grant select,insert,update on table public.commerce_return_requests to service_role;

create or replace function public.record_commerce_fulfillment_booking_v1(
  p_order_id uuid,
  p_provider_shipment_id text,
  p_provider_adapter_key text,
  p_packages jsonb,
  p_booking_idempotency_key text,
  p_provider_evidence_hash text,
  p_environment text default 'live'
) returns table(
  shipment_id uuid,
  shipment_code text,
  provider_code text,
  service_code text,
  shipment_status text,
  package_count integer
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_order public.otop_orders%rowtype;
  v_quote public.commerce_shipping_quotes%rowtype;
  v_provider public.commerce_shipping_providers%rowtype;
  v_service public.commerce_market_shipping_services%rowtype;
  v_payment public.commerce_payment_intents%rowtype;
  v_existing public.commerce_fulfillment_shipments%rowtype;
  v_shipment public.commerce_fulfillment_shipments%rowtype;
  v_package record;
  v_package_count integer;
  v_labels_ready boolean;
  v_first_tracking_enc text;
  v_first_tracking_url text;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_provider_shipment_id is null or char_length(trim(p_provider_shipment_id)) not between 1 and 200 then
    raise exception 'invalid_provider_shipment_id';
  end if;
  if p_provider_adapter_key is null or lower(trim(p_provider_adapter_key)) !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then
    raise exception 'invalid_provider_adapter_key';
  end if;
  if p_booking_idempotency_key is null
     or char_length(p_booking_idempotency_key) not between 16 and 120
     or p_booking_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$' then
    raise exception 'idempotency_key_required';
  end if;
  if p_provider_evidence_hash is null or lower(p_provider_evidence_hash) !~ '^[0-9a-f]{64}$' then
    raise exception 'provider_evidence_hash_required';
  end if;
  if jsonb_typeof(p_packages)<>'array'
     or jsonb_array_length(p_packages)<1
     or jsonb_array_length(p_packages)>100 then
    raise exception 'invalid_packages';
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_packages) e
    where jsonb_typeof(e)<>'object'
      or jsonb_typeof(e->'packageIndex')<>'number'
      or (e->>'packageIndex') !~ '^[0-9]{1,3}$'
      or (e->>'packageIndex')::integer not between 1 and 100
      or (e ? 'trackingUrl' and e->>'trackingUrl' is not null and e->>'trackingUrl' !~ '^https://')
      or (e ? 'labelFormat' and e->>'labelFormat' is not null and e->>'labelFormat' not in ('pdf','png','zpl'))
  ) then
    raise exception 'invalid_packages';
  end if;
  if (
    select count(distinct (e->>'packageIndex')::integer)
    from jsonb_array_elements(p_packages) e
  ) <> jsonb_array_length(p_packages) then
    raise exception 'duplicate_package_index';
  end if;

  select * into v_existing
  from public.commerce_fulfillment_shipments s
  where s.booking_idempotency_key=p_booking_idempotency_key
  limit 1;
  if found then
    if v_existing.order_id<>p_order_id
       or v_existing.provider_shipment_id<>trim(p_provider_shipment_id)
       or v_existing.provider_adapter_key<>lower(trim(p_provider_adapter_key))
       or v_existing.provider_evidence_hash<>lower(p_provider_evidence_hash)
       or v_existing.environment<>p_environment then
      raise exception 'fulfillment_booking_idempotency_conflict';
    end if;
    return query
      select v_existing.id,v_existing.shipment_code,v_existing.provider_code,
             v_existing.service_code,v_existing.shipment_status,
             (select count(*)::integer from public.commerce_fulfillment_packages p where p.shipment_id=v_existing.id);
    return;
  end if;

  select * into v_order from public.otop_orders o where o.id=p_order_id for update;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.checkout_version<>2 or v_order.fulfillment_type<>'shipping' then
    raise exception 'global_fulfillment_requires_checkout_v2';
  end if;
  if v_order.environment<>p_environment then raise exception 'environment_mismatch'; end if;
  if v_order.shipping_status<>'packing' then
    raise exception 'order_not_ready_for_fulfillment:%',coalesce(v_order.shipping_status,'null');
  end if;
  if v_order.payment_intent_id is null then raise exception 'captured_payment_required'; end if;
  select * into v_payment from public.commerce_payment_intents p
  where p.id=v_order.payment_intent_id
    and p.source_entity_type='otop_order'
    and p.source_entity_id=v_order.id
    and p.status='captured'
    and p.captured_amount_minor>=p.amount_minor
  limit 1;
  if not found then raise exception 'captured_payment_required'; end if;

  select * into v_quote from public.commerce_shipping_quotes q
  where q.id=v_order.shipping_quote_id and q.status='consumed'
  limit 1;
  if not found then raise exception 'consumed_shipping_quote_required'; end if;
  if v_quote.market_code<>v_order.market_code
     or v_quote.destination_country_code<>v_order.destination_country_code
     or v_quote.currency_code<>v_order.currency_code
     or v_quote.environment<>v_order.environment then
    raise exception 'shipping_quote_order_mismatch';
  end if;

  select * into v_provider from public.commerce_shipping_providers p
  where p.provider_code=v_quote.provider_code
    and p.status='live' and p.active
  limit 1;
  if not found then raise exception 'shipping_provider_not_live'; end if;
  if v_provider.adapter_key<>lower(trim(p_provider_adapter_key))
     or v_provider.adapter_key='legacy_domestic_static_v1' then
    raise exception 'shipping_provider_adapter_mismatch';
  end if;

  select * into v_service from public.commerce_market_shipping_services s
  where s.market_code=v_quote.market_code
    and s.service_code=v_quote.service_code
    and s.provider_code=v_quote.provider_code
    and s.execution_mode='global_v2'
    and s.status='live' and s.enabled
  limit 1;
  if not found then raise exception 'global_shipping_service_not_live'; end if;

  v_package_count:=jsonb_array_length(p_packages);
  if jsonb_typeof(v_quote.parcel_snapshot)<>'array'
     or jsonb_array_length(v_quote.parcel_snapshot)<>v_package_count then
    raise exception 'provider_package_count_mismatch';
  end if;
  if exists(
    select 1 from generate_series(1,v_package_count) n
    where not exists(
      select 1 from jsonb_array_elements(p_packages) e
      where (e->>'packageIndex')::integer=n
    )
  ) then
    raise exception 'package_indexes_must_be_contiguous';
  end if;

  select bool_and(
    nullif(trim(e->>'labelReference'),'') is not null
  ) into v_labels_ready
  from jsonb_array_elements(p_packages) e;

  insert into public.commerce_fulfillment_shipments(
    order_id,shipping_quote_id,market_code,destination_country_code,currency_code,
    provider_code,service_code,provider_adapter_key,provider_shipment_id,
    booking_idempotency_key,provider_evidence_hash,booking_status,shipment_status,
    environment,last_event_at
  ) values(
    v_order.id,v_quote.id,v_order.market_code,v_order.destination_country_code,v_order.currency_code,
    v_quote.provider_code,v_quote.service_code,v_provider.adapter_key,trim(p_provider_shipment_id),
    p_booking_idempotency_key,lower(p_provider_evidence_hash),'booked',
    case when coalesce(v_labels_ready,false) then 'label_ready' else 'booked' end,
    p_environment,now()
  ) returning * into v_shipment;

  for v_package in
    select
      (e->>'packageIndex')::integer package_index,
      nullif(trim(e->>'providerPackageId'),'') provider_package_id,
      nullif(e->>'trackingNumberEnc','') tracking_number_enc,
      nullif(trim(e->>'trackingUrl'),'') tracking_url,
      nullif(trim(e->>'labelReference'),'') label_reference,
      nullif(lower(trim(e->>'labelFormat')),'') label_format
    from jsonb_array_elements(p_packages) e
    order by (e->>'packageIndex')::integer
  loop
    insert into public.commerce_fulfillment_packages(
      shipment_id,package_index,provider_package_id,tracking_number_enc,tracking_url,
      label_reference,label_format,package_status
    ) values(
      v_shipment.id,v_package.package_index,v_package.provider_package_id,
      v_package.tracking_number_enc,v_package.tracking_url,
      v_package.label_reference,v_package.label_format,
      case when v_package.label_reference is not null then 'label_ready' else 'booked' end
    );
    if v_package.package_index=1 then
      v_first_tracking_enc:=v_package.tracking_number_enc;
      v_first_tracking_url:=v_package.tracking_url;
    end if;
  end loop;

  insert into public.commerce_fulfillment_tracking_events(
    shipment_id,provider_event_id,event_code,provider_status,customer_message,
    occurred_at,raw_event_hash,state_applied,environment,metadata
  ) values(
    v_shipment.id,'booking:'||trim(p_provider_shipment_id),'BOOKED','booked',
    'Carrier booking confirmed.',v_shipment.booked_at,lower(p_provider_evidence_hash),true,
    p_environment,jsonb_build_object('source','carrier_adapter')
  );

  if coalesce(v_labels_ready,false) then
    insert into public.commerce_fulfillment_tracking_events(
      shipment_id,provider_event_id,event_code,provider_status,customer_message,
      occurred_at,raw_event_hash,state_applied,environment,metadata
    ) values(
      v_shipment.id,'label:'||trim(p_provider_shipment_id),'LABEL_READY','label_ready',
      'Shipping label is ready.',v_shipment.booked_at,lower(p_provider_evidence_hash),true,
      p_environment,jsonb_build_object('source','carrier_adapter')
    );
  end if;

  update public.otop_orders
  set carrier_name=v_provider.display_name,
      tracking_number_enc=case when v_package_count=1 then v_first_tracking_enc else null end,
      tracking_url=case when v_package_count=1 then v_first_tracking_url else null end,
      shipping_status='ready_to_ship'
  where id=v_order.id;

  insert into public.commerce_fulfillment_notification_outbox(
    shipment_id,tracking_event_id,order_id,customer_id,notification_key,payload,environment
  )
  select
    v_shipment.id,e.id,v_order.id,v_order.customer_id,
    case e.event_code when 'LABEL_READY' then 'fulfillment.label_ready' else 'fulfillment.booked' end,
    jsonb_build_object(
      'orderCode',v_order.order_code,
      'shipmentCode',v_shipment.shipment_code,
      'eventCode',e.event_code,
      'marketCode',v_order.market_code,
      'destinationCountryCode',v_order.destination_country_code
    ),
    p_environment
  from public.commerce_fulfillment_tracking_events e
  where e.shipment_id=v_shipment.id and e.event_code in ('BOOKED','LABEL_READY')
  on conflict on constraint commerce_fulfillment_notification_outbox_tracking_event_id_uq do nothing;

  return query
    select v_shipment.id,v_shipment.shipment_code,v_shipment.provider_code,
           v_shipment.service_code,v_shipment.shipment_status,v_package_count;
end; $$;

revoke all on function public.record_commerce_fulfillment_booking_v1(uuid,text,text,jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.record_commerce_fulfillment_booking_v1(uuid,text,text,jsonb,text,text,text)
  to service_role;

create or replace function public.apply_commerce_fulfillment_tracking_event_v1(
  p_shipment_id uuid,
  p_provider_event_id text,
  p_event_code text,
  p_occurred_at timestamptz,
  p_provider_status text,
  p_customer_message text,
  p_raw_event_hash text,
  p_metadata jsonb default '{}'::jsonb,
  p_environment text default 'live'
) returns table(
  tracking_event_id uuid,
  shipment_status text,
  state_applied boolean,
  order_shipping_status text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_shipment public.commerce_fulfillment_shipments%rowtype;
  v_order public.otop_orders%rowtype;
  v_existing public.commerce_fulfillment_tracking_events%rowtype;
  v_event public.commerce_fulfillment_tracking_events%rowtype;
  v_code text;
  v_next text;
  v_apply boolean:=false;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_provider_event_id is null or char_length(trim(p_provider_event_id)) not between 1 and 200 then
    raise exception 'invalid_provider_event_id';
  end if;
  v_code:=upper(trim(coalesce(p_event_code,'')));
  if v_code not in (
    'BOOKED','LABEL_READY','PICKED_UP','IN_TRANSIT','CUSTOMS_HOLD',
    'CUSTOMS_RELEASED','OUT_FOR_DELIVERY','DELIVERED','DELIVERY_FAILED',
    'RETURN_TO_SENDER','CANCELLED'
  ) then raise exception 'invalid_tracking_event_code'; end if;
  if p_occurred_at is null then raise exception 'tracking_event_time_required'; end if;
  if p_raw_event_hash is null or lower(p_raw_event_hash) !~ '^[0-9a-f]{64}$' then
    raise exception 'raw_event_hash_required';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata)<>'object' then raise exception 'invalid_event_metadata'; end if;

  select * into v_existing
  from public.commerce_fulfillment_tracking_events e
  where e.shipment_id=p_shipment_id and e.provider_event_id=trim(p_provider_event_id)
  limit 1;
  if found then
    if v_existing.event_code<>v_code
       or v_existing.occurred_at<>p_occurred_at
       or v_existing.raw_event_hash<>lower(p_raw_event_hash)
       or v_existing.environment<>p_environment then
      raise exception 'tracking_event_idempotency_conflict';
    end if;
    select * into v_shipment from public.commerce_fulfillment_shipments s where s.id=p_shipment_id;
    select * into v_order from public.otop_orders o where o.id=v_shipment.order_id;
    return query select v_existing.id,v_shipment.shipment_status,v_existing.state_applied,v_order.shipping_status;
    return;
  end if;

  select * into v_shipment
  from public.commerce_fulfillment_shipments s
  where s.id=p_shipment_id for update;
  if not found then raise exception 'shipment_not_found'; end if;
  if v_shipment.environment<>p_environment then raise exception 'environment_mismatch'; end if;
  if v_shipment.booking_status<>'booked' then raise exception 'shipment_not_active'; end if;
  select * into v_order from public.otop_orders o where o.id=v_shipment.order_id for update;
  if not found or v_order.checkout_version<>2 then raise exception 'global_fulfillment_requires_checkout_v2'; end if;

  v_next:=case v_code
    when 'BOOKED' then 'booked'
    when 'LABEL_READY' then 'label_ready'
    when 'PICKED_UP' then 'shipped'
    when 'IN_TRANSIT' then 'in_transit'
    when 'CUSTOMS_HOLD' then 'in_transit'
    when 'CUSTOMS_RELEASED' then 'in_transit'
    when 'OUT_FOR_DELIVERY' then 'out_for_delivery'
    when 'DELIVERED' then 'delivered'
    when 'DELIVERY_FAILED' then 'delivery_failed'
    when 'RETURN_TO_SENDER' then 'returned'
    when 'CANCELLED' then 'cancelled'
  end;

  v_apply:=case
    when v_next=v_shipment.shipment_status then false
    when v_shipment.shipment_status='booked'
      and v_next in ('label_ready','shipped','in_transit','out_for_delivery','delivery_failed','returned','cancelled') then true
    when v_shipment.shipment_status='label_ready'
      and v_next in ('shipped','in_transit','out_for_delivery','delivery_failed','returned','cancelled') then true
    when v_shipment.shipment_status='shipped'
      and v_next in ('in_transit','out_for_delivery','delivered','delivery_failed','returned') then true
    when v_shipment.shipment_status='in_transit'
      and v_next in ('out_for_delivery','delivered','delivery_failed','returned') then true
    when v_shipment.shipment_status='out_for_delivery'
      and v_next in ('delivered','delivery_failed','returned') then true
    when v_shipment.shipment_status='delivery_failed'
      and v_next in ('in_transit','out_for_delivery','delivered','returned') then true
    else false
  end;

  insert into public.commerce_fulfillment_tracking_events(
    shipment_id,provider_event_id,event_code,provider_status,customer_message,
    occurred_at,raw_event_hash,state_applied,environment,metadata
  ) values(
    v_shipment.id,trim(p_provider_event_id),v_code,left(p_provider_status,200),
    left(p_customer_message,500),p_occurred_at,lower(p_raw_event_hash),v_apply,
    p_environment,p_metadata
  ) returning * into v_event;

  if v_apply then
    update public.commerce_fulfillment_shipments
    set shipment_status=v_next,
        last_event_at=greatest(coalesce(last_event_at,p_occurred_at),p_occurred_at),
        shipped_at=case when v_next in ('shipped','in_transit','out_for_delivery','delivered','delivery_failed','returned')
          then coalesce(shipped_at,p_occurred_at) else shipped_at end,
        delivered_at=case when v_next='delivered' then coalesce(delivered_at,p_occurred_at) else delivered_at end,
        returned_at=case when v_next='returned' then coalesce(returned_at,p_occurred_at) else returned_at end,
        cancelled_at=case when v_next='cancelled' then coalesce(cancelled_at,p_occurred_at) else cancelled_at end,
        booking_status=case when v_next='cancelled' then 'cancelled' else booking_status end,
        updated_at=now()
    where id=v_shipment.id
    returning * into v_shipment;

    update public.commerce_fulfillment_packages
    set package_status=v_next,updated_at=now()
    where shipment_id=v_shipment.id
      and package_status not in ('delivered','returned','cancelled');

    if v_next='label_ready' and v_order.shipping_status='packing' then
      update public.otop_orders set shipping_status='ready_to_ship' where id=v_order.id returning * into v_order;
    elsif v_next in ('shipped','in_transit','out_for_delivery') then
      if v_order.shipping_status='packing' then
        update public.otop_orders set shipping_status='ready_to_ship' where id=v_order.id returning * into v_order;
      end if;
      if v_order.shipping_status='ready_to_ship' then
        update public.otop_orders set shipping_status='shipped' where id=v_order.id returning * into v_order;
      end if;
    elsif v_next='delivered' then
      if v_order.shipping_status='delivery_failed' then
        update public.otop_orders set shipping_status='shipped' where id=v_order.id returning * into v_order;
      elsif v_order.shipping_status='ready_to_ship' then
        update public.otop_orders set shipping_status='shipped' where id=v_order.id returning * into v_order;
      end if;
      if v_order.shipping_status='shipped' then
        update public.otop_orders set shipping_status='delivered' where id=v_order.id returning * into v_order;
      end if;
    elsif v_next='delivery_failed' and v_order.shipping_status='shipped' then
      update public.otop_orders set shipping_status='delivery_failed' where id=v_order.id returning * into v_order;
    elsif v_next='returned' then
      if v_order.shipping_status='ready_to_ship' then
        update public.otop_orders set shipping_status='shipped' where id=v_order.id returning * into v_order;
      end if;
      if v_order.shipping_status in ('shipped','delivery_failed') then
        update public.otop_orders set shipping_status='returned' where id=v_order.id returning * into v_order;
      end if;
    elsif v_next='cancelled' and v_order.shipping_status in ('packing','ready_to_ship') then
      update public.otop_orders set shipping_status='cancelled' where id=v_order.id returning * into v_order;
    end if;

    insert into public.commerce_fulfillment_notification_outbox(
      shipment_id,tracking_event_id,order_id,customer_id,notification_key,payload,environment
    ) values(
      v_shipment.id,v_event.id,v_order.id,v_order.customer_id,
      'fulfillment.'||lower(v_code),
      jsonb_build_object(
        'orderCode',v_order.order_code,
        'shipmentCode',v_shipment.shipment_code,
        'eventCode',v_code,
        'shipmentStatus',v_shipment.shipment_status,
        'marketCode',v_order.market_code,
        'destinationCountryCode',v_order.destination_country_code,
        'occurredAt',p_occurred_at
      ),
      p_environment
    ) on conflict on constraint commerce_fulfillment_notification_outbox_tracking_event_id_uq do nothing;
  end if;

  return query select v_event.id,v_shipment.shipment_status,v_event.state_applied,v_order.shipping_status;
end; $$;

revoke all on function public.apply_commerce_fulfillment_tracking_event_v1(uuid,text,text,timestamptz,text,text,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.apply_commerce_fulfillment_tracking_event_v1(uuid,text,text,timestamptz,text,text,text,jsonb,text)
  to service_role;

create or replace function public.create_commerce_return_request_v1(
  p_auth_user_id uuid,
  p_order_id uuid,
  p_reason_code text,
  p_requested_resolution text,
  p_idempotency_key text,
  p_environment text default 'live'
) returns table(
  return_id uuid,
  return_code text,
  status text,
  requested_resolution text,
  policy_terms_code text
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_customer public.customer_accounts%rowtype;
  v_order public.otop_orders%rowtype;
  v_shipment public.commerce_fulfillment_shipments%rowtype;
  v_policy public.commerce_return_policies%rowtype;
  v_existing public.commerce_return_requests%rowtype;
  v_return public.commerce_return_requests%rowtype;
  v_reason text;
  v_resolution text;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  v_reason:=lower(trim(coalesce(p_reason_code,'')));
  v_resolution:=lower(trim(coalesce(p_requested_resolution,'')));
  if v_reason !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then raise exception 'invalid_return_reason'; end if;
  if v_resolution not in ('refund','replacement','store_credit','return_only') then
    raise exception 'invalid_return_resolution';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 120
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$' then
    raise exception 'idempotency_key_required';
  end if;

  select * into v_customer
  from public.customer_accounts c
  where c.auth_user_id=p_auth_user_id and c.member_status='member'
  limit 1;
  if not found then raise exception 'member_profile_required'; end if;

  select * into v_existing
  from public.commerce_return_requests r
  where r.idempotency_key=p_idempotency_key
  limit 1;
  if found then
    if v_existing.customer_id<>v_customer.id
       or v_existing.order_id<>p_order_id
       or v_existing.reason_code<>v_reason
       or v_existing.requested_resolution<>v_resolution
       or v_existing.environment<>p_environment then
      raise exception 'return_idempotency_conflict';
    end if;
    return query select v_existing.id,v_existing.return_code,v_existing.status,
                        v_existing.requested_resolution,v_existing.policy_terms_code;
    return;
  end if;

  select * into v_order
  from public.otop_orders o
  where o.id=p_order_id and o.customer_id=v_customer.id
  limit 1;
  if not found then raise exception 'order_not_found'; end if;
  if v_order.checkout_version<>2 or v_order.environment<>p_environment then
    raise exception 'international_return_only';
  end if;
  if v_order.shipping_status<>'delivered' or v_order.delivered_at is null then
    raise exception 'return_requires_delivered_order';
  end if;

  select * into v_shipment
  from public.commerce_fulfillment_shipments s
  where s.order_id=v_order.id and s.shipment_status='delivered'
  limit 1;
  if not found then raise exception 'delivered_fulfillment_required'; end if;

  select * into v_policy
  from public.commerce_return_policies p
  where p.market_code=v_order.market_code and p.enabled and p.status='live'
  limit 1;
  if not found then raise exception 'return_policy_not_live'; end if;
  if v_order.delivered_at + make_interval(days=>v_policy.return_window_days) < now() then
    raise exception 'return_window_closed';
  end if;
  if not exists(
    select 1 from jsonb_array_elements_text(v_policy.allowed_resolutions) x(value)
    where x.value=v_resolution
  ) then raise exception 'return_resolution_not_allowed'; end if;

  insert into public.commerce_return_requests(
    order_id,shipment_id,customer_id,market_code,reason_code,requested_resolution,
    status,policy_terms_code,idempotency_key,environment
  ) values(
    v_order.id,v_shipment.id,v_customer.id,v_order.market_code,v_reason,v_resolution,
    'requested',v_policy.terms_code,p_idempotency_key,p_environment
  ) returning * into v_return;

  return query select v_return.id,v_return.return_code,v_return.status,
                      v_return.requested_resolution,v_return.policy_terms_code;
end; $$;

revoke all on function public.create_commerce_return_request_v1(uuid,uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.create_commerce_return_request_v1(uuid,uuid,text,text,text,text)
  to service_role;

comment on table public.commerce_fulfillment_shipments is
  'WW-9 provider-neutral international carrier booking evidence. No live carrier is seeded by WW-9.';
comment on table public.commerce_fulfillment_tracking_events is
  'Immutable idempotent provider tracking timeline. Out-of-order events remain evidence but do not rewind state.';
comment on table public.commerce_fulfillment_notification_outbox is
  'Customer notification work queue only. WW-9 does not invent or auto-enable an outbound provider.';
comment on table public.commerce_return_policies is
  'Explicit per-market international return policy. WW-9 seeds none; returns fail closed until a policy is live.';
