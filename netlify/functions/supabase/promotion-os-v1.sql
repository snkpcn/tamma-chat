-- Promotion OS / Campaign Intelligence — non-destructive additive schema.
-- Layered on top of (never replacing) the existing menu/activity/stay/otop
-- catalogs and the payment/order/settlement flow. Every number the engine
-- produces must trace back to a real row here or in the existing catalogs
-- (tamma_chart_os.restaurant_menu_live, recipe_ingredients+ingredients,
-- activity_offerings, otop_products, service_resources) -- nothing is
-- invented at the DB layer; incompleteness is recorded, not papered over.

create table if not exists public.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_code text unique not null default (
    'PROMO-' || to_char(now(), 'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
  ),
  title text not null,
  description text,
  business_scope text not null
    check (business_scope in ('restaurant','cafe','activity','stay','otop','cross_business')),
  status text not null default 'draft'
    check (status in ('draft','pending_review','active','paused','ended','cancelled')),
  promo_type text not null
    check (promo_type in (
      'percentage_discount','fixed_amount_discount','bundle_price','buy_x_get_y',
      'add_on_discount','threshold_reward','weekday_boost','slow_moving_stock',
      'low_season_stay','cross_business_bundle'
    )),
  start_at timestamptz,
  end_at timestamptz,
  channel_scope jsonb not null default '[]'::jsonb,
  rules jsonb not null default '{}'::jsonb,
  financial_snapshot jsonb,
  recommendation_reason jsonb,
  risk_level text check (risk_level in ('low','medium','high') or risk_level is null),
  max_redemptions integer,
  redemption_count integer not null default 0,
  environment text not null default 'live' check (environment in ('live','test')),
  created_by text,
  approved_by text,
  negative_margin_confirmed boolean not null default false,
  cost_incomplete_confirmed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz
);

create index if not exists promotion_campaigns_status_idx on public.promotion_campaigns (status, business_scope);
create index if not exists promotion_campaigns_environment_idx on public.promotion_campaigns (environment);
create index if not exists promotion_campaigns_active_window_idx on public.promotion_campaigns (status, start_at, end_at);

create or replace function public.promotion_campaigns_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_promotion_campaigns_updated_at on public.promotion_campaigns;
create trigger trg_promotion_campaigns_updated_at
before update on public.promotion_campaigns
for each row execute function public.promotion_campaigns_set_updated_at();

create table if not exists public.promotion_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id) on delete cascade,
  business_unit text not null check (business_unit in ('restaurant','cafe','activity','stay','otop')),
  entity_type text not null
    check (entity_type in ('menu_item','activity_offering','stay_unit','otop_product','cafe_product','custom_service')),
  entity_id text not null,
  entity_code text,
  name_snapshot text not null,
  normal_price numeric not null,
  price_source text not null default 'catalog' check (price_source in ('catalog','manual')),
  cost_basis numeric,
  cost_source text not null default 'catalog' check (cost_source in ('catalog','manual','incomplete')),
  promo_price numeric,
  quantity integer not null default 1,
  margin_before numeric,
  margin_after numeric,
  gross_profit_before numeric,
  gross_profit_after numeric,
  cost_complete boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists promotion_items_campaign_idx on public.promotion_items (campaign_id);

create table if not exists public.promotion_redemptions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id),
  customer_id uuid,
  guest_id uuid,
  source_channel text,
  related_entity_type text,
  related_entity_id text,
  normal_total numeric,
  promo_total numeric,
  cost_total numeric,
  gross_profit numeric,
  margin_pct numeric,
  status text not null default 'reserved' check (status in ('reserved','redeemed','cancelled')),
  environment text not null default 'live' check (environment in ('live','test')),
  created_at timestamptz not null default now()
);

create index if not exists promotion_redemptions_campaign_idx on public.promotion_redemptions (campaign_id, status);

create table if not exists public.promotion_recommendations (
  id uuid primary key default gen_random_uuid(),
  business_scope text not null,
  recommendation_type text not null,
  title text not null,
  rationale text,
  inputs jsonb not null default '{}'::jsonb,
  suggested_rules jsonb not null default '{}'::jsonb,
  financial_projection jsonb,
  risk_level text check (risk_level in ('low','medium','high') or risk_level is null),
  status text not null default 'suggested' check (status in ('suggested','dismissed','converted')),
  converted_campaign_id uuid references public.promotion_campaigns(id),
  environment text not null default 'live' check (environment in ('live','test')),
  created_at timestamptz not null default now()
);

create index if not exists promotion_recommendations_status_idx on public.promotion_recommendations (status, business_scope);

-- Generic, owner-entered cost basis for business units with no live cost
-- catalog (activity/stay/cafe today). Never auto-populated with a guess --
-- a row only exists once the owner has actually entered one, and
-- confidence='incomplete' is the honest default for anything not yet set.
create table if not exists public.service_cost_basis (
  id uuid primary key default gen_random_uuid(),
  business_unit text not null check (business_unit in ('restaurant','cafe','activity','stay','otop')),
  entity_type text not null,
  entity_id text not null,
  cost_type text not null default 'manual_estimate' check (cost_type in ('variable','fixed_allocated','manual_estimate')),
  unit_cost numeric not null,
  currency text not null default 'THB',
  confidence text not null default 'estimated' check (confidence in ('verified','estimated','incomplete')),
  source text,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);

create unique index if not exists service_cost_basis_entity_active_idx
  on public.service_cost_basis (business_unit, entity_type, entity_id)
  where active;

create or replace function public.service_cost_basis_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_service_cost_basis_updated_at on public.service_cost_basis;
create trigger trg_service_cost_basis_updated_at
before update on public.service_cost_basis
for each row execute function public.service_cost_basis_set_updated_at();
