create table if not exists public.commerce_shipping_quote_cart_bindings (
  quote_id uuid primary key references public.commerce_shipping_quotes(id) on delete cascade,
  request_items jsonb not null,
  environment text not null check (environment in ('live','test')),
  created_at timestamptz not null default now(),
  check (jsonb_typeof(request_items)='array' and jsonb_array_length(request_items)>0)
);
alter table public.commerce_shipping_quote_cart_bindings enable row level security;
revoke all on table public.commerce_shipping_quote_cart_bindings from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_shipping_quote_cart_bindings to service_role;

alter table public.otop_orders
  add column if not exists checkout_version smallint not null default 1,
  add column if not exists destination_country_code text null,
  add column if not exists shipping_quote_id uuid null,
  add column if not exists customs_snapshot_id uuid null,
  add column if not exists payment_intent_id uuid null,
  add column if not exists subtotal_minor bigint null,
  add column if not exists shipping_fee_minor bigint null,
  add column if not exists total_minor bigint null,
  add column if not exists shipping_address_snapshot_v2 jsonb null,
  add column if not exists checkout_request_items jsonb null,
  add column if not exists payment_provider_code text null,
  add column if not exists payment_method_code text null,
  add column if not exists duty_terms_code text null,
  add column if not exists duty_disclosure_key text null,
  add column if not exists duties_acknowledged_at timestamptz null;

alter table public.otop_orders drop constraint if exists otop_orders_checkout_version_check;
alter table public.otop_orders add constraint otop_orders_checkout_version_check check (checkout_version in (1,2));
alter table public.otop_orders drop constraint if exists otop_orders_destination_country_fkey;
alter table public.otop_orders add constraint otop_orders_destination_country_fkey foreign key(destination_country_code) references public.commerce_countries(country_code);
alter table public.otop_orders drop constraint if exists otop_orders_shipping_quote_fkey;
alter table public.otop_orders add constraint otop_orders_shipping_quote_fkey foreign key(shipping_quote_id) references public.commerce_shipping_quotes(id);
alter table public.otop_orders drop constraint if exists otop_orders_customs_snapshot_fkey;
alter table public.otop_orders add constraint otop_orders_customs_snapshot_fkey foreign key(customs_snapshot_id) references public.commerce_customs_compliance_snapshots(id);
alter table public.otop_orders drop constraint if exists otop_orders_payment_intent_fkey;
alter table public.otop_orders add constraint otop_orders_payment_intent_fkey foreign key(payment_intent_id) references public.commerce_payment_intents(id);
alter table public.otop_orders drop constraint if exists otop_orders_minor_amount_check;
alter table public.otop_orders add constraint otop_orders_minor_amount_check check (
  (subtotal_minor is null or subtotal_minor>=0) and
  (shipping_fee_minor is null or shipping_fee_minor>=0) and
  (total_minor is null or total_minor>=0)
);
alter table public.otop_orders drop constraint if exists otop_orders_checkout_v2_shape_check;
alter table public.otop_orders add constraint otop_orders_checkout_v2_shape_check check (
  checkout_version<>2 or (
    pricing_source='multi_currency_v1'
    and destination_country_code is not null and shipping_quote_id is not null
    and customs_snapshot_id is not null and subtotal_minor is not null
    and shipping_fee_minor is not null and total_minor is not null
    and shipping_address_snapshot_v2 is not null and checkout_request_items is not null
    and payment_provider_code is not null and payment_method_code is not null
    and duty_terms_code is not null and duty_disclosure_key is not null
    and duties_acknowledged_at is not null
  )
);
alter table public.otop_order_items
  add column if not exists unit_price_minor bigint null,
  add column if not exists line_total_minor bigint null;
