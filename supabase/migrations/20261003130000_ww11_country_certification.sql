-- WW-11 Country Certification Gate
create table if not exists public.commerce_market_certifications (
  id uuid primary key default gen_random_uuid(),
  certification_code text not null unique default (
    'MC-' || to_char(now(),'YYMMDD') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  certification_version text not null default 'ww11-country-certification-v1',
  market_code text not null references public.commerce_markets(market_code) on delete restrict,
  country_code text not null references public.commerce_countries(country_code) on delete restrict,
  currency_code text not null references public.commerce_currencies(currency_code) on delete restrict,
  status text not null default 'certified' check (status in ('certified','revoked','expired')),
  environment text not null check (environment in ('live','test')),
  product_set_hash text not null check (product_set_hash ~ '^[0-9a-f]{64}$'),
  shipping_quote_id uuid not null references public.commerce_shipping_quotes(id) on delete restrict,
  customs_snapshot_id uuid not null references public.commerce_customs_compliance_snapshots(id) on delete restrict,
  shipping_provider_code text not null references public.commerce_shipping_providers(provider_code),
  shipping_service_code text not null,
  payment_provider_code text not null references public.commerce_payment_providers(provider_code),
  payment_method_code text not null check (payment_method_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  customs_terms_code text not null,
  customs_disclosure_key text not null,
  return_terms_code text not null,
  probe_evidence_hash text not null check (probe_evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence_snapshot jsonb not null default '{}'::jsonb,
  idempotency_key text not null unique check (
    char_length(idempotency_key) between 16 and 120
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$'
  ),
  certified_at timestamptz not null default now(),
  valid_until timestamptz not null,
  revoked_at timestamptz null,
  revoke_reason text null check (revoke_reason is null or char_length(revoke_reason)<=240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_until > certified_at),
  foreign key(market_code,shipping_service_code)
    references public.commerce_market_shipping_services(market_code,service_code)
);

create table if not exists public.commerce_market_certification_products (
  certification_id uuid not null references public.commerce_market_certifications(id) on delete cascade,
  product_id uuid not null references public.otop_products(id) on delete restrict,
  sku text not null,
  price_revision_id uuid not null references public.commerce_product_prices(id) on delete restrict,
  price_amount_minor bigint not null check (price_amount_minor>0),
  shipping_profile_hash text not null check (shipping_profile_hash ~ '^[0-9a-f]{64}$'),
  customs_profile_hash text not null check (customs_profile_hash ~ '^[0-9a-f]{64}$'),
  destination_rule_hash text not null check (destination_rule_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  primary key(certification_id,product_id)
);

create index if not exists commerce_market_certifications_market_idx
  on public.commerce_market_certifications(market_code,environment,status,valid_until desc);
create index if not exists commerce_market_certifications_country_idx
  on public.commerce_market_certifications(country_code,environment,status,valid_until desc);
create index if not exists commerce_market_certifications_currency_idx
  on public.commerce_market_certifications(currency_code,status,valid_until desc);
create index if not exists commerce_market_certifications_shipping_quote_idx
  on public.commerce_market_certifications(shipping_quote_id);
create index if not exists commerce_market_certifications_customs_snapshot_idx
  on public.commerce_market_certifications(customs_snapshot_id);
create index if not exists commerce_market_certifications_shipping_provider_idx
  on public.commerce_market_certifications(shipping_provider_code);
create index if not exists commerce_market_certifications_payment_provider_idx
  on public.commerce_market_certifications(payment_provider_code);
create index if not exists commerce_market_certification_products_product_idx
  on public.commerce_market_certification_products(product_id,certification_id);
create index if not exists commerce_market_certification_products_price_idx
  on public.commerce_market_certification_products(price_revision_id);

alter table public.commerce_market_certifications enable row level security;
alter table public.commerce_market_certification_products enable row level security;
revoke all on table public.commerce_market_certifications from public,anon,authenticated,service_role;
revoke all on table public.commerce_market_certification_products from public,anon,authenticated,service_role;
grant select,insert,update on table public.commerce_market_certifications to service_role;
grant select,insert on table public.commerce_market_certification_products to service_role;

create or replace function public.commerce_shipping_profile_hash_v1(p_product_id uuid)
returns text language sql stable security definer set search_path=''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'productId',p.product_id,'originCountryCode',p.origin_country_code,
    'weightGrams',p.weight_grams,'lengthMm',p.length_mm,'widthMm',p.width_mm,
    'heightMm',p.height_mm,'shipsSeparately',p.ships_separately,'active',p.active
  )::text,'UTF8'),'sha256'),'hex')
  from public.commerce_product_shipping_profiles p
  where p.product_id=p_product_id and p.active limit 1;
