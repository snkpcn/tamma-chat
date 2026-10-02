alter table public.financial_daily_close_adjustments
  add column if not exists batch_id uuid;

update public.financial_daily_close_adjustments
set batch_id=gen_random_uuid()
where batch_id is null;

alter table public.financial_daily_close_adjustments
  alter column batch_id set default gen_random_uuid(),
  alter column batch_id set not null;

create index if not exists financial_daily_adjustments_batch_idx
  on public.financial_daily_close_adjustments(daily_close_id,batch_id,created_at);

create or replace view public.financial_daily_close_effective_v1
with (security_invoker=true) as
 SELECT c.id,
    c.branch_id,
    b.code AS branch_code,
    b.name AS branch_name,
    b.business_unit_code,
    c.local_date,
    c.environment,
    c.status,
    ((c.gross_sales + COALESCE(a.gross_sales_delta, (0)::numeric)))::numeric(14,2) AS gross_sales,
    ((c.discounts + COALESCE(a.discounts_delta, (0)::numeric)))::numeric(14,2) AS discounts,
    ((c.refunds + COALESCE(a.refunds_delta, (0)::numeric)))::numeric(14,2) AS refunds,
    ((c.payment_cash + COALESCE(a.payment_cash_delta, (0)::numeric)))::numeric(14,2) AS payment_cash,
    ((c.payment_qr + COALESCE(a.payment_qr_delta, (0)::numeric)))::numeric(14,2) AS payment_qr,
    ((c.payment_card + COALESCE(a.payment_card_delta, (0)::numeric)))::numeric(14,2) AS payment_card,
    ((c.payment_delivery + COALESCE(a.payment_delivery_delta, (0)::numeric)))::numeric(14,2) AS payment_delivery,
    ((c.payment_other + COALESCE(a.payment_other_delta, (0)::numeric)))::numeric(14,2) AS payment_other,
    ((((c.gross_sales + COALESCE(a.gross_sales_delta, (0)::numeric)) - (c.discounts + COALESCE(a.discounts_delta, (0)::numeric))) - (c.refunds + COALESCE(a.refunds_delta, (0)::numeric))))::numeric(14,2) AS net_sales,
    ((((((c.payment_cash + COALESCE(a.payment_cash_delta, (0)::numeric)) + (c.payment_qr + COALESCE(a.payment_qr_delta, (0)::numeric))) + (c.payment_card + COALESCE(a.payment_card_delta, (0)::numeric))) + (c.payment_delivery + COALESCE(a.payment_delivery_delta, (0)::numeric))) + (c.payment_other + COALESCE(a.payment_other_delta, (0)::numeric))))::numeric(14,2) AS payments_total,
    (((((((c.payment_cash + COALESCE(a.payment_cash_delta, (0)::numeric)) + (c.payment_qr + COALESCE(a.payment_qr_delta, (0)::numeric))) + (c.payment_card + COALESCE(a.payment_card_delta, (0)::numeric))) + (c.payment_delivery + COALESCE(a.payment_delivery_delta, (0)::numeric))) + (c.payment_other + COALESCE(a.payment_other_delta, (0)::numeric))) - (((c.gross_sales + COALESCE(a.gross_sales_delta, (0)::numeric)) - (c.discounts + COALESCE(a.discounts_delta, (0)::numeric))) - (c.refunds + COALESCE(a.refunds_delta, (0)::numeric)))))::numeric(14,2) AS sales_payment_variance,
    ((c.purchase_cash_outflow + COALESCE(a.purchase_cash_outflow_delta, (0)::numeric)))::numeric(14,2) AS purchase_cash_outflow,
    ((c.expense_cash_outflow + COALESCE(a.expense_cash_outflow_delta, (0)::numeric)))::numeric(14,2) AS expense_cash_outflow,
    ((c.waste_reported_value + COALESCE(a.waste_reported_value_delta, (0)::numeric)))::numeric(14,2) AS waste_reported_value,
    (GREATEST((0)::numeric, (COALESCE(er.economic_expense_amount, (0)::numeric) + COALESCE(a.economic_expense_amount_delta, (0)::numeric))))::numeric(14,2) AS economic_expense_amount,
    (GREATEST((0)::numeric, (COALESCE(er.cash_outflow_amount, (0)::numeric) + COALESCE(a.ledger_cash_outflow_amount_delta, (0)::numeric))))::numeric(14,2) AS ledger_cash_outflow_amount,
    (GREATEST((0)::numeric, (COALESCE(cash.cash_drawer_outflow_amount, (0)::numeric) + COALESCE(a.cash_drawer_outflow_amount_delta, (0)::numeric))))::numeric(14,2) AS cash_drawer_outflow_amount,
        CASE
            WHEN ((c.cup_count IS NULL) AND (COALESCE(a.cup_count_delta, (0)::numeric) = (0)::numeric)) THEN NULL::integer
            ELSE (GREATEST((0)::numeric, ((COALESCE(c.cup_count, 0))::numeric + COALESCE(a.cup_count_delta, (0)::numeric))))::integer
        END AS cup_count,
        CASE
            WHEN ((c.bill_count IS NULL) AND (COALESCE(a.bill_count_delta, (0)::numeric) = (0)::numeric)) THEN NULL::integer
            ELSE (GREATEST((0)::numeric, ((COALESCE(c.bill_count, 0))::numeric + COALESCE(a.bill_count_delta, (0)::numeric))))::integer
        END AS bill_count,
    (
        CASE
            WHEN ((c.cash_opening_float IS NULL) AND (COALESCE(a.cash_opening_float_delta, (0)::numeric) = (0)::numeric)) THEN NULL::numeric
            ELSE GREATEST((0)::numeric, (COALESCE(c.cash_opening_float, (0)::numeric) + COALESCE(a.cash_opening_float_delta, (0)::numeric)))
        END)::numeric(14,2) AS cash_opening_float,
    (
        CASE
            WHEN ((c.cash_counted_closing IS NULL) AND (COALESCE(a.cash_counted_closing_delta, (0)::numeric) = (0)::numeric)) THEN NULL::numeric
            ELSE GREATEST((0)::numeric, (COALESCE(c.cash_counted_closing, (0)::numeric) + COALESCE(a.cash_counted_closing_delta, (0)::numeric)))
        END)::numeric(14,2) AS cash_counted_closing,
    c.staff_count,
    c.notes,
    c.operational_metrics,
    c.source,
    c.submitted_at,
    c.confirmed_at,
    c.confirmed_by_hash,
    c.revision,
    c.created_at,
    c.updated_at,
    c.gross_sales AS original_gross_sales,
    c.discounts AS original_discounts,
    c.refunds AS original_refunds,
    c.payment_cash AS original_payment_cash,
    c.payment_qr AS original_payment_qr,
    c.payment_card AS original_payment_card,
    c.payment_delivery AS original_payment_delivery,
    c.payment_other AS original_payment_other,
    c.purchase_cash_outflow AS original_purchase_cash_outflow,
    c.expense_cash_outflow AS original_expense_cash_outflow,
    c.waste_reported_value AS original_waste_reported_value,
    c.cup_count AS original_cup_count,
    c.bill_count AS original_bill_count,
    c.cash_opening_float AS original_cash_opening_float,
    c.cash_counted_closing AS original_cash_counted_closing,
    COALESCE(a.adjustment_count, 0) AS adjustment_count
   FROM ((((financial_daily_closes c
     JOIN operations_business_branches b ON ((b.id = c.branch_id)))
     LEFT JOIN financial_daily_expense_rollup er ON ((er.daily_close_id = c.id)))
     LEFT JOIN LATERAL ( SELECT (COALESCE(sum(le.amount), (0)::numeric))::numeric(14,2) AS cash_drawer_outflow_amount
           FROM financial_daily_ledger_entries le
          WHERE ((le.daily_close_id = c.id) AND (le.direction = 'outflow'::text) AND (le.payment_method = 'cash'::text) AND (COALESCE(((le.metadata ->> 'superseded'::text))::boolean, false) = false))) cash ON (true))
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'gross_sales'::text)), (0)::numeric) AS gross_sales_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'discounts'::text)), (0)::numeric) AS discounts_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'refunds'::text)), (0)::numeric) AS refunds_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'payment_cash'::text)), (0)::numeric) AS payment_cash_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'payment_qr'::text)), (0)::numeric) AS payment_qr_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'payment_card'::text)), (0)::numeric) AS payment_card_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'payment_delivery'::text)), (0)::numeric) AS payment_delivery_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'payment_other'::text)), (0)::numeric) AS payment_other_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'purchase_cash_outflow'::text)), (0)::numeric) AS purchase_cash_outflow_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'expense_cash_outflow'::text)), (0)::numeric) AS expense_cash_outflow_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'waste_reported_value'::text)), (0)::numeric) AS waste_reported_value_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'economic_expense_amount'::text)), (0)::numeric) AS economic_expense_amount_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'ledger_cash_outflow_amount'::text)), (0)::numeric) AS ledger_cash_outflow_amount_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'cash_drawer_outflow_amount'::text)), (0)::numeric) AS cash_drawer_outflow_amount_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'cup_count'::text)), (0)::numeric) AS cup_count_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'bill_count'::text)), (0)::numeric) AS bill_count_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'cash_opening_float'::text)), (0)::numeric) AS cash_opening_float_delta,
            COALESCE(sum(adj.amount_delta) FILTER (WHERE (adj.field_name = 'cash_counted_closing'::text)), (0)::numeric) AS cash_counted_closing_delta,
            (count(*))::integer AS adjustment_count
           FROM financial_daily_close_adjustments adj
          WHERE (adj.daily_close_id = c.id)) a ON (true));;

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