alter table public.otop_order_items drop constraint if exists otop_order_items_minor_amount_check;
alter table public.otop_order_items add constraint otop_order_items_minor_amount_check check (
  (unit_price_minor is null or unit_price_minor>=0)
  and (line_total_minor is null or line_total_minor>=0)
);
create index if not exists otop_orders_shipping_quote_idx on public.otop_orders(shipping_quote_id) where shipping_quote_id is not null;
create index if not exists otop_orders_customs_snapshot_idx on public.otop_orders(customs_snapshot_id) where customs_snapshot_id is not null;
create index if not exists otop_orders_payment_intent_idx on public.otop_orders(payment_intent_id) where payment_intent_id is not null;
create index if not exists otop_orders_destination_country_idx on public.otop_orders(destination_country_code) where destination_country_code is not null;

create or replace function public.create_payment_for_otop_order()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_status text;
begin
  if new.checkout_version=2 then return new; end if;
  if new.currency_code<>'THB' then raise exception 'global_payment_not_enabled'; end if;
  v_status:=case when coalesce(new.total_amount,0)>0 then 'awaiting_payment' else 'quote_required' end;
  insert into public.payment_requests(entity_type,entity_id,entity_code,guest_id,customer_id,team_code,amount,currency,method,status,source_channel,environment,quoted_at)
  values('otop_order',new.id,new.order_code,new.guest_id,coalesce(new.customer_id,public.payment_customer_for_guest(new.guest_id)),'otop',
    case when coalesce(new.total_amount,0)>0 then new.total_amount else null end,new.currency_code,'promptpay_owner_qr',v_status,new.source_channel,new.environment,
    case when coalesce(new.total_amount,0)>0 then now() else null end)
  on conflict(entity_type,entity_id) do nothing;
  return new;
end; $$;

create or replace function public.sync_otop_payment_amount()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.checkout_version=2 then return new; end if;
  if new.currency_code<>'THB' then raise exception 'global_payment_not_enabled'; end if;
  if (new.total_amount is distinct from old.total_amount or new.currency_code is distinct from old.currency_code)
     and coalesce(new.total_amount,0)>0 then
    update public.payment_requests set amount=new.total_amount,currency=new.currency_code,
      status=case when status in ('quote_required','awaiting_payment') then 'awaiting_payment' else status end,
      quoted_at=coalesce(quoted_at,now())
    where entity_type='otop_order' and entity_id=new.id and status<>'verified';
  end if;
  if new.status='cancelled' and old.status is distinct from new.status then
    update public.payment_requests set status='cancelled'
    where entity_type='otop_order' and entity_id=new.id
      and status in ('quote_required','awaiting_payment','proof_submitted','rejected');
  end if;
  return new;
end; $$;

create or replace function public.require_verified_payment_for_otop_confirmation()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_payment_status text;
begin
  if new.status='confirmed' and old.status is distinct from new.status then
    if new.checkout_version=2 then
      select p.status into v_payment_status from public.commerce_payment_intents p where p.id=new.payment_intent_id limit 1;
      if v_payment_status is distinct from 'captured' then raise exception 'global_payment_not_captured:%',new.order_code using errcode='P0001'; end if;
    else
      select pr.status into v_payment_status from public.payment_requests pr
      where pr.entity_type='otop_order' and pr.entity_id=new.id order by pr.created_at desc limit 1;
      if v_payment_status is distinct from 'verified' then raise exception 'payment_not_verified:%',new.order_code using errcode='P0001'; end if;
    end if;
  end if;
  return new;
end; $$;

create or replace function public.sync_otop_shipping_after_global_payment()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.source_entity_type='otop_order'
     and old.status is distinct from new.status
     and new.status='captured' then
    update public.otop_orders set shipping_status='packing'
    where id=new.source_entity_id and checkout_version=2
      and fulfillment_type='shipping' and shipping_status='awaiting_payment';
  end if;
  return new;
end; $$;
revoke all on function public.sync_otop_shipping_after_global_payment() from public,anon,authenticated;
grant execute on function public.sync_otop_shipping_after_global_payment() to service_role;
drop trigger if exists sync_otop_shipping_after_global_payment on public.commerce_payment_intents;
create trigger sync_otop_shipping_after_global_payment
after update of status on public.commerce_payment_intents
for each row execute function public.sync_otop_shipping_after_global_payment();

