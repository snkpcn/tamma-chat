create or replace view public.financial_daily_expense_rollup as
select
  c.id as daily_close_id,
  c.local_date,
  c.environment,
  b.code as branch_code,
  coalesce(sum(
    case
      when le.accounting_role='economic_event'
        and le.entry_type in ('purchase','expense','reimbursement','vendor_payment')
        and coalesce((le.metadata->>'superseded')::boolean,false)=false
      then le.amount else 0
    end
  ),0)::numeric(14,2) as economic_expense_amount,
  coalesce(sum(
    case
      when le.direction='outflow'
        and coalesce((le.metadata->>'superseded')::boolean,false)=false
      then le.amount else 0
    end
  ),0)::numeric(14,2) as cash_outflow_amount,
  coalesce(sum(
    case
      when le.accounting_role='cash_settlement'
        and le.entry_type in ('reimbursement','cash_advance','vendor_payment')
        and coalesce((le.metadata->>'superseded')::boolean,false)=false
      then le.amount else 0
    end
  ),0)::numeric(14,2) as settlement_outflow_amount
from public.financial_daily_closes c
join public.operations_business_branches b on b.id=c.branch_id
left join public.financial_daily_ledger_entries le on le.daily_close_id=c.id
group by c.id,c.local_date,c.environment,b.code;

