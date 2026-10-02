-- WW-1 Global Data Core
-- Additive, server-only commerce reference/config data.
-- Does not reroute or modify existing Thailand checkout/payment/shipping flows.

create table if not exists public.commerce_currencies (
  currency_code text primary key
    check (currency_code ~ '^[A-Z]{3}$'),
  name_en text not null
    check (char_length(name_en) between 1 and 120),
  symbol text null
    check (symbol is null or char_length(symbol) between 1 and 16),
  minor_unit smallint not null default 2
    check (minor_unit between 0 and 4),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_countries (
  country_code text primary key
    check (country_code ~ '^[A-Z]{2}$'),
  name_en text not null
    check (char_length(name_en) between 1 and 120),
  default_currency_code text not null
    references public.commerce_currencies(currency_code),
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_locales (
  locale_code text primary key
    check (
      char_length(locale_code) between 2 and 35
      and locale_code ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$'
    ),
  language_code text not null
    check (language_code ~ '^[a-z]{2,3}$'),
  name_en text not null
    check (char_length(name_en) between 1 and 120),
  rtl boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.commerce_markets (
  market_code text primary key
    check (market_code ~ '^[A-Z0-9][A-Z0-9_-]{1,23}$'),
  country_code text not null unique
    references public.commerce_countries(country_code),
  default_currency_code text not null
    references public.commerce_currencies(currency_code),
  default_locale_code text not null
    references public.commerce_locales(locale_code),
  status text not null default 'draft'
    check (status in ('draft','certification','live','suspended')),
  is_domestic boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists commerce_markets_one_domestic_uq
  on public.commerce_markets(is_domestic)
  where is_domestic;

create table if not exists public.commerce_market_locales (
  market_code text not null
    references public.commerce_markets(market_code) on delete cascade,
  locale_code text not null
    references public.commerce_locales(locale_code),
  enabled boolean not null default false,
  is_default boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market_code, locale_code),
  check (not is_default or enabled)
);

create unique index if not exists commerce_market_locales_one_default_uq
  on public.commerce_market_locales(market_code)
  where is_default and enabled;

create table if not exists public.commerce_market_capabilities (
  market_code text not null
    references public.commerce_markets(market_code) on delete cascade,
  capability text not null
    check (capability in (
      'catalog','storefront','pricing','payments','shipping',
      'customs','checkout','fulfillment','thongthai'
    )),
  state text not null default 'disabled'
    check (state in ('disabled','shadow','live')),
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (market_code, capability)
);

alter table public.commerce_currencies enable row level security;
alter table public.commerce_countries enable row level security;
alter table public.commerce_locales enable row level security;
alter table public.commerce_markets enable row level security;
alter table public.commerce_market_locales enable row level security;
alter table public.commerce_market_capabilities enable row level security;

revoke all on table public.commerce_currencies from public, anon, authenticated, service_role;
revoke all on table public.commerce_countries from public, anon, authenticated, service_role;
revoke all on table public.commerce_locales from public, anon, authenticated, service_role;
revoke all on table public.commerce_markets from public, anon, authenticated, service_role;
revoke all on table public.commerce_market_locales from public, anon, authenticated, service_role;
revoke all on table public.commerce_market_capabilities from public, anon, authenticated, service_role;

grant select, insert, update, delete on table public.commerce_currencies to service_role;
grant select, insert, update, delete on table public.commerce_countries to service_role;
grant select, insert, update, delete on table public.commerce_locales to service_role;
grant select, insert, update, delete on table public.commerce_markets to service_role;
grant select, insert, update, delete on table public.commerce_market_locales to service_role;
grant select, insert, update, delete on table public.commerce_market_capabilities to service_role;

insert into public.commerce_currencies (
  currency_code, name_en, symbol, minor_unit, active
) values (
  'THB', 'Thai Baht', '฿', 2, true
)
on conflict (currency_code) do update set
  name_en = excluded.name_en,
  symbol = excluded.symbol,
  minor_unit = excluded.minor_unit,
  active = excluded.active,
  updated_at = now();

insert into public.commerce_countries (
  country_code, name_en, default_currency_code, active
) values (
  'TH', 'Thailand', 'THB', true
)
on conflict (country_code) do update set
  name_en = excluded.name_en,
  default_currency_code = excluded.default_currency_code,
  active = excluded.active,
  updated_at = now();

insert into public.commerce_locales (
  locale_code, language_code, name_en, rtl, active
) values
  ('th', 'th', 'Thai', false, true),
  ('en', 'en', 'English', false, true),
  ('zh', 'zh', 'Chinese', false, true),
  ('lo', 'lo', 'Lao', false, true),
  ('vi', 'vi', 'Vietnamese', false, true)
on conflict (locale_code) do update set
  language_code = excluded.language_code,
  name_en = excluded.name_en,
  rtl = excluded.rtl,
  active = excluded.active,
  updated_at = now();

insert into public.commerce_markets (
  market_code, country_code, default_currency_code,
  default_locale_code, status, is_domestic
) values (
  'TH', 'TH', 'THB', 'th', 'live', true
)
on conflict (market_code) do update set
  country_code = excluded.country_code,
  default_currency_code = excluded.default_currency_code,
  default_locale_code = excluded.default_locale_code,
  status = excluded.status,
  is_domestic = excluded.is_domestic,
  updated_at = now();

insert into public.commerce_market_locales (
  market_code, locale_code, enabled, is_default
) values
  ('TH', 'th', true, true),
  ('TH', 'en', true, false),
  ('TH', 'zh', true, false),
  ('TH', 'lo', true, false),
  ('TH', 'vi', true, false)
on conflict (market_code, locale_code) do update set
  enabled = excluded.enabled,
  is_default = excluded.is_default,
  updated_at = now();

insert into public.commerce_market_capabilities (
  market_code, capability, state
) values
  ('TH', 'catalog', 'live'),
  ('TH', 'storefront', 'live'),
  ('TH', 'pricing', 'live'),
  ('TH', 'payments', 'live'),
  ('TH', 'shipping', 'live'),
  ('TH', 'customs', 'disabled'),
  ('TH', 'checkout', 'live'),
  ('TH', 'fulfillment', 'live'),
  ('TH', 'thongthai', 'live')
on conflict (market_code, capability) do update set
  state = excluded.state,
  updated_at = now();
