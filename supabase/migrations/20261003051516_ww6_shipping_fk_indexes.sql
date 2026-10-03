create index if not exists commerce_shipping_quotes_service_tier_idx
  on public.commerce_shipping_quotes(
    market_code,service_code,rate_tier_order
  );

create index if not exists commerce_shipping_quotes_origin_country_idx
  on public.commerce_shipping_quotes(origin_country_code);
