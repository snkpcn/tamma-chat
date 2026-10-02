-- WW-1 Global Data Core follow-up indexes.
-- Covers foreign-key lookup paths identified by Supabase advisors.

create index if not exists commerce_countries_default_currency_idx
  on public.commerce_countries(default_currency_code);

create index if not exists commerce_market_locales_locale_idx
  on public.commerce_market_locales(locale_code);

create index if not exists commerce_markets_default_currency_idx
  on public.commerce_markets(default_currency_code);

create index if not exists commerce_markets_default_locale_idx
  on public.commerce_markets(default_locale_code);
