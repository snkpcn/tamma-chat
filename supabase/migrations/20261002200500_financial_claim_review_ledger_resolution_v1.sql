create or replace function public.financial_review_expense_claim_v1(
  p_claim_id uuid,
  p_decision text,
  p_approved_amount numeric default null,
  p_actor_hash text default null,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_claim public.financial_expense_claims%rowtype;
  v_close public.financial_daily_closes%rowtype;
  v_branch_code text;
  v_settled numeric(14,2):=0;
  v_amount numeric(14,2);
  v_result jsonb;
begin
  select cl.* into v_claim
  from public.financial_expense_claims cl
  where cl.id=p_claim_id
  for update;

  if v_claim.id is null then raise exception 'expense_claim_not_found'; end if;

  select c.* into v_close
  from public.financial_daily_closes c
  where c.id=v_claim.origin_daily_close_id
  for update;

  select b.code into v_branch_code
  from public.operations_business_branches b
  where b.id=v_close.branch_id;

  if v_branch_code<>'inthanin_tadtone' or v_close.environment<>'test' then
    raise exception 'expense_claim_review_test_only';
  end if;
  if v_close.status='confirmed' then raise exception 'confirmed_daily_close_is_immutable'; end if;
  if p_decision not in ('approve','reject') then raise exception 'invalid_claim_review_decision'; end if;

  select coalesce(sum(le.amount),0)::numeric(14,2)
  into v_settled
  from public.financial_daily_ledger_entries le
  where le.expense_claim_id=v_claim.id
    and le.accounting_role='cash_settlement'
    and le.direction='outflow'
    and coalesce((le.metadata->>'superseded')::boolean,false)=false;

  if p_decision='reject' then
    if v_settled>0 then raise exception 'settled_claim_cannot_be_rejected'; end if;

    update public.financial_expense_claims
    set approval_status='rejected',
        approved_amount=0,
        approved_by_hash=nullif(trim(coalesce(p_actor_hash,'')),''),
        approved_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'review_reason',nullif(trim(coalesce(p_reason,'')),''),
          'reviewed_at',now(),
          'review_decision','reject'
        )
    where id=v_claim.id;

    update public.financial_daily_ledger_entries
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'needs_review',false,
          'superseded',true,
          'claim_review_status','rejected',
          'claim_reviewed_at',now()
        ),
        updated_at=now()
    where expense_claim_id=v_claim.id
      and accounting_role='economic_event';
  else
    v_amount:=coalesce(p_approved_amount,v_claim.claimed_amount);
    if v_amount<0 or v_amount>v_claim.claimed_amount then raise exception 'invalid_approved_amount'; end if;
    if v_settled>v_amount+0.01 then raise exception 'approved_amount_below_already_settled_amount'; end if;

    update public.financial_expense_claims
    set approval_status='approved',
        approved_amount=v_amount,
        approved_by_hash=nullif(trim(coalesce(p_actor_hash,'')),''),
        approved_at=now(),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'review_reason',nullif(trim(coalesce(p_reason,'')),''),
          'reviewed_at',now(),
          'review_decision','approve'
        )
    where id=v_claim.id;

    update public.financial_daily_ledger_entries
    set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'needs_review',false,
          'claim_review_status','approved',
          'claim_reviewed_at',now()
        ),
        updated_at=now()
    where expense_claim_id=v_claim.id
      and accounting_role='economic_event'
      and coalesce((metadata->>'superseded')::boolean,false)=false;
  end if;

  select jsonb_build_object(
    'ok',true,'claim_id',s.id,'approval_status',s.approval_status,
    'claimed_amount',s.claimed_amount,'approved_amount',s.approved_amount,
    'cash_settled_amount',s.cash_settled_amount,'outstanding_amount',s.outstanding_amount,
    'payment_status',s.payment_status,'daily_close_id',v_close.id,
    'local_date',v_close.local_date,'environment',v_close.environment
  )
  into v_result
  from public.financial_expense_claim_summary s
  where s.id=v_claim.id;

  return v_result;
end;
$$;

revoke all on function public.financial_review_expense_claim_v1(uuid,text,numeric,text,text) from public;
revoke all on function public.financial_review_expense_claim_v1(uuid,text,numeric,text,text) from anon;
revoke all on function public.financial_review_expense_claim_v1(uuid,text,numeric,text,text) from authenticated;
grant execute on function public.financial_review_expense_claim_v1(uuid,text,numeric,text,text) to service_role;
