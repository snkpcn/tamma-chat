-- WW-11 first real-country onboarding targets.
-- Reference/config only: markets remain in certification state and no transaction capability is live.
-- No payment provider, carrier, customs ruling, shipping rate, or product certification is invented here.

insert into public.commerce_currencies(currency_code,name_en,symbol,minor_unit,active,metadata)
values
  ('KRW','South Korean Won','₩',0,true,'{"ww11Target":true}'::jsonb),
  ('JPY','Japanese Yen','¥',0,true,'{"ww11Target":true}'::jsonb),
  ('USD','US Dollar','$',2,true,'{"ww11Target":true}'::jsonb)
on conflict(currency_code) do update set
  name_en=excluded.name_en,
  symbol=excluded.symbol,
  minor_unit=excluded.minor_unit,
  active=true,
  metadata=public.commerce_currencies.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_countries(country_code,name_en,default_currency_code,active,metadata)
values
  ('KR','South Korea','KRW',true,'{"ww11Target":true,"launchWave":"first"}'::jsonb),
  ('JP','Japan','JPY',true,'{"ww11Target":true,"launchWave":"first"}'::jsonb),
  ('US','United States','USD',true,'{"ww11Target":true,"launchWave":"first"}'::jsonb)
on conflict(country_code) do update set
  name_en=excluded.name_en,
  default_currency_code=excluded.default_currency_code,
  active=true,
  metadata=public.commerce_countries.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_locales(locale_code,language_code,name_en,rtl,active,metadata)
values
  ('ko','ko','Korean',false,true,'{"ww11Target":true}'::jsonb),
  ('ja','ja','Japanese',false,true,'{"ww11Target":true}'::jsonb)
on conflict(locale_code) do update set
  language_code=excluded.language_code,
  name_en=excluded.name_en,
  rtl=false,
  active=true,
  metadata=public.commerce_locales.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_markets(
  market_code,country_code,default_currency_code,default_locale_code,status,is_domestic,metadata
)
values
  ('KR','KR','KRW','ko','certification',false,'{"ww11Target":true,"launchWave":"first"}'::jsonb),
  ('JP','JP','JPY','ja','certification',false,'{"ww11Target":true,"launchWave":"first"}'::jsonb),
  ('US','US','USD','en','certification',false,'{"ww11Target":true,"launchWave":"first"}'::jsonb)
on conflict(market_code) do update set
  country_code=excluded.country_code,
  default_currency_code=excluded.default_currency_code,
  default_locale_code=excluded.default_locale_code,
  status='certification',
  is_domestic=false,
  metadata=public.commerce_markets.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_market_currencies(
  market_code,currency_code,enabled,is_default,display_order,metadata
)
values
  ('KR','KRW',true,true,1,'{"ww11Target":true}'::jsonb),
  ('JP','JPY',true,true,1,'{"ww11Target":true}'::jsonb),
  ('US','USD',true,true,1,'{"ww11Target":true}'::jsonb)
on conflict(market_code,currency_code) do update set
  enabled=true,is_default=true,display_order=1,
  metadata=public.commerce_market_currencies.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_market_locales(
  market_code,locale_code,enabled,is_default,metadata
)
values
  ('KR','ko',true,true,'{"ww11Target":true}'::jsonb),
  ('KR','en',true,false,'{"ww11Target":true}'::jsonb),
  ('JP','ja',true,true,'{"ww11Target":true}'::jsonb),
  ('JP','en',true,false,'{"ww11Target":true}'::jsonb),
  ('US','en',true,true,'{"ww11Target":true}'::jsonb)
on conflict(market_code,locale_code) do update set
  enabled=excluded.enabled,is_default=excluded.is_default,
  metadata=public.commerce_market_locales.metadata || excluded.metadata,
  updated_at=now();

insert into public.commerce_market_capabilities(market_code,capability,state,configuration)
select m.market_code,c.capability,c.state,'{"ww11Target":true}'::jsonb
from (values ('KR'),('JP'),('US')) as m(market_code)
cross join (
  values
    ('catalog','shadow'),
    ('storefront','shadow'),
    ('pricing','shadow'),
    ('thongthai','shadow'),
    ('payments','disabled'),
    ('shipping','disabled'),
    ('customs','disabled'),
    ('checkout','disabled'),
    ('fulfillment','disabled')
) as c(capability,state)
on conflict(market_code,capability) do update set
  state=excluded.state,
  configuration=public.commerce_market_capabilities.configuration || excluded.configuration,
  updated_at=now();
