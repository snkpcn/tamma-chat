-- WW-11 performance hardening for composite market/service FK.
create index if not exists commerce_market_certifications_market_service_idx
  on public.commerce_market_certifications(market_code,shipping_service_code);
