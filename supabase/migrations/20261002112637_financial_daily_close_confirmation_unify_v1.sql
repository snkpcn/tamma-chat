drop function if exists public.financial_confirm_cafe_test_daily_close_v1(uuid,text);

CREATE OR REPLACE FUNCTION public.financial_validate_cafe_test_daily_close_v1(p_daily_close_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
begin
  r:=public.financial_reconcile_daily_close_v1(p_daily_close_id);
  if coalesce(r->>'environment','')<>'test' then
    raise exception 'validation_test_only';
  end if;
  return r;
end;
$function$


CREATE OR REPLACE FUNCTION public.financial_confirm_cafe_test_daily_close_v1(p_daily_close_id uuid, p_actor_hash text, p_source text DEFAULT 'line'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_environment text;
  v_status text;
  v_recon jsonb;
  v_result jsonb;
begin
  select environment,status into v_environment,v_status
  from public.financial_daily_closes
  where id=p_daily_close_id
  for update;

  if v_environment is null then
    raise exception 'daily_close_not_found';
  end if;
  if v_environment<>'test' then
    raise exception 'confirmation_test_only';
  end if;

  if v_status='confirmed' then
    select jsonb_build_object(
      'ok',true,
      'confirmed',true,
      'already_confirmed',true,
      'daily_close_id',id,
      'local_date',local_date,
      'status',status,
      'confirmed_at',confirmed_at
    )
    into v_result
    from public.financial_daily_closes
    where id=p_daily_close_id;
    return v_result;
  end if;

  if v_status='void' then
    raise exception 'void_daily_close_cannot_confirm';
  end if;

  v_recon:=public.financial_reconcile_daily_close_v1(p_daily_close_id);

  if coalesce((v_recon->>'ready_to_confirm')::boolean,false)=false then
    return v_recon || jsonb_build_object(
      'confirmed',false,
      'reason','reconciliation_blocked'
    );
  end if;

  update public.financial_daily_closes
  set status='confirmed',
      submitted_at=coalesce(submitted_at,now()),
      confirmed_at=now(),
      confirmed_by_hash=nullif(trim(coalesce(p_actor_hash,'')),''),
      source=case
        when p_source in ('line','backoffice','import','system') then p_source
        else source
      end,
      updated_at=now(),
      revision=revision+1
  where id=p_daily_close_id;

  return v_recon || jsonb_build_object(
    'confirmed',true,
    'already_confirmed',false,
    'status','confirmed',
    'confirmed_at',now()
  );
end;
$function$


revoke all on function public.financial_validate_cafe_test_daily_close_v1(uuid) from public;
revoke all on function public.financial_validate_cafe_test_daily_close_v1(uuid) from anon;
revoke all on function public.financial_validate_cafe_test_daily_close_v1(uuid) from authenticated;
grant execute on function public.financial_validate_cafe_test_daily_close_v1(uuid) to service_role;

revoke all on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) from public;
revoke all on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) from anon;
revoke all on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) from authenticated;
grant execute on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) to service_role;