$$;

create or replace function public.commerce_customs_profile_hash_v1(p_product_id uuid)
returns text language sql stable security definer set search_path=''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'productId',p.product_id,'originCountryCode',p.origin_country_code,
    'classificationSystem',p.classification_system,'classificationCode',p.classification_code,
    'customsDescription',p.customs_description,'verificationStatus',p.verification_status,
    'verifiedAt',p.verified_at,'active',p.active
  )::text,'UTF8'),'sha256'),'hex')
  from public.commerce_product_customs_profiles p
  where p.product_id=p_product_id and p.active limit 1;
$$;

create or replace function public.commerce_destination_rule_hash_v1(p_product_id uuid,p_country_code text)
returns text language sql stable security definer set search_path=''
as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'productId',r.product_id,'countryCode',r.country_code,'decision',r.decision,
    'status',r.status,'enabled',r.enabled,'requiredDocumentCodes',r.required_document_codes,
    'reasonCode',r.reason_code,'validFrom',r.valid_from,'validUntil',r.valid_until
  )::text,'UTF8'),'sha256'),'hex')
  from public.commerce_customs_destination_rules r
  where r.product_id=p_product_id
    and r.country_code=upper(trim(p_country_code))
    and r.enabled and r.status='live'
    and r.valid_from<=now()
    and (r.valid_until is null or r.valid_until>now())
  limit 1;
$$;

revoke all on function public.commerce_shipping_profile_hash_v1(uuid) from public,anon,authenticated;
revoke all on function public.commerce_customs_profile_hash_v1(uuid) from public,anon,authenticated;
revoke all on function public.commerce_destination_rule_hash_v1(uuid,text) from public,anon,authenticated;
grant execute on function public.commerce_shipping_profile_hash_v1(uuid) to service_role;
grant execute on function public.commerce_customs_profile_hash_v1(uuid) to service_role;
grant execute on function public.commerce_destination_rule_hash_v1(uuid,text) to service_role;

