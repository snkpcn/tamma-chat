create table if not exists public.commerce_product_customs_profiles (
  product_id uuid primary key references public.otop_products(id) on delete cascade,
  origin_country_code text not null references public.commerce_countries(country_code),
  classification_system text not null default 'HS' check (char_length(classification_system) between 1 and 32),
  classification_code text not null check (classification_code ~ '^[0-9]{6,12}$'),
  customs_description text not null check (char_length(customs_description) between 3 and 240),
  verification_status text not null default 'draft' check (verification_status in ('draft','verified','rejected')),
  evidence jsonb not null default '{}'::jsonb,
  verified_at timestamptz null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.commerce_customs_destination_rules (
  product_id uuid not null references public.otop_products(id) on delete cascade,
  country_code text not null references public.commerce_countries(country_code),
  decision text not null check (decision in ('allowed','review_required','prohibited')),
  status text not null default 'draft' check (status in ('draft','certification','live','suspended')),
  enabled boolean not null default false,
  required_document_codes text[] not null default '{}'::text[],
  reason_code text null check (reason_code is null or reason_code ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  evidence jsonb not null default '{}'::jsonb,
  valid_from timestamptz not null default now(),
  valid_until timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(product_id,country_code),
  check (valid_until is null or valid_until > valid_from)
);
create table if not exists public.commerce_customs_market_policies (
  market_code text primary key references public.commerce_markets(market_code) on delete cascade,
  status text not null default 'draft' check (status in ('draft','certification','live','suspended')),
  enabled boolean not null default false,
  duty_tax_mode text not null default 'not_configured' check (duty_tax_mode in ('not_configured','recipient_on_import','prepaid_assessment')),
  importer_responsibility text not null default 'not_configured' check (importer_responsibility in ('not_configured','customer','merchant','provider')),
  terms_code text null check (terms_code is null or terms_code ~ '^[A-Z0-9_-]{2,16}$'),
  disclosure_key text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.commerce_customs_compliance_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_code text not null unique default ('CS-' || to_char(now(),'YYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  market_code text not null references public.commerce_markets(market_code),
  destination_country_code text not null references public.commerce_countries(country_code),
  currency_code text not null references public.commerce_currencies(currency_code),
  decision text not null check (decision in ('eligible','review_required','prohibited')),
  duty_tax_status text not null default 'not_calculated' check (duty_tax_status='not_calculated'),
  line_snapshot jsonb not null,
  reasons jsonb not null default '[]'::jsonb,
  idempotency_key text not null unique check (char_length(idempotency_key) between 16 and 120),
  environment text not null check (environment in ('live','test')),
  status text not null default 'active' check (status in ('active','superseded','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists customs_profiles_origin_idx on public.commerce_product_customs_profiles(origin_country_code,verification_status,active);
create index if not exists customs_rules_country_idx on public.commerce_customs_destination_rules(country_code,status,enabled);
create index if not exists customs_snapshots_market_idx on public.commerce_customs_compliance_snapshots(market_code,decision,created_at desc);
create index if not exists customs_snapshots_destination_idx on public.commerce_customs_compliance_snapshots(destination_country_code,decision,created_at desc);
create index if not exists customs_snapshots_currency_idx on public.commerce_customs_compliance_snapshots(currency_code,created_at desc);
alter table public.commerce_product_customs_profiles enable row level security;
alter table public.commerce_customs_destination_rules enable row level security;
alter table public.commerce_customs_market_policies enable row level security;
alter table public.commerce_customs_compliance_snapshots enable row level security;
revoke all on table public.commerce_product_customs_profiles from public,anon,authenticated,service_role;
revoke all on table public.commerce_customs_destination_rules from public,anon,authenticated,service_role;
revoke all on table public.commerce_customs_market_policies from public,anon,authenticated,service_role;
revoke all on table public.commerce_customs_compliance_snapshots from public,anon,authenticated,service_role;
grant select,insert,update,delete on table public.commerce_product_customs_profiles to service_role;
grant select,insert,update,delete on table public.commerce_customs_destination_rules to service_role;
grant select,insert,update,delete on table public.commerce_customs_market_policies to service_role;
grant select,insert,update,delete on table public.commerce_customs_compliance_snapshots to service_role;

create or replace function public.set_commerce_product_customs_profile_v1(
  p_product_id uuid,p_origin_country_code text,p_classification_system text,
  p_classification_code text,p_customs_description text,p_verification_status text,
  p_evidence jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=''
as $$
declare v_origin text:=upper(trim(p_origin_country_code)); v_code text:=regexp_replace(coalesce(p_classification_code,''),'\s','','g');
begin
  if not exists(select 1 from public.otop_products p where p.id=p_product_id) then raise exception 'customs_product_not_found'; end if;
  if not exists(select 1 from public.commerce_countries c where c.country_code=v_origin and c.active) then raise exception 'customs_origin_not_active'; end if;
  if v_code !~ '^[0-9]{6,12}$' then raise exception 'invalid_customs_classification'; end if;
  if p_verification_status not in ('draft','verified','rejected') then raise exception 'invalid_customs_verification_status'; end if;
  insert into public.commerce_product_customs_profiles(product_id,origin_country_code,classification_system,classification_code,customs_description,verification_status,evidence,verified_at,active,updated_at)
  values (p_product_id,v_origin,trim(p_classification_system),v_code,trim(p_customs_description),p_verification_status,coalesce(p_evidence,'{}'::jsonb),case when p_verification_status='verified' then now() else null end,true,now())
  on conflict(product_id) do update set origin_country_code=excluded.origin_country_code,classification_system=excluded.classification_system,classification_code=excluded.classification_code,customs_description=excluded.customs_description,verification_status=excluded.verification_status,evidence=excluded.evidence,verified_at=excluded.verified_at,active=true,updated_at=now();
  return p_product_id;
end; $$;
revoke all on function public.set_commerce_product_customs_profile_v1(uuid,text,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.set_commerce_product_customs_profile_v1(uuid,text,text,text,text,text,jsonb) to service_role;

create or replace function public.create_commerce_customs_snapshot_v1(
  p_market_code text,p_destination_country_code text,p_currency_code text,
  p_items jsonb,p_idempotency_key text,p_environment text default 'live'
) returns table(snapshot_id uuid,decision text,duty_tax_status text)
language plpgsql security definer set search_path=''
as $$
declare
  v_market text:=upper(trim(p_market_code)); v_dest text:=upper(trim(p_destination_country_code));
  v_currency text:=upper(trim(p_currency_code)); v_item jsonb; v_product_id uuid; v_qty integer;
  v_profile public.commerce_product_customs_profiles%rowtype; v_rule public.commerce_customs_destination_rules%rowtype;
  v_decision text:='eligible'; v_lines jsonb:='[]'::jsonb; v_reasons jsonb:='[]'::jsonb;
  v_existing public.commerce_customs_compliance_snapshots%rowtype;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 16 and 120 then raise exception 'invalid_customs_idempotency_key'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>50 then raise exception 'invalid_customs_items'; end if;
  select * into v_existing from public.commerce_customs_compliance_snapshots s where s.idempotency_key=p_idempotency_key limit 1;
  if found then
    if v_existing.market_code<>v_market or v_existing.destination_country_code<>v_dest or v_existing.currency_code<>v_currency or v_existing.environment<>p_environment then raise exception 'customs_snapshot_idempotency_conflict'; end if;
    return query select v_existing.id,v_existing.decision,v_existing.duty_tax_status; return;
  end if;
  if not exists(select 1 from public.commerce_markets m where m.market_code=v_market and m.country_code=v_dest and m.status='live') then raise exception 'customs_market_not_live'; end if;
  if not exists(select 1 from public.commerce_market_capabilities c where c.market_code=v_market and c.capability='customs' and c.state='live') then raise exception 'customs_capability_not_live'; end if;
  if not exists(select 1 from public.commerce_market_currencies c where c.market_code=v_market and c.currency_code=v_currency and c.enabled) then raise exception 'customs_currency_not_enabled'; end if;
  if not exists(select 1 from public.commerce_customs_market_policies p where p.market_code=v_market and p.enabled and p.status='live') then raise exception 'customs_market_policy_not_live'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin v_product_id:=(v_item->>'productId')::uuid; exception when others then raise exception 'invalid_customs_product_id'; end;
    if (v_item->>'quantity') !~ '^[0-9]+$' then raise exception 'invalid_customs_quantity'; end if;
    v_qty:=(v_item->>'quantity')::integer; if v_qty<1 or v_qty>99 then raise exception 'invalid_customs_quantity'; end if;
    if not exists(select 1 from public.otop_products p where p.id=v_product_id and p.environment=p_environment and p.active and p.verified) then raise exception 'customs_product_not_available'; end if;
    select * into v_profile from public.commerce_product_customs_profiles p where p.product_id=v_product_id and p.active limit 1;
    select * into v_rule from public.commerce_customs_destination_rules r where r.product_id=v_product_id and r.country_code=v_dest and r.enabled and r.status='live' and r.valid_from<=now() and (r.valid_until is null or r.valid_until>now()) limit 1;
    if v_profile.product_id is null or v_profile.verification_status<>'verified' then
      if v_decision<>'prohibited' then v_decision:='review_required'; end if;
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('productId',v_product_id,'reason','customs_profile_not_verified'));
    elsif v_rule.product_id is null then
      if v_decision<>'prohibited' then v_decision:='review_required'; end if;
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('productId',v_product_id,'reason','destination_rule_not_live'));
    elsif v_rule.decision='prohibited' then
      v_decision:='prohibited';
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('productId',v_product_id,'reason',coalesce(v_rule.reason_code,'destination_prohibited')));
    elsif v_rule.decision<>'allowed' then
      if v_decision<>'prohibited' then v_decision:='review_required'; end if;
      v_reasons:=v_reasons||jsonb_build_array(jsonb_build_object('productId',v_product_id,'reason',coalesce(v_rule.reason_code,'destination_review_required')));
    end if;
    v_lines:=v_lines||jsonb_build_array(jsonb_build_object('productId',v_product_id,'quantity',v_qty,'originCountryCode',v_profile.origin_country_code,'classificationSystem',v_profile.classification_system,'classificationCode',v_profile.classification_code,'customsDescription',v_profile.customs_description,'profileVerification',v_profile.verification_status,'destinationDecision',v_rule.decision,'requiredDocumentCodes',coalesce(to_jsonb(v_rule.required_document_codes),'[]'::jsonb)));
    v_profile:=null; v_rule:=null;
  end loop;
  insert into public.commerce_customs_compliance_snapshots(market_code,destination_country_code,currency_code,decision,duty_tax_status,line_snapshot,reasons,idempotency_key,environment,status)
  values (v_market,v_dest,v_currency,v_decision,'not_calculated',v_lines,v_reasons,p_idempotency_key,p_environment,'active')
  returning * into v_existing;
  return query select v_existing.id,v_existing.decision,v_existing.duty_tax_status;
end; $$;
revoke all on function public.create_commerce_customs_snapshot_v1(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_commerce_customs_snapshot_v1(text,text,text,jsonb,text,text) to service_role;