create or replace function public.financial_ingest_cafe_test_text_v1(
  p_message_id text,
  p_user_hash text,
  p_local_date date,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch_id uuid;
  v_close_id uuid;
  v_close_status text;
  v_marker_id uuid;
  v_prior_message_id text;
  exp jsonb;
  exp_index integer := 0;
  exp_amount numeric(14,2);
  exp_category text;
  exp_funding text;
  entry_kind text;
  v_claim_id uuid;
  purchase_outflow numeric(14,2) := 0;
  expense_outflow numeric(14,2) := 0;
  result_row jsonb;
begin
  if coalesce(trim(p_message_id),'') = '' then
    raise exception 'message_id_required';
  end if;

  select id into v_branch_id
  from public.operations_business_branches
  where code='inthanin_tadtone' and active=true
  limit 1;

  if v_branch_id is null then
    raise exception 'inthanin_branch_missing';
  end if;

  insert into public.financial_daily_closes(
    branch_id, local_date, environment, status, source
  )
  values(v_branch_id, p_local_date, 'test', 'draft', 'line')
  on conflict (branch_id, local_date, environment) do nothing;

  select c.id,c.status into v_close_id,v_close_status
  from public.financial_daily_closes c
  where c.branch_id=v_branch_id
    and c.local_date=p_local_date
    and c.environment='test'
  limit 1;

  if v_close_id is null then raise exception 'daily_close_not_available'; end if;
  if v_close_status='confirmed' then raise exception 'confirmed_daily_close_is_immutable'; end if;

  insert into public.financial_daily_ledger_entries(
    daily_close_id,entry_type,accounting_role,amount,direction,description,
    source_channel,source_message_id,source_item_key,metadata
  )
  values(
    v_close_id,'sales_summary','memo',
    coalesce((p_payload->>'reported_pos_net_sales')::numeric,0),
    'noncash','Inthanin LINE daily close report',
    'line',p_message_id,'daily_close_report',
    jsonb_build_object(
      'schema','inthanin-daily-close-text-v1',
      'raw_text_sha256',p_payload->>'raw_text_sha256',
      'payment_components',coalesce(p_payload->'payment_components','{}'::jsonb),
      'benefits',coalesce(p_payload->'benefits','{}'::jsonb),
      'warnings',coalesce(p_payload->'warnings','[]'::jsonb),
      'superseded',false
    )
  )
  on conflict do nothing
  returning id into v_marker_id;

  if v_marker_id is null then
    select jsonb_build_object('ok',true,'duplicate',true,'daily_close_id',e.daily_close_id)
    into result_row
    from public.financial_daily_ledger_entries e
    where e.source_channel='line'
      and e.source_message_id=p_message_id
      and e.source_item_key='daily_close_report'
    limit 1;
    return coalesce(result_row,jsonb_build_object('ok',true,'duplicate',true,'daily_close_id',v_close_id));
  end if;

  for v_prior_message_id in
    select distinct e.source_message_id
    from public.financial_daily_ledger_entries e
    where e.daily_close_id=v_close_id
      and e.source_channel='line'
      and e.source_item_key='daily_close_report'
      and e.source_message_id is not null
      and e.source_message_id<>p_message_id
      and coalesce((e.metadata->>'superseded')::boolean,false)=false
  loop
    update public.financial_daily_ledger_entries
    set metadata=coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'superseded',true,
        'superseded_by_message_id',p_message_id,
        'superseded_at',now()
      ),
      updated_at=now()
    where daily_close_id=v_close_id
      and source_channel='line'
      and source_message_id=v_prior_message_id
      and (source_item_key='daily_close_report' or source_item_key like 'expense:%');

    update public.financial_expense_claims
    set approval_status='cancelled',
        metadata=coalesce(metadata,'{}'::jsonb)
          || jsonb_build_object(
            'superseded',true,
            'superseded_by_message_id',p_message_id,
            'superseded_at',now()
          ),
        updated_at=now()
    where origin_daily_close_id=v_close_id
      and source_channel='line'
      and source_message_id like v_prior_message_id || ':expense:%'
      and approval_status not in ('rejected','cancelled');
  end loop;

  update public.financial_daily_closes
  set
    gross_sales=coalesce((p_payload->>'gross_sales')::numeric,0),
    discounts=coalesce((p_payload->>'discounts')::numeric,0),
    refunds=coalesce((p_payload->>'refunds')::numeric,0),
    payment_cash=coalesce((p_payload->>'payment_cash')::numeric,0),
    payment_qr=coalesce((p_payload->>'payment_qr')::numeric,0),
    payment_card=coalesce((p_payload->>'payment_card')::numeric,0),
    payment_delivery=coalesce((p_payload->>'payment_delivery')::numeric,0),
    payment_other=coalesce((p_payload->>'payment_other')::numeric,0),
    cup_count=nullif(p_payload->>'cup_count','')::integer,
    bill_count=nullif(p_payload->>'bill_count','')::integer,
    cash_opening_float=nullif(p_payload->>'cash_opening_float','')::numeric,
    cash_counted_closing=nullif(p_payload->>'cash_counted_closing','')::numeric,
    notes=nullif(trim(coalesce(p_payload->>'notes','')),''),
    submitted_by_hash=nullif(trim(coalesce(p_user_hash,'')),''),
    submitted_at=now(),
    revision=revision+1,
    operational_metrics=coalesce(operational_metrics,'{}'::jsonb)
      || jsonb_build_object(
        'payment_components',coalesce(p_payload->'payment_components','{}'::jsonb),
        'benefits',coalesce(p_payload->'benefits','{}'::jsonb),
        'text_report_warnings',coalesce(p_payload->'warnings','[]'::jsonb),
        'last_line_text_message_id',p_message_id,
        'last_line_text_received_at',now()
      ),
    updated_at=now()
  where id=v_close_id;

  for exp in select value from jsonb_array_elements(coalesce(p_payload->'expenses','[]'::jsonb))
  loop
    exp_index:=exp_index+1;
    exp_amount:=greatest(coalesce((exp->>'amount')::numeric,0),0);
    if exp_amount<=0 then continue; end if;

    exp_category:=case
      when exp->>'category' in (
        'ingredients','beverages','packaging','consumables','cleaning','maintenance',
        'utilities','transport','staff','equipment','marketing','fees','petty_cash','other'
      ) then exp->>'category' else 'other' end;

    exp_funding:=case
      when exp->>'funding' in ('company_cash','employee_fronted','owner_transfer','vendor_transfer','unknown')
      then exp->>'funding' else 'unknown' end;

    entry_kind:=case
      when exp_category in ('ingredients','beverages','packaging','consumables','equipment')
      then 'purchase' else 'expense' end;

    if exp_funding='employee_fronted' then
      insert into public.financial_expense_claims(
        origin_daily_close_id,claim_type,approval_status,expense_category,
        counterparty_type,counterparty_label,claimed_amount,description,
        expense_date,source_channel,source_message_id,created_by_hash,metadata
      ) values(
        v_close_id,'employee_reimbursement','needs_review',exp_category,
        'employee',nullif(trim(coalesce(exp->>'counterparty_label','')),''),
        exp_amount,nullif(trim(coalesce(exp->>'label','')),''),
        p_local_date,'line',p_message_id||':expense:'||exp_index::text,
        nullif(trim(coalesce(p_user_hash,'')),''),
        jsonb_build_object('funding','employee_fronted','source_report_message_id',p_message_id,'superseded',false)
      )
      returning id into v_claim_id;

      insert into public.financial_daily_ledger_entries(
        daily_close_id,entry_type,category,accounting_role,amount,direction,
        description,source_channel,source_message_id,source_item_key,expense_claim_id,metadata
      ) values(
        v_close_id,entry_kind,exp_category,'economic_event',exp_amount,'noncash',
        nullif(trim(coalesce(exp->>'label','')),''),
        'line',p_message_id,'expense:'||exp_index::text,v_claim_id,
        jsonb_build_object('funding',exp_funding,'needs_review',true,'superseded',false)
      );
    else
      insert into public.financial_daily_ledger_entries(
        daily_close_id,entry_type,category,accounting_role,amount,direction,payment_method,
        description,source_channel,source_message_id,source_item_key,metadata
      ) values(
        v_close_id,
        case when exp_funding in ('owner_transfer','vendor_transfer') then 'vendor_payment' else entry_kind end,
        exp_category,'economic_event',exp_amount,
        case when exp_funding in ('company_cash','owner_transfer','vendor_transfer') then 'outflow' else 'noncash' end,
        case when exp_funding='company_cash' then 'cash'
             when exp_funding in ('owner_transfer','vendor_transfer') then 'qr'
             else null end,
        nullif(trim(coalesce(exp->>'label','')),''),
        'line',p_message_id,'expense:'||exp_index::text,
        jsonb_build_object('funding',exp_funding,'needs_review',(exp_funding='unknown'),'superseded',false)
      );

      if exp_funding in ('company_cash','owner_transfer','vendor_transfer') then
        if entry_kind='purchase' then purchase_outflow:=purchase_outflow+exp_amount;
        else expense_outflow:=expense_outflow+exp_amount;
        end if;
      end if;
    end if;
  end loop;

  update public.financial_daily_closes
  set purchase_cash_outflow=purchase_outflow,
      expense_cash_outflow=expense_outflow,
      updated_at=now()
  where id=v_close_id;

  select jsonb_build_object(
    'ok',true,'duplicate',false,'daily_close_id',c.id,'local_date',c.local_date,
    'gross_sales',c.gross_sales,'discounts',c.discounts,'refunds',c.refunds,
    'net_sales',c.net_sales,'payments_total',c.payments_total,
    'sales_payment_variance',c.sales_payment_variance,
    'payment_cash',c.payment_cash,'payment_qr',c.payment_qr,
    'payment_card',c.payment_card,'payment_other',c.payment_other,
    'purchase_cash_outflow',c.purchase_cash_outflow,
    'expense_cash_outflow',c.expense_cash_outflow,
    'cup_count',c.cup_count,'bill_count',c.bill_count,
    'cash_opening_float',c.cash_opening_float,
    'cash_counted_closing',c.cash_counted_closing,
    'status',c.status,'revision',c.revision
  )
  into result_row
  from public.financial_daily_closes c where c.id=v_close_id;

  return result_row;
