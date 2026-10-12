-- LOCAL REVIEW PROPOSAL. Not applied. No data backfill or confirmation activation.
-- Replaces five existing functions and adds one service-only atomic draft saver.
-- The installed LINE confirmation wrapper is reused, not replaced.
begin;
-- LOCAL PROPOSAL: requires independent review and real PostgreSQL concurrency tests.
-- No data backfill. Replaces only existing trigger functions; retains ACL/security modes.
-- New semantics limited to live inthanin_tadtone parent rows.
CREATE OR REPLACE FUNCTION public.financial_guard_daily_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  expected_branches integer;
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then
      raise exception 'confirmed daily close is immutable; use an adjustment';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' then
    raise exception 'confirmed daily close is immutable; use an adjustment';
  end if;

  if new.status = 'confirmed' and new.confirmed_at is null then
    new.confirmed_at = now();
  end if;

  -- RLS must not hide branch scope and make a financial parent edit skip its
  -- revision. Check both identities before applying the scoped semantics.
  if old.environment='live' or new.environment='live' then
    select count(distinct x) into expected_branches from unnest(array[old.branch_id,new.branch_id]) x where x is not null;
    if (select count(*) from public.operations_business_branches where id=any(array[old.branch_id,new.branch_id]))<>expected_branches then
      raise exception 'daily_close_branch_unavailable';
    end if;
  end if;
  -- Generated columns are not available in BEFORE UPDATE NEW; compare their
  -- source fields instead, so no-op writes cannot create spurious revisions.
  -- Scope new revision semantics to this live branch only.
  if new.environment='live' and exists (
    select 1 from public.operations_business_branches b
    where b.id=new.branch_id and b.code='inthanin_tadtone'
  ) then
    if (to_jsonb(new)-array['updated_at','revision','net_sales','payments_total','sales_payment_variance']) is distinct from
       (to_jsonb(old)-array['updated_at','revision','net_sales','payments_total','sales_payment_variance']) then
      new.revision := greatest(old.revision+1,coalesce(new.revision,old.revision));
    elsif new.revision is null or new.revision < old.revision then
      new.revision := old.revision;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.financial_guard_close_child_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  close_status text;
  close_id uuid;
  affected_id uuid;
  affected_ids uuid[];
  direct_ids uuid[];
  claim_ids uuid[];
  claim_row record;
  expected_claims integer;
  locked_claims integer := 0;
  expected_parents integer;
  locked_parents integer := 0;