create or replace function public.create_commerce_cart_shipping_quote_v1(
  p_market_code text,p_destination_country_code text,p_currency_code text,p_service_code text,
  p_items jsonb,p_idempotency_key text,p_environment text default 'live'
) returns table(quote_id uuid,quote_code text,amount_minor bigint,currency_code text,expires_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  v_item record; v_product record; v_profile public.commerce_product_shipping_profiles%rowtype;
  v_items jsonb:='[]'::jsonb; v_parcels jsonb:='[]'::jsonb; v_units integer:=0;
  v_origin text:=null; v_quote record; v_binding public.commerce_shipping_quote_cart_bindings%rowtype;
begin
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>30 then raise exception 'invalid_items'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e
    where jsonb_typeof(e)<>'object' or jsonb_typeof(e->'sku')<>'string' or jsonb_typeof(e->'quantity')<>'number'
      or upper(trim(e->>'sku')) !~ '^[A-Z0-9][A-Z0-9_-]{2,79}$' or (e->>'quantity') !~ '^[0-9]{1,2}$') then raise exception 'invalid_items'; end if;
  for v_item in
    select upper(trim(e->>'sku')) sku,sum((e->>'quantity')::integer)::integer quantity
    from jsonb_array_elements(p_items) e group by upper(trim(e->>'sku')) order by upper(trim(e->>'sku'))
  loop
    if v_item.quantity<1 or v_item.quantity>99 then raise exception 'invalid_items'; end if;
    select p.id,p.sku into v_product from public.otop_products p where p.sku=v_item.sku and p.environment=p_environment and p.active and p.verified limit 1;
    if not found then raise exception 'product_not_available:%',v_item.sku; end if;
    select * into v_profile from public.commerce_product_shipping_profiles sp where sp.product_id=v_product.id and sp.active limit 1;
    if not found then raise exception 'shipping_profile_required:%',v_item.sku; end if;
    if v_origin is null then v_origin:=v_profile.origin_country_code;
    elsif v_origin<>v_profile.origin_country_code then raise exception 'mixed_shipping_origins_not_supported'; end if;
    v_units:=v_units+v_item.quantity;
    if v_units>20 then raise exception 'shipping_cart_requires_manual_packaging'; end if;
    v_items:=v_items||jsonb_build_array(jsonb_build_object('sku',v_item.sku,'quantity',v_item.quantity));
    for i in 1..v_item.quantity loop
      v_parcels:=v_parcels||jsonb_build_array(jsonb_build_object('weightGrams',v_profile.weight_grams,'lengthMm',v_profile.length_mm,'widthMm',v_profile.width_mm,'heightMm',v_profile.height_mm));
    end loop;
  end loop;
  select * into v_quote from public.create_commerce_shipping_quote_v1(p_market_code,p_destination_country_code,p_currency_code,p_service_code,v_parcels,p_idempotency_key,p_environment) limit 1;
  if v_quote.origin_country_code<>v_origin then raise exception 'shipping_origin_mismatch'; end if;
  insert into public.commerce_shipping_quote_cart_bindings(quote_id,request_items,environment)
  values(v_quote.quote_id,v_items,p_environment) on conflict(quote_id) do nothing;
  select * into v_binding from public.commerce_shipping_quote_cart_bindings b where b.quote_id=v_quote.quote_id limit 1;
  if v_binding.request_items<>v_items or v_binding.environment<>p_environment then raise exception 'shipping_quote_cart_binding_conflict'; end if;
  return query select v_quote.quote_id,v_quote.quote_code,v_quote.amount_minor,v_quote.currency_code,v_quote.expires_at;
