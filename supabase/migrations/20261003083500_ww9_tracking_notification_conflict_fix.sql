-- WW-9 hotfix: disambiguate notification outbox conflict target on already-migrated databases.
-- Fresh databases receive the named constraint from the base WW-9 migration.
-- Existing production created the implicit *_key constraint before this fix.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid='public.commerce_fulfillment_notification_outbox'::regclass
      and conname='commerce_fulfillment_notification_outbox_tracking_event_id_key'
  ) and not exists (
    select 1 from pg_constraint
    where conrelid='public.commerce_fulfillment_notification_outbox'::regclass
      and conname='commerce_fulfillment_notification_outbox_tracking_event_id_uq'
  ) then
    alter table public.commerce_fulfillment_notification_outbox
      rename constraint commerce_fulfillment_notification_outbox_tracking_event_id_key
      to commerce_fulfillment_notification_outbox_tracking_event_id_uq;
  end if;
end;
$$;

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