begin
  -- Moving a child must never remove it from an immutable old direct parent.
  if tg_op='UPDATE' and exists (
    select 1 from public.financial_daily_closes where id=old.daily_close_id and status='confirmed'
  ) then
    raise exception 'confirmed daily close children are immutable; use an adjustment';
  end if;
  close_id := case when tg_op = 'DELETE' then old.daily_close_id else new.daily_close_id end;

  select status into close_status
  from public.financial_daily_closes
  where id = close_id;

  if close_status = 'confirmed' then
    raise exception 'confirmed daily close children are immutable; use an adjustment';
  end if;

  if tg_op='UPDATE' then
    affected_ids:=array[old.daily_close_id,new.daily_close_id];
  elsif tg_op='DELETE' then affected_ids:=array[old.daily_close_id];
  else affected_ids:=array[new.daily_close_id]; end if;

  direct_ids:=affected_ids;
  -- Settlement/evidence can reference a claim from an earlier close. Lock claim
  -- identities before resolving origins, so concurrent reparenting cannot escape.
  if tg_op='UPDATE' then
    claim_ids:=array[(to_jsonb(old)->>'expense_claim_id')::uuid,(to_jsonb(new)->>'expense_claim_id')::uuid];
  elsif tg_op='DELETE' then claim_ids:=array[(to_jsonb(old)->>'expense_claim_id')::uuid];
  else claim_ids:=array[(to_jsonb(new)->>'expense_claim_id')::uuid]; end if;
  select count(distinct x) into expected_claims from unnest(claim_ids) x where x is not null;
  if expected_claims>0 then
  for claim_row in select c.id,c.origin_daily_close_id from public.financial_expense_claims c
    where c.id=any(claim_ids) order by c.id for share of c
  loop
    locked_claims:=locked_claims+1;
    affected_ids:=array_append(affected_ids,claim_row.origin_daily_close_id);
  end loop;
  if locked_claims<>expected_claims then raise exception 'linked_expense_claim_lock_unavailable'; end if;
  end if;

  -- Invoker triggers must fail closed when RLS hides a dependency or prevents
  -- a required lock. A successful child write must never silently skip revision.
  select count(distinct x) into expected_parents from unnest(affected_ids) x where x is not null;
  if (select count(*) from public.financial_daily_closes d join public.operations_business_branches b on b.id=d.branch_id where d.id=any(affected_ids))<>expected_parents then
    raise exception 'daily_close_parent_unavailable';
  end if;
  select count(*) into expected_parents from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone';
  -- Lock old/new direct parents and linked claim origins in stable order.
  for affected_id in
    select d.id from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone'
    order by d.id for update of d
  loop
    locked_parents:=locked_parents+1;
    select status into close_status from public.financial_daily_closes where id=affected_id;
    if close_status='confirmed' and affected_id=any(direct_ids) then
      raise exception 'confirmed daily close children are immutable; use an adjustment';
    end if;
    if close_status<>'confirmed' and (tg_op<>'UPDATE' or (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')) then
      update public.financial_daily_closes set revision=revision+1 where id=affected_id;
    end if;
  end loop;

  if locked_parents<>expected_parents then raise exception 'daily_close_parent_lock_unavailable'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.financial_guard_expense_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  close_status text;
  settled_count integer := 0;
  affected_id uuid;
  affected_ids uuid[];
  expected_parents integer;
  locked_parents integer := 0;
begin
  if tg_op='UPDATE' then affected_ids:=array[old.origin_daily_close_id,new.origin_daily_close_id];
  elsif tg_op='DELETE' then affected_ids:=array[old.origin_daily_close_id];
  else affected_ids:=array[new.origin_daily_close_id]; end if;
  -- Invoker triggers must fail closed when RLS hides a dependency or prevents
  -- a required lock. A successful child write must never silently skip revision.
  select count(distinct x) into expected_parents from unnest(affected_ids) x where x is not null;
  if (select count(*) from public.financial_daily_closes d join public.operations_business_branches b on b.id=d.branch_id where d.id=any(affected_ids))<>expected_parents then
    raise exception 'daily_close_parent_unavailable';
  end if;
  select count(*) into expected_parents from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone';
  for affected_id in
    select d.id from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone'
    order by d.id for update of d
  loop
    locked_parents:=locked_parents+1;
    select status into close_status from public.financial_daily_closes where id=affected_id;
    if close_status='confirmed' then
      raise exception 'expense claim belongs to a confirmed close and is immutable';
    end if;
  end loop;
  if locked_parents<>expected_parents then raise exception 'daily_close_parent_lock_unavailable'; end if;
  if tg_op = 'DELETE' then
    select status into close_status
    from public.financial_daily_closes
    where id = old.origin_daily_close_id;

    if close_status = 'confirmed' then
      raise exception 'expense claim belongs to a confirmed close and is immutable';
    end if;
    update public.financial_daily_closes d set revision=d.revision+1
    from public.operations_business_branches b
    where b.id=d.branch_id and b.code='inthanin_tadtone' and d.environment='live'
      and d.id=any(affected_ids);
    return old;
  end if;

  select status into close_status
  from public.financial_daily_closes
  where id = new.origin_daily_close_id;

  if tg_op = 'INSERT' then
    if close_status = 'confirmed' then
      raise exception 'cannot add expense claim directly to a confirmed close; use adjustment workflow';
    end if;
    update public.financial_daily_closes d set revision=d.revision+1
    from public.operations_business_branches b
    where b.id=d.branch_id and b.code='inthanin_tadtone' and d.environment='live'
      and d.id=any(affected_ids);
    return new;
  end if;

  if close_status = 'confirmed' then
    raise exception 'expense claim belongs to a confirmed close and is immutable';
  end if;

  if new.approval_status = 'cancelled' and old.approval_status <> 'cancelled' then
    -- A filtered ledger count cannot establish that a claim has no settlement.
    -- Keep invoker privileges: restricted direct writers must fail closed rather
    -- than cancel against an incomplete RLS view. Service/definer application
    -- writers retain their existing complete-ledger visibility and behavior.
    if expected_parents>0 and pg_catalog.row_security_active('public.financial_daily_ledger_entries'::regclass) then
      raise exception 'complete_settlement_visibility_required';
    end if;
    select count(*) into settled_count
    from public.financial_daily_ledger_entries le
    where le.expense_claim_id=old.id
      and le.accounting_role='cash_settlement'
      and le.direction='outflow'
      and coalesce((le.metadata->>'superseded')::boolean,false)=false;

    if settled_count > 0 then
      new.approval_status := 'needs_review';
      new.metadata := coalesce(new.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'cancel_blocked_due_cash_settlement',true,
          'cancel_blocked_at',now()
        );
    end if;
  end if;

  if new.approval_status = 'approved' then
    if new.approved_amount is null then
      new.approved_amount = new.claimed_amount;
    end if;
    if new.approved_at is null then
      new.approved_at = now();
    end if;
  end if;

  if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    update public.financial_daily_closes d set revision=d.revision+1
    from public.operations_business_branches b
    where b.id=d.branch_id and b.code='inthanin_tadtone' and d.environment='live'
      and d.id=any(affected_ids);
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.financial_attach_inthanin_live_evidence_v1(p_message_id text, p_user_hash text, p_received_local_date date, p_image_sha256 text, p_storage_bucket text, p_storage_path text, p_mime_type text, p_extraction jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_branch_id uuid;
  v_close_id uuid;
  v_existing record;
  v_evidence_id uuid;
  v_document_type text;
  v_evidence_type text;
  v_amount numeric(14,2);
  v_confidence numeric(5,4);
  v_match_status text := 'unmatched';
  v_match_reason text := null;
  v_ledger_id uuid := null;
  v_claim_id uuid := null;
  v_candidate_count integer := 0;
  v_candidate_ledger uuid := null;
  v_candidate_claim uuid := null;
  v_candidate_label text := null;
  v_effective_date date;
  v_received_date date;
  v_attach_date date;
  v_settlement_id uuid := null;
begin
  if coalesce(trim(p_message_id),'')='' then
    raise exception 'message_id_required';
  end if;
  if coalesce(trim(p_image_sha256),'')='' then
    raise exception 'image_sha256_required';
  end if;
  if p_storage_bucket <> 'financial-evidence' then
    raise exception 'invalid_financial_evidence_bucket';
  end if;

  select e.id,e.daily_close_id,e.match_status,e.evidence_type,e.expense_claim_id,e.ledger_entry_id
  into v_existing
  from public.financial_daily_close_evidence e
  where e.source_channel='line'
    and (e.source_message_id=p_message_id or e.image_sha256=p_image_sha256)
  order by e.created_at ASC
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'evidence_id',v_existing.id,
      'daily_close_id',v_existing.daily_close_id,
      'match_status',v_existing.match_status,
      'evidence_type',v_existing.evidence_type,
      'expense_claim_id',v_existing.expense_claim_id,
      'ledger_entry_id',v_existing.ledger_entry_id
    );
  end if;

  select id into v_branch_id
  from public.operations_business_branches
  where code='inthanin_tadtone' and active=true
  limit 1;

  if v_branch_id is null then
    raise exception 'inthanin_branch_missing';
  end if;

  v_document_type := coalesce(nullif(p_extraction->>'document_type',''),'other');
  v_evidence_type := case v_document_type
    when 'pos_close' then 'pos_close'
    when 'purchase_receipt' then 'purchase_receipt'
    when 'expense_receipt' then 'expense_receipt'
    when 'transfer_slip' then 'transfer_slip'
    when 'stock_photo' then 'stock_photo'
    when 'waste_photo' then 'waste_photo'
    else 'other'
  end;

  v_amount := case
    when (p_extraction->>'amount_total') ~ '^\d+(\.\d+)?$'
      then (p_extraction->>'amount_total')::numeric
    else null
  end;

  v_confidence := greatest(
    0,
    least(
      1,
      case
        when (p_extraction->>'confidence') ~ '^\d+(\.\d+)?$'
          then (p_extraction->>'confidence')::numeric
        else 0
      end
    )
  );

  v_received_date := coalesce(p_received_local_date,current_date);
  v_effective_date := case
    when coalesce(p_extraction->>'document_date_local','') ~ '^\d{4}-\d{2}-\d{2}$'
      and (p_extraction->>'document_date_local')::date between (v_received_date - 31) and (v_received_date + 1)
      then (p_extraction->>'document_date_local')::date
    else v_received_date
  end;

  v_attach_date := case when v_confidence>=0.80 then v_effective_date else v_received_date end;

  insert into public.financial_daily_closes(
    branch_id,local_date,environment,status,source
  )
  values(v_branch_id,v_attach_date,'live','draft','line')
  on conflict (branch_id,local_date,environment) do nothing;

  select c.id into v_close_id
  from public.financial_daily_closes c
  where c.branch_id=v_branch_id
    and c.local_date=v_attach_date
    and c.environment='live'
  limit 1;

  if v_close_id is null then
    raise exception 'daily_close_not_available';
  end if;

  if v_evidence_type in ('stock_photo','waste_photo','pos_close') then
    v_match_status := 'informational';
    v_match_reason := case
      when v_evidence_type='pos_close' then 'pos_close_evidence'
      when v_evidence_type='stock_photo' then 'stock_photo_evidence'
      else 'waste_photo_evidence'
    end;
  elsif v_evidence_type in ('purchase_receipt','expense_receipt') and v_amount is not null then
    select count(*),min(le.id::text)::uuid,min(coalesce(le.description,le.category,le.entry_type))
    into v_candidate_count,v_candidate_ledger,v_candidate_label
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
        from public.financial_daily_close_evidence ee
        where ee.ledger_entry_id=le.id
          and ee.extraction_status<>'rejected'
      );

    if v_candidate_count=1 then
      v_ledger_id:=v_candidate_ledger;
      select le.expense_claim_id into v_claim_id
      from public.financial_daily_ledger_entries le
      where le.id=v_ledger_id;
      v_match_status:='matched_ledger';
      v_match_reason:='exact_amount_unique_economic_event';
    elsif v_candidate_count>1 then
      v_match_status:='ambiguous';
      v_match_reason:='multiple_exact_amount_expense_candidates';
    else
      v_match_status:='unmatched';
      v_match_reason:='no_exact_amount_expense_candidate';
    end if;
  elsif v_evidence_type='transfer_slip' and v_amount is not null then
    select count(*),min(le.id::text)::uuid,min(coalesce(le.description,le.category,le.entry_type))
    into v_candidate_count,v_candidate_ledger,v_candidate_label
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
        select 1 from public.financial_daily_close_evidence ee
        where ee.ledger_entry_id=le.id
          and ee.evidence_type='transfer_slip'
          and ee.extraction_status<>'rejected'
      );

    select count(*),min(s.id::text)::uuid
    into strict v_candidate_count,v_candidate_claim
    from public.financial_expense_claim_summary s
    where s.branch_code='inthanin_tadtone'
      and s.environment='live'
      and s.claim_type='employee_reimbursement'
      and s.approval_status not in ('rejected','cancelled')
      and s.payment_status in ('unpaid','partially_paid')
      and abs(s.outstanding_amount-v_amount)<0.01
      and s.origin_local_date between (v_effective_date-31) and v_effective_date;

    -- Recompute combined candidate count to avoid guessing between vendor payment and reimbursement.
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
            select 1 from public.financial_daily_close_evidence ee
            where ee.ledger_entry_id=le.id
              and ee.evidence_type='transfer_slip'
              and ee.extraction_status<>'rejected'
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

    if v_candidate_count=1 and v_candidate_claim is not null then
      -- Serialize automatic settlements on the claim itself, then re-read the
      -- eligibility view after any lock wait (status, current origin and balance).
      perform 1 from public.financial_expense_claims c where c.id=v_candidate_claim for update;
      if not exists (
        select 1 from public.financial_expense_claim_summary s
        where s.id=v_candidate_claim and s.branch_code='inthanin_tadtone' and s.environment='live'
          and s.claim_type='employee_reimbursement'
          and s.approval_status not in ('rejected','cancelled')
          and s.payment_status in ('unpaid','partially_paid')
          and abs(s.outstanding_amount-v_amount)<0.01
          and s.origin_local_date between (v_effective_date-31) and v_effective_date
      ) then
        v_claim_id:=null;
        v_match_status:='unmatched';
        v_match_reason:='claim_changed_before_automatic_settlement';
      else
      v_claim_id:=v_candidate_claim;
      insert into public.financial_daily_ledger_entries(
        daily_close_id,entry_type,category,accounting_role,amount,direction,payment_method,
        description,source_channel,source_message_id,source_item_key,expense_claim_id,metadata
      )
      values(
        v_close_id,'reimbursement','staff','cash_settlement',v_amount,'outflow','qr',
        'Employee reimbursement matched from transfer slip',
        'line',p_message_id,'image_settlement',v_claim_id,
        jsonb_build_object('evidence_sha256',p_image_sha256,'superseded',false)
      )
      returning id into v_settlement_id;
      v_ledger_id:=v_settlement_id;
      v_match_status:='matched_claim';
      v_match_reason:='exact_amount_unique_employee_reimbursement';
      end if;
    elsif v_candidate_count=1 and v_candidate_ledger is not null then
      v_ledger_id:=v_candidate_ledger;
      v_match_status:='matched_ledger';
      v_match_reason:='exact_amount_unique_vendor_payment';
    elsif v_candidate_count>1 then
      v_match_status:='ambiguous';
      v_match_reason:='multiple_exact_amount_transfer_candidates';
    else
      v_match_status:='unmatched';
      v_match_reason:='no_exact_amount_transfer_candidate';
    end if;
  else
    v_match_status:='unmatched';
    v_match_reason:=case
      when v_amount is null then 'amount_not_visible_or_unreadable'
      else 'unsupported_or_unclassified_evidence'
    end;
  end if;

  insert into public.financial_daily_close_evidence(
    daily_close_id,
    ledger_entry_id,
    expense_claim_id,
    evidence_type,
    source_channel,
    source_message_id,
    image_sha256,
    storage_bucket,
    storage_path,
    mime_type,
    extraction_status,
    extracted_data,
    extraction_confidence,
    match_status,
    match_reason,
    matched_at,
    received_at
  )
  values(
    v_close_id,
    v_ledger_id,
    v_claim_id,
    v_evidence_type,
    'line',
    p_message_id,
    p_image_sha256,
    p_storage_bucket,
    p_storage_path,
    p_mime_type,
    case
      when v_match_status in ('matched_ledger','matched_claim','informational') and v_confidence>=0.70 then 'extracted'
      when v_match_status in ('ambiguous','unmatched') then 'needs_review'
      else 'needs_review'
    end,
    p_extraction || jsonb_build_object(
      'effective_date',v_effective_date,
      'received_local_date',v_received_date,
      'source_user_hash',nullif(trim(coalesce(p_user_hash,'')),'')
    ),
    v_confidence,
    v_match_status,
    v_match_reason,
    case when v_match_status in ('matched_ledger','matched_claim') then now() else null end,
    now()
  )
  returning id into v_evidence_id;

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'evidence_id',v_evidence_id,
    'daily_close_id',v_close_id,
    'evidence_type',v_evidence_type,
    'document_type',v_document_type,
    'amount',v_amount,
    'confidence',v_confidence,
    'match_status',v_match_status,
    'match_reason',v_match_reason,
    'ledger_entry_id',v_ledger_id,
    'expense_claim_id',v_claim_id,
    'matched_label',v_candidate_label,
    'effective_date',v_effective_date,
    'received_local_date',v_received_date,
    'attached_local_date',v_attach_date
  );
