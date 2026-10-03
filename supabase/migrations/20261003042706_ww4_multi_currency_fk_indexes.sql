-- WW-4 covering indexes for foreign-key paths reported by Supabase advisors.

create index if not exists commerce_fx_quotes_quote_currency_idx
  on public.commerce_fx_quotes(quote_currency_code);

create index if not exists commerce_product_prices_source_currency_idx
  on public.commerce_product_prices(source_currency_code)
  where source_currency_code is not null;

create index if not exists otop_order_items_currency_idx
  on public.otop_order_items(currency_code);

create index if not exists otop_orders_currency_idx
  on public.otop_orders(currency_code);

create index if not exists payment_requests_currency_idx
  on public.payment_requests(currency);
