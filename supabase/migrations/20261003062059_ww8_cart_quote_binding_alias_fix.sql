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
  values(v_quote.quote_id,v_items,p_environment)
  on conflict on constraint commerce_shipping_quote_cart_bindings_pkey do nothing;
  select * into v_binding from public.commerce_shipping_quote_cart_bindings b where b.quote_id=v_quote.quote_id limit 1;
  if v_binding.request_items<>v_items or v_binding.environment<>p_environment then raise exception 'shipping_quote_cart_binding_conflict'; end if;
  return query select v_quote.quote_id,v_quote.quote_code,v_quote.amount_minor,v_quote.currency_code,v_quote.expires_at;
end; $$;
revoke all on function public.create_commerce_cart_shipping_quote_v1(text,text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_commerce_cart_shipping_quote_v1(text,text,text,text,jsonb,text,text) to service_role;
