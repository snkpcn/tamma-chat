-- CP8: enable Inthanin LIVE Daily Close + private Owner-only payroll/employee-advance flow.
-- Existing TEST functions remain unchanged for regression/certification.

-- Clone the already-certified TEST accounting functions into LIVE-specific variants.
do $$
declare ddl text;
begin
  select pg_get_functiondef('public.financial_ingest_cafe_test_text_v1(text,text,date,jsonb)'::regprocedure) into ddl;
  ddl:=replace(ddl,'financial_ingest_cafe_test_text_v1','financial_ingest_inthanin_live_text_v1');
  ddl:=replace(ddl,'''test''','''live''');
  -- Only cash physically paid from the shop drawer belongs in the reported cash-purchase totals.
  ddl:=replace(
    ddl,
    'if exp_funding in (''company_cash'',''owner_transfer'',''vendor_transfer'') then',
    'if exp_funding=''company_cash'' then'
  );
  execute ddl;
end;
$$;

do $$
declare ddl text;
begin
  select pg_get_functiondef('public.financial_attach_cafe_test_evidence_v1(text,text,date,text,text,text,text,jsonb)'::regprocedure) into ddl;
  ddl:=replace(ddl,'financial_attach_cafe_test_evidence_v1','financial_attach_inthanin_live_evidence_v1');
  ddl:=replace(ddl,'''test''','''live''');
  execute ddl;
end;
$$;

do $$
declare ddl text;
begin
  select pg_get_functiondef('public.financial_rematch_cafe_test_day_evidence_v1(uuid)'::regprocedure) into ddl;
  ddl:=replace(ddl,'financial_rematch_cafe_test_day_evidence_v1','financial_rematch_inthanin_live_day_evidence_v1');
  ddl:=replace(ddl,'''test''','''live''');
  ddl:=replace(ddl,'rematch_test_only','rematch_live_only');
  execute ddl;
end;
$$;

do $$
declare ddl text;
begin
  select pg_get_functiondef('public.financial_record_cash_sweep_v1(uuid,numeric,text,text)'::regprocedure) into ddl;
  ddl:=replace(ddl,'financial_record_cash_sweep_v1','financial_record_cash_sweep_live_v1');
  ddl:=replace(ddl,'''test''','''live''');
  ddl:=replace(ddl,'cash_custody_test_only','cash_custody_live_only');
  execute ddl;
end;
$$;

do $$
declare ddl text;
begin
  select pg_get_functiondef('public.financial_record_cash_bag_pickup_v1(text,numeric,text,text,text)'::regprocedure) into ddl;
  ddl:=replace(ddl,'financial_record_cash_bag_pickup_v1','financial_record_cash_bag_pickup_live_v1');
  ddl:=replace(ddl,'''test''','''live''');
  execute ddl;
end;
$$;

do $$
declare ddl text;
begin
  select pg_get_functiondef('public.financial_confirm_cafe_test_daily_close_v1(uuid,text,text)'::regprocedure) into ddl;
  ddl:=replace(ddl,'financial_confirm_cafe_test_daily_close_v1','financial_confirm_inthanin_live_daily_close_v1');
  ddl:=replace(ddl,'''test''','''live''');
  ddl:=replace(ddl,'confirmation_test_only','confirmation_live_only');
  execute ddl;
end;
$$;