end; $$;
revoke all on function public.create_commerce_cart_shipping_quote_v1(text,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_commerce_cart_shipping_quote_v1(text,text,text,text,jsonb,text,text) to service_role;

create or replace function public.create_member_otop_order_v2(
  p_auth_user_id uuid,p_items jsonb,p_shipping_address_id uuid,p_shipping_quote_id uuid,
  p_customs_snapshot_id uuid,p_payment_method_code text,p_customer_note text,
  p_checkout_idempotency_key text,p_payment_idempotency_key text,
  p_duties_acknowledged boolean,p_environment text default 'live'
) returns table(
  order_id uuid,order_code text,market_code text,currency_code text,
  subtotal_minor bigint,shipping_fee_minor bigint,total_minor bigint,
  payment_intent_id uuid,payment_intent_code text,shipping_status text
)
language plpgsql security definer set search_path=''
as $$
declare
  v_customer public.customer_accounts%rowtype; v_address public.customer_addresses%rowtype;
  v_quote public.commerce_shipping_quotes%rowtype; v_binding public.commerce_shipping_quote_cart_bindings%rowtype;
  v_customs public.commerce_customs_compliance_snapshots%rowtype; v_policy public.commerce_customs_market_policies%rowtype;
  v_order public.otop_orders%rowtype; v_item record; v_product record; v_price public.commerce_product_prices%rowtype;
  v_request_items jsonb:='[]'::jsonb; v_customs_items jsonb:='[]'::jsonb; v_customs_norm jsonb:='[]'::jsonb;
  v_line_items jsonb:='[]'::jsonb; v_subtotal_minor bigint:=0; v_total_minor bigint; v_minor_unit integer; v_factor numeric;
  v_pm record; v_pm_count integer; v_payment record;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_payment_method_code is null or lower(trim(p_payment_method_code)) !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then raise exception 'payment_method_not_ready'; end if;
  if not coalesce(p_duties_acknowledged,false) then raise exception 'duties_acknowledgement_required'; end if;
  if p_checkout_idempotency_key is null or char_length(p_checkout_idempotency_key)<16 then raise exception 'idempotency_key_required'; end if;
  if p_payment_idempotency_key is null or char_length(p_payment_idempotency_key)<16 then raise exception 'payment_idempotency_key_required'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>30 then raise exception 'invalid_items'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) e where jsonb_typeof(e)<>'object' or jsonb_typeof(e->'sku')<>'string' or jsonb_typeof(e->'quantity')<>'number'
      or upper(trim(e->>'sku')) !~ '^[A-Z0-9][A-Z0-9_-]{2,79}$' or (e->>'quantity') !~ '^[0-9]{1,2}$') then raise exception 'invalid_items'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('sku',x.sku,'quantity',x.quantity) order by x.sku),'[]'::jsonb) into v_request_items
  from (select upper(trim(e->>'sku')) sku,sum((e->>'quantity')::integer)::integer quantity from jsonb_array_elements(p_items) e group by upper(trim(e->>'sku'))) x;
  if exists(select 1 from jsonb_array_elements(v_request_items) e where (e->>'quantity')::integer not between 1 and 99) then raise exception 'invalid_items'; end if;
  select * into v_customer from public.customer_accounts c where c.auth_user_id=p_auth_user_id and c.member_status='member' limit 1;
  if not found then raise exception 'member_profile_required'; end if;
  select * into v_order from public.otop_orders o where o.customer_id=v_customer.id and o.checkout_idempotency_key=p_checkout_idempotency_key limit 1;
  if found then
    if v_order.checkout_version<>2 or v_order.checkout_request_items<>v_request_items or v_order.shipping_address_id<>p_shipping_address_id or v_order.shipping_quote_id<>p_shipping_quote_id
       or v_order.customs_snapshot_id<>p_customs_snapshot_id or v_order.payment_method_code<>lower(trim(p_payment_method_code)) then raise exception 'checkout_idempotency_conflict'; end if;
    select * into v_payment from public.commerce_payment_intents pi where pi.id=v_order.payment_intent_id limit 1;
    if not found or v_payment.idempotency_key<>p_payment_idempotency_key then raise exception 'checkout_idempotency_conflict'; end if;
    return query select v_order.id,v_order.order_code,v_order.market_code,v_order.currency_code,v_order.subtotal_minor,v_order.shipping_fee_minor,v_order.total_minor,v_order.payment_intent_id,v_payment.intent_code,v_order.shipping_status; return;
  end if;
  select * into v_quote from public.commerce_shipping_quotes q where q.id=p_shipping_quote_id for update;
  if not found then raise exception 'shipping_quote_not_found'; end if;
  if v_quote.status<>'quoted' then raise exception 'shipping_quote_already_consumed'; end if;
  if v_quote.expires_at<=now() then raise exception 'shipping_quote_expired'; end if;
  if v_quote.environment<>p_environment then raise exception 'shipping_quote_environment_mismatch'; end if;
  if v_quote.duties_tax_scope<>'excluded' then raise exception 'shipping_quote_duties_scope_invalid'; end if;
  select * into v_binding from public.commerce_shipping_quote_cart_bindings b where b.quote_id=v_quote.id limit 1;
  if not found or v_binding.request_items<>v_request_items or v_binding.environment<>p_environment then raise exception 'shipping_quote_cart_mismatch'; end if;
  if not exists(select 1 from public.commerce_markets m where m.market_code=v_quote.market_code and m.country_code=v_quote.destination_country_code and m.status='live' and not m.is_domestic) then raise exception 'international_market_not_live'; end if;
  if not exists(select 1 from public.commerce_market_capabilities c where c.market_code=v_quote.market_code and c.capability='checkout' and c.state='live') then raise exception 'checkout_capability_not_live'; end if;
  select * into v_customs from public.commerce_customs_compliance_snapshots s where s.id=p_customs_snapshot_id limit 1;
  if not found then raise exception 'customs_snapshot_not_found'; end if;
  if v_customs.market_code<>v_quote.market_code or v_customs.destination_country_code<>v_quote.destination_country_code or v_customs.currency_code<>v_quote.currency_code or v_customs.environment<>p_environment then raise exception 'customs_snapshot_mismatch'; end if;
  if v_customs.status<>'active' or v_customs.decision<>'eligible' then raise exception 'customs_not_eligible'; end if;
  if v_customs.duty_tax_status<>'not_calculated' then raise exception 'customs_duty_status_invalid'; end if;
  if exists(select 1 from jsonb_array_elements(v_customs.line_snapshot) l where jsonb_typeof(coalesce(l->'requiredDocumentCodes','[]'::jsonb))='array' and jsonb_array_length(coalesce(l->'requiredDocumentCodes','[]'::jsonb))>0) then raise exception 'customs_documents_not_automated'; end if;
  select * into v_policy from public.commerce_customs_market_policies p where p.market_code=v_quote.market_code and p.enabled and p.status='live' limit 1;
  if not found then raise exception 'customs_market_policy_not_live'; end if;
  if v_policy.duty_tax_mode<>'recipient_on_import' or v_policy.importer_responsibility<>'customer' or v_policy.terms_code is null or v_policy.disclosure_key is null then raise exception 'landed_cost_not_supported'; end if;
  select * into v_address from public.customer_addresses a where a.id=p_shipping_address_id and a.customer_id=v_customer.id and a.active and a.address_schema_version=2 and a.country_code=v_quote.destination_country_code limit 1;
  if not found then raise exception 'international_shipping_address_mismatch'; end if;
  select c.minor_unit into v_minor_unit from public.commerce_currencies c where c.currency_code=v_quote.currency_code and c.active;
  if not found then raise exception 'currency_not_active'; end if;
  v_factor:=power(10::numeric,v_minor_unit);
  for v_item in select e->>'sku' sku,(e->>'quantity')::integer quantity from jsonb_array_elements(v_request_items) e order by e->>'sku' loop
    select p.id,p.sku,p.stock_qty into v_product from public.otop_products p where p.sku=v_item.sku and p.environment=p_environment and p.active and p.verified for update;
    if not found then raise exception 'product_not_available:%',v_item.sku; end if;
    if v_product.stock_qty<v_item.quantity then raise exception 'insufficient_stock:%',v_item.sku; end if;
    select * into v_price from public.commerce_product_prices cp where cp.product_id=v_product.id and cp.currency_code=v_quote.currency_code and cp.active and cp.valid_from<=now() and (cp.valid_until is null or cp.valid_until>now()) limit 1;
    if not found then raise exception 'price_not_available:%',v_item.sku; end if;
    v_subtotal_minor:=v_subtotal_minor+(v_price.amount_minor*v_item.quantity);
    v_line_items:=v_line_items||jsonb_build_array(jsonb_build_object('productId',v_product.id,'sku',v_product.sku,'quantity',v_item.quantity,'priceRevisionId',v_price.id,'unitPriceMinor',v_price.amount_minor));
    v_customs_items:=v_customs_items||jsonb_build_array(jsonb_build_object('productId',v_product.id,'quantity',v_item.quantity));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('productId',e->>'productId','quantity',(e->>'quantity')::integer) order by e->>'productId'),'[]'::jsonb) into v_customs_norm from jsonb_array_elements(v_customs.request_items) e;
  select coalesce(jsonb_agg(e order by e->>'productId'),'[]'::jsonb) into v_customs_items from jsonb_array_elements(v_customs_items) e;
  if v_customs_norm<>v_customs_items then raise exception 'customs_cart_mismatch'; end if;
  v_total_minor:=v_subtotal_minor+v_quote.amount_minor;
  if v_total_minor<=0 then raise exception 'invalid_checkout_total'; end if;
  select pm.*,p.adapter_key into v_pm from public.commerce_market_payment_methods pm join public.commerce_payment_providers p on p.provider_code=pm.provider_code
  where pm.market_code=v_quote.market_code and pm.currency_code=v_quote.currency_code and pm.payment_method_code=lower(trim(p_payment_method_code))
    and pm.execution_mode='global_v2' and pm.status='live' and pm.enabled and p.status='live' and p.active
  order by pm.priority,pm.provider_code limit 1;
  if not found then raise exception 'payment_method_not_ready'; end if;
  select count(*) into v_pm_count from public.commerce_market_payment_methods pm join public.commerce_payment_providers p on p.provider_code=pm.provider_code
  where pm.market_code=v_quote.market_code and pm.currency_code=v_quote.currency_code and pm.payment_method_code=lower(trim(p_payment_method_code))
    and pm.execution_mode='global_v2' and pm.status='live' and pm.enabled and p.status='live' and p.active and pm.priority=v_pm.priority;
  if v_pm_count>1 then raise exception 'payment_method_ambiguous'; end if;
  insert into public.otop_orders(customer_id,guest_id,status,source_channel,fulfillment_type,shipping_address_id,shipping_recipient_name_enc,shipping_phone_enc,shipping_address_enc,
    customer_note,subtotal_amount,shipping_fee,total_amount,shipping_status,checkout_idempotency_key,environment,market_code,currency_code,pricing_source,
    checkout_version,destination_country_code,shipping_quote_id,customs_snapshot_id,subtotal_minor,shipping_fee_minor,total_minor,shipping_address_snapshot_v2,checkout_request_items,
    payment_provider_code,payment_method_code,duty_terms_code,duty_disclosure_key,duties_acknowledged_at)
  values(v_customer.id,v_customer.guest_id,'requested','web','shipping',v_address.id,v_address.recipient_name_enc,v_address.phone_enc,null,left(p_customer_note,1000),
    v_subtotal_minor::numeric/v_factor,v_quote.amount_minor::numeric/v_factor,v_total_minor::numeric/v_factor,'awaiting_payment',p_checkout_idempotency_key,p_environment,
    v_quote.market_code,v_quote.currency_code,'multi_currency_v1',2,v_quote.destination_country_code,v_quote.id,v_customs.id,v_subtotal_minor,v_quote.amount_minor,v_total_minor,
    jsonb_build_object('countryCode',v_address.country_code,'recipientNameEnc',v_address.recipient_name_enc,'phoneEnc',v_address.phone_enc,'organizationEnc',v_address.organization_enc,
      'addressLine1Enc',v_address.address_line1_enc,'addressLine2Enc',v_address.address_line2_enc,'dependentLocalityEnc',v_address.dependent_locality_enc,'localityEnc',v_address.locality_enc,
      'administrativeAreaEnc',v_address.administrative_area_enc,'postalCodeEnc',v_address.postal_code_enc,'deliveryInstructionsEnc',v_address.delivery_instructions_enc),
    v_request_items,v_pm.provider_code,v_pm.payment_method_code,v_policy.terms_code,v_policy.disclosure_key,now())
  returning * into v_order;
  insert into public.otop_order_items(order_id,product_id,quantity,unit_price,currency_code,price_revision_id,unit_price_minor,line_total_minor)
  select v_order.id,(e->>'productId')::uuid,(e->>'quantity')::integer,(e->>'unitPriceMinor')::numeric/v_factor,v_order.currency_code,(e->>'priceRevisionId')::uuid,
    (e->>'unitPriceMinor')::bigint,(e->>'unitPriceMinor')::bigint*(e->>'quantity')::integer from jsonb_array_elements(v_line_items) e;
  select * into v_payment from public.create_commerce_payment_intent_v1('otop_order',v_order.id,v_order.order_code,v_customer.id,v_order.market_code,v_order.currency_code,v_order.total_minor,
    v_pm.provider_code,v_pm.payment_method_code,p_payment_idempotency_key,p_environment) limit 1;
  if not found then raise exception 'payment_intent_not_created'; end if;
  update public.otop_orders set payment_intent_id=v_payment.intent_id where id=v_order.id returning * into v_order;
  update public.commerce_shipping_quotes set status='consumed' where id=v_quote.id;
  insert into public.otop_shipping_events(order_id,status,customer_message,actor) values(v_order.id,'awaiting_payment','Order received; awaiting payment.','system');
  return query select v_order.id,v_order.order_code,v_order.market_code,v_order.currency_code,v_order.subtotal_minor,v_order.shipping_fee_minor,v_order.total_minor,v_order.payment_intent_id,v_payment.intent_code,v_order.shipping_status;
