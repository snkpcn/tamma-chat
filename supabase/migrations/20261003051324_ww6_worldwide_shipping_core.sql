create table if not exists public.commerce_shipping_providers (
  provider_code text primary key
    check (provider_code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  display_name text not null
    check (char_length(display_name) between 1 and 120),
  adapter_key text not null unique
    check (adapter_key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_shipping_zones (
  zone_code text primary key
    check (zone_code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  name text not null
    check (char_length(name) between 1 and 120),
  origin_country_code text not null
    references public.commerce_countries(country_code),
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  active boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_shipping_zone_destinations (
  zone_code text not null
    references public.commerce_shipping_zones(zone_code) on delete cascade,
  country_code text not null
    references public.commerce_countries(country_code),
  enabled boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(zone_code,country_code)
);

create table if not exists public.commerce_market_shipping_services (
  market_code text not null
    references public.commerce_markets(market_code) on delete cascade,
  service_code text not null
    check (service_code ~ '^[A-Z0-9][A-Z0-9_-]{1,63}$'),
  provider_code text not null
    references public.commerce_shipping_providers(provider_code),
  zone_code text not null
    references public.commerce_shipping_zones(zone_code),
  currency_code text not null
    references public.commerce_currencies(currency_code),
  execution_mode text not null
    check (execution_mode in ('legacy_v1','global_v2')),
  rate_mode text not null
    check (rate_mode in ('domestic_v1','manual_weight_table','provider_quote')),
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  enabled boolean not null default false,
  priority integer not null default 100
    check (priority between 0 and 10000),
  estimated_min_days integer not null
    check (estimated_min_days between 1 and 180),
  estimated_max_days integer not null
    check (estimated_max_days between estimated_min_days and 365),
  volumetric_divisor_cm3_per_kg integer null
    check (
      volumetric_divisor_cm3_per_kg is null
      or volumetric_divisor_cm3_per_kg between 1 and 100000
    ),
  quote_ttl_minutes integer not null default 30
    check (quote_ttl_minutes between 1 and 1440),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(market_code,service_code)
);

create table if not exists public.commerce_shipping_rate_tiers (
  market_code text not null,
  service_code text not null,
  tier_order integer not null
    check (tier_order between 1 and 10000),
  max_chargeable_weight_grams integer not null
    check (max_chargeable_weight_grams between 1 and 2000000),
  amount_minor bigint not null
    check (amount_minor > 0),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(market_code,service_code,tier_order),
  unique(market_code,service_code,max_chargeable_weight_grams),
  foreign key(market_code,service_code)
    references public.commerce_market_shipping_services(market_code,service_code)
    on delete cascade
);

create table if not exists public.commerce_product_shipping_profiles (
  product_id uuid primary key
    references public.otop_products(id) on delete cascade,
  origin_country_code text not null
    references public.commerce_countries(country_code),
  weight_grams integer not null
    check (weight_grams between 1 and 100000),
  length_mm integer not null
    check (length_mm between 1 and 3000),
  width_mm integer not null
    check (width_mm between 1 and 3000),
  height_mm integer not null
    check (height_mm between 1 and 3000),
  ships_separately boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_shipping_quotes (
  id uuid primary key default gen_random_uuid(),
  quote_code text not null unique default (
    'SQ-' || to_char(now(),'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  market_code text not null
    references public.commerce_markets(market_code),
  origin_country_code text not null
    references public.commerce_countries(country_code),
  destination_country_code text not null
    references public.commerce_countries(country_code),
  currency_code text not null
    references public.commerce_currencies(currency_code),
  amount_minor bigint not null
    check (amount_minor > 0),
  provider_code text not null
    references public.commerce_shipping_providers(provider_code),
  service_code text not null,
  zone_code text not null
    references public.commerce_shipping_zones(zone_code),
  rate_tier_order integer not null,
  parcel_snapshot jsonb not null,
  actual_weight_grams bigint not null
    check (actual_weight_grams > 0),
  volumetric_weight_grams bigint not null
    check (volumetric_weight_grams >= 0),
  chargeable_weight_grams bigint not null
    check (chargeable_weight_grams > 0),
  estimated_min_days integer not null,
  estimated_max_days integer not null,
  duties_tax_scope text not null default 'excluded'
    check (duties_tax_scope='excluded'),
  idempotency_key text not null unique
    check (
      char_length(idempotency_key) between 16 and 120
      and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$'
    ),
  environment text not null default 'live'
    check (environment in ('live','test')),
  status text not null default 'quoted'
    check (status in ('quoted','consumed','cancelled','expired')),
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(market_code,service_code)
    references public.commerce_market_shipping_services(market_code,service_code),
  foreign key(market_code,service_code,rate_tier_order)
    references public.commerce_shipping_rate_tiers(market_code,service_code,tier_order),
  check (estimated_max_days >= estimated_min_days),
  check (expires_at > created_at)
);

create index if not exists commerce_shipping_zones_origin_idx
  on public.commerce_shipping_zones(origin_country_code,status,active);
create index if not exists commerce_shipping_zone_destinations_country_idx
  on public.commerce_shipping_zone_destinations(country_code,enabled);
create index if not exists commerce_market_shipping_services_provider_idx
  on public.commerce_market_shipping_services(provider_code,status,enabled);
create index if not exists commerce_market_shipping_services_zone_idx
  on public.commerce_market_shipping_services(zone_code,status,enabled);
create index if not exists commerce_market_shipping_services_currency_idx
  on public.commerce_market_shipping_services(currency_code,status,enabled);
create index if not exists commerce_shipping_rate_tiers_lookup_idx
  on public.commerce_shipping_rate_tiers(
    market_code,service_code,active,max_chargeable_weight_grams
  );
create index if not exists commerce_product_shipping_profiles_origin_idx
  on public.commerce_product_shipping_profiles(origin_country_code,active);
create index if not exists commerce_shipping_quotes_market_idx
  on public.commerce_shipping_quotes(market_code,status,created_at desc);
create index if not exists commerce_shipping_quotes_destination_idx
  on public.commerce_shipping_quotes(destination_country_code,status,created_at desc);
create index if not exists commerce_shipping_quotes_currency_idx
  on public.commerce_shipping_quotes(currency_code,status,created_at desc);
create index if not exists commerce_shipping_quotes_provider_idx
  on public.commerce_shipping_quotes(provider_code,status,created_at desc);
create index if not exists commerce_shipping_quotes_zone_idx
  on public.commerce_shipping_quotes(zone_code,status,created_at desc);

alter table public.commerce_shipping_providers enable row level security;
alter table public.commerce_shipping_zones enable row level security;
alter table public.commerce_shipping_zone_destinations enable row level security;
alter table public.commerce_market_shipping_services enable row level security;
alter table public.commerce_shipping_rate_tiers enable row level security;
alter table public.commerce_product_shipping_profiles enable row level security;
alter table public.commerce_shipping_quotes enable row level security;

revoke all on table public.commerce_shipping_providers from public,anon,authenticated,service_role;
revoke all on table public.commerce_shipping_zones from public,anon,authenticated,service_role;
revoke all on table public.commerce_shipping_zone_destinations from public,anon,authenticated,service_role;
revoke all on table public.commerce_market_shipping_services from public,anon,authenticated,service_role;
revoke all on table public.commerce_shipping_rate_tiers from public,anon,authenticated,service_role;
revoke all on table public.commerce_product_shipping_profiles from public,anon,authenticated,service_role;
revoke all on table public.commerce_shipping_quotes from public,anon,authenticated,service_role;

grant select,insert,update,delete on table public.commerce_shipping_providers to service_role;
grant select,insert,update,delete on table public.commerce_shipping_zones to service_role;
grant select,insert,update,delete on table public.commerce_shipping_zone_destinations to service_role;
grant select,insert,update,delete on table public.commerce_market_shipping_services to service_role;
grant select,insert,update,delete on table public.commerce_shipping_rate_tiers to service_role;
grant select,insert,update,delete on table public.commerce_product_shipping_profiles to service_role;
grant select,insert,update,delete on table public.commerce_shipping_quotes to service_role;

insert into public.commerce_shipping_providers(
  provider_code,display_name,adapter_key,status,active,metadata
) values (
  'LEGACY_DOMESTIC_STATIC',
  'Domestic static shipping (legacy v1)',
  'legacy_domestic_static_v1',
  'live',
  true,
  jsonb_build_object(
    'execution_owner','otop_shipping_settings',
    'ww6_global_v2_eligible',false
  )
)
on conflict(provider_code) do update set
  display_name=excluded.display_name,
  adapter_key=excluded.adapter_key,
  status=excluded.status,
  active=excluded.active,
  metadata=excluded.metadata,
  updated_at=now();

insert into public.commerce_shipping_zones(
  zone_code,name,origin_country_code,status,active,metadata
) values (
  'TH_DOMESTIC',
  'Thailand domestic legacy zone',
  'TH',
  'live',
  true,
  jsonb_build_object('execution_mode','legacy_v1')
)
on conflict(zone_code) do update set
  name=excluded.name,
  origin_country_code=excluded.origin_country_code,
  status=excluded.status,
  active=excluded.active,
  metadata=excluded.metadata,
  updated_at=now();

insert into public.commerce_shipping_zone_destinations(
  zone_code,country_code,enabled,metadata
) values (
  'TH_DOMESTIC','TH',true,jsonb_build_object('execution_mode','legacy_v1')
)
on conflict(zone_code,country_code) do update set
  enabled=excluded.enabled,
  metadata=excluded.metadata,
  updated_at=now();

insert into public.commerce_market_shipping_services(
  market_code,service_code,provider_code,zone_code,currency_code,
  execution_mode,rate_mode,status,enabled,priority,
  estimated_min_days,estimated_max_days,volumetric_divisor_cm3_per_kg,
  quote_ttl_minutes,metadata
)
select
  'TH','TH_DOMESTIC_STANDARD','LEGACY_DOMESTIC_STATIC','TH_DOMESTIC','THB',
  'legacy_v1','domestic_v1','live',s.enabled,0,
  s.estimated_min_days,s.estimated_max_days,null,
  30,
  jsonb_build_object(
    'source','otop_shipping_settings',
    'domestic_base_fee',s.domestic_base_fee,
    'free_shipping_threshold',s.free_shipping_threshold
  )
from public.otop_shipping_settings s
where s.id='default'
on conflict(market_code,service_code) do update set
  provider_code=excluded.provider_code,
  zone_code=excluded.zone_code,
  currency_code=excluded.currency_code,
  execution_mode=excluded.execution_mode,
  rate_mode=excluded.rate_mode,
  status=excluded.status,
  enabled=excluded.enabled,
  priority=excluded.priority,
  estimated_min_days=excluded.estimated_min_days,
  estimated_max_days=excluded.estimated_max_days,
  volumetric_divisor_cm3_per_kg=excluded.volumetric_divisor_cm3_per_kg,
  quote_ttl_minutes=excluded.quote_ttl_minutes,
  metadata=excluded.metadata,
  updated_at=now();

create or replace function public.commerce_shipping_quote_update_guard()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if old.market_code is distinct from new.market_code
     or old.origin_country_code is distinct from new.origin_country_code
     or old.destination_country_code is distinct from new.destination_country_code
     or old.currency_code is distinct from new.currency_code
     or old.amount_minor is distinct from new.amount_minor
     or old.provider_code is distinct from new.provider_code
     or old.service_code is distinct from new.service_code
     or old.zone_code is distinct from new.zone_code
     or old.rate_tier_order is distinct from new.rate_tier_order
     or old.parcel_snapshot is distinct from new.parcel_snapshot
     or old.actual_weight_grams is distinct from new.actual_weight_grams
     or old.volumetric_weight_grams is distinct from new.volumetric_weight_grams
     or old.chargeable_weight_grams is distinct from new.chargeable_weight_grams
     or old.estimated_min_days is distinct from new.estimated_min_days
     or old.estimated_max_days is distinct from new.estimated_max_days
     or old.duties_tax_scope is distinct from new.duties_tax_scope
     or old.idempotency_key is distinct from new.idempotency_key
     or old.environment is distinct from new.environment
     or old.expires_at is distinct from new.expires_at then
    raise exception 'shipping_quote_immutable_field';
  end if;

  if old.status is distinct from new.status and not (
    old.status='quoted' and new.status in ('consumed','cancelled','expired')
  ) then
    raise exception 'invalid_shipping_quote_transition:%->%',old.status,new.status;
  end if;

  if new.status='consumed' then
    new.consumed_at:=coalesce(new.consumed_at,now());
  end if;
  new.updated_at:=now();
  return new;
end;
$$;

revoke all on function public.commerce_shipping_quote_update_guard()
  from public,anon,authenticated;
grant execute on function public.commerce_shipping_quote_update_guard()
  to service_role;

drop trigger if exists commerce_shipping_quote_update_guard
  on public.commerce_shipping_quotes;
create trigger commerce_shipping_quote_update_guard
before update on public.commerce_shipping_quotes
for each row execute function public.commerce_shipping_quote_update_guard();

create or replace function public.create_commerce_shipping_quote_v1(
  p_market_code text,
  p_destination_country_code text,
  p_currency_code text,
  p_service_code text,
  p_parcels jsonb,
  p_idempotency_key text,
  p_environment text default 'live'
)
returns table(
  quote_id uuid,
  quote_code text,
  market_code text,
  origin_country_code text,
  destination_country_code text,
  currency_code text,
  amount_minor bigint,
  provider_code text,
  service_code text,
  zone_code text,
  actual_weight_grams bigint,
  volumetric_weight_grams bigint,
  chargeable_weight_grams bigint,
  estimated_min_days integer,
  estimated_max_days integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_market text:=upper(trim(p_market_code));
  v_destination text:=upper(trim(p_destination_country_code));
  v_currency text:=upper(trim(p_currency_code));
  v_service_code text:=case
    when p_service_code is null or trim(p_service_code)='' then null
    else upper(trim(p_service_code))
  end;
  v_service public.commerce_market_shipping_services%rowtype;
  v_zone public.commerce_shipping_zones%rowtype;
  v_tier public.commerce_shipping_rate_tiers%rowtype;
  v_existing public.commerce_shipping_quotes%rowtype;
  v_parcel jsonb;
  v_weight bigint;
  v_length bigint;
  v_width bigint;
  v_height bigint;
  v_volume numeric;
  v_volumetric bigint;
  v_chargeable bigint;
  v_actual_total bigint:=0;
  v_volumetric_total bigint:=0;
  v_chargeable_total bigint:=0;
  v_expires timestamptz;
begin
  if v_market is null or v_market !~ '^[A-Z0-9][A-Z0-9_-]{1,23}$' then
    raise exception 'invalid_shipping_market';
  end if;
  if v_destination is null or v_destination !~ '^[A-Z]{2}$' then
    raise exception 'invalid_destination_country';
  end if;
  if v_currency is null or v_currency !~ '^[A-Z]{3}$' then
    raise exception 'invalid_shipping_currency';
  end if;
  if v_service_code is not null
     and v_service_code !~ '^[A-Z0-9][A-Z0-9_-]{1,63}$' then
    raise exception 'invalid_shipping_service';
  end if;
  if p_environment not in ('live','test') then
    raise exception 'invalid_environment';
  end if;
  if p_idempotency_key is null
     or char_length(p_idempotency_key) not between 16 and 120
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$' then
    raise exception 'invalid_shipping_idempotency_key';
  end if;
  if jsonb_typeof(p_parcels)<>'array'
     or jsonb_array_length(p_parcels)<1
     or jsonb_array_length(p_parcels)>20 then
    raise exception 'invalid_parcel_count';
  end if;

  select * into v_existing
  from public.commerce_shipping_quotes q
  where q.idempotency_key=p_idempotency_key
  limit 1;

  if found then
    if v_existing.market_code<>v_market
       or v_existing.destination_country_code<>v_destination
       or v_existing.currency_code<>v_currency
       or v_existing.parcel_snapshot<>p_parcels
       or v_existing.environment<>p_environment
       or (v_service_code is not null and v_existing.service_code<>v_service_code) then
      raise exception 'shipping_quote_idempotency_conflict';
    end if;
    return query select
      v_existing.id,v_existing.quote_code,v_existing.market_code,
      v_existing.origin_country_code,v_existing.destination_country_code,
      v_existing.currency_code,v_existing.amount_minor,v_existing.provider_code,
      v_existing.service_code,v_existing.zone_code,
      v_existing.actual_weight_grams,v_existing.volumetric_weight_grams,
      v_existing.chargeable_weight_grams,
      v_existing.estimated_min_days,v_existing.estimated_max_days,
      v_existing.expires_at;
    return;
  end if;

  if not exists (
    select 1 from public.commerce_markets m
    where m.market_code=v_market
      and m.country_code=v_destination
      and m.status='live'
  ) then
    raise exception 'shipping_market_not_live';
  end if;
  if not exists (
    select 1 from public.commerce_market_capabilities c
    where c.market_code=v_market
      and c.capability='shipping'
      and c.state='live'
  ) then
    raise exception 'shipping_capability_not_live';
  end if;
  if not exists (
    select 1 from public.commerce_market_currencies c
    where c.market_code=v_market
      and c.currency_code=v_currency
      and c.enabled
  ) then
    raise exception 'shipping_currency_not_enabled';
  end if;

  if v_service_code is not null then
    select s.* into v_service
    from public.commerce_market_shipping_services s
    join public.commerce_shipping_providers p
      on p.provider_code=s.provider_code
    join public.commerce_shipping_zones z
      on z.zone_code=s.zone_code
    join public.commerce_shipping_zone_destinations d
      on d.zone_code=s.zone_code
     and d.country_code=v_destination
     and d.enabled
    where s.market_code=v_market
      and s.service_code=v_service_code
      and s.currency_code=v_currency
      and s.enabled
      and s.status='live'
      and p.active
      and p.status='live'
      and z.active
      and z.status='live'
    limit 1;

    if not found then raise exception 'global_shipping_service_not_ready'; end if;
    if v_service.execution_mode<>'global_v2' then
      raise exception 'legacy_shipping_service_not_global';
    end if;
    if v_service.rate_mode='provider_quote' then
      raise exception 'shipping_provider_quote_adapter_required';
    end if;
    if v_service.rate_mode<>'manual_weight_table' then
      raise exception 'shipping_rate_mode_not_supported';
    end if;
  else
    select s.* into v_service
    from public.commerce_market_shipping_services s
    join public.commerce_shipping_providers p
      on p.provider_code=s.provider_code
    join public.commerce_shipping_zones z
      on z.zone_code=s.zone_code
    join public.commerce_shipping_zone_destinations d
      on d.zone_code=s.zone_code
     and d.country_code=v_destination
     and d.enabled
    where s.market_code=v_market
      and s.currency_code=v_currency
      and s.execution_mode='global_v2'
      and s.rate_mode='manual_weight_table'
      and s.enabled
      and s.status='live'
      and p.active
      and p.status='live'
      and z.active
      and z.status='live'
    order by s.priority,s.service_code
    limit 1;
    if not found then raise exception 'global_shipping_service_not_ready'; end if;
  end if;

  select * into v_zone
  from public.commerce_shipping_zones z
  where z.zone_code=v_service.zone_code
  limit 1;
  if not found then raise exception 'shipping_zone_not_found'; end if;

  for v_parcel in select value from jsonb_array_elements(p_parcels)
  loop
    if jsonb_typeof(v_parcel)<>'object'
       or not (v_parcel ? 'weightGrams')
       or not (v_parcel ? 'lengthMm')
       or not (v_parcel ? 'widthMm')
       or not (v_parcel ? 'heightMm')
       or (v_parcel->>'weightGrams') !~ '^[0-9]+$'
       or (v_parcel->>'lengthMm') !~ '^[0-9]+$'
       or (v_parcel->>'widthMm') !~ '^[0-9]+$'
       or (v_parcel->>'heightMm') !~ '^[0-9]+$' then
      raise exception 'invalid_parcel_dimensions';
    end if;

    v_weight:=(v_parcel->>'weightGrams')::bigint;
    v_length:=(v_parcel->>'lengthMm')::bigint;
    v_width:=(v_parcel->>'widthMm')::bigint;
    v_height:=(v_parcel->>'heightMm')::bigint;

    if v_weight not between 1 and 100000 then
      raise exception 'invalid_parcel_weight';
    end if;
    if v_length not between 1 and 3000
       or v_width not between 1 and 3000
       or v_height not between 1 and 3000 then
      raise exception 'invalid_parcel_dimensions';
    end if;

    if v_service.volumetric_divisor_cm3_per_kg is null then
      v_volumetric:=0;
    else
      v_volume:=v_length::numeric*v_width::numeric*v_height::numeric;
      v_volumetric:=ceil(
        v_volume/v_service.volumetric_divisor_cm3_per_kg
      )::bigint;
    end if;
    v_chargeable:=greatest(v_weight,v_volumetric);
    v_actual_total:=v_actual_total+v_weight;
    v_volumetric_total:=v_volumetric_total+v_volumetric;
    v_chargeable_total:=v_chargeable_total+v_chargeable;
  end loop;

  select * into v_tier
  from public.commerce_shipping_rate_tiers r
  where r.market_code=v_market
    and r.service_code=v_service.service_code
    and r.active
    and r.max_chargeable_weight_grams>=v_chargeable_total
  order by r.max_chargeable_weight_grams,r.tier_order
  limit 1;
  if not found then raise exception 'shipping_rate_not_configured'; end if;

  v_expires:=now()+(v_service.quote_ttl_minutes::text||' minutes')::interval;

  insert into public.commerce_shipping_quotes(
    market_code,origin_country_code,destination_country_code,currency_code,
    amount_minor,provider_code,service_code,zone_code,rate_tier_order,
    parcel_snapshot,actual_weight_grams,volumetric_weight_grams,
    chargeable_weight_grams,estimated_min_days,estimated_max_days,
    duties_tax_scope,idempotency_key,environment,status,expires_at,metadata
  ) values (
    v_market,v_zone.origin_country_code,v_destination,v_currency,
    v_tier.amount_minor,v_service.provider_code,v_service.service_code,
    v_service.zone_code,v_tier.tier_order,
    p_parcels,v_actual_total,v_volumetric_total,v_chargeable_total,
    v_service.estimated_min_days,v_service.estimated_max_days,
    'excluded',p_idempotency_key,p_environment,'quoted',v_expires,
    jsonb_build_object(
      'rate_mode',v_service.rate_mode,
      'execution_mode',v_service.execution_mode
    )
  )
  returning * into v_existing;

  return query select
    v_existing.id,v_existing.quote_code,v_existing.market_code,
    v_existing.origin_country_code,v_existing.destination_country_code,
    v_existing.currency_code,v_existing.amount_minor,v_existing.provider_code,
    v_existing.service_code,v_existing.zone_code,
    v_existing.actual_weight_grams,v_existing.volumetric_weight_grams,
    v_existing.chargeable_weight_grams,
    v_existing.estimated_min_days,v_existing.estimated_max_days,
    v_existing.expires_at;
end;
$$;

revoke all on function public.create_commerce_shipping_quote_v1(
  text,text,text,text,jsonb,text,text
) from public,anon,authenticated;
grant execute on function public.create_commerce_shipping_quote_v1(
  text,text,text,text,jsonb,text,text
) to service_role;
