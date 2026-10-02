create or replace function public.financial_validate_cafe_test_daily_close_v1(
  p_daily_close_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  c record;
  blockers jsonb := '[]'::jsonb;
  warnings jsonb := '[]'::jsonb;
  pos_count integer := 0;
  pos_net numeric(14,2) := null;
  pos_conf numeric(5,4) := null;
  unresolved_evidence integer := 0;
  claim_review integer := 0;
  approved_unpaid integer := 0;
  cash_out numeric(14,2) := 0;
  cash_expected numeric(14,2) := null;
  cash_variance numeric(14,2) := null;
begin
  select dc.*,b.code as branch_code
  into c
  from public.financial_daily_closes dc
  join public.operations_business_branches b on b.id=dc.branch_id
  where dc.id=p_daily_close_id
    and b.code='inthanin_tadtone'
  limit 1;

  if c.id is null then raise exception 'inthanin_daily_close_not_found'; end if;
  if c.environment<>'test' then raise exception 'validation_test_only'; end if;

  if abs(c.sales_payment_variance)>0.009 then
    blockers:=blockers||jsonb_build_array(jsonb_build_object(
      'code','SALES_PAYMENT_VARIANCE',
      'message','ยอดรับเงินไม่ตรงกับยอดขาย',
      'value',c.sales_payment_variance
    ));
  end if;

  select count(*) into pos_count
  from public.financial_daily_close_evidence e
  where e.daily_close_id=c.id
    and e.evidence_type='pos_close'
    and e.extraction_status='extracted'
    and e.extraction_confidence>=0.80;

  if pos_count=0 then
    blockers:=blockers||jsonb_build_array(jsonb_build_object(
      'code','POS_EVIDENCE_MISSING',
      'message','ยังไม่มีรูปปิดยอด POS ที่อ่านได้ชัด'
    ));
  else
    select
      case
        when coalesce(e.extracted_data->>'pos_net_sales','') ~ '^\d+(\.\d+)?$'
          then (e.extracted_data->>'pos_net_sales')::numeric
        else null
      end,
      e.extraction_confidence
    into pos_net,pos_conf
    from public.financial_daily_close_evidence e
    where e.daily_close_id=c.id
      and e.evidence_type='pos_close'
      and e.extraction_status='extracted'
      and e.extraction_confidence>=0.80
    order by e.created_at desc
    limit 1;

    if pos_net is null then
      blockers:=blockers||jsonb_build_array(jsonb_build_object(
        'code','POS_SALES_UNREADABLE',
        'message','รูป POS อ่านยอดสุทธิไม่ได้'
      ));
    elsif abs(pos_net-c.net_sales)>0.009 then
      blockers:=blockers||jsonb_build_array(jsonb_build_object(
        'code','POS_SALES_MISMATCH',
        'message','ยอดในรูป POS ไม่ตรงกับยอดที่พิมพ์',
        'pos_net_sales',pos_net,
        'daily_close_net_sales',c.net_sales
      ));
    end if;
  end if;

  select count(*) into unresolved_evidence
  from public.financial_daily_close_evidence e
  where e.daily_close_id=c.id
    and e.evidence_type in ('purchase_receipt','expense_receipt','transfer_slip')
    and (
      e.extraction_status in ('pending','needs_review')
      or e.match_status in ('unmatched','ambiguous')
    );

  if unresolved_evidence>0 then
    blockers:=blockers||jsonb_build_array(jsonb_build_object(
      'code','FINANCIAL_EVIDENCE_NEEDS_REVIEW',
      'message','ยังมีใบเสร็จ/สลิปที่ต้องตรวจ',
      'count',unresolved_evidence
    ));
  end if;

  select
    count(*) filter (where s.approval_status in ('draft','needs_review')),
    count(*) filter (
      where s.approval_status='approved'
        and s.payment_status in ('unpaid','partially_paid')
    )
  into claim_review,approved_unpaid
  from public.financial_expense_claim_summary s
  where s.branch_code='inthanin_tadtone'
    and s.environment='test'
    and s.origin_local_date=c.local_date
    and s.approval_status not in ('rejected','cancelled');

  if claim_review>0 then
    blockers:=blockers||jsonb_build_array(jsonb_build_object(
      'code','EXPENSE_CLAIM_NEEDS_REVIEW',
      'message','ยังมีรายการเบิกพนักงานที่ต้องตรวจ',
      'count',claim_review
    ));
  end if;

  if approved_unpaid>0 then
    warnings:=warnings||jsonb_build_array(jsonb_build_object(
      'code','APPROVED_REIMBURSEMENT_OUTSTANDING',
      'message','มีรายการเบิกที่อนุมัติแล้วแต่ยังค้างจ่าย',
      'count',approved_unpaid
    ));
  end if;

  if c.payment_cash>0 then
    if c.cash_opening_float is null then
      blockers:=blockers||jsonb_build_array(jsonb_build_object(
        'code','CASH_OPENING_MISSING',
        'message','ยังไม่ได้ใส่เงินสดตั้งต้น'
      ));
    end if;
    if c.cash_counted_closing is null then
      blockers:=blockers||jsonb_build_array(jsonb_build_object(
        'code','CASH_CLOSING_MISSING',
        'message','ยังไม่ได้ใส่เงินสดนับจริงปลายวัน'
      ));
    end if;

    select coalesce(sum(le.amount),0)
    into cash_out
    from public.financial_daily_ledger_entries le
    where le.daily_close_id=c.id
      and le.direction='outflow'
      and le.payment_method='cash'
      and coalesce((le.metadata->>'superseded')::boolean,false)=false;

    if c.cash_opening_float is not null and c.cash_counted_closing is not null then
      cash_expected:=c.cash_opening_float+c.payment_cash-cash_out;
      cash_variance:=c.cash_counted_closing-cash_expected;
      if abs(cash_variance)>0.009 then
        blockers:=blockers||jsonb_build_array(jsonb_build_object(
          'code','CASH_DRAWER_VARIANCE',
          'message','เงินสดนับจริงไม่ตรงกับเงินสดที่ควรเหลือ',
          'expected',cash_expected,
          'counted',c.cash_counted_closing,
          'variance',cash_variance
        ));
      end if;
    end if;
  end if;

  if c.cup_count is null then
    warnings:=warnings||jsonb_build_array(jsonb_build_object(
      'code','CUP_COUNT_MISSING','message','ยังไม่ได้ใส่จำนวนแก้ว'
    ));
  end if;
  if c.bill_count is null then
    warnings:=warnings||jsonb_build_array(jsonb_build_object(
      'code','BILL_COUNT_MISSING','message','ยังไม่ได้ใส่จำนวนบิล'
    ));
  end if;

  return jsonb_build_object(
    'ok',true,
    'ready',jsonb_array_length(blockers)=0,
    'daily_close_id',c.id,
    'local_date',c.local_date,
    'net_sales',c.net_sales,
    'payments_total',c.payments_total,
    'sales_payment_variance',c.sales_payment_variance,
    'cash_outflow_from_drawer',cash_out,
    'cash_expected_closing',cash_expected,
    'cash_counted_closing',c.cash_counted_closing,
    'cash_variance',cash_variance,
    'pos_net_sales',pos_net,
    'pos_confidence',pos_conf,
    'blockers',blockers,
    'warnings',warnings
  );
end;
$$;

revoke all on function public.financial_validate_cafe_test_daily_close_v1(uuid) from public;
revoke all on function public.financial_validate_cafe_test_daily_close_v1(uuid) from anon;
revoke all on function public.financial_validate_cafe_test_daily_close_v1(uuid) from authenticated;
grant execute on function public.financial_validate_cafe_test_daily_close_v1(uuid) to service_role;

create or replace function public.financial_confirm_cafe_test_daily_close_v1(
  p_daily_close_id uuid,
  p_actor_hash text,
  p_source text default 'line'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  validation jsonb;
  c record;
begin
  validation:=public.financial_validate_cafe_test_daily_close_v1(p_daily_close_id);

  if not coalesce((validation->>'ready')::boolean,false) then
    return validation||jsonb_build_object('confirmed',false);
  end if;

  select dc.id,dc.status,dc.environment into c
  from public.financial_daily_closes dc
  where dc.id=p_daily_close_id
  limit 1;

  if c.environment<>'test' then raise exception 'confirmation_test_only'; end if;

  if c.status='confirmed' then
    return validation||jsonb_build_object('confirmed',true,'already_confirmed',true);
  end if;

  update public.financial_daily_closes
  set status='confirmed',
      confirmed_by_hash=nullif(trim(coalesce(p_actor_hash,'')),''),
      confirmed_at=now(),
      submitted_at=coalesce(submitted_at,now()),
      source=case when p_source in ('line','backoffice','import','system') then p_source else source end,
      updated_at=now()
  where id=p_daily_close_id;

  return validation||jsonb_build_object(
    'confirmed',true,
    'already_confirmed',false,
    'confirmed_at',now()
  );
end;
$$;

revoke all on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) from public;
revoke all on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) from anon;
revoke all on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) from authenticated;
grant execute on function public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text) to service_role;