CREATE OR REPLACE FUNCTION public.financial_add_daily_close_adjustment_batch_v1(p_daily_close_id uuid, p_patch jsonb, p_reason text, p_created_by_hash text, p_source_channel text DEFAULT 'backoffice'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status text;
  v_batch uuid:=gen_random_uuid();
  kv record;
  v_new numeric;
  v_old numeric;
  v_delta numeric;
  v_changed integer:=0;
  v_recon jsonb;
  v_allowed text[]:=array[
    'gross_sales','discounts','refunds',
    'payment_cash','payment_qr','payment_card','payment_delivery','payment_other',
    'purchase_cash_outflow','expense_cash_outflow','waste_reported_value',
    'economic_expense_amount','ledger_cash_outflow_amount','cash_drawer_outflow_amount',
    'cup_count','bill_count','cash_opening_float','cash_counted_closing'
  ];
begin
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then
    raise exception 'adjustment_patch_required';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception 'adjustment_reason_required';
  end if;
  if p_source_channel not in ('line','backoffice','import','system') then
    raise exception 'invalid_adjustment_source_channel';
  end if;

  select status into v_status
  from public.financial_daily_closes
  where id=p_daily_close_id
  for update;

  if v_status is null then raise exception 'daily_close_not_found'; end if;
  if v_status<>'confirmed' then raise exception 'adjustments_require_confirmed_close'; end if;

  for kv in select key,value from jsonb_each(p_patch)
  loop
    if not (kv.key=any(v_allowed)) then
      raise exception 'unsupported_adjustment_field:%',kv.key;
    end if;

    begin
      v_new:=(kv.value #>> '{}')::numeric;
    exception when others then
      raise exception 'invalid_adjustment_value:%',kv.key;
    end;

    if v_new<0 then
      raise exception 'negative_adjustment_value:%',kv.key;
    end if;
    if kv.key in ('cup_count','bill_count') and v_new<>trunc(v_new) then
      raise exception 'integer_adjustment_required:%',kv.key;
    end if;

    select case kv.key
      when 'gross_sales' then e.gross_sales
      when 'discounts' then e.discounts
      when 'refunds' then e.refunds
      when 'payment_cash' then e.payment_cash
      when 'payment_qr' then e.payment_qr
      when 'payment_card' then e.payment_card
      when 'payment_delivery' then e.payment_delivery
      when 'payment_other' then e.payment_other
      when 'purchase_cash_outflow' then e.purchase_cash_outflow
      when 'expense_cash_outflow' then e.expense_cash_outflow
      when 'waste_reported_value' then e.waste_reported_value
      when 'economic_expense_amount' then e.economic_expense_amount
      when 'ledger_cash_outflow_amount' then e.ledger_cash_outflow_amount
      when 'cash_drawer_outflow_amount' then e.cash_drawer_outflow_amount
      when 'cup_count' then coalesce(e.cup_count,0)
      when 'bill_count' then coalesce(e.bill_count,0)
      when 'cash_opening_float' then coalesce(e.cash_opening_float,0)
      when 'cash_counted_closing' then coalesce(e.cash_counted_closing,0)
      else null
    end
    into v_old
    from public.financial_daily_close_effective_v1 e
    where e.id=p_daily_close_id;

    v_delta:=v_new-coalesce(v_old,0);

    if abs(v_delta)>0.0001 then
      insert into public.financial_daily_close_adjustments(
        daily_close_id,batch_id,adjustment_type,field_name,amount_delta,
        old_value,new_value,reason,created_by_hash,source_channel
      )
      values(
        p_daily_close_id,v_batch,'correction',kv.key,v_delta,
        to_jsonb(v_old),to_jsonb(v_new),trim(p_reason),
        nullif(trim(coalesce(p_created_by_hash,'')),''),
        p_source_channel
      );
      v_changed:=v_changed+1;
    end if;
  end loop;

  if v_changed=0 then
    return jsonb_build_object(
      'ok',true,'changed',false,'batch_id',v_batch,'adjustment_count',0
    );
  end if;

  v_recon:=public.financial_reconcile_daily_close_v1(p_daily_close_id);

  if abs(coalesce((v_recon->>'sales_payment_variance')::numeric,0))>0.01 then
    raise exception 'adjustment_breaks_sales_payment_reconciliation';
  end if;

  if (v_recon->>'cash_drawer_variance') is not null
     and abs((v_recon->>'cash_drawer_variance')::numeric)>1.00 then
    raise exception 'adjustment_breaks_cash_reconciliation';
  end if;

  return jsonb_build_object(
    'ok',true,
    'changed',true,
    'batch_id',v_batch,
    'adjustment_count',v_changed,
    'reconciliation',v_recon
  );
end;
$function$


revoke all on function public.financial_reconcile_daily_close_v1(uuid) from public;
revoke all on function public.financial_reconcile_daily_close_v1(uuid) from anon;
revoke all on function public.financial_reconcile_daily_close_v1(uuid) from authenticated;
grant execute on function public.financial_reconcile_daily_close_v1(uuid) to service_role;

revoke all on function public.financial_add_daily_close_adjustment_batch_v1(uuid,jsonb,text,text,text) from public;
revoke all on function public.financial_add_daily_close_adjustment_batch_v1(uuid,jsonb,text,text,text) from anon;
revoke all on function public.financial_add_daily_close_adjustment_batch_v1(uuid,jsonb,text,text,text) from authenticated;
grant execute on function public.financial_add_daily_close_adjustment_batch_v1(uuid,jsonb,text,text,text) to service_role;

create or replace view public.financial_daily_close_owner_v1
with (security_invoker=true) as
 SELECT e.id,
    e.local_date,
    e.environment,
    e.status,
    e.branch_code,
    e.branch_name,
    e.business_unit_code,
    e.gross_sales,
    e.discounts,
    e.refunds,
    e.net_sales,
    e.payment_cash,
    e.payment_qr,
    e.payment_card,
    e.payment_delivery,
    e.payment_other,
    e.payments_total,
    e.sales_payment_variance,
    e.purchase_cash_outflow,
    e.expense_cash_outflow,
    e.waste_reported_value,
    e.staff_count,
    e.source,
    e.submitted_at,
    e.confirmed_at,
    e.created_at,
    e.updated_at,
    e.economic_expense_amount,
    e.ledger_cash_outflow_amount,
    (COALESCE(er.settlement_outflow_amount, (0)::numeric))::numeric(14,2) AS settlement_outflow_amount,
    COALESCE(ev.evidence_count, 0) AS evidence_count,
    COALESCE(ev.evidence_needs_review_count, 0) AS evidence_needs_review_count,
    COALESCE(cl.claim_count, 0) AS claim_count,
    COALESCE(cl.claim_needs_review_count, 0) AS claim_needs_review_count,
    (COALESCE(cl.claim_outstanding_amount, (0)::numeric))::numeric(14,2) AS claim_outstanding_amount,
    e.adjustment_count,
    e.cup_count,
    e.bill_count,
    e.cash_opening_float,
    e.cash_counted_closing,
    e.operational_metrics,
    e.cash_drawer_outflow_amount,
        CASE
            WHEN ((e.cash_opening_float IS NULL) OR (e.cash_counted_closing IS NULL)) THEN NULL::numeric
            ELSE (((e.cash_opening_float + e.payment_cash) - e.cash_drawer_outflow_amount))::numeric(14,2)
        END AS cash_expected_closing,
        CASE
            WHEN ((e.cash_opening_float IS NULL) OR (e.cash_counted_closing IS NULL)) THEN NULL::numeric
            ELSE ((e.cash_counted_closing - ((e.cash_opening_float + e.payment_cash) - e.cash_drawer_outflow_amount)))::numeric(14,2)
        END AS cash_drawer_variance,
    e.original_gross_sales,
    e.original_discounts,
    e.original_refunds,
    e.original_payment_cash,
    e.original_payment_qr,
    e.original_payment_card,
    e.original_payment_delivery,
    e.original_payment_other,
    e.original_purchase_cash_outflow,
    e.original_expense_cash_outflow,
    e.original_waste_reported_value,
    e.original_cup_count,
    e.original_bill_count,
    e.original_cash_opening_float,
    e.original_cash_counted_closing
   FROM (((financial_daily_close_effective_v1 e
     LEFT JOIN financial_daily_expense_rollup er ON ((er.daily_close_id = e.id)))
     LEFT JOIN LATERAL ( SELECT (count(*))::integer AS evidence_count,
            (count(*) FILTER (WHERE ((ev_1.extraction_status = ANY (ARRAY['pending'::text, 'needs_review'::text])) OR (ev_1.match_status = ANY (ARRAY['unmatched'::text, 'ambiguous'::text])))))::integer AS evidence_needs_review_count
           FROM financial_daily_close_evidence ev_1
          WHERE (ev_1.daily_close_id = e.id)) ev ON (true))
     LEFT JOIN LATERAL ( SELECT (count(*) FILTER (WHERE (s.approval_status <> ALL (ARRAY['rejected'::text, 'cancelled'::text]))))::integer AS claim_count,
            (count(*) FILTER (WHERE (s.approval_status = ANY (ARRAY['draft'::text, 'needs_review'::text]))))::integer AS claim_needs_review_count,
            (COALESCE(sum(
                CASE
                    WHEN (s.approval_status <> ALL (ARRAY['rejected'::text, 'cancelled'::text])) THEN s.outstanding_amount
                    ELSE (0)::numeric
                END), (0)::numeric))::numeric(14,2) AS claim_outstanding_amount
           FROM financial_expense_claim_summary s
          WHERE ((s.origin_local_date = e.local_date) AND (s.environment = e.environment) AND (s.branch_code = e.branch_code))) cl ON (true));;
