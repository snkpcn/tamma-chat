-- WW-4 safe server-side explicit price revision writer.
-- THB remains owned by otop_products.price and its sync trigger.

create or replace function public.set_commerce_product_price_v1(
  p_product_id uuid,
  p_currency_code text,
  p_amount_minor bigint,
  p_price_source text default 'manual',
  p_source_currency_code text default null,
  p_source_amount_minor bigint default null,
  p_fx_rate numeric default null,
  p_fx_observed_at timestamptz default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_id uuid;
  v_currency text := upper(trim(p_currency_code));
  v_source_currency text := case
    when p_source_currency_code is null then null
    else upper(trim(p_source_currency_code))
  end;
begin
  if not exists (
    select 1 from public.otop_products p where p.id=p_product_id
  ) then
    raise exception 'product_not_found';
  end if;

  if not exists (
    select 1
    from public.commerce_currencies c
    where c.currency_code=v_currency and c.active
  ) then
    raise exception 'currency_not_active';
  end if;

  if v_currency='THB' then
    raise exception 'domestic_thb_price_owned_by_otop_products';
  end if;

  if p_amount_minor is null or p_amount_minor<=0 then
    raise exception 'invalid_amount_minor';
  end if;

  if p_price_source not in ('manual','fx_assisted') then
    raise exception 'invalid_price_source';
  end if;

  if p_price_source='fx_assisted' then
    if v_source_currency is null
       or p_source_amount_minor is null or p_source_amount_minor<=0
       or p_fx_rate is null or p_fx_rate<=0
       or p_fx_observed_at is null then
      raise exception 'fx_reference_required';
    end if;
    if not exists (
      select 1 from public.commerce_currencies c
      where c.currency_code=v_source_currency and c.active
    ) then
      raise exception 'source_currency_not_active';
    end if;
  end if;

  update public.commerce_product_prices
  set active=false,
      valid_until=coalesce(valid_until,now()),
      updated_at=now()
  where product_id=p_product_id
    and currency_code=v_currency
    and active;

  insert into public.commerce_product_prices(
    product_id,currency_code,amount_minor,price_source,
    source_currency_code,source_amount_minor,fx_rate,fx_observed_at,
    active,valid_from,metadata
  ) values (
    p_product_id,v_currency,p_amount_minor,p_price_source,
    case when p_price_source='fx_assisted' then v_source_currency else null end,
    case when p_price_source='fx_assisted' then p_source_amount_minor else null end,
    case when p_price_source='fx_assisted' then p_fx_rate else null end,
    case when p_price_source='fx_assisted' then p_fx_observed_at else null end,
    true,now(),coalesce(p_metadata,'{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.set_commerce_product_price_v1(uuid,text,bigint,text,text,bigint,numeric,timestamptz,jsonb)
  from public,anon,authenticated;
grant execute on function public.set_commerce_product_price_v1(uuid,text,bigint,text,text,bigint,numeric,timestamptz,jsonb)
  to service_role;