create or replace function public.financial_add_cafe_test_adjustment_v1(
  p_daily_close_id uuid,
  p_field_name text,
  p_new_value numeric,
  p_reason text,
  p_actor_hash text,
  p_source text default 'backoffice'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  c record;
  current_value numeric;
  base_value numeric;
  prior_delta numeric;
  delta numeric;
  adjustment_id uuid;
begin
  if p_new_value<0 then raise exception 'adjustment_value_must_be_nonnegative'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'adjustment_reason_required'; end if;

  select dc.* into c
  from public.financial_daily_closes dc
  join public.operations_business_branches b on b.id=dc.branch_id
  where dc.id=p_daily_close_id
    and b.code='inthanin_tadtone'
  limit 1;

  if c.id is null then raise exception 'inthanin_daily_close_not_found'; end if;
  if c.environment<>'test' then raise exception 'adjustment_test_only'; end if;
  if c.status<>'confirmed' then raise exception 'adjustment_requires_confirmed_close'; end if;

  base_value:=case p_field_name
    when 'gross_sales' then c.gross_sales
    when 'discounts' then c.discounts
    when 'refunds' then c.refunds
    when 'payment_cash' then c.payment_cash
    when 'payment_qr' then c.payment_qr
    when 'payment_card' then c.payment_card
    when 'payment_delivery' then c.payment_delivery
    when 'payment_other' then c.payment_other
    when 'waste_reported_value' then c.waste_reported_value
    when 'staff_count' then coalesce(c.staff_count,0)
    when 'cup_count' then coalesce(c.cup_count,0)
    when 'bill_count' then coalesce(c.bill_count,0)
    when 'cash_opening_float' then coalesce(c.cash_opening_float,0)
    when 'cash_counted_closing' then coalesce(c.cash_counted_closing,0)
    when 'economic_expense_amount' then (
      select coalesce(r.economic_expense_amount,0)
      from public.financial_daily_expense_rollup r
      where r.daily_close_id=c.id
    )
    when 'ledger_cash_outflow_amount' then (
      select coalesce(r.cash_outflow_amount,0)
      from public.financial_daily_expense_rollup r
      where r.daily_close_id=c.id
    )
    else null
  end;

  if base_value is null then raise exception 'adjustment_field_not_allowed'; end if;

  select coalesce(sum(a.amount_delta),0)
  into prior_delta
  from public.financial_daily_close_adjustments a
  where a.daily_close_id=c.id
    and a.field_name=p_field_name;

  current_value:=base_value+prior_delta;
  delta:=p_new_value-current_value;

  if abs(delta)<0.0001 then
    return jsonb_build_object(
      'ok',true,'changed',false,'field_name',p_field_name,
      'old_value',current_value,'new_value',p_new_value,'amount_delta',0
    );
  end if;

  insert into public.financial_daily_close_adjustments(
    daily_close_id,adjustment_type,field_name,amount_delta,
    old_value,new_value,reason,created_by_hash,source_channel
  )
  values(
    c.id,'correction',p_field_name,delta,
    to_jsonb(current_value),to_jsonb(p_new_value),
    trim(p_reason),nullif(trim(coalesce(p_actor_hash,'')),''),
    case when p_source in ('line','backoffice','import','system') then p_source else 'backoffice' end
  )
  returning id into adjustment_id;

  return jsonb_build_object(
    'ok',true,'changed',true,'adjustment_id',adjustment_id,
    'field_name',p_field_name,'old_value',current_value,
    'new_value',p_new_value,'amount_delta',delta
  );
end;
$$;

revoke all on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) from public;
revoke all on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) from anon;
revoke all on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) from authenticated;
grant execute on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) to service_role;

