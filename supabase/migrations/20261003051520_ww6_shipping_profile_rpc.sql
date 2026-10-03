create or replace function public.set_commerce_product_shipping_profile_v1(
  p_product_id uuid,
  p_origin_country_code text,
  p_weight_grams integer,
  p_length_mm integer,
  p_width_mm integer,
  p_height_mm integer,
  p_ships_separately boolean default false,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_origin text:=upper(trim(p_origin_country_code));
begin
  if not exists (
    select 1 from public.otop_products p where p.id=p_product_id
  ) then raise exception 'shipping_profile_product_not_found'; end if;

  if not exists (
    select 1 from public.commerce_countries c
    where c.country_code=v_origin and c.active
  ) then raise exception 'shipping_profile_origin_not_active'; end if;

  if p_weight_grams is null or p_weight_grams not between 1 and 100000 then
    raise exception 'invalid_shipping_profile_weight';
  end if;
  if p_length_mm is null or p_length_mm not between 1 and 3000
     or p_width_mm is null or p_width_mm not between 1 and 3000
     or p_height_mm is null or p_height_mm not between 1 and 3000 then
    raise exception 'invalid_shipping_profile_dimensions';
  end if;

  insert into public.commerce_product_shipping_profiles(
    product_id,origin_country_code,weight_grams,length_mm,width_mm,height_mm,
    ships_separately,active,metadata,updated_at
  ) values (
    p_product_id,v_origin,p_weight_grams,p_length_mm,p_width_mm,p_height_mm,
    coalesce(p_ships_separately,false),true,coalesce(p_metadata,'{}'::jsonb),now()
  )
  on conflict(product_id) do update set
    origin_country_code=excluded.origin_country_code,
    weight_grams=excluded.weight_grams,
    length_mm=excluded.length_mm,
    width_mm=excluded.width_mm,
    height_mm=excluded.height_mm,
    ships_separately=excluded.ships_separately,
    active=true,
    metadata=excluded.metadata,
    updated_at=now();

  return p_product_id;
end;
$$;

revoke all on function public.set_commerce_product_shipping_profile_v1(
  uuid,text,integer,integer,integer,integer,boolean,jsonb
) from public,anon,authenticated;
grant execute on function public.set_commerce_product_shipping_profile_v1(
  uuid,text,integer,integer,integer,integer,boolean,jsonb
) to service_role;
