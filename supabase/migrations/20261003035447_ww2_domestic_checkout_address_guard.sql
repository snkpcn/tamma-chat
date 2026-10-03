-- WW-2 defense-in-depth guard for the existing domestic checkout RPC.
-- Address V2/non-TH destinations may be stored, but V1 checkout must never
-- apply Thailand shipping rules to them.

create or replace function public.create_member_otop_order_v1(
  p_customer_id uuid,
  p_guest_id uuid,
  p_items jsonb,
  p_shipping_address_id uuid,
  p_shipping_recipient_name_enc text,
  p_shipping_phone_enc text,
  p_shipping_address_enc text,
  p_customer_note text,
  p_shipping_fee numeric,
  p_checkout_idempotency_key text,
  p_environment text default 'live'
)
returns table (
  order_id uuid,
  order_code text,
  subtotal numeric,
  shipping_fee numeric,
  total numeric,
  payment_code text,
  shipping_status text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.otop_orders%rowtype;
  v_product record;
  v_item record;
  v_subtotal numeric(12,2) := 0;
  v_fee numeric(12,2) := 0;
  v_shipping public.otop_shipping_settings%rowtype;
  v_line_items jsonb := '[]'::jsonb;
  v_payment_code text;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_checkout_idempotency_key is null or char_length(p_checkout_idempotency_key) < 16 then
    raise exception 'idempotency_key_required';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 30 then
    raise exception 'invalid_items';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_items) elem
    where jsonb_typeof(elem) <> 'object'
       or not (elem ? 'sku' and elem ? 'quantity')
       or jsonb_typeof(elem->'sku') <> 'string'
       or jsonb_typeof(elem->'quantity') <> 'number'
       or (elem->>'sku') !~ '^[A-Z0-9][A-Z0-9_-]{2,79}$'
       or (elem->>'quantity') !~ '^[0-9]{1,2}$'
  ) then
    raise exception 'invalid_items';
  end if;
  if not exists (
    select 1
    from public.customer_accounts c
    where c.id = p_customer_id and c.member_status = 'member'
  ) then
    raise exception 'member_required';
  end if;
  if not exists (
    select 1
    from public.customer_addresses a
    where a.id = p_shipping_address_id
      and a.customer_id = p_customer_id
      and a.active
  ) then
    raise exception 'shipping_address_not_found';
  end if;
  if exists (
    select 1
    from public.customer_addresses a
    where a.id = p_shipping_address_id
      and a.customer_id = p_customer_id
      and a.active
      and (a.country_code <> 'TH' or a.address_schema_version <> 1)
  ) then
    raise exception 'international_shipping_not_enabled';
  end if;

  select o.* into v_order
  from public.otop_orders o
  where o.customer_id = p_customer_id
    and o.checkout_idempotency_key = p_checkout_idempotency_key
  limit 1;

  if found then
    select pr.payment_code into v_payment_code
    from public.payment_requests pr
    where pr.entity_type = 'otop_order' and pr.entity_id = v_order.id
    limit 1;
    return query select v_order.id, v_order.order_code, v_order.subtotal_amount,
      v_order.shipping_fee, v_order.total_amount, v_payment_code, v_order.shipping_status;
    return;
  end if;

  for v_item in
    select elem->>'sku' as sku, sum((elem->>'quantity')::integer)::integer as quantity
    from jsonb_array_elements(p_items) elem
    group by elem->>'sku'
  loop
    if v_item.quantity < 1 or v_item.quantity > 99 then raise exception 'invalid_quantity'; end if;
    select p.id, p.sku, p.price, p.stock_qty into v_product
    from public.otop_products p
    where p.sku = v_item.sku
      and p.environment = p_environment
      and p.active and p.verified
    for update;
    if not found then raise exception 'product_not_available:%', v_item.sku; end if;
    if v_product.stock_qty < v_item.quantity then raise exception 'insufficient_stock:%', v_item.sku; end if;
    v_subtotal := v_subtotal + (v_product.price * v_item.quantity);
    v_line_items := v_line_items || jsonb_build_array(jsonb_build_object(
      'product_id', v_product.id,
      'quantity', v_item.quantity,
      'unit_price', v_product.price
    ));
  end loop;

  if jsonb_array_length(v_line_items) < 1 then raise exception 'invalid_items'; end if;

  select * into v_shipping
  from public.otop_shipping_settings s
  where s.id = 'default'
  for share;
  if not found or not v_shipping.enabled then raise exception 'shipping_temporarily_unavailable'; end if;
  v_fee := case
    when v_shipping.free_shipping_threshold is not null
      and v_subtotal >= v_shipping.free_shipping_threshold then 0
    else v_shipping.domestic_base_fee
  end;
  if p_shipping_fee is null or abs(p_shipping_fee - v_fee) > 0.001 then
    raise exception 'shipping_quote_changed';
  end if;

  insert into public.otop_orders (
    customer_id, guest_id, source_channel, fulfillment_type,
    shipping_address_id, shipping_recipient_name_enc, shipping_phone_enc,
    shipping_address_enc, customer_note, subtotal_amount, shipping_fee,
    total_amount, shipping_status, checkout_idempotency_key, environment
  ) values (
    p_customer_id, p_guest_id, 'web', 'shipping',
    p_shipping_address_id, p_shipping_recipient_name_enc, p_shipping_phone_enc,
    p_shipping_address_enc, left(p_customer_note, 1000), v_subtotal, v_fee,
    v_subtotal + v_fee, 'awaiting_payment', p_checkout_idempotency_key, p_environment
  ) returning * into v_order;

  insert into public.otop_order_items(order_id, product_id, quantity, unit_price)
  select v_order.id,
         (item->>'product_id')::uuid,
         (item->>'quantity')::integer,
         (item->>'unit_price')::numeric
  from jsonb_array_elements(v_line_items) item;

  insert into public.otop_shipping_events(order_id, status, customer_message, actor)
  values (v_order.id, 'awaiting_payment', 'รับคำสั่งซื้อแล้ว รอตรวจสอบการชำระเงิน', 'system');

  select pr.payment_code into v_payment_code
  from public.payment_requests pr
  where pr.entity_type = 'otop_order' and pr.entity_id = v_order.id
  limit 1;

  return query select v_order.id, v_order.order_code, v_order.subtotal_amount,
    v_order.shipping_fee, v_order.total_amount, v_payment_code, v_order.shipping_status;
end;
$$;

revoke all on function public.create_member_otop_order_v1(uuid,uuid,jsonb,uuid,text,text,text,text,numeric,text,text)
  from public, anon, authenticated;
grant execute on function public.create_member_otop_order_v1(uuid,uuid,jsonb,uuid,text,text,text,text,numeric,text,text)
  to service_role;
