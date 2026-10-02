insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values (
  'financial-evidence',
  'financial-evidence',
  false,
  10485760,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict (id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

alter table public.financial_daily_close_evidence
  add column if not exists match_status text not null default 'unmatched'
    check (match_status in ('unmatched','ambiguous','matched_ledger','matched_claim','informational')),
  add column if not exists match_reason text,
  add column if not exists matched_at timestamptz;

create unique index if not exists financial_daily_evidence_image_sha_unique
  on public.financial_daily_close_evidence(image_sha256)
  where image_sha256 is not null;

create or replace function public.financial_attach_cafe_test_evidence_v1(
  p_message_id text,
  p_user_hash text,
  p_received_local_date date,
  p_image_sha256 text,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_extraction jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
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
      'ok',true,'duplicate',true,
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
    0, least(1,
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

  insert into public.financial_daily_closes(branch_id,local_date,environment,status,source)
  values(v_branch_id,v_received_date,'test','draft','line')
  on conflict (branch_id,local_date,environment) do nothing;

  select c.id into v_close_id
  from public.financial_daily_closes c
  where c.branch_id=v_branch_id
    and c.local_date=v_received_date
    and c.environment='test'
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
      and dc.environment='test'
      and dc.local_date=v_effective_date
      and le.accounting_role='economic_event'
      and le.entry_type in ('purchase','expense','vendor_payment')
      and abs(le.amount-v_amount)<0.01
      and coalesce((le.metadata->>'superseded')::boolean,false)=false
      and not exists (
        select 1 from public.financial_daily_close_evidence ee
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
      and dc.environment='test'
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
      and s.environment='test'
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
          and dc.environment='test'
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
          and s.environment='test'
          and s.claim_type='employee_reimbursement'
          and s.approval_status not in ('rejected','cancelled')
          and s.payment_status in ('unpaid','partially_paid')
          and abs(s.outstanding_amount-v_amount)<0.01
          and s.origin_local_date between (v_effective_date-31) and v_effective_date
      )
    into v_candidate_count;

    if v_candidate_count=1 and v_candidate_claim is not null then
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
    daily_close_id,ledger_entry_id,expense_claim_id,evidence_type,source_channel,
    source_message_id,image_sha256,storage_bucket,storage_path,mime_type,
    extraction_status,extracted_data,extraction_confidence,match_status,match_reason,
    matched_at,received_at
  )
  values(
    v_close_id,v_ledger_id,v_claim_id,v_evidence_type,'line',
    p_message_id,p_image_sha256,p_storage_bucket,p_storage_path,p_mime_type,
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
    v_confidence,v_match_status,v_match_reason,
    case when v_match_status in ('matched_ledger','matched_claim') then now() else null end,
    now()
  )
  returning id into v_evidence_id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,
    'evidence_id',v_evidence_id,'daily_close_id',v_close_id,
    'evidence_type',v_evidence_type,'document_type',v_document_type,
    'amount',v_amount,'confidence',v_confidence,
    'match_status',v_match_status,'match_reason',v_match_reason,
    'ledger_entry_id',v_ledger_id,'expense_claim_id',v_claim_id,
    'matched_label',v_candidate_label,'effective_date',v_effective_date,
    'received_local_date',v_received_date
  );
end;
$$;

revoke all on function public.financial_attach_cafe_test_evidence_v1(text,text,date,text,text,text,text,jsonb) from public;
revoke all on function public.financial_attach_cafe_test_evidence_v1(text,text,date,text,text,text,text,jsonb) from anon;
revoke all on function public.financial_attach_cafe_test_evidence_v1(text,text,date,text,text,text,text,jsonb) from authenticated;
grant execute on function public.financial_attach_cafe_test_evidence_v1(text,text,date,text,text,text,text,jsonb) to service_role;
