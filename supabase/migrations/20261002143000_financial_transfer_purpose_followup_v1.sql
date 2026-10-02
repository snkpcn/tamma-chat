-- Financial OS: ask for transfer-slip purpose when no safe match exists.
-- The purpose answer becomes the economic event; the slip remains the evidence.
-- TEST and LIVE share this follow-up mechanism, scoped to the physical LINE group hash.

create table if not exists public.financial_transfer_followups (
  id uuid primary key default gen_random_uuid(),
  evidence_id uuid not null references public.financial_daily_close_evidence(id) on delete cascade,
  daily_close_id uuid not null references public.financial_daily_closes(id) on delete cascade,
  environment text not null check(environment in ('test','live')),
  target_hash text not null,
  amount numeric(14,2) not null check(amount > 0),
  status text not null default 'awaiting_description'
    check(status in ('awaiting_description','resolved','cancelled')),
  description text null,
  expense_category text null
    check(expense_category is null or expense_category in (
      'ingredients','beverages','packaging','consumables','cleaning','maintenance',
      'utilities','transport','staff','equipment','marketing','fees','petty_cash','other'
    )),
  ledger_entry_id uuid null references public.financial_daily_ledger_entries(id) on delete set null,
  source_slip_message_id text null,
  resolved_by_message_id text null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb
);

create unique index if not exists financial_transfer_followups_evidence_unique
on public.financial_transfer_followups(evidence_id);

create index if not exists financial_transfer_followups_pending_group_idx
on public.financial_transfer_followups(target_hash,status,created_at);

alter table public.financial_transfer_followups enable row level security;
revoke all on public.financial_transfer_followups from public,anon,authenticated;
grant select,insert,update,delete on public.financial_transfer_followups to service_role;

