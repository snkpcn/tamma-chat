-- WW-11 first-wave provider selection.
-- Providers are registered for certification only and remain disabled/inactive.
-- No credentials are stored here and no payment/shipping transaction is enabled.

insert into public.commerce_payment_providers(
  provider_code,display_name,adapter_key,status,active,metadata
) values (
  'stripe_th',
  'Stripe Thailand',
  'stripe_payment_intents_v1',
  'certification',
  false,
  jsonb_build_object(
    'merchantCountry','TH',
    'settlementCurrency','THB',
    'presentmentCurrencies',jsonb_build_array('KRW','JPY','USD'),
    'paymentMethodScope','card-first',
    'credentialEnv',jsonb_build_array('STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET'),
    'source','official-stripe-docs',
    'ww11FirstWave',true
  )
)
on conflict(provider_code) do update set
  display_name=excluded.display_name,
  adapter_key=excluded.adapter_key,
  status='certification',
  active=false,
  metadata=public.commerce_payment_providers.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_market_payment_methods(
  market_code,provider_code,currency_code,payment_method_code,
  execution_mode,status,enabled,priority,metadata
)
values
  ('KR','stripe_th','KRW','card','global_v2','certification',false,10,'{"ww11FirstWave":true}'::jsonb),
  ('JP','stripe_th','JPY','card','global_v2','certification',false,10,'{"ww11FirstWave":true}'::jsonb),
  ('US','stripe_th','USD','card','global_v2','certification',false,10,'{"ww11FirstWave":true}'::jsonb)
on conflict(market_code,provider_code,currency_code,payment_method_code) do update set
  execution_mode='global_v2',
  status='certification',
  enabled=false,
  priority=10,
  metadata=public.commerce_market_payment_methods.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_shipping_providers(
  provider_code,display_name,adapter_key,status,active,metadata
) values (
  'DHL_EXPRESS',
  'DHL Express MyDHL API',
  'dhl_express_mydhl_v1',
  'certification',
  false,
  jsonb_build_object(
    'originCountry','TH',
    'apiFamily','MyDHL API',
    'rating','POST /rates',
    'shipment','shipment API',
    'tracking','tracking API',
    'auth','basic',
    'credentialEnv',jsonb_build_array('DHL_EXPRESS_API_USERNAME','DHL_EXPRESS_API_PASSWORD','DHL_EXPRESS_ACCOUNT_NUMBER'),
    'source','official-dhl-developer-docs',
    'ww11FirstWave',true
  )
)
on conflict(provider_code) do update set
  display_name=excluded.display_name,
  adapter_key=excluded.adapter_key,
  status='certification',
  active=false,
  metadata=public.commerce_shipping_providers.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_shipping_zones(
  zone_code,name,origin_country_code,status,active,metadata
) values (
  'DHL_TH_FIRST_WAVE',
  'DHL Thailand first-wave export targets',
  'TH',
  'certification',
  false,
  jsonb_build_object(
    'providerCode','DHL_EXPRESS',
    'countries',jsonb_build_array('KR','JP','US'),
    'ww11FirstWave',true
  )
)
on conflict(zone_code) do update set
  name=excluded.name,
  origin_country_code='TH',
  status='certification',
  active=false,
  metadata=public.commerce_shipping_zones.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_shipping_zone_destinations(
  zone_code,country_code,enabled,metadata
) values
  ('DHL_TH_FIRST_WAVE','KR',true,'{"ww11FirstWave":true}'::jsonb),
  ('DHL_TH_FIRST_WAVE','JP',true,'{"ww11FirstWave":true}'::jsonb),
  ('DHL_TH_FIRST_WAVE','US',true,'{"ww11FirstWave":true}'::jsonb)
on conflict(zone_code,country_code) do update set
  enabled=true,
  metadata=public.commerce_shipping_zone_destinations.metadata || excluded.metadata,
  updated_at=now();
