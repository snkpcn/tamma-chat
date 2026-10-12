-- LOCAL PROPOSAL ONLY. Owner-authenticated Backoffice calls with service_role.
-- Uses the same parent-row lock and expected-revision contract as the installed
-- LINE confirmation wrapper. Does not call confirmation or change its grants.
create function public.financial_save_inthanin_daily_close_draft_v1(
  p_daily_close_id uuid,
  p_expected_local_date date,
  p_expected_environment text,
  p_expected_revision integer,
  p_patch jsonb,
  p_actor_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_close public.financial_daily_closes%rowtype;
  v_next public.financial_daily_closes%rowtype;
  v_field text;
  v_number numeric;
  v_money text[] := array['gross_sales','discounts','refunds','payment_cash','payment_qr','payment_card','payment_delivery','payment_other','purchase_cash_outflow','expense_cash_outflow','waste_reported_value'];
  v_nullable text[] := array['staff_count','cup_count','bill_count','cash_opening_float','cash_counted_closing'];
begin
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'invalid_expected_revision'; end if;
  if p_expected_environment is null or p_expected_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then raise exception 'owner_actor_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'nothing_to_save'; end if;
  for v_field in select jsonb_object_keys(p_patch) loop
    if not (v_field=any(v_money || v_nullable || array['notes','status'])) then raise exception 'invalid_patch_field'; end if;
    if v_field=any(v_money || v_nullable) then
      if p_patch->v_field='null'::jsonb and v_field=any(v_nullable) then continue; end if;
      if jsonb_typeof(p_patch->v_field)<>'number' then raise exception 'invalid_numeric_field'; end if;
      v_number:=(p_patch->>v_field)::numeric;
      if v_number<0 or v_number>999999999999.99 or v_number<>round(v_number,2) then raise exception 'invalid_numeric_field'; end if;
      if v_field=any(array['staff_count','cup_count','bill_count']) and (v_number<>trunc(v_number) or v_number>case when v_field='staff_count' then 1000 else 100000 end) then raise exception 'invalid_count_field'; end if;
    elsif v_field='notes' then
      if p_patch->v_field<>'null'::jsonb and (jsonb_typeof(p_patch->v_field)<>'string' or length(p_patch->>v_field)>4000) then raise exception 'invalid_notes'; end if;
    elsif v_field='status' then
      if coalesce(p_patch->>v_field,'') not in ('draft','pending_confirmation') then raise exception 'invalid_status'; end if;
    end if;
  end loop;
  select d.* into v_close
  from public.financial_daily_closes d
  join public.operations_business_branches b on b.id=d.branch_id
  where d.id=p_daily_close_id and d.local_date=p_expected_local_date
    and d.environment=p_expected_environment and b.code='inthanin_tadtone' and b.active=true
  for update of d;
  if v_close.id is null then raise exception 'daily_close_scope_mismatch'; end if;
  if v_close.revision<>p_expected_revision then
    return jsonb_build_object('ok',false,'saved',false,'reason','stale_revision','revision',v_close.revision,'status',v_close.status);
  end if;
  if v_close.status not in ('draft','pending_confirmation') then raise exception 'daily_close_not_editable'; end if;
  v_next:=jsonb_populate_record(v_close,p_patch);
  update public.financial_daily_closes set
    gross_sales=v_next.gross_sales,discounts=v_next.discounts,refunds=v_next.refunds,
    payment_cash=v_next.payment_cash,payment_qr=v_next.payment_qr,payment_card=v_next.payment_card,
    payment_delivery=v_next.payment_delivery,payment_other=v_next.payment_other,
    purchase_cash_outflow=v_next.purchase_cash_outflow,expense_cash_outflow=v_next.expense_cash_outflow,
    waste_reported_value=v_next.waste_reported_value,staff_count=v_next.staff_count,
    cup_count=v_next.cup_count,bill_count=v_next.bill_count,cash_opening_float=v_next.cash_opening_float,
    cash_counted_closing=v_next.cash_counted_closing,notes=v_next.notes,status=v_next.status,
    source='backoffice',revision=v_close.revision+1,
    submitted_at=case when v_next.status='pending_confirmation' then coalesce(v_close.submitted_at,now()) else v_close.submitted_at end
  where id=v_close.id
  returning * into v_next;
  return jsonb_build_object('ok',true,'saved',true,'close',to_jsonb(v_next));
end;
$function$;
revoke all on function public.financial_save_inthanin_daily_close_draft_v1(uuid,date,text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.financial_save_inthanin_daily_close_draft_v1(uuid,date,text,integer,jsonb,text) to service_role;
