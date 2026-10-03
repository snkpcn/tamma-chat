-- WW-5 covering indexes for payment-core foreign keys reported by Supabase advisors.

create index if not exists commerce_payment_events_currency_idx
  on public.commerce_payment_events(currency_code)
  where currency_code is not null;

create index if not exists commerce_payment_intents_currency_idx
  on public.commerce_payment_intents(currency_code);

create index if not exists commerce_payment_intents_market_idx
  on public.commerce_payment_intents(market_code);

create index if not exists commerce_payment_intents_method_fk_idx
  on public.commerce_payment_intents(
    market_code,provider_code,currency_code,payment_method_code
  );
