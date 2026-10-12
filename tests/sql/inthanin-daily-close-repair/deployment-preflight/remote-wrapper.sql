-- LOCAL DRAFT ONLY. Not applied. Generate the repository migration via Supabase CLI on release.
-- Caller must be the trusted server after checking the dedicated owner LINE identity.
-- No grants to browser roles; no new financial records or altered reconciliation rules.
create function public.financial_confirm_inthanin_daily_close_card_v1(
  p_daily_close_id uuid,
  p_expected_local_date date,
  p_expected_revision integer,
  p_actor_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $function$
declare
  v_close record;
  v_result jsonb;
begin
  if p_expected_revision is null or p_expected_revision < 1 then
    raise exception 'invalid_expected_revision';
  end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'owner_actor_required';
  end if;
  select d.* into v_close
  from public.financial_daily_closes d
  join public.operations_business_branches b on b.id=d.branch_id
  where d.id=p_daily_close_id and b.code='inthanin_tadtone' and b.active=true
    and d.environment='live' and d.local_date=p_expected_local_date
  for update of d;
  if v_close.id is null then raise exception 'daily_close_scope_mismatch'; end if;
  if v_close.revision<>p_expected_revision then
    return jsonb_build_object('ok',false,'confirmed',false,'reason','stale_revision',
      'daily_close_id',v_close.id,'local_date',v_close.local_date,'revision',v_close.revision,'status',v_close.status);
  end if;
  -- The row lock remains held while the existing canonical reconciliation and confirmation run.
  v_result:=public.financial_confirm_inthanin_live_daily_close_v1(p_daily_close_id,p_actor_hash,'line');
  return v_result;
end;
$function$;
revoke all on function public.financial_confirm_inthanin_daily_close_card_v1(uuid,date,integer,text) from public,anon,authenticated;
grant execute on function public.financial_confirm_inthanin_daily_close_card_v1(uuid,date,integer,text) to service_role;
