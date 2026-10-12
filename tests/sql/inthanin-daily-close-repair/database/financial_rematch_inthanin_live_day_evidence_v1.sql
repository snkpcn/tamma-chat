CREATE OR REPLACE FUNCTION public.financial_rematch_inthanin_live_day_evidence_v1(p_daily_close_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch_id uuid;
  v_local_date date;
  v_environment text;
  ev record;
  v_amount numeric(14,2);
  v_effective_date date;
  v_candidate_count integer;
  v_ledger_id uuid;
  v_claim_id uuid;
  v_vendor_id uuid;
  v_vendor_label text;
  v_settlement_id uuid;
  v_existing_settlement record;
  v_matched integer := 0;
  v_ambiguous integer := 0;
begin
  select c.branch_id,c.local_date,c.environment
  into v_branch_id,v_local_date,v_environment
  from public.financial_daily_closes c
  join public.operations_business_branches b on b.id=c.branch_id
  where c.id=p_daily_close_id
    and b.code='inthanin_tadtone'
  limit 1;

  if v_branch_id is null then
    raise exception 'inthanin_daily_close_not_found';
  end if;
  if v_environment<>'live' then
    raise exception 'rematch_live_only';
  end if;

  for ev in
    select e.*
    from public.financial_daily_close_evidence e
    where e.daily_close_id=p_daily_close_id
      and e.match_status in ('unmatched','ambiguous')
      and e.extraction_status<>'rejected'
      and e.extraction_confidence>=0.80
      and e.evidence_type in ('purchase_receipt','expense_receipt','transfer_slip')
    -- Serialize repeated rematches of the same evidence; a waiter rechecks
    -- unmatched/ambiguous eligibility rather than overwriting a completed match.
    order by e.created_at ASC,e.id for update of e
  loop
    v_amount:=case
      when coalesce(ev.extracted_data->>'amount_total','') ~ '^\d+(\.\d+)?$'
      then (ev.extracted_data->>'amount_total')::numeric
      else null
    end;
    if v_amount is null then
      continue;
    end if;

    v_effective_date:=case
      when coalesce(ev.extracted_data->>'effective_date','') ~ '^\d{4}-\d{2}-\d{2}$'
      then (ev.extracted_data->>'effective_date')::date
      else v_local_date
    end;

    v_ledger_id:=null;
    v_claim_id:=null;
    v_vendor_id:=null;
    v_vendor_label:=null;
    v_candidate_count:=0;

    if ev.evidence_type in ('purchase_receipt','expense_receipt') then
      select count(*),min(le.id::text)::uuid
      into v_candidate_count,v_ledger_id
      from public.financial_daily_ledger_entries le
      join public.financial_daily_closes dc on dc.id=le.daily_close_id
      where dc.branch_id=v_branch_id
        and dc.environment='live'
        and dc.local_date=v_effective_date
        and le.accounting_role='economic_event'
        and le.entry_type in ('purchase','expense','vendor_payment')
        and abs(le.amount-v_amount)<0.01
        and coalesce((le.metadata->>'superseded')::boolean,false)=false
        and not exists (
          select 1
          from public.financial_daily_close_evidence other_ev
          where other_ev.id<>ev.id
            and other_ev.ledger_entry_id=le.id
            and other_ev.extraction_status<>'rejected'
        );

      if v_candidate_count=1 and v_ledger_id is not null then
        select le.expense_claim_id into v_claim_id
        from public.financial_daily_ledger_entries le
        where le.id=v_ledger_id;

        update public.financial_daily_close_evidence
        set ledger_entry_id=v_ledger_id,
            expense_claim_id=v_claim_id,
            match_status='matched_ledger',
            match_reason='rematched_exact_amount_unique_economic_event',
            extraction_status='extracted',
            matched_at=now()
        where id=ev.id;

        v_matched:=v_matched+1;
      elsif v_candidate_count>1 then
        update public.financial_daily_close_evidence
        set match_status='ambiguous',
            match_reason='multiple_exact_amount_expense_candidates_after_rematch'
        where id=ev.id;
        v_ambiguous:=v_ambiguous+1;
      end if;

    elsif ev.evidence_type='transfer_slip' then
      select count(*),min(le.id::text)::uuid,min(coalesce(le.description,le.category,le.entry_type))
      into v_candidate_count,v_vendor_id,v_vendor_label
      from public.financial_daily_ledger_entries le
      join public.financial_daily_closes dc on dc.id=le.daily_close_id
      where dc.branch_id=v_branch_id
        and dc.environment='live'
        and dc.local_date between (v_effective_date-7) and (v_effective_date+1)
        and le.entry_type='vendor_payment'
        and le.accounting_role='economic_event'
        and le.direction='outflow'
        and abs(le.amount-v_amount)<0.01
        and coalesce((le.metadata->>'superseded')::boolean,false)=false
        and not exists (
          select 1
          from public.financial_daily_close_evidence other_ev
          where other_ev.id<>ev.id
            and other_ev.ledger_entry_id=le.id
            and other_ev.evidence_type='transfer_slip'
            and other_ev.extraction_status<>'rejected'
        );

      select min(s.id::text)::uuid
      into v_claim_id
      from public.financial_expense_claim_summary s
      where s.branch_code='inthanin_tadtone'
        and s.environment='live'
        and s.claim_type='employee_reimbursement'
        and s.approval_status not in ('rejected','cancelled')
        and s.payment_status in ('unpaid','partially_paid')
        and abs(s.outstanding_amount-v_amount)<0.01
        and s.origin_local_date between (v_effective_date-31) and v_effective_date;

      select
        (
          select count(*)
          from public.financial_daily_ledger_entries le
          join public.financial_daily_closes dc on dc.id=le.daily_close_id
          where dc.branch_id=v_branch_id
            and dc.environment='live'
            and dc.local_date between (v_effective_date-7) and (v_effective_date+1)
            and le.entry_type='vendor_payment'
            and le.accounting_role='economic_event'
            and le.direction='outflow'
            and abs(le.amount-v_amount)<0.01
            and coalesce((le.metadata->>'superseded')::boolean,false)=false
            and not exists (
              select 1
              from public.financial_daily_close_evidence other_ev
              where other_ev.id<>ev.id
                and other_ev.ledger_entry_id=le.id
                and other_ev.evidence_type='transfer_slip'
                and other_ev.extraction_status<>'rejected'
            )
        )
        +
        (
          select count(*)
          from public.financial_expense_claim_summary s
          where s.branch_code='inthanin_tadtone'
            and s.environment='live'
            and s.claim_type='employee_reimbursement'
            and s.approval_status not in ('rejected','cancelled')
            and s.payment_status in ('unpaid','partially_paid')
            and abs(s.outstanding_amount-v_amount)<0.01
            and s.origin_local_date between (v_effective_date-31) and v_effective_date
        )
      into v_candidate_count;

      if v_candidate_count=1 and v_claim_id is not null then
      -- Serialize automatic settlements on the claim itself, then re-read the
      -- eligibility view after any lock wait (status, current origin and balance).
      perform 1 from public.financial_expense_claims c where c.id=v_claim_id for update;
      if not exists (
        select 1 from public.financial_expense_claim_summary s
        where s.id=v_claim_id and s.branch_code='inthanin_tadtone' and s.environment='live'
          and s.claim_type='employee_reimbursement'
          and s.approval_status not in ('rejected','cancelled')
          and s.payment_status in ('unpaid','partially_paid')
          and abs(s.outstanding_amount-v_amount)<0.01
          and s.origin_local_date between (v_effective_date-31) and v_effective_date
      ) then
        update public.financial_daily_close_evidence
        set ledger_entry_id=null,expense_claim_id=null,match_status='unmatched',
          extraction_status='needs_review',matched_at=null,
          match_reason='claim_changed_before_automatic_settlement'
        where id=ev.id;
      else
        insert into public.financial_daily_ledger_entries(
          daily_close_id,entry_type,category,accounting_role,amount,direction,payment_method,
          description,source_channel,source_message_id,source_item_key,expense_claim_id,metadata
        )
        values(
          p_daily_close_id,'reimbursement','staff','cash_settlement',v_amount,'outflow','qr',
          'Employee reimbursement rematched from transfer slip',
          'line',ev.source_message_id,'image_settlement',v_claim_id,
          jsonb_build_object('evidence_sha256',ev.image_sha256,'superseded',false)
        )
        on conflict (source_channel,source_message_id,source_item_key)
        where source_message_id is not null
        do nothing
        returning id into v_settlement_id;

        if v_settlement_id is null then
        select le.* into v_existing_settlement
        from public.financial_daily_ledger_entries le
        where le.source_channel='line'
          and le.source_message_id=ev.source_message_id
          and le.source_item_key='image_settlement'
        limit 1 for update of le;

        -- A globally unique source key is not proof that the existing payment
        -- belongs to this evidence/claim. Never relink a conflicting settlement.
        if v_existing_settlement.id is null
          or v_existing_settlement.daily_close_id is distinct from p_daily_close_id
          or v_existing_settlement.expense_claim_id is distinct from v_claim_id
          or v_existing_settlement.amount is distinct from v_amount
          or v_existing_settlement.accounting_role is distinct from 'cash_settlement'
          or v_existing_settlement.direction is distinct from 'outflow'
          or v_existing_settlement.entry_type is distinct from 'reimbursement'
          or v_existing_settlement.payment_method is distinct from 'qr'
          or coalesce((v_existing_settlement.metadata->>'superseded')::boolean,false)
        then
          update public.financial_daily_close_evidence
          set match_status='unmatched',extraction_status='needs_review',matched_at=null,
            match_reason='existing_settlement_scope_mismatch'
          where id=ev.id;
          continue;
        end if;
        v_settlement_id:=v_existing_settlement.id;
        end if;

        update public.financial_daily_close_evidence
        set ledger_entry_id=v_settlement_id,
            expense_claim_id=v_claim_id,
            match_status='matched_claim',
            match_reason='rematched_exact_amount_unique_employee_reimbursement',
            extraction_status='extracted',
            matched_at=now()
        where id=ev.id;

        v_matched:=v_matched+1;

      end if;
      elsif v_candidate_count=1 and v_vendor_id is not null then
        update public.financial_daily_close_evidence
        set ledger_entry_id=v_vendor_id,
            match_status='matched_ledger',
            match_reason='rematched_exact_amount_unique_vendor_payment',
            extraction_status='extracted',
            matched_at=now()
        where id=ev.id;

        v_matched:=v_matched+1;

      elsif v_candidate_count>1 then
        update public.financial_daily_close_evidence
        set match_status='ambiguous',
            match_reason='multiple_exact_amount_transfer_candidates_after_rematch'
        where id=ev.id;
        v_ambiguous:=v_ambiguous+1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'daily_close_id',p_daily_close_id,
    'matched_count',v_matched,
    'ambiguous_count',v_ambiguous
  );
end;
$function$;