create or replace view public.financial_daily_close_owner_v2
with (security_invoker=true) as
select
  c.id,c.local_date,c.environment,c.status,
  b.code as branch_code,b.name as branch_name,b.business_unit_code,

  (c.gross_sales+coalesce(adj.gross_sales,0))::numeric(14,2) as gross_sales,
  (c.discounts+coalesce(adj.discounts,0))::numeric(14,2) as discounts,
  (c.refunds+coalesce(adj.refunds,0))::numeric(14,2) as refunds,
  (
    c.gross_sales+coalesce(adj.gross_sales,0)
    -c.discounts-coalesce(adj.discounts,0)
    -c.refunds-coalesce(adj.refunds,0)
  )::numeric(14,2) as net_sales,

  (c.payment_cash+coalesce(adj.payment_cash,0))::numeric(14,2) as payment_cash,
  (c.payment_qr+coalesce(adj.payment_qr,0))::numeric(14,2) as payment_qr,
  (c.payment_card+coalesce(adj.payment_card,0))::numeric(14,2) as payment_card,
  (c.payment_delivery+coalesce(adj.payment_delivery,0))::numeric(14,2) as payment_delivery,
  (c.payment_other+coalesce(adj.payment_other,0))::numeric(14,2) as payment_other,
  (
    c.payment_cash+coalesce(adj.payment_cash,0)
    +c.payment_qr+coalesce(adj.payment_qr,0)
    +c.payment_card+coalesce(adj.payment_card,0)
    +c.payment_delivery+coalesce(adj.payment_delivery,0)
    +c.payment_other+coalesce(adj.payment_other,0)
  )::numeric(14,2) as payments_total,
  (
    c.payment_cash+coalesce(adj.payment_cash,0)
    +c.payment_qr+coalesce(adj.payment_qr,0)
    +c.payment_card+coalesce(adj.payment_card,0)
    +c.payment_delivery+coalesce(adj.payment_delivery,0)
    +c.payment_other+coalesce(adj.payment_other,0)
    -(
      c.gross_sales+coalesce(adj.gross_sales,0)
      -c.discounts-coalesce(adj.discounts,0)
      -c.refunds-coalesce(adj.refunds,0)
    )
  )::numeric(14,2) as sales_payment_variance,

  c.purchase_cash_outflow,
  c.expense_cash_outflow,
  (c.waste_reported_value+coalesce(adj.waste_reported_value,0))::numeric(14,2) as waste_reported_value,
  greatest(0,round(coalesce(c.staff_count,0)+coalesce(adj.staff_count,0)))::integer as staff_count,
  greatest(0,round(coalesce(c.cup_count,0)+coalesce(adj.cup_count,0)))::integer as cup_count,
  greatest(0,round(coalesce(c.bill_count,0)+coalesce(adj.bill_count,0)))::integer as bill_count,
  (coalesce(c.cash_opening_float,0)+coalesce(adj.cash_opening_float,0))::numeric(14,2) as cash_opening_float,
  (coalesce(c.cash_counted_closing,0)+coalesce(adj.cash_counted_closing,0))::numeric(14,2) as cash_counted_closing,
  c.operational_metrics,c.source,c.submitted_at,c.confirmed_at,c.created_at,c.updated_at,

  (coalesce(er.economic_expense_amount,0)+coalesce(adj.economic_expense_amount,0))::numeric(14,2) as economic_expense_amount,
  (coalesce(er.cash_outflow_amount,0)+coalesce(adj.ledger_cash_outflow_amount,0))::numeric(14,2) as ledger_cash_outflow_amount,
  coalesce(er.settlement_outflow_amount,0)::numeric(14,2) as settlement_outflow_amount,
  coalesce(ev.evidence_count,0)::integer as evidence_count,
  coalesce(ev.evidence_needs_review_count,0)::integer as evidence_needs_review_count,
  coalesce(cl.claim_count,0)::integer as claim_count,
  coalesce(cl.claim_needs_review_count,0)::integer as claim_needs_review_count,
  coalesce(cl.claim_outstanding_amount,0)::numeric(14,2) as claim_outstanding_amount,
  coalesce(adj.adjustment_count,0)::integer as adjustment_count