create or replace function public.financial_open_transfer_followup_v1(
  p_evidence_id uuid,
  p_target_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_evidence record;
  v_followup_id uuid;
  v_pending_count integer;
  v_oldest_amount numeric(14,2);
  v_amount numeric(14,2);
begin
  if coalesce(trim(p_target_hash),'')='' then
    raise exception 'target_hash_required';
  end if;

  select
    e.id,
    e.daily_close_id,
    e.evidence_type,
    e.match_status,
    e.extraction_confidence,
    e.source_message_id,
    e.extracted_data,
    c.environment,
    c.status as close_status
  into v_evidence
  from public.financial_daily_close_evidence e
  join public.financial_daily_closes c on c.id=e.daily_close_id
  where e.id=p_evidence_id
  limit 1;

  if v_evidence.id is null then raise exception 'financial_evidence_not_found'; end if;
  if v_evidence.evidence_type<>'transfer_slip' then raise exception 'followup_requires_transfer_slip'; end if;

  if v_evidence.match_status<>'unmatched' then
    return jsonb_build_object(
      'ok',true,'opened',false,'reason','evidence_already_matched_or_ambiguous',
      'match_status',v_evidence.match_status
    );
  end if;

  if v_evidence.close_status in ('confirmed','void') then
    return jsonb_build_object(
      'ok',true,'opened',false,'reason','daily_close_not_editable'
    );
  end if;

  v_amount:=case
    when coalesce(v_evidence.extracted_data->>'amount_total','') ~ '^\d+(\.\d+)?$'
    then (v_evidence.extracted_data->>'amount_total')::numeric
    else null
  end;

  if v_amount is null or v_amount<=0 or coalesce(v_evidence.extraction_confidence,0)<0.80 then
    return jsonb_build_object(
      'ok',true,'opened',false,'reason','amount_or_confidence_insufficient'
    );
  end if;

  select id into v_followup_id
  from public.financial_transfer_followups
  where evidence_id=p_evidence_id
  limit 1;

  if v_followup_id is null then
    insert into public.financial_transfer_followups(
      evidence_id,daily_close_id,environment,target_hash,amount,status,
      source_slip_message_id,metadata
    )
    values(
      v_evidence.id,v_evidence.daily_close_id,v_evidence.environment,
      trim(p_target_hash),v_amount,'awaiting_description',
      v_evidence.source_message_id,
      jsonb_build_object(
        'question','transfer_purpose',
        'opened_from_match_reason','no_safe_existing_match'
      )
    )
    returning id into v_followup_id;
  end if;

  select count(*) into v_pending_count
  from public.financial_transfer_followups
  where target_hash=trim(p_target_hash)
    and status='awaiting_description'
    and created_at>now()-interval '72 hours';

  select amount into v_oldest_amount
  from public.financial_transfer_followups
  where target_hash=trim(p_target_hash)
    and status='awaiting_description'
    and created_at>now()-interval '72 hours'
  order by created_at asc
  limit 1;

  return jsonb_build_object(
    'ok',true,'opened',true,'followup_id',v_followup_id,
    'amount',v_amount,'pending_count',v_pending_count,
    'oldest_amount',v_oldest_amount
  );
end;
$$;

create or replace function public.financial_resolve_transfer_followup_v1(
  p_followup_id uuid,
  p_description text,
  p_category text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  f record;
  v_close_status text;
  v_ledger_id uuid;
  v_category text;
begin
  if coalesce(trim(p_description),'')='' then raise exception 'transfer_description_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  v_category:=case
    when p_category in (
      'ingredients','beverages','packaging','consumables','cleaning','maintenance',
      'utilities','transport','staff','equipment','marketing','fees','petty_cash','other'
    ) then p_category
    else 'other'
  end;

  select * into f
  from public.financial_transfer_followups
  where id=p_followup_id
  for update;

  if f.id is null then raise exception 'transfer_followup_not_found'; end if;

  if f.status='resolved' then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'resolved',true,
      'followup_id',f.id,'ledger_entry_id',f.ledger_entry_id,
      'amount',f.amount,'description',f.description,'category',f.expense_category
    );
  end if;

  if f.status<>'awaiting_description' then
    raise exception 'transfer_followup_not_pending';
  end if;

  select status into v_close_status
  from public.financial_daily_closes
  where id=f.daily_close_id
  for update;

  if v_close_status in ('confirmed','void') then
    raise exception 'daily_close_not_editable';
  end if;

  insert into public.financial_daily_ledger_entries(
    daily_close_id,entry_type,category,accounting_role,amount,direction,payment_method,
    description,source_channel,source_message_id,source_item_key,metadata
  )
  values(
    f.daily_close_id,'vendor_payment',v_category,'economic_event',f.amount,'outflow','qr',
    left(trim(p_description),240),'line',p_message_id,'transfer_purpose',
    jsonb_build_object(
      'funding','owner_transfer',
      'needs_review',false,
      'is_shop_expense',true,
      'transfer_followup_id',f.id,
      'evidence_id',f.evidence_id,
      'purpose_source','line_group_followup',
      'resolved_by_hash',nullif(trim(coalesce(p_user_hash,'')),'')
    )
  )
  returning id into v_ledger_id;

  update public.financial_daily_close_evidence
  set ledger_entry_id=v_ledger_id,
      match_status='matched_ledger',
      match_reason='user_described_transfer_purpose',
      extraction_status='extracted',
      matched_at=now(),
      extracted_data=coalesce(extracted_data,'{}'::jsonb)
        || jsonb_build_object(
          'purpose_description',left(trim(p_description),240),
          'purpose_category',v_category,
          'purpose_resolved_at',now()
        )
  where id=f.evidence_id;

  update public.financial_transfer_followups
  set status='resolved',
      description=left(trim(p_description),240),
      expense_category=v_category,
      ledger_entry_id=v_ledger_id,
      resolved_by_message_id=p_message_id,
      resolved_at=now(),
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object('resolved_by_hash',nullif(trim(coalesce(p_user_hash,'')),''))
  where id=f.id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'resolved',true,
    'followup_id',f.id,'ledger_entry_id',v_ledger_id,
    'evidence_id',f.evidence_id,'daily_close_id',f.daily_close_id,
    'environment',f.environment,'amount',f.amount,
    'description',left(trim(p_description),240),'category',v_category
  );
end;
$$;

revoke all on function public.financial_open_transfer_followup_v1(uuid,text)
from public,anon,authenticated;
grant execute on function public.financial_open_transfer_followup_v1(uuid,text) to service_role;

revoke all on function public.financial_resolve_transfer_followup_v1(uuid,text,text,text,text)
from public,anon,authenticated;
grant execute on function public.financial_resolve_transfer_followup_v1(uuid,text,text,text,text) to service_role;
