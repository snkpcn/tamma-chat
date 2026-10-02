-- Financial OS: prevent a purpose-resolved transfer slip from being counted again
-- when the same purchase later appears in the staff Daily Close form.

create or replace function public.financial_dedupe_transfer_followup_expenses_v1(
  p_daily_close_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  s record;
  v_candidate_count integer;
  v_report_ledger_id uuid;
  v_claim_id uuid;
  v_deduped integer:=0;
  v_purchase_cash numeric(14,2):=0;
  v_expense_cash numeric(14,2):=0;
begin
  if not exists(select 1 from public.financial_daily_closes where id=p_daily_close_id) then
    raise exception 'daily_close_not_found';
  end if;

  if exists(
    select 1 from public.financial_daily_closes
    where id=p_daily_close_id and status in ('confirmed','void')
  ) then
    raise exception 'daily_close_not_editable';
  end if;

  for s in
    select le.id,le.amount,le.category,le.description
    from public.financial_daily_ledger_entries le
    where le.daily_close_id=p_daily_close_id
      and le.source_channel='line'
      and le.source_item_key='transfer_purpose'
      and le.accounting_role='economic_event'
      and le.entry_type='vendor_payment'
      and coalesce((le.metadata->>'superseded')::boolean,false)=false
      and coalesce(le.metadata->>'transfer_followup_id','')<>''
    order by le.created_at asc
  loop
    select count(*),min(le.id::text)::uuid
    into v_candidate_count,v_report_ledger_id
    from public.financial_daily_ledger_entries le
    where le.daily_close_id=p_daily_close_id
      and le.id<>s.id
      and le.source_channel='line'
      and le.source_item_key like 'expense:%'
      and le.accounting_role='economic_event'
      and abs(le.amount-s.amount)<0.01
      and coalesce((le.metadata->>'superseded')::boolean,false)=false
      and (
        le.category is not distinct from s.category
        or s.category='other'
      );

    if v_candidate_count=1 and v_report_ledger_id is not null then
      select expense_claim_id into v_claim_id
      from public.financial_daily_ledger_entries
      where id=v_report_ledger_id;

      update public.financial_daily_ledger_entries
      set metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object(
          'superseded',true,
          'superseded_reason','duplicate_of_transfer_followup',
          'superseded_by_ledger_id',s.id,
          'superseded_at',now(),
          'needs_review',false
        ),
        updated_at=now()
      where id=v_report_ledger_id;

      if v_claim_id is not null then
        update public.financial_expense_claims
        set approval_status='cancelled',
            metadata=coalesce(metadata,'{}'::jsonb)
              || jsonb_build_object(
                'superseded',true,
                'superseded_reason','duplicate_of_transfer_followup',
                'superseded_by_ledger_id',s.id,
                'superseded_at',now()
              ),
            updated_at=now()
        where id=v_claim_id
          and approval_status not in ('rejected','cancelled');
      end if;

      v_deduped:=v_deduped+1;
    end if;
  end loop;

  select
    coalesce(sum(
      case
        when le.entry_type='purchase'
          and le.direction='outflow'
          and le.payment_method='cash'
          and coalesce(le.metadata->>'funding','')='company_cash'
          and coalesce((le.metadata->>'superseded')::boolean,false)=false
        then le.amount else 0 end
    ),0),
    coalesce(sum(
      case
        when le.entry_type='expense'
          and le.direction='outflow'
          and le.payment_method='cash'
          and coalesce(le.metadata->>'funding','')='company_cash'
          and coalesce((le.metadata->>'superseded')::boolean,false)=false
        then le.amount else 0 end
    ),0)
  into v_purchase_cash,v_expense_cash
  from public.financial_daily_ledger_entries le
  where le.daily_close_id=p_daily_close_id;

  update public.financial_daily_closes
  set purchase_cash_outflow=v_purchase_cash,
      expense_cash_outflow=v_expense_cash,
      updated_at=now()
  where id=p_daily_close_id;

  return jsonb_build_object(
    'ok',true,
    'daily_close_id',p_daily_close_id,
    'deduped_count',v_deduped,
    'purchase_cash_outflow',v_purchase_cash,
    'expense_cash_outflow',v_expense_cash
  );
end;
$$;

revoke all on function public.financial_dedupe_transfer_followup_expenses_v1(uuid)
from public,anon,authenticated;
grant execute on function public.financial_dedupe_transfer_followup_expenses_v1(uuid)
to service_role;