from public.financial_daily_closes c
join public.operations_business_branches b on b.id=c.branch_id
left join public.financial_daily_expense_rollup er on er.daily_close_id=c.id
left join lateral (
  select
    coalesce(sum(a.amount_delta) filter (where a.field_name='gross_sales'),0) as gross_sales,
    coalesce(sum(a.amount_delta) filter (where a.field_name='discounts'),0) as discounts,
    coalesce(sum(a.amount_delta) filter (where a.field_name='refunds'),0) as refunds,
    coalesce(sum(a.amount_delta) filter (where a.field_name='payment_cash'),0) as payment_cash,
    coalesce(sum(a.amount_delta) filter (where a.field_name='payment_qr'),0) as payment_qr,
    coalesce(sum(a.amount_delta) filter (where a.field_name='payment_card'),0) as payment_card,
    coalesce(sum(a.amount_delta) filter (where a.field_name='payment_delivery'),0) as payment_delivery,
    coalesce(sum(a.amount_delta) filter (where a.field_name='payment_other'),0) as payment_other,
    coalesce(sum(a.amount_delta) filter (where a.field_name='waste_reported_value'),0) as waste_reported_value,
    coalesce(sum(a.amount_delta) filter (where a.field_name='staff_count'),0) as staff_count,
    coalesce(sum(a.amount_delta) filter (where a.field_name='cup_count'),0) as cup_count,
    coalesce(sum(a.amount_delta) filter (where a.field_name='bill_count'),0) as bill_count,
    coalesce(sum(a.amount_delta) filter (where a.field_name='cash_opening_float'),0) as cash_opening_float,
    coalesce(sum(a.amount_delta) filter (where a.field_name='cash_counted_closing'),0) as cash_counted_closing,
    coalesce(sum(a.amount_delta) filter (where a.field_name='economic_expense_amount'),0) as economic_expense_amount,
    coalesce(sum(a.amount_delta) filter (where a.field_name='ledger_cash_outflow_amount'),0) as ledger_cash_outflow_amount,
    count(*)::integer as adjustment_count
  from public.financial_daily_close_adjustments a
  where a.daily_close_id=c.id
) adj on true
left join lateral (
  select
    count(*)::integer as evidence_count,
    count(*) filter (where e.extraction_status in ('pending','needs_review'))::integer as evidence_needs_review_count
  from public.financial_daily_close_evidence e
  where e.daily_close_id=c.id
) ev on true
left join lateral (
  select
    count(*) filter (where s.approval_status not in ('rejected','cancelled'))::integer as claim_count,
    count(*) filter (where s.approval_status in ('draft','needs_review'))::integer as claim_needs_review_count,
    coalesce(sum(
      case when s.approval_status not in ('rejected','cancelled') then s.outstanding_amount else 0 end
    ),0)::numeric(14,2) as claim_outstanding_amount
  from public.financial_expense_claim_summary s
  where s.origin_local_date=c.local_date
    and s.environment=c.environment
    and s.branch_code=b.code
) cl on true;

