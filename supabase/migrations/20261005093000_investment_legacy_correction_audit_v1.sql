-- Preserve an immutable explanation whenever a legacy Restaurant OS investment total is corrected.
-- The original row remains in tamma_chart_os; this audit stores both numerical states.

create table if not exists public.financial_investment_legacy_adjustment_audit_events(
  id uuid primary key default gen_random_uuid(),
  legacy_investment_id uuid not null,
  action text not null check(action in ('actual_corrected')),
  source text not null check(source in ('owner_instruction','backoffice','import','system')),
  actor_hash text null,
  reason text not null check(length(trim(reason))>=3),
  previous_manual_actual_amount numeric(14,2) null,
  previous_actual_amount numeric(14,2) null,
  new_manual_actual_amount numeric(14,2) not null,
  new_actual_amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create index if not exists financial_investment_legacy_adjustment_audit_idx
  on public.financial_investment_legacy_adjustment_audit_events(legacy_investment_id,created_at);

alter table public.financial_investment_legacy_adjustment_audit_events enable row level security;
revoke all on public.financial_investment_legacy_adjustment_audit_events from public,anon,authenticated;
grant select,insert on public.financial_investment_legacy_adjustment_audit_events to service_role;

create or replace function public.financial_correct_legacy_investment_actual_v1(
  p_investment_id uuid,
  p_manual_actual_amount numeric,
  p_reason text,
  p_source text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public,tamma_chart_os
as $$
declare
  v_before tamma_chart_os.investments%rowtype;
  v_after tamma_chart_os.investments%rowtype;
begin
  if p_investment_id is null then raise exception 'legacy_investment_id_required'; end if;
  if p_manual_actual_amount is null or p_manual_actual_amount<0 or p_manual_actual_amount>100000000 then raise exception 'invalid_actual_amount'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'correction_reason_required'; end if;
  if coalesce(trim(p_source),'') not in ('owner_instruction','backoffice','import','system') then raise exception 'invalid_correction_source'; end if;

  select * into v_before from tamma_chart_os.investments where id=p_investment_id for update;
  if v_before.id is null then raise exception 'legacy_investment_not_found'; end if;

  update tamma_chart_os.investments
  set manual_actual_amount=p_manual_actual_amount
  where id=p_investment_id
  returning * into v_after;

  insert into public.financial_investment_legacy_adjustment_audit_events(
    legacy_investment_id,action,source,actor_hash,reason,
    previous_manual_actual_amount,previous_actual_amount,
    new_manual_actual_amount,new_actual_amount
  ) values (
    p_investment_id,'actual_corrected',trim(p_source),nullif(trim(coalesce(p_actor_hash,'')),''),trim(p_reason),
    v_before.manual_actual_amount,v_before.actual_amount,
    v_after.manual_actual_amount,v_after.actual_amount
  );

  return jsonb_build_object(
    'ok',true,'investment_id',v_after.id,'name',v_after.name,
    'previous_actual_amount',v_before.actual_amount,
    'actual_amount',v_after.actual_amount,
    'manual_actual_amount',v_after.manual_actual_amount
  );
end;
$$;

revoke all on function public.financial_correct_legacy_investment_actual_v1(uuid,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_correct_legacy_investment_actual_v1(uuid,numeric,text,text,text) to service_role;