create or replace function public.evaluate_commerce_market_certification_v1(
  p_market_code text,p_product_ids jsonb,p_environment text default 'live'
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  v_market public.commerce_markets%rowtype;
  v_pid uuid; v_reasons jsonb:='[]'::jsonb; v_price_count integer; v_required_cap text;
begin
  if p_environment not in ('live','test') then
    return jsonb_build_object('ready',false,'reasons',jsonb_build_array('invalid_environment'));
  end if;
  if jsonb_typeof(p_product_ids)<>'array' or jsonb_array_length(p_product_ids)<1 or jsonb_array_length(p_product_ids)>50 then
    return jsonb_build_object('ready',false,'reasons',jsonb_build_array('invalid_product_ids'));
  end if;
  if exists(
    select 1 from jsonb_array_elements(p_product_ids) e
    where jsonb_typeof(e)<>'string'
       or trim(both '"' from e::text) !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ) then
    return jsonb_build_object('ready',false,'reasons',jsonb_build_array('invalid_product_ids'));
  end if;
  if (select count(distinct trim(both '"' from e::text)) from jsonb_array_elements(p_product_ids) e)
     <> jsonb_array_length(p_product_ids) then
    return jsonb_build_object('ready',false,'reasons',jsonb_build_array('duplicate_product_ids'));
  end if;

  select * into v_market from public.commerce_markets m where m.market_code=upper(trim(p_market_code)) limit 1;
  if not found then
    return jsonb_build_object('ready',false,'reasons',jsonb_build_array('market_not_configured'));
  end if;
  if v_market.is_domestic then v_reasons:=v_reasons||jsonb_build_array('domestic_market_not_certifiable'); end if;
  if v_market.status<>'live' then v_reasons:=v_reasons||jsonb_build_array('market_not_live'); end if;

  if not exists(select 1 from public.commerce_countries c where c.country_code=v_market.country_code and c.active and c.default_currency_code=v_market.default_currency_code) then
    v_reasons:=v_reasons||jsonb_build_array('country_or_currency_relationship_not_live');
  end if;
  if not exists(select 1 from public.commerce_currencies c where c.currency_code=v_market.default_currency_code and c.active) then
    v_reasons:=v_reasons||jsonb_build_array('currency_not_active');
  end if;
  if not exists(select 1 from public.commerce_market_currencies mc where mc.market_code=v_market.market_code and mc.currency_code=v_market.default_currency_code and mc.enabled and mc.is_default) then
    v_reasons:=v_reasons||jsonb_build_array('default_market_currency_not_enabled');
  end if;
  if not exists(
    select 1 from public.commerce_market_locales ml join public.commerce_locales l on l.locale_code=ml.locale_code
    where ml.market_code=v_market.market_code and ml.locale_code=v_market.default_locale_code
      and ml.enabled and ml.is_default and l.active
  ) then
    v_reasons:=v_reasons||jsonb_build_array('default_market_locale_not_enabled');
  end if;

  foreach v_required_cap in array array['catalog','storefront','pricing','payments','shipping','customs','checkout','fulfillment','thongthai'] loop
    if not exists(select 1 from public.commerce_market_capabilities c where c.market_code=v_market.market_code and c.capability=v_required_cap and c.state='live') then
      v_reasons:=v_reasons||jsonb_build_array('capability_not_live:'||v_required_cap);
    end if;
  end loop;

  if not exists(
    select 1 from public.commerce_market_payment_methods pm
    join public.commerce_payment_providers p on p.provider_code=pm.provider_code
    where pm.market_code=v_market.market_code and pm.currency_code=v_market.default_currency_code
      and pm.execution_mode='global_v2' and pm.status='live' and pm.enabled and p.status='live' and p.active
  ) then v_reasons:=v_reasons||jsonb_build_array('global_payment_method_not_live'); end if;

  if not exists(
    select 1 from public.commerce_market_shipping_services s
    join public.commerce_shipping_providers p on p.provider_code=s.provider_code
    join public.commerce_shipping_zone_destinations zd on zd.zone_code=s.zone_code and zd.country_code=v_market.country_code and zd.enabled
    where s.market_code=v_market.market_code and s.currency_code=v_market.default_currency_code
      and s.execution_mode='global_v2' and s.status='live' and s.enabled
      and p.status='live' and p.active and p.adapter_key<>'legacy_domestic_static_v1'
      and (s.rate_mode='provider_quote' or exists(
        select 1 from public.commerce_shipping_rate_tiers t
        where t.market_code=s.market_code and t.service_code=s.service_code and t.active
      ))
  ) then v_reasons:=v_reasons||jsonb_build_array('global_shipping_service_not_live'); end if;

  if not exists(
    select 1 from public.commerce_customs_market_policies p
    where p.market_code=v_market.market_code and p.enabled and p.status='live'
      and p.duty_tax_mode='recipient_on_import' and p.importer_responsibility='customer'
      and p.terms_code is not null and p.disclosure_key is not null
  ) then v_reasons:=v_reasons||jsonb_build_array('customs_market_policy_not_live'); end if;

  if not exists(select 1 from public.commerce_return_policies p where p.market_code=v_market.market_code and p.enabled and p.status='live') then
    v_reasons:=v_reasons||jsonb_build_array('return_policy_not_live');
  end if;

  for v_pid in
    select (trim(both '"' from e::text))::uuid from jsonb_array_elements(p_product_ids) e
  loop
    if not exists(select 1 from public.otop_products p where p.id=v_pid and p.environment=p_environment and p.active and p.verified and p.stock_qty>0) then
      v_reasons:=v_reasons||jsonb_build_array('product_not_available:'||v_pid::text); continue;
    end if;

    select count(*) into v_price_count from public.commerce_product_prices p
    where p.product_id=v_pid and p.currency_code=v_market.default_currency_code
      and p.active and p.valid_from<=now() and (p.valid_until is null or p.valid_until>now());
    if v_price_count<>1 then
      v_reasons:=v_reasons||jsonb_build_array((case when v_price_count=0 then 'product_price_not_ready:' else 'product_price_ambiguous:' end)||v_pid::text);
    end if;

    if public.commerce_shipping_profile_hash_v1(v_pid) is null then
      v_reasons:=v_reasons||jsonb_build_array('shipping_profile_not_ready:'||v_pid::text);
    end if;

    if not exists(
      select 1 from public.commerce_product_customs_profiles p
      where p.product_id=v_pid and p.active and p.verification_status='verified'
        and p.verified_at is not null and p.origin_country_code='TH'
    ) then v_reasons:=v_reasons||jsonb_build_array('customs_profile_not_verified:'||v_pid::text); end if;

    if not exists(
      select 1 from public.commerce_customs_destination_rules r
      where r.product_id=v_pid and r.country_code=v_market.country_code
        and r.enabled and r.status='live' and r.valid_from<=now()
        and (r.valid_until is null or r.valid_until>now())
        and r.decision='allowed'
        and coalesce(array_length(r.required_document_codes,1),0)=0
    ) then v_reasons:=v_reasons||jsonb_build_array('destination_rule_not_checkout_ready:'||v_pid::text); end if;
  end loop;

  return jsonb_build_object(
    'ready',jsonb_array_length(v_reasons)=0,'marketCode',v_market.market_code,
    'countryCode',v_market.country_code,'currencyCode',v_market.default_currency_code,
    'environment',p_environment,'productCount',jsonb_array_length(p_product_ids),'reasons',v_reasons
  );
end; $$;

revoke all on function public.evaluate_commerce_market_certification_v1(text,jsonb,text) from public,anon,authenticated;
grant execute on function public.evaluate_commerce_market_certification_v1(text,jsonb,text) to service_role;

create or replace function public.certify_commerce_market_v1(
  p_market_code text,p_product_ids jsonb,p_shipping_quote_id uuid,p_customs_snapshot_id uuid,
  p_payment_method_code text,p_probe_evidence_hash text,p_idempotency_key text,
  p_valid_days integer default 30,p_environment text default 'live'
) returns table(certification_id uuid,certification_code text,status text,valid_until timestamptz)
language plpgsql security definer set search_path=''
as $$
declare
  v_market public.commerce_markets%rowtype; v_quote public.commerce_shipping_quotes%rowtype;
  v_customs public.commerce_customs_compliance_snapshots%rowtype; v_policy public.commerce_customs_market_policies%rowtype;
  v_return public.commerce_return_policies%rowtype; v_payment record;
  v_eval jsonb; v_existing public.commerce_market_certifications%rowtype; v_cert public.commerce_market_certifications%rowtype;
  v_pid uuid; v_product public.otop_products%rowtype; v_price public.commerce_product_prices%rowtype;
  v_product_set_hash text; v_request_product_count integer;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_valid_days not between 1 and 180 then raise exception 'invalid_certification_valid_days'; end if;
  if p_probe_evidence_hash is null or lower(p_probe_evidence_hash) !~ '^[0-9a-f]{64}$' then raise exception 'certification_probe_evidence_required'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 120 or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:_-]{15,119}$' then raise exception 'idempotency_key_required'; end if;
  if p_payment_method_code is null or lower(trim(p_payment_method_code)) !~ '^[a-z0-9][a-z0-9_-]{1,63}$' then raise exception 'payment_method_required'; end if;

  select * into v_existing from public.commerce_market_certifications c where c.idempotency_key=p_idempotency_key limit 1;
  if found then
    if v_existing.market_code<>upper(trim(p_market_code)) or v_existing.shipping_quote_id<>p_shipping_quote_id
       or v_existing.customs_snapshot_id<>p_customs_snapshot_id or v_existing.payment_method_code<>lower(trim(p_payment_method_code))
       or v_existing.probe_evidence_hash<>lower(p_probe_evidence_hash) or v_existing.environment<>p_environment then
      raise exception 'market_certification_idempotency_conflict';
    end if;
    return query select v_existing.id,v_existing.certification_code,v_existing.status,v_existing.valid_until; return;
  end if;

  v_eval:=public.evaluate_commerce_market_certification_v1(p_market_code,p_product_ids,p_environment);
  if coalesce((v_eval->>'ready')::boolean,false) is not true then
    raise exception 'market_certification_not_ready:%',coalesce(v_eval->'reasons','[]'::jsonb)::text;
  end if;

  select * into v_market from public.commerce_markets m where m.market_code=upper(trim(p_market_code)) limit 1;
  select * into v_quote from public.commerce_shipping_quotes q
  where q.id=p_shipping_quote_id and q.market_code=v_market.market_code
    and q.destination_country_code=v_market.country_code and q.currency_code=v_market.default_currency_code
    and q.environment=p_environment and q.status in ('quoted','consumed') and q.expires_at>now() limit 1;
  if not found then raise exception 'certification_shipping_quote_not_valid'; end if;

  if not exists(
    select 1 from public.commerce_market_shipping_services s
    join public.commerce_shipping_providers p on p.provider_code=s.provider_code
    where s.market_code=v_quote.market_code and s.service_code=v_quote.service_code
      and s.provider_code=v_quote.provider_code and s.execution_mode='global_v2'
      and s.status='live' and s.enabled and p.status='live' and p.active and p.adapter_key<>'legacy_domestic_static_v1'
  ) then raise exception 'certification_shipping_service_not_live'; end if;

  if not exists(
    select 1 from public.commerce_shipping_quote_cart_bindings b
    where b.quote_id=v_quote.id and b.environment=p_environment
      and not exists(
        select 1 from jsonb_array_elements(p_product_ids) e
        join public.otop_products p on p.id=(trim(both '"' from e::text))::uuid
        where not exists(
          select 1 from jsonb_array_elements(b.request_items) i
          where upper(trim(i->>'sku'))=upper(p.sku) and (i->>'quantity')::integer>=1
        )
      )
      and not exists(
        select 1 from jsonb_array_elements(b.request_items) i
        where not exists(
          select 1 from jsonb_array_elements(p_product_ids) e
          join public.otop_products p on p.id=(trim(both '"' from e::text))::uuid
          where upper(p.sku)=upper(trim(i->>'sku'))
        )
      )
  ) then raise exception 'certification_shipping_quote_product_set_mismatch'; end if;

  select * into v_customs from public.commerce_customs_compliance_snapshots c
  where c.id=p_customs_snapshot_id and c.market_code=v_market.market_code
    and c.destination_country_code=v_market.country_code and c.currency_code=v_market.default_currency_code
    and c.environment=p_environment and c.status='active' and c.decision='eligible'
    and c.duty_tax_status='not_calculated' limit 1;
  if not found then raise exception 'certification_customs_snapshot_not_eligible'; end if;

  select count(distinct (e->>'productId')::uuid) into v_request_product_count
  from jsonb_array_elements(v_customs.request_items) e;
  if v_request_product_count<>jsonb_array_length(p_product_ids)
     or exists(
       select 1 from jsonb_array_elements(p_product_ids) e
       where not exists(
         select 1 from jsonb_array_elements(v_customs.request_items) i
         where (i->>'productId')::uuid=(trim(both '"' from e::text))::uuid and (i->>'quantity')::integer>=1
       )
     ) then raise exception 'certification_customs_product_set_mismatch'; end if;

  select * into v_policy from public.commerce_customs_market_policies p
  where p.market_code=v_market.market_code and p.enabled and p.status='live'
    and p.duty_tax_mode='recipient_on_import' and p.importer_responsibility='customer'
    and p.terms_code is not null and p.disclosure_key is not null limit 1;
  if not found then raise exception 'certification_customs_policy_not_live'; end if;

  select * into v_return from public.commerce_return_policies p
  where p.market_code=v_market.market_code and p.enabled and p.status='live' limit 1;
  if not found then raise exception 'certification_return_policy_not_live'; end if;

  select pm.provider_code,pm.payment_method_code into v_payment
  from public.commerce_market_payment_methods pm
  join public.commerce_payment_providers p on p.provider_code=pm.provider_code
  where pm.market_code=v_market.market_code and pm.currency_code=v_market.default_currency_code
    and pm.payment_method_code=lower(trim(p_payment_method_code))
    and pm.execution_mode='global_v2' and pm.status='live' and pm.enabled and p.status='live' and p.active
  order by pm.priority,pm.provider_code limit 1;
  if not found then raise exception 'certification_payment_method_not_live'; end if;

  select encode(extensions.digest(convert_to(string_agg(pid::text,',' order by pid),'UTF8'),'sha256'),'hex')
  into v_product_set_hash
  from (select distinct (trim(both '"' from e::text))::uuid pid from jsonb_array_elements(p_product_ids) e) x;

  insert into public.commerce_market_certifications(
    market_code,country_code,currency_code,status,environment,product_set_hash,
    shipping_quote_id,customs_snapshot_id,shipping_provider_code,shipping_service_code,
    payment_provider_code,payment_method_code,customs_terms_code,customs_disclosure_key,
    return_terms_code,probe_evidence_hash,evidence_snapshot,idempotency_key,valid_until
  ) values(
    v_market.market_code,v_market.country_code,v_market.default_currency_code,'certified',p_environment,v_product_set_hash,
    v_quote.id,v_customs.id,v_quote.provider_code,v_quote.service_code,
    v_payment.provider_code,v_payment.payment_method_code,v_policy.terms_code,v_policy.disclosure_key,
    v_return.terms_code,lower(p_probe_evidence_hash),
    jsonb_build_object('readiness',v_eval,'shippingQuoteCode',v_quote.quote_code,
      'customsSnapshotCode',v_customs.snapshot_code,'paymentProviderCode',v_payment.provider_code,
      'paymentMethodCode',v_payment.payment_method_code,'returnTermsCode',v_return.terms_code),
    p_idempotency_key,now()+make_interval(days=>p_valid_days)
  ) returning * into v_cert;

  for v_pid in select (trim(both '"' from e::text))::uuid from jsonb_array_elements(p_product_ids) e loop
    select * into v_product from public.otop_products p where p.id=v_pid limit 1;
    select * into v_price from public.commerce_product_prices p
    where p.product_id=v_pid and p.currency_code=v_market.default_currency_code
      and p.active and p.valid_from<=now() and (p.valid_until is null or p.valid_until>now()) limit 1;
    insert into public.commerce_market_certification_products(
      certification_id,product_id,sku,price_revision_id,price_amount_minor,
      shipping_profile_hash,customs_profile_hash,destination_rule_hash
    ) values(
      v_cert.id,v_pid,v_product.sku,v_price.id,v_price.amount_minor,
      public.commerce_shipping_profile_hash_v1(v_pid),
      public.commerce_customs_profile_hash_v1(v_pid),
      public.commerce_destination_rule_hash_v1(v_pid,v_market.country_code)
    );
  end loop;

  return query select v_cert.id,v_cert.certification_code,v_cert.status,v_cert.valid_until;
