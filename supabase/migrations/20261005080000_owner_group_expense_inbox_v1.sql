-- Owner Group Expense Inbox
--
-- This is deliberately separate from Inthanin Daily Close and Owner Payroll.
-- Owner-funded investment and cross-business spending must never be silently
-- forced into a café day-close ledger or overwrite historical accounting data.
-- Every change is append-only auditable; this migration creates new objects only.

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'owner-expense-evidence','owner-expense-evidence',false,10485760,
  array['image/jpeg','image/png','image/webp']::text[]
)
on conflict(id) do nothing;

create table if not exists public.financial_owner_expense_intakes(
  id uuid primary key default gen_random_uuid(),
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  source_channel text not null default 'line'
    check(source_channel in ('line','backoffice','import','system')),
  evidence_message_id text not null check(length(trim(evidence_message_id)) between 1 and 255),
  evidence_sha256 text not null check(evidence_sha256 ~ '^[0-9a-f]{64}$'),
  source_user_hash text null,
  occurred_on date not null,
  amount numeric(14,2) null check(amount is null or (amount>0 and amount<=100000000)),
  currency text not null default 'THB' check(currency='THB'),
  document_type text not null default 'other'
    check(document_type in ('transfer_slip','purchase_receipt','expense_receipt','other')),
  vendor_label text null,
  reference_number text null,
  status text not null default 'awaiting_purpose'
    check(status in ('awaiting_purpose','awaiting_business','categorized','needs_review','cancelled')),
  purpose_raw text null,
  business_unit_code text null
    check(business_unit_code is null or business_unit_code in (
      'inthanin','tamma_restaurant','huenstay','adventure','otop',
      'shared_infrastructure','shared','other'
    )),
  expense_class text null
    check(expense_class is null or expense_class in (
      'capital_investment','operating_expense','owner_private','uncategorized'
    )),
  expense_category text null
    check(expense_category is null or expense_category in (
      'construction','land_infrastructure','kitchen_equipment','equipment',
      'furniture_fixtures','activity_assets','technology','licenses',
      'inventory','ingredients','beverages','packaging','consumables','cleaning',
      'maintenance','utilities','transport','staff','marketing','fees',
      'professional_services','tax','financing','petty_cash','other'
    )),
  expense_subcategory text null,
  classification_confidence numeric(4,3) null
    check(classification_confidence is null or (classification_confidence>=0 and classification_confidence<=1)),
  classification_source text null
    check(classification_source is null or classification_source in ('rule','owner','backoffice','import')),
  extraction_confidence numeric(4,3) null
    check(extraction_confidence is null or (extraction_confidence>=0 and extraction_confidence<=1)),
  extraction_data jsonb not null default '{}'::jsonb,
  storage_bucket text not null default 'owner-expense-evidence',
  storage_path text not null,
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  resolved_by_message_id text null,
  resolved_by_hash text null,
  categorized_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists financial_owner_expense_line_message_unique
on public.financial_owner_expense_intakes(source_channel,evidence_message_id)
where source_channel='line';

create unique index if not exists financial_owner_expense_group_image_unique
on public.financial_owner_expense_intakes(owner_group_hash,evidence_sha256);

create index if not exists financial_owner_expense_pending_group_idx
on public.financial_owner_expense_intakes(owner_group_hash,status,created_at);

create index if not exists financial_owner_expense_dashboard_idx
on public.financial_owner_expense_intakes(occurred_on,business_unit_code,expense_class,expense_category)
where status<>'cancelled';

create table if not exists public.financial_owner_expense_audit_events(
  id uuid primary key default gen_random_uuid(),
  intake_id uuid not null references public.financial_owner_expense_intakes(id) on delete restrict,
  action text not null check(action in ('captured_slip','purpose_staged','categorized','reclassified','cancelled')),
  source text not null check(source in ('line','backoffice','import','system')),
  actor_hash text null,
  message_id text null,
  reason text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_owner_expense_audit_intake_idx
on public.financial_owner_expense_audit_events(intake_id,created_at);

alter table public.financial_owner_expense_intakes enable row level security;
alter table public.financial_owner_expense_audit_events enable row level security;
revoke all on public.financial_owner_expense_intakes from public,anon,authenticated;
revoke all on public.financial_owner_expense_audit_events from public,anon,authenticated;
grant select,insert,update on public.financial_owner_expense_intakes to service_role;
grant select,insert on public.financial_owner_expense_audit_events to service_role;

create or replace function public.financial_capture_owner_expense_slip_v1(
  p_group_hash text,
  p_message_id text,
  p_user_hash text,
  p_occurred_on date,
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
  v_existing public.financial_owner_expense_intakes%rowtype;
  v_id uuid;
  v_document_type text;
  v_amount numeric(14,2);
  v_confidence numeric(4,3);
  v_date date;
begin
  if coalesce(trim(p_group_hash),'')='' then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_image_sha256),'') !~ '^[0-9a-f]{64}$' then raise exception 'invalid_image_sha256'; end if;
  if coalesce(trim(p_storage_bucket),'')<>'owner-expense-evidence' then raise exception 'invalid_owner_expense_bucket'; end if;
  if coalesce(trim(p_storage_path),'')='' then raise exception 'storage_path_required'; end if;
  if coalesce(trim(p_mime_type),'') not in ('image/jpeg','image/png','image/webp') then raise exception 'invalid_evidence_mime_type'; end if;

  select * into v_existing
  from public.financial_owner_expense_intakes
  where source_channel='line'
    and (
      evidence_message_id=trim(p_message_id)
      or (owner_group_hash=trim(p_group_hash) and evidence_sha256=lower(trim(p_image_sha256)))
    )
  order by created_at asc
  limit 1;

  if v_existing.id is not null then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'intake_id',v_existing.id,
      'status',v_existing.status,'amount',v_existing.amount,
      'document_type',v_existing.document_type
    );
  end if;

  v_document_type:=lower(trim(coalesce(p_extraction->>'document_type','other')));
  if v_document_type not in ('transfer_slip','purchase_receipt','expense_receipt') then
    v_document_type:='other';
  end if;

  v_amount:=case
    when coalesce(p_extraction->>'amount_total','') ~ '^[0-9]+([.][0-9]{1,2})?$'
      then (p_extraction->>'amount_total')::numeric(14,2)
    else null
  end;
  if v_amount is not null and (v_amount<=0 or v_amount>100000000) then v_amount:=null; end if;

  v_confidence:=case
    when coalesce(p_extraction->>'confidence','') ~ '^(0([.][0-9]+)?|1([.]0+)?)$'
      then least(1::numeric,greatest(0::numeric,(p_extraction->>'confidence')::numeric))::numeric(4,3)
    else 0
  end;

  v_date:=coalesce(
    p_occurred_on,
    case when coalesce(p_extraction->>'document_date_local','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      then (p_extraction->>'document_date_local')::date
      else null end,
    timezone('Asia/Bangkok',now())::date
  );

  insert into public.financial_owner_expense_intakes(
    owner_group_hash,source_channel,evidence_message_id,evidence_sha256,source_user_hash,
    occurred_on,amount,document_type,vendor_label,reference_number,
    extraction_confidence,extraction_data,storage_bucket,storage_path,mime_type,status
  ) values (
    trim(p_group_hash),'line',trim(p_message_id),lower(trim(p_image_sha256)),
    nullif(trim(coalesce(p_user_hash,'')),''),
    v_date,v_amount,v_document_type,
    nullif(left(trim(coalesce(p_extraction->>'merchant','')),180),''),
    nullif(left(trim(coalesce(p_extraction->>'reference_number','')),120),''),
    v_confidence,coalesce(p_extraction,'{}'::jsonb),
    'owner-expense-evidence',trim(p_storage_path),trim(p_mime_type),'awaiting_purpose'
  ) returning id into v_id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,after_data
  ) values (
    v_id,'captured_slip','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),
    jsonb_build_object(
      'status','awaiting_purpose','amount',v_amount,'document_type',v_document_type,
      'occurred_on',v_date,'evidence_sha256',lower(trim(p_image_sha256))
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',v_id,'status','awaiting_purpose',
    'amount',v_amount,'document_type',v_document_type,'occurred_on',v_date,
    'pending_count',(
      select count(*) from public.financial_owner_expense_intakes
      where owner_group_hash=trim(p_group_hash)
        and status in ('awaiting_purpose','awaiting_business')
        and created_at>now()-interval '14 days'
    )
  );
end;
$$;

create or replace function public.financial_stage_owner_expense_purpose_v1(
  p_intake_id uuid,
  p_purpose text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_confidence numeric,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
  v_confidence numeric(4,3);
begin
  if coalesce(trim(p_purpose),'')='' then raise exception 'purpose_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;

  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id;
    if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status in ('categorized','needs_review','cancelled') then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  v_confidence:=least(1::numeric,greatest(0::numeric,coalesce(p_confidence,0)))::numeric(4,3);
  v_before:=jsonb_build_object(
    'status',v_row.status,'purpose_raw',v_row.purpose_raw,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status='awaiting_business',
      purpose_raw=left(trim(p_purpose),500),
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      classification_confidence=v_confidence,
      classification_source='rule',
      updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (
    v_row.id,'purpose_staged','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),v_before,
    jsonb_build_object(
      'status','awaiting_business','purpose_raw',left(trim(p_purpose),500),
      'expense_class',p_expense_class,'expense_category',p_expense_category,
      'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      'classification_confidence',v_confidence
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',v_row.id,'status','awaiting_business',
    'amount',v_row.amount,'purpose',left(trim(p_purpose),500),
    'expense_class',p_expense_class,'expense_category',p_expense_category,
    'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),'')
  );
end;
$$;

create or replace function public.financial_resolve_owner_expense_intake_v1(
  p_intake_id uuid,
  p_purpose text,
  p_business_unit_code text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_confidence numeric,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
  v_confidence numeric(4,3);
  v_status text;
  v_purpose text;
begin
  if coalesce(trim(p_business_unit_code),'') not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then raise exception 'invalid_business_unit'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id;
    if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status in ('categorized','needs_review') then
    if v_row.resolved_by_message_id=trim(p_message_id) then
      return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
    end if;
    raise exception 'owner_expense_already_resolved';
  end if;
  if v_row.status not in ('awaiting_purpose','awaiting_business') then
    raise exception 'owner_expense_not_pending';
  end if;

  v_purpose:=coalesce(nullif(left(trim(coalesce(p_purpose,'')),500),''),v_row.purpose_raw);
  if v_purpose is null then raise exception 'purpose_required'; end if;
  v_confidence:=least(1::numeric,greatest(0::numeric,coalesce(p_confidence,0)))::numeric(4,3);
  v_status:=case
    when p_business_unit_code='other' or p_expense_category='other' or v_confidence<0.70 then 'needs_review'
    else 'categorized'
  end;
  v_before:=jsonb_build_object(
    'status',v_row.status,'purpose_raw',v_row.purpose_raw,'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status=v_status,
      purpose_raw=v_purpose,
      business_unit_code=p_business_unit_code,
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      classification_confidence=v_confidence,
      classification_source='rule',
      resolved_by_message_id=trim(p_message_id),
      resolved_by_hash=nullif(trim(coalesce(p_user_hash,'')),''),
      categorized_at=now(),
      updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (
    v_row.id,'categorized','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),v_before,
    jsonb_build_object(
      'status',v_status,'purpose_raw',v_purpose,'business_unit_code',p_business_unit_code,
      'expense_class',p_expense_class,'expense_category',p_expense_category,
      'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      'classification_confidence',v_confidence
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',v_row.id,'status',v_status,
    'amount',v_row.amount,'purpose',v_purpose,'business_unit_code',p_business_unit_code,
    'expense_class',p_expense_class,'expense_category',p_expense_category,
    'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
    'confidence',v_confidence
  );
end;
$$;

create or replace function public.financial_mark_owner_expense_not_expense_v1(
  p_intake_id uuid,
  p_reason text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
begin
  if coalesce(trim(p_reason),'')='' then raise exception 'cancellation_reason_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status='cancelled' then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;
  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;

  v_before:=jsonb_build_object(
    'status',v_row.status,'purpose_raw',v_row.purpose_raw,
    'business_unit_code',v_row.business_unit_code,'expense_class',v_row.expense_class,
    'expense_category',v_row.expense_category
  );

  update public.financial_owner_expense_intakes
  set status='cancelled',updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,reason,before_data,after_data
  ) values (
    v_row.id,'cancelled','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),
    left(trim(p_reason),500),v_before,jsonb_build_object('status','cancelled')
  );

  return jsonb_build_object('ok',true,'duplicate',false,'intake_id',v_row.id,'status','cancelled');
end;
$$;

create or replace function public.financial_reclassify_owner_expense_intake_v1(
  p_intake_id uuid,
  p_business_unit_code text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
begin
  if coalesce(trim(p_reason),'')='' then raise exception 'reclassification_reason_required'; end if;
  if coalesce(trim(p_business_unit_code),'') not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then raise exception 'invalid_business_unit'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;

  select * into v_row
  from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;
  if v_row.status='cancelled' then raise exception 'cancelled_owner_expense_immutable'; end if;

  v_before:=jsonb_build_object(
    'status',v_row.status,'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status=case when p_business_unit_code='other' or p_expense_category='other' then 'needs_review' else 'categorized' end,
      business_unit_code=p_business_unit_code,
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      classification_confidence=1,
      classification_source='backoffice',
      categorized_at=coalesce(categorized_at,now()),
      updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    v_row.id,'reclassified','backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),left(trim(p_reason),500),v_before,
    jsonb_build_object(
      'business_unit_code',p_business_unit_code,'expense_class',p_expense_class,
      'expense_category',p_expense_category,
      'expense_subcategory',nullif(left(trim(coalesce(p_expense_subcategory,'')),120),''),
      'classification_confidence',1
    )
  );

  return jsonb_build_object('ok',true,'intake_id',v_row.id);
end;
$$;

create or replace view public.financial_owner_expense_summary_v1
with (security_invoker=true) as
select
  date_trunc('month',occurred_on)::date as month_start,
  owner_group_hash,
  coalesce(business_unit_code,'other') as business_unit_code,
  coalesce(expense_class,'uncategorized') as expense_class,
  coalesce(expense_category,'other') as expense_category,
  count(*)::integer as item_count,
  coalesce(sum(amount),0)::numeric(16,2) as total_amount,
  count(*) filter(where status='categorized')::integer as categorized_count,
  count(*) filter(where status in ('awaiting_purpose','awaiting_business','needs_review'))::integer as attention_count
from public.financial_owner_expense_intakes
where status<>'cancelled'
group by 1,2,3,4,5;

revoke all on public.financial_owner_expense_summary_v1 from public,anon,authenticated;
grant select on public.financial_owner_expense_summary_v1 to service_role;

revoke all on function public.financial_capture_owner_expense_slip_v1(text,text,text,date,text,text,text,text,jsonb)
from public,anon,authenticated;
revoke all on function public.financial_stage_owner_expense_purpose_v1(uuid,text,text,text,text,numeric,text,text)
from public,anon,authenticated;
revoke all on function public.financial_resolve_owner_expense_intake_v1(uuid,text,text,text,text,text,numeric,text,text)
from public,anon,authenticated;
revoke all on function public.financial_reclassify_owner_expense_intake_v1(uuid,text,text,text,text,text,text)
from public,anon,authenticated;
revoke all on function public.financial_mark_owner_expense_not_expense_v1(uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.financial_capture_owner_expense_slip_v1(text,text,text,date,text,text,text,text,jsonb) to service_role;
grant execute on function public.financial_stage_owner_expense_purpose_v1(uuid,text,text,text,text,numeric,text,text) to service_role;
grant execute on function public.financial_resolve_owner_expense_intake_v1(uuid,text,text,text,text,text,numeric,text,text) to service_role;
grant execute on function public.financial_reclassify_owner_expense_intake_v1(uuid,text,text,text,text,text,text) to service_role;
grant execute on function public.financial_mark_owner_expense_not_expense_v1(uuid,text,text,text) to service_role;
