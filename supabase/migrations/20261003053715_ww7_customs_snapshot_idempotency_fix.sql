alter table public.commerce_customs_compliance_snapshots
  add column if not exists request_items jsonb not null default '[]'::jsonb;

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
    if v_existing.market_code<>v_market or v_existing.destination_country_code<>v_dest
       or v_existing.currency_code<>v_currency or v_existing.environment<>p_environment
       or v_existing.request_items<>p_items then raise exception 'customs_snapshot_idempotency_conflict'; end if;
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
  insert into public.commerce_customs_compliance_snapshots(market_code,destination_country_code,currency_code,decision,duty_tax_status,request_items,line_snapshot,reasons,idempotency_key,environment,status)
  values (v_market,v_dest,v_currency,v_decision,'not_calculated',p_items,v_lines,v_reasons,p_idempotency_key,p_environment,'active')
  returning * into v_existing;
  return query select v_existing.id,v_existing.decision,v_existing.duty_tax_status;
end; $$;
revoke all on function public.create_commerce_customs_snapshot_v1(text,text,text,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.create_commerce_customs_snapshot_v1(text,text,text,jsonb,text,text) to service_role;