end; $$;

revoke all on function public.certify_commerce_market_v1(text,jsonb,uuid,uuid,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.certify_commerce_market_v1(text,jsonb,uuid,uuid,text,text,text,integer,text) to service_role;

create or replace function public.resolve_commerce_market_certification_v1(
  p_market_code text,p_country_code text,p_currency_code text,p_product_price_revisions jsonb,p_environment text default 'live'
) returns table(certification_id uuid,certification_code text,valid_until timestamptz)
language plpgsql security definer set search_path=''
as $$
begin
  if p_environment not in ('live','test') or jsonb_typeof(p_product_price_revisions)<>'array' or jsonb_array_length(p_product_price_revisions)<1 then return; end if;
  return query
  select c.id,c.certification_code,c.valid_until
  from public.commerce_market_certifications c
  join public.commerce_market_shipping_services s on s.market_code=c.market_code and s.service_code=c.shipping_service_code
  join public.commerce_shipping_providers sp on sp.provider_code=c.shipping_provider_code
  join public.commerce_market_payment_methods pm on pm.market_code=c.market_code and pm.provider_code=c.payment_provider_code
    and pm.currency_code=c.currency_code and pm.payment_method_code=c.payment_method_code
  join public.commerce_payment_providers pp on pp.provider_code=c.payment_provider_code
  join public.commerce_customs_market_policies cmp on cmp.market_code=c.market_code
  join public.commerce_return_policies rp on rp.market_code=c.market_code
  where c.market_code=upper(trim(p_market_code)) and c.country_code=upper(trim(p_country_code))
    and c.currency_code=upper(trim(p_currency_code)) and c.environment=p_environment
    and c.status='certified' and c.valid_until>now()
    and s.execution_mode='global_v2' and s.status='live' and s.enabled
    and sp.status='live' and sp.active and sp.adapter_key<>'legacy_domestic_static_v1'
    and pm.execution_mode='global_v2' and pm.status='live' and pm.enabled
    and pp.status='live' and pp.active
    and cmp.enabled and cmp.status='live' and cmp.duty_tax_mode='recipient_on_import'
    and cmp.importer_responsibility='customer' and cmp.terms_code=c.customs_terms_code
    and cmp.disclosure_key=c.customs_disclosure_key
    and rp.enabled and rp.status='live' and rp.terms_code=c.return_terms_code
    and not exists(
      select 1 from jsonb_array_elements(p_product_price_revisions) e
      where jsonb_typeof(e)<>'object' or (e->>'productId') is null or (e->>'priceRevisionId') is null
         or not exists(
           select 1 from public.commerce_market_certification_products cp
           where cp.certification_id=c.id and cp.product_id=(e->>'productId')::uuid
             and cp.price_revision_id=(e->>'priceRevisionId')::uuid
             and cp.shipping_profile_hash=public.commerce_shipping_profile_hash_v1(cp.product_id)
             and cp.customs_profile_hash=public.commerce_customs_profile_hash_v1(cp.product_id)
             and cp.destination_rule_hash=public.commerce_destination_rule_hash_v1(cp.product_id,c.country_code)
         )
    )
  order by c.certified_at desc limit 1;
end; $$;

revoke all on function public.resolve_commerce_market_certification_v1(text,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.resolve_commerce_market_certification_v1(text,text,text,jsonb,text) to service_role;

create or replace function public.assert_otop_country_certification_v1(p_order_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_order public.otop_orders%rowtype; v_items jsonb; v_cert uuid;
begin
  select * into v_order from public.otop_orders o where o.id=p_order_id limit 1;
  if not found or v_order.checkout_version<>2 then return; end if;
  select jsonb_agg(jsonb_build_object('productId',i.product_id,'priceRevisionId',i.price_revision_id) order by i.product_id)
  into v_items from public.otop_order_items i where i.order_id=v_order.id;
  if v_items is null or exists(select 1 from public.otop_order_items i where i.order_id=v_order.id and i.price_revision_id is null) then
    raise exception 'country_certification_order_items_missing';
  end if;
  select r.certification_id into v_cert
  from public.resolve_commerce_market_certification_v1(
    v_order.market_code,v_order.destination_country_code,v_order.currency_code,v_items,v_order.environment
  ) r limit 1;
  if v_cert is null then raise exception 'country_certification_required'; end if;
end; $$;

revoke all on function public.assert_otop_country_certification_v1(uuid) from public,anon,authenticated;
grant execute on function public.assert_otop_country_certification_v1(uuid) to service_role;

create or replace function public.otop_country_certification_order_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.checkout_version<>2 then return null; end if;
  if tg_op='UPDATE' and old.checkout_version is not distinct from new.checkout_version
     and old.market_code is not distinct from new.market_code
     and old.destination_country_code is not distinct from new.destination_country_code
     and old.currency_code is not distinct from new.currency_code
     and old.checkout_request_items is not distinct from new.checkout_request_items then return null;
  end if;
  perform public.assert_otop_country_certification_v1(new.id);
  return null;
end; $$;

create or replace function public.otop_country_certification_item_guard()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_order_id uuid;
begin
  v_order_id:=coalesce(new.order_id,old.order_id);
  perform public.assert_otop_country_certification_v1(v_order_id);
  return null;
end; $$;

revoke all on function public.otop_country_certification_order_guard() from public,anon,authenticated;
revoke all on function public.otop_country_certification_item_guard() from public,anon,authenticated;
grant execute on function public.otop_country_certification_order_guard() to service_role;
grant execute on function public.otop_country_certification_item_guard() to service_role;

drop trigger if exists otop_country_certification_order_guard on public.otop_orders;
create constraint trigger otop_country_certification_order_guard
after insert or update on public.otop_orders deferrable initially deferred
for each row execute function public.otop_country_certification_order_guard();

drop trigger if exists otop_country_certification_item_guard on public.otop_order_items;
create constraint trigger otop_country_certification_item_guard
after insert or update or delete on public.otop_order_items deferrable initially deferred
for each row execute function public.otop_country_certification_item_guard();

comment on table public.commerce_market_certifications is
  'WW-11 time-bounded country/market certification evidence. Foreign checkout-v2 fails closed without a current matching certification.';
comment on table public.commerce_market_certification_products is
  'WW-11 exact certified product evidence: price revision plus hashes of shipping/customs/destination-rule truth.';