create or replace view public.financial_monthly_owner_v2
with (security_invoker=true) as
select
  branch_code,branch_name,business_unit_code,environment,
  date_trunc('month', local_date)::date as month_start,
  count(*)::integer as recorded_days,
  count(*) filter (where status='confirmed')::integer as confirmed_days,
  count(*) filter (where status in ('draft','pending_confirmation'))::integer as open_days,
  sum(gross_sales)::numeric(16,2) as gross_sales,
  sum(discounts)::numeric(16,2) as discounts,
  sum(refunds)::numeric(16,2) as refunds,
  sum(net_sales)::numeric(16,2) as net_sales,
  sum(payments_total)::numeric(16,2) as payments_total,
  sum(abs(sales_payment_variance))::numeric(16,2) as absolute_variance_total,
  sum(economic_expense_amount)::numeric(16,2) as economic_expense_amount,
  sum(ledger_cash_outflow_amount)::numeric(16,2) as ledger_cash_outflow_amount,
  sum(settlement_outflow_amount)::numeric(16,2) as settlement_outflow_amount,
  sum(purchase_cash_outflow)::numeric(16,2) as reported_purchase_cash_outflow,
  sum(expense_cash_outflow)::numeric(16,2) as reported_expense_cash_outflow,
  sum(waste_reported_value)::numeric(16,2) as waste_reported_value,
  sum(cup_count)::integer as cup_count,
  sum(bill_count)::integer as bill_count,
  case when sum(cup_count)>0 then round(sum(net_sales)/sum(cup_count),2) else null end as avg_revenue_per_cup,
  case when sum(bill_count)>0 then round(sum(net_sales)/sum(bill_count),2) else null end as avg_ticket,
  sum(evidence_count)::integer as evidence_count,
  sum(evidence_needs_review_count)::integer as evidence_needs_review_count,
  sum(claim_count)::integer as claim_count,
  sum(claim_needs_review_count)::integer as claim_needs_review_count,
  sum(claim_outstanding_amount)::numeric(16,2) as claim_outstanding_amount,
  sum(adjustment_count)::integer as adjustment_count
from public.financial_daily_close_owner_v2
group by branch_code,branch_name,business_unit_code,environment,date_trunc('month',local_date)::date;