end;
$function$;

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

-- LOCAL PROPOSAL ONLY. Owner-authenticated Backoffice calls with service_role.
-- Uses the same parent-row lock and expected-revision contract as the installed
-- LINE confirmation wrapper. Does not call confirmation or change its grants.
create function public.financial_save_inthanin_daily_close_draft_v1(
  p_daily_close_id uuid,
  p_expected_local_date date,
  p_expected_environment text,
  p_expected_revision integer,
  p_patch jsonb,
  p_actor_hash text
) returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $function$
declare
  v_close public.financial_daily_closes%rowtype;
  v_next public.financial_daily_closes%rowtype;
  v_field text;
  v_number numeric;
  v_money text[] := array['gross_sales','discounts','refunds','payment_cash','payment_qr','payment_card','payment_delivery','payment_other','purchase_cash_outflow','expense_cash_outflow','waste_reported_value'];
  v_nullable text[] := array['staff_count','cup_count','bill_count','cash_opening_float','cash_counted_closing'];
begin
  if p_expected_revision is null or p_expected_revision < 1 then raise exception 'invalid_expected_revision'; end if;
  if p_expected_environment is null or p_expected_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_actor_hash is null or p_actor_hash !~ '^[a-f0-9]{64}$' then raise exception 'owner_actor_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' or p_patch='{}'::jsonb then raise exception 'nothing_to_save'; end if;
  for v_field in select jsonb_object_keys(p_patch) loop
    if not (v_field=any(v_money || v_nullable || array['notes','status'])) then raise exception 'invalid_patch_field'; end if;
    if v_field=any(v_money || v_nullable) then
      if p_patch->v_field='null'::jsonb and v_field=any(v_nullable) then continue; end if;
      if jsonb_typeof(p_patch->v_field)<>'number' then raise exception 'invalid_numeric_field'; end if;
      v_number:=(p_patch->>v_field)::numeric;
      if v_number<0 or v_number>999999999999.99 or v_number<>round(v_number,2) then raise exception 'invalid_numeric_field'; end if;
      if v_field=any(array['staff_count','cup_count','bill_count']) and (v_number<>trunc(v_number) or v_number>case when v_field='staff_count' then 1000 else 100000 end) then raise exception 'invalid_count_field'; end if;
    elsif v_field='notes' then
      if p_patch->v_field<>'null'::jsonb and (jsonb_typeof(p_patch->v_field)<>'string' or length(p_patch->>v_field)>4000) then raise exception 'invalid_notes'; end if;
    elsif v_field='status' then
      if coalesce(p_patch->>v_field,'') not in ('draft','pending_confirmation') then raise exception 'invalid_status'; end if;
    end if;
  end loop;
  select d.* into v_close
  from public.financial_daily_closes d
  join public.operations_business_branches b on b.id=d.branch_id
  where d.id=p_daily_close_id and d.local_date=p_expected_local_date
    and d.environment=p_expected_environment and b.code='inthanin_tadtone' and b.active=true
  for update of d;
  if v_close.id is null then raise exception 'daily_close_scope_mismatch'; end if;
  if v_close.revision<>p_expected_revision then
    return jsonb_build_object('ok',false,'saved',false,'reason','stale_revision','revision',v_close.revision,'status',v_close.status);
  end if;
  if v_close.status not in ('draft','pending_confirmation') then raise exception 'daily_close_not_editable'; end if;
  v_next:=jsonb_populate_record(v_close,p_patch);
  update public.financial_daily_closes set
    gross_sales=v_next.gross_sales,discounts=v_next.discounts,refunds=v_next.refunds,
    payment_cash=v_next.payment_cash,payment_qr=v_next.payment_qr,payment_card=v_next.payment_card,
    payment_delivery=v_next.payment_delivery,payment_other=v_next.payment_other,
    purchase_cash_outflow=v_next.purchase_cash_outflow,expense_cash_outflow=v_next.expense_cash_outflow,
    waste_reported_value=v_next.waste_reported_value,staff_count=v_next.staff_count,
    cup_count=v_next.cup_count,bill_count=v_next.bill_count,cash_opening_float=v_next.cash_opening_float,
    cash_counted_closing=v_next.cash_counted_closing,notes=v_next.notes,status=v_next.status,
    source='backoffice',revision=v_close.revision+1,
    submitted_at=case when v_next.status='pending_confirmation' then coalesce(v_close.submitted_at,now()) else v_close.submitted_at end
  where id=v_close.id
  returning * into v_next;
  return jsonb_build_object('ok',true,'saved',true,'close',to_jsonb(v_next));
end;
$function$;
revoke all on function public.financial_save_inthanin_daily_close_draft_v1(uuid,date,text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.financial_save_inthanin_daily_close_draft_v1(uuid,date,text,integer,jsonb,text) to service_role;
commit;