end; $$;
revoke all on function public.create_member_otop_order_v2(uuid,jsonb,uuid,uuid,uuid,text,text,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.create_member_otop_order_v2(uuid,jsonb,uuid,uuid,uuid,text,text,text,text,boolean,text) to service_role;

create or replace function public.otop_global_checkout_integrity_guard()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.checkout_version=2 then
    if new.payment_intent_id is null then raise exception 'global_checkout_payment_intent_missing'; end if;
    if not exists(select 1 from public.commerce_payment_intents p where p.id=new.payment_intent_id and p.source_entity_type='otop_order' and p.source_entity_id=new.id
      and p.market_code=new.market_code and p.currency_code=new.currency_code and p.amount_minor=new.total_minor) then raise exception 'global_checkout_payment_intent_mismatch'; end if;
    if not exists(select 1 from public.commerce_shipping_quotes q where q.id=new.shipping_quote_id and q.status='consumed' and q.market_code=new.market_code and q.currency_code=new.currency_code
      and q.destination_country_code=new.destination_country_code and q.amount_minor=new.shipping_fee_minor) then raise exception 'global_checkout_shipping_quote_mismatch'; end if;
    if not exists(select 1 from public.commerce_customs_compliance_snapshots c where c.id=new.customs_snapshot_id and c.status='active' and c.decision='eligible'
      and c.market_code=new.market_code and c.currency_code=new.currency_code and c.destination_country_code=new.destination_country_code) then raise exception 'global_checkout_customs_snapshot_mismatch'; end if;
  end if;
  return null;
end; $$;
revoke all on function public.otop_global_checkout_integrity_guard() from public,anon,authenticated;
grant execute on function public.otop_global_checkout_integrity_guard() to service_role;
drop trigger if exists otop_global_checkout_integrity_guard on public.otop_orders;
create constraint trigger otop_global_checkout_integrity_guard
after insert or update on public.otop_orders deferrable initially deferred
for each row execute function public.otop_global_checkout_integrity_guard();
