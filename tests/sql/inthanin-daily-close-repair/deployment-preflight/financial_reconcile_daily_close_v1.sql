CREATE OR REPLACE FUNCTION public.financial_reconcile_daily_close_v1(p_daily_close_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  e record;
  v_evidence_review integer := 0;
  v_ledger_review integer := 0;
  v_claim_review integer := 0;
  v_claim_outstanding numeric(14,2) := 0;
  v_cash_expected numeric(14,2) := null;
  v_cash_variance numeric(14,2) := null;
  v_pos_count integer := 0;
  v_pos_net numeric(14,2) := null;
  v_pos_conf numeric(5,4) := null;
  v_blockers jsonb := '[]'::jsonb;
  v_warnings jsonb := '[]'::jsonb;
  v_ready boolean := false;
begin
  select * into e
  from public.financial_daily_close_effective_v1
  where id=p_daily_close_id
  limit 1;

  if e.id is null then
    raise exception 'daily_close_not_found';
  end if;

  select
    count(*),
    (
      select case
        when coalesce(pe.extracted_data->>'pos_net_sales','') ~ '^\d+(\.\d+)?$'
        then (pe.extracted_data->>'pos_net_sales')::numeric
        else null
      end
      from public.financial_daily_close_evidence pe
      where pe.daily_close_id=e.id
        and pe.evidence_type='pos_close'
        and pe.extraction_status='extracted'
        and pe.extraction_confidence>=0.80
      order by pe.created_at desc
      limit 1
    ),
    (
      select pe.extraction_confidence
      from public.financial_daily_close_evidence pe
      where pe.daily_close_id=e.id
        and pe.evidence_type='pos_close'
        and pe.extraction_status='extracted'
        and pe.extraction_confidence>=0.80
      order by pe.created_at desc
      limit 1
    )
  into v_pos_count,v_pos_net,v_pos_conf
  from public.financial_daily_close_evidence ev
  where ev.daily_close_id=e.id
    and ev.evidence_type='pos_close'
    and ev.extraction_status='extracted'
    and ev.extraction_confidence>=0.80;

  if v_pos_count=0 then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','pos_evidence_missing',
      'message','ยังไม่มีรูปปิดยอด POS ที่อ่านได้ชัด'
    ));
  elsif v_pos_net is null then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','pos_sales_unreadable',
      'message','รูป POS อ่านยอดสุทธิไม่ได้'
    ));
  elsif abs(v_pos_net-e.net_sales)>0.01 then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','pos_sales_mismatch',
      'message','ยอดในรูป POS ไม่ตรงกับยอด Daily Close',
      'pos_net_sales',v_pos_net,
      'daily_close_net_sales',e.net_sales
    ));
  end if;

  select count(*) into v_evidence_review
  from public.financial_daily_close_evidence ev
  where ev.daily_close_id=e.id
    and ev.evidence_type in ('purchase_receipt','expense_receipt','transfer_slip','other')
    and (
      ev.extraction_status in ('pending','needs_review')
      or ev.match_status in ('unmatched','ambiguous')
    );

  select count(*) into v_ledger_review
  from public.financial_daily_ledger_entries le
  where le.daily_close_id=e.id
    and coalesce((le.metadata->>'superseded')::boolean,false)=false
    and coalesce((le.metadata->>'needs_review')::boolean,false)=true;

  select
    count(*) filter (where s.approval_status in ('draft','needs_review')),
    coalesce(sum(
      case
        when s.approval_status not in ('rejected','cancelled')
        then s.outstanding_amount
        else 0
      end
    ),0)::numeric(14,2)
  into v_claim_review,v_claim_outstanding
  from public.financial_expense_claim_summary s
  where s.branch_code=e.branch_code
    and s.environment=e.environment
    and s.origin_local_date=e.local_date;

  if abs(e.sales_payment_variance)>0.01 then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','sales_payment_variance',
      'message','ยอดรับเงินไม่ตรงกับยอดขายสุทธิ',
      'amount',e.sales_payment_variance
    ));
  end if;

  if v_evidence_review>0 then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','evidence_needs_review',
      'message','มีใบเสร็จ/สลิปที่ยังจับคู่หรืออ่านไม่จบ',
      'count',v_evidence_review
    ));
  end if;

  if v_ledger_review>0 then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','ledger_needs_review',
      'message','มีค่าใช้จ่ายที่ยังไม่รู้แหล่งเงินหรือยังต้องตรวจ',
      'count',v_ledger_review
    ));
  end if;

  if v_claim_review>0 then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','claim_needs_review',
      'message','มีรายการเบิกพนักงานที่ยังไม่ได้ตรวจ/อนุมัติ',
      'count',v_claim_review
    ));
  end if;

  if e.cash_opening_float is null then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','cash_opening_missing',
      'message','ยังไม่มีเงินสดตั้งต้น'
    ));
  end if;

  if e.cash_counted_closing is null then
    v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
      'code','cash_counted_closing_missing',
      'message','ยังไม่มีเงินสดนับจริงปลายวัน'
    ));
  end if;

  if e.cash_opening_float is not null and e.cash_counted_closing is not null then
    v_cash_expected:=(
      e.cash_opening_float
      + e.payment_cash
      - e.cash_drawer_outflow_amount
    )::numeric(14,2);

    v_cash_variance:=(e.cash_counted_closing-v_cash_expected)::numeric(14,2);

    if abs(v_cash_variance)>1.00 then
      v_blockers:=v_blockers || jsonb_build_array(jsonb_build_object(
        'code','cash_drawer_variance',
        'message','เงินสดนับจริงต่างจากเงินสดที่ควรเหลือเกิน 1 บาท',
        'amount',v_cash_variance,
        'expected',v_cash_expected,
        'counted',e.cash_counted_closing
      ));
    end if;
  end if;

  if e.cup_count is null then
    v_warnings:=v_warnings || jsonb_build_array(jsonb_build_object(
      'code','cup_count_missing',
      'message','ยังไม่มีจำนวนแก้ว'
    ));
  end if;

  if e.bill_count is null then
    v_warnings:=v_warnings || jsonb_build_array(jsonb_build_object(
      'code','bill_count_missing',
      'message','ยังไม่มีจำนวนบิล'
    ));
  end if;

  if e.refunds>0 then
    v_warnings:=v_warnings || jsonb_build_array(jsonb_build_object(
      'code','refund_payment_method_not_split',
      'message','มี Refund แต่ยังไม่ได้แยกช่องทางที่คืนเงิน'
    ));
  end if;

  if v_claim_outstanding>0 then
    v_warnings:=v_warnings || jsonb_build_array(jsonb_build_object(
      'code','approved_claims_outstanding',
      'message','มีรายการเบิกที่อนุมัติแล้วแต่ยังค้างจ่าย',
      'amount',v_claim_outstanding
    ));
  end if;

  v_ready:=jsonb_array_length(v_blockers)=0;

  return jsonb_build_object(
    'ok',true,
    'daily_close_id',e.id,
    'local_date',e.local_date,
    'environment',e.environment,
    'status',e.status,
    'ready_to_confirm',v_ready,
    'ready',v_ready,
    'blockers',v_blockers,
    'warnings',v_warnings,
    'net_sales',e.net_sales,
    'payments_total',e.payments_total,
    'sales_payment_variance',e.sales_payment_variance,
    'pos_net_sales',v_pos_net,
    'pos_confidence',v_pos_conf,
    'cash_opening_float',e.cash_opening_float,
    'payment_cash',e.payment_cash,
    'cash_drawer_outflow_amount',e.cash_drawer_outflow_amount,
    'cash_outflow_from_drawer',e.cash_drawer_outflow_amount,
    'cash_expected_closing',v_cash_expected,
    'cash_counted_closing',e.cash_counted_closing,
    'cash_drawer_variance',v_cash_variance,
    'cash_variance',v_cash_variance,
    'evidence_needs_review_count',v_evidence_review,
    'ledger_needs_review_count',v_ledger_review,
    'claim_needs_review_count',v_claim_review,
    'claim_outstanding_amount',v_claim_outstanding,
    'adjustment_count',e.adjustment_count
  );
end;
$function$