revoke all on function public.financial_ingest_inthanin_live_text_v1(text,text,date,jsonb) from public,anon,authenticated;
grant execute on function public.financial_ingest_inthanin_live_text_v1(text,text,date,jsonb) to service_role;
revoke all on function public.financial_attach_inthanin_live_evidence_v1(text,text,date,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.financial_attach_inthanin_live_evidence_v1(text,text,date,text,text,text,text,jsonb) to service_role;
revoke all on function public.financial_rematch_inthanin_live_day_evidence_v1(uuid) from public,anon,authenticated;
grant execute on function public.financial_rematch_inthanin_live_day_evidence_v1(uuid) to service_role;
revoke all on function public.financial_record_cash_sweep_live_v1(uuid,numeric,text,text) from public,anon,authenticated;
grant execute on function public.financial_record_cash_sweep_live_v1(uuid,numeric,text,text) to service_role;
revoke all on function public.financial_record_cash_bag_pickup_live_v1(text,numeric,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_record_cash_bag_pickup_live_v1(text,numeric,text,text,text) to service_role;
revoke all on function public.financial_confirm_inthanin_live_daily_close_v1(uuid,text,text) from public,anon,authenticated;
grant execute on function public.financial_confirm_inthanin_live_daily_close_v1(uuid,text,text) to service_role;

-- Salary/payroll evidence is intentionally separated from shop Financial OS evidence.
-- It is never exposed to Café/Inthanin staff-group flows.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'owner-payroll-evidence','owner-payroll-evidence',false,10485760,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict(id) do update
set public=false,
    file_size_limit=excluded.file_size_limit,
    allowed_mime_types=excluded.allowed_mime_types;

create table if not exists public.financial_employee_payroll_events(
  id uuid primary key default gen_random_uuid(),
  event_type text not null check(event_type in ('salary_advance','salary_payment','advance_deduction')),
  employee_label text not null check(length(trim(employee_label)) between 1 and 120),
  employee_key text not null,
  amount numeric(14,2) not null check(amount>0),
  event_date date not null,
  pay_period text null,
  funding_source text not null default 'owner_personal'
    check(funding_source in ('owner_personal','business_account','cash','other')),
  status text not null
    check(status in ('awaiting_slip','paid','recorded','needs_review','cancelled')),
  source_channel text not null default 'line'
    check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  owner_group_hash text not null,
  created_by_hash text null,
  slip_message_id text null,
  slip_sha256 text null,
  storage_bucket text null,
  storage_path text null,
  mime_type text null,
  slip_amount numeric(14,2) null,
  slip_confidence numeric(5,4) null,
  slip_extracted_data jsonb not null default '{}'::jsonb,
  review_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_employee_payroll_source_unique
on public.financial_employee_payroll_events(source_channel,source_message_id)
where source_message_id is not null;

create unique index if not exists financial_employee_payroll_slip_message_unique
on public.financial_employee_payroll_events(slip_message_id)
where slip_message_id is not null;

create unique index if not exists financial_employee_payroll_slip_sha_unique
on public.financial_employee_payroll_events(slip_sha256)
where slip_sha256 is not null;

create index if not exists financial_employee_payroll_pending_idx
on public.financial_employee_payroll_events(owner_group_hash,created_by_hash,status,created_at desc);

alter table public.financial_employee_payroll_events enable row level security;
revoke all on public.financial_employee_payroll_events from public,anon,authenticated;
grant select,insert,update,delete on public.financial_employee_payroll_events to service_role;

drop trigger if exists financial_employee_payroll_touch on public.financial_employee_payroll_events;
create trigger financial_employee_payroll_touch
before update on public.financial_employee_payroll_events
for each row execute function public.financial_touch_updated_at();

create or replace view public.financial_employee_advance_owner_v1
with (security_invoker=true) as
select
  employee_key,
  max(employee_label) as employee_label,
  coalesce(sum(case when event_type='salary_advance' and status='paid' then amount else 0 end),0)::numeric(16,2) as total_advanced,
  coalesce(sum(case when event_type='advance_deduction' and status='recorded' then amount else 0 end),0)::numeric(16,2) as total_deducted,
  greatest(
    0,
    coalesce(sum(case when event_type='salary_advance' and status='paid' then amount else 0 end),0)
    - coalesce(sum(case when event_type='advance_deduction' and status='recorded' then amount else 0 end),0)
  )::numeric(16,2) as advance_outstanding,
  coalesce(sum(case when event_type='salary_payment' and status='paid' then amount else 0 end),0)::numeric(16,2) as salary_paid_recorded,
  max(created_at) as last_event_at
from public.financial_employee_payroll_events
where status<>'cancelled'
group by employee_key;

grant select on public.financial_employee_advance_owner_v1 to service_role;

create or replace function public.financial_create_owner_payroll_event_v1(
  p_event_type text,
  p_employee_label text,
  p_amount numeric,
  p_event_date date,
  p_pay_period text,
  p_group_hash text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event_id uuid;
  v_status text;
  v_existing record;
begin
  if p_event_type not in ('salary_advance','salary_payment','advance_deduction') then
    raise exception 'invalid_payroll_event_type';
  end if;
  if coalesce(trim(p_employee_label),'')='' then raise exception 'employee_label_required'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'payroll_amount_required'; end if;
  if coalesce(trim(p_group_hash),'')='' then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select * into v_existing
  from public.financial_employee_payroll_events
  where source_channel='line' and source_message_id=p_message_id
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'event_id',v_existing.id,
      'event_type',v_existing.event_type,'status',v_existing.status,
      'employee_label',v_existing.employee_label,'amount',v_existing.amount
    );
  end if;

  if p_event_type in ('salary_advance','salary_payment') and exists(
    select 1
    from public.financial_employee_payroll_events
    where owner_group_hash=p_group_hash
      and created_by_hash is not distinct from nullif(trim(coalesce(p_user_hash,'')),'')
      and status='awaiting_slip'
      and created_at>now()-interval '12 hours'
  ) then
    raise exception 'payroll_slip_pending';
  end if;

  v_status:=case when p_event_type='advance_deduction' then 'recorded' else 'awaiting_slip' end;

  insert into public.financial_employee_payroll_events(
    event_type,employee_label,employee_key,amount,event_date,pay_period,
    funding_source,status,source_channel,source_message_id,owner_group_hash,created_by_hash,metadata
  )
  values(
    p_event_type,trim(p_employee_label),lower(regexp_replace(trim(p_employee_label),'\s+',' ','g')),
    round(p_amount,2),coalesce(p_event_date,timezone('Asia/Bangkok',now())::date),
    nullif(trim(coalesce(p_pay_period,'')),''),
    'owner_personal',v_status,'line',p_message_id,trim(p_group_hash),
    nullif(trim(coalesce(p_user_hash,'')),''),
    jsonb_build_object('privacy_scope','owner_only','not_shop_expense',p_event_type='salary_advance')
  )
  returning id into v_event_id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'event_id',v_event_id,
    'event_type',p_event_type,'status',v_status,
    'employee_label',trim(p_employee_label),'amount',round(p_amount,2)
  );
end;
$$;

create or replace function public.financial_attach_owner_payroll_slip_v1(
  p_event_id uuid,
  p_slip_message_id text,
  p_slip_sha256 text,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_document_type text,
  p_slip_amount numeric,
  p_confidence numeric,
  p_extracted_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  e record;
  v_match boolean;
  v_status text;
  v_reason text;
begin
  if p_storage_bucket<>'owner-payroll-evidence' then raise exception 'invalid_payroll_evidence_bucket'; end if;
  if coalesce(trim(p_slip_message_id),'')='' then raise exception 'slip_message_id_required'; end if;
  if coalesce(trim(p_slip_sha256),'')='' then raise exception 'slip_sha256_required'; end if;

  select * into e
  from public.financial_employee_payroll_events
  where id=p_event_id
  for update;

  if e.id is null then raise exception 'payroll_event_not_found'; end if;
  if e.event_type='advance_deduction' then raise exception 'deduction_does_not_accept_slip'; end if;

  if e.status='paid' then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'event_id',e.id,'status',e.status,
      'employee_label',e.employee_label,'amount',e.amount
    );
  end if;

  if exists(
    select 1 from public.financial_employee_payroll_events
    where id<>e.id and (slip_message_id=p_slip_message_id or slip_sha256=p_slip_sha256)
  ) then
    raise exception 'payroll_slip_already_used';
  end if;

  v_match:=
    p_document_type='transfer_slip'
    and coalesce(p_confidence,0)>=0.80
    and p_slip_amount is not null
    and abs(p_slip_amount-e.amount)<0.01;

  v_status:=case when v_match then 'paid' else 'needs_review' end;
  v_reason:=case
    when p_document_type<>'transfer_slip' then 'image_not_transfer_slip'
    when coalesce(p_confidence,0)<0.80 then 'low_extraction_confidence'
    when p_slip_amount is null then 'slip_amount_unreadable'
    when abs(p_slip_amount-e.amount)>=0.01 then 'slip_amount_mismatch'
    else null
  end;

  update public.financial_employee_payroll_events
  set status=v_status,
      slip_message_id=p_slip_message_id,
      slip_sha256=p_slip_sha256,
      storage_bucket=p_storage_bucket,
      storage_path=p_storage_path,
      mime_type=p_mime_type,
      slip_amount=p_slip_amount,
      slip_confidence=greatest(0,least(1,coalesce(p_confidence,0))),
      slip_extracted_data=coalesce(p_extracted_data,'{}'::jsonb),
      review_reason=v_reason,
      metadata=coalesce(metadata,'{}'::jsonb)
        || jsonb_build_object('slip_attached_at',now(),'privacy_scope','owner_only'),
      updated_at=now()
  where id=e.id;

  return jsonb_build_object(
    'ok',true,'duplicate',false,'event_id',e.id,'status',v_status,
    'employee_label',e.employee_label,'amount',e.amount,
    'slip_amount',p_slip_amount,'match',v_match,'review_reason',v_reason
  );
end;
$$;

revoke all on function public.financial_create_owner_payroll_event_v1(text,text,numeric,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_create_owner_payroll_event_v1(text,text,numeric,date,text,text,text,text) to service_role;
revoke all on function public.financial_attach_owner_payroll_slip_v1(uuid,text,text,text,text,text,text,numeric,numeric,jsonb) from public,anon,authenticated;
grant execute on function public.financial_attach_owner_payroll_slip_v1(uuid,text,text,text,text,text,text,numeric,numeric,jsonb) to service_role;
