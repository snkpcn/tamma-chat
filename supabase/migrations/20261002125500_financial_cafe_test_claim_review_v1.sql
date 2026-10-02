create or replace function public.financial_review_cafe_test_expense_claim_v1(
  p_claim_id uuid,
  p_decision text,
  p_actor_hash text,
  p_source text default 'backoffice'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_close_id uuid;
  v_environment text;
  v_close_status text;
  v_current_status text;
  v_claimed numeric(14,2);
  v_settlement_count integer:=0;
  v_recon jsonb;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'invalid_claim_decision';
  end if;
  if p_source not in ('line','backoffice','import','system') then
    raise exception 'invalid_claim_review_source';
  end if;

  select c.origin_daily_close_id,c.approval_status,c.claimed_amount,
         dc.environment,dc.status
  into v_close_id,v_current_status,v_claimed,v_environment,v_close_status
  from public.financial_expense_claims c
  join public.financial_daily_closes dc on dc.id=c.origin_daily_close_id
  where c.id=p_claim_id
  for update of c;

  if v_close_id is null then raise exception 'expense_claim_not_found'; end if;
  if v_environment<>'test' then raise exception 'claim_review_test_only'; end if;
  if v_close_status='confirmed' then raise exception 'confirmed_daily_close_is_immutable'; end if;

  select count(*) into v_settlement_count
  from public.financial_daily_ledger_entries le
  where le.expense_claim_id=p_claim_id
    and le.accounting_role='cash_settlement'
    and le.direction='outflow'
    and coalesce((le.metadata->>'superseded')::boolean,false)=false;

  if p_decision='rejected' and v_settlement_count>0 then
    raise exception 'settled_claim_cannot_reject';
  end if;

  update public.financial_expense_claims
  set approval_status=p_decision,
      approved_amount=case when p_decision='approved' then claimed_amount else 0 end,
      approved_by_hash=nullif(trim(coalesce(p_actor_hash,'')),''),
      approved_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object(
          'reviewed_via',p_source,
          'reviewed_at',now(),
          'review_decision',p_decision
        ),
      updated_at=now()
  where id=p_claim_id;

  update public.financial_daily_ledger_entries
  set metadata=(coalesce(metadata,'{}'::jsonb)-'needs_review')
      || jsonb_build_object(
        'claim_reviewed',true,
        'claim_review_status',p_decision,
        'claim_reviewed_at',now()
      ),
      updated_at=now()
  where expense_claim_id=p_claim_id
    and accounting_role='economic_event'
    and coalesce((metadata->>'superseded')::boolean,false)=false;

  v_recon:=public.financial_reconcile_daily_close_v1(v_close_id);

  return jsonb_build_object(
    'ok',true,
    'claim_id',p_claim_id,
    'decision',p_decision,
    'daily_close_id',v_close_id,
    'settlement_count',v_settlement_count,
    'reconciliation',v_recon
  );
end;
$$;

revoke all on function public.financial_review_cafe_test_expense_claim_v1(uuid,text,text,text) from public;
revoke all on function public.financial_review_cafe_test_expense_claim_v1(uuid,text,text,text) from anon;
revoke all on function public.financial_review_cafe_test_expense_claim_v1(uuid,text,text,text) from authenticated;
grant execute on function public.financial_review_cafe_test_expense_claim_v1(uuid,text,text,text) to service_role;