end;
$$;

revoke all on function public.financial_ingest_cafe_test_text_v1(text,text,date,jsonb) from public;
revoke all on function public.financial_ingest_cafe_test_text_v1(text,text,date,jsonb) from anon;
revoke all on function public.financial_ingest_cafe_test_text_v1(text,text,date,jsonb) from authenticated;
grant execute on function public.financial_ingest_cafe_test_text_v1(text,text,date,jsonb) to service_role;

create or replace view public.financial_daily_close_owner_v1
with (security_invoker=true) as
select
  c.id,c.local_date,c.environment,c.status,
  b.code as branch_code,b.name as branch_name,b.business_unit_code,
  c.gross_sales,c.discounts,c.refunds,c.net_sales,
  c.payment_cash,c.payment_qr,c.payment_card,c.payment_delivery,c.payment_other,
  c.payments_total,c.sales_payment_variance,
  c.purchase_cash_outflow,c.expense_cash_outflow,c.waste_reported_value,c.staff_count,
  c.source,c.submitted_at,c.confirmed_at,c.created_at,c.updated_at,
  coalesce(er.economic_expense_amount,0)::numeric(14,2) as economic_expense_amount,
  coalesce(er.cash_outflow_amount,0)::numeric(14,2) as ledger_cash_outflow_amount,
  coalesce(er.settlement_outflow_amount,0)::numeric(14,2) as settlement_outflow_amount,
  coalesce(ev.evidence_count,0)::integer as evidence_count,
  coalesce(ev.evidence_needs_review_count,0)::integer as evidence_needs_review_count,
  coalesce(cl.claim_count,0)::integer as claim_count,
  coalesce(cl.claim_needs_review_count,0)::integer as claim_needs_review_count,
  coalesce(cl.claim_outstanding_amount,0)::numeric(14,2) as claim_outstanding_amount,
  coalesce(ad.adjustment_count,0)::integer as adjustment_count,
  c.cup_count,c.bill_count,c.cash_opening_float,c.cash_counted_closing,c.operational_metrics
from public.financial_daily_closes c
join public.operations_business_branches b on b.id=c.branch_id
left join public.financial_daily_expense_rollup er on er.daily_close_id=c.id
left join lateral (
  select count(*)::integer as evidence_count,
         count(*) filter (where e.extraction_status in ('pending','needs_review'))::integer as evidence_needs_review_count
  from public.financial_daily_close_evidence e where e.daily_close_id=c.id
) ev on true
left join lateral (
  select
    count(*) filter (where s.approval_status not in ('rejected','cancelled'))::integer as claim_count,
    count(*) filter (
      where s.approval_status not in ('rejected','cancelled')
        and (
          s.approval_status in ('draft','needs_review')
          or s.payment_status in ('unpaid','partially_paid')
        )
    )::integer as claim_needs_review_count,
    coalesce(sum(
      case when s.approval_status not in ('rejected','cancelled') then s.outstanding_amount else 0 end
    ),0)::numeric(14,2) as claim_outstanding_amount
  from public.financial_expense_claim_summary s
  where s.origin_local_date=c.local_date and s.environment=c.environment and s.branch_code=b.code
) cl on true
left join lateral (
  select count(*)::integer as adjustment_count
  from public.financial_daily_close_adjustments a where a.daily_close_id=c.id
) ad on true;
