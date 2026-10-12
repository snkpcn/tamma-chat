-- LOCAL PROPOSAL ONLY. Not applied to production.
-- Generate the eventual migration with `supabase migration new` after review.
-- All entry points are SECURITY INVOKER and service_role-only. No client access,
-- owner impersonation, storage copy, financial-history deletion, or auto-payment.

alter table public.financial_employee_payroll_events
  drop constraint financial_employee_payroll_events_funding_source_check;
alter table public.financial_employee_payroll_events
  add constraint financial_employee_payroll_events_funding_source_check
  check(funding_source in ('owner_personal','business_account','cash','other','unknown'));

-- Approved aliases are private profile data, never public seeds or fuzzy rules.
-- Whitespace/case normalization only; digits, punctuation and extra prose remain.
create function public.financial_employee_advance_normalize_alias_v1(p_note text)
returns text language sql immutable security invoker set search_path='' as $$
 select lower(regexp_replace(coalesce(p_note,''),'[[:space:]]','','g'));
$$;
-- Even a misconfigured approved alias cannot imply salary when its text says
-- purchase, reimbursement, another worker, negation, future intent or a question.
create function public.financial_employee_advance_alias_note_ok_v1(p_note text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select public.financial_employee_advance_normalize_alias_v1(p_note)<>''
  and public.financial_employee_advance_normalize_alias_v1(p_note) !~
   '(ซื้อ|สำรองจ่าย|คืนเงิน|เบิก.*จ่าย|ค่า|วัสดุ|อุปกรณ์|ใบเสนอราคา|ใบแจ้งหนี้|ให้.*(คนงาน|ช่าง|ผู้รับเหมา)|จ่าย.*(คนงาน|ช่าง|ผู้รับเหมา)|ไม่|ห้าม|ยังไม่ได้|พรุ่งนี้|มะรืน|จะเบิก|ขอเบิก|ไหม|มั้ย|หรือ|\?|purchase|reimburse|quotation|invoice|notpaid|notadvance|tomorrow)';
$$;
create function public.financial_employee_advance_aliases_valid_v1(p_aliases text[],p_approval_ref text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(cardinality(p_aliases) between 0 and 12
  and (cardinality(p_aliases)=0 or (array_ndims(p_aliases)=1 and nullif(trim(p_approval_ref),'') is not null))
  and not exists(select 1 from unnest(p_aliases) a where a is null or length(trim(a)) not between 3 and 160
   or not public.financial_employee_advance_alias_note_ok_v1(a)
   or public.financial_employee_advance_normalize_alias_v1(a) in
    ('','เบิก','พนักงานเบิก','เบิกพนักงาน','เบิกเงิน','เงินเบิก','เบิกเงินเดือน','เงินเดือน','เงินเดือนล่วงหน้า',
     'เบิกเงินเดือนล่วงหน้า','พนักงานเบิกเงิน','พนักงานเบิกเงินเดือน','พนักงานเบิกเงินเดือนล่วงหน้า',
     'staffadvance','employeeadvance','salaryadvance','cashadvance','staffsalaryadvance','employeesalaryadvance',
     'salary','payroll','advance','withdrawal'))
  and (select count(distinct public.financial_employee_advance_normalize_alias_v1(a)) from unnest(p_aliases) a)=cardinality(p_aliases),false);
$$;
-- An already staged employee card retains its server-captured source note even
-- when its display purpose is canonicalized. Client source-note fields are ignored.
create function public.financial_employee_advance_saved_note_v1(p_purpose text,p_review jsonb,p_extraction jsonb)
returns text language sql immutable security invoker set search_path='' as $$
 select case when p_review->>'kind'='employee_advance' then
  coalesce(nullif(trim(p_review->>'alias_source_note'),''),nullif(trim(p_purpose),''),
   nullif(trim(p_extraction->>'visible_payment_note'),''),nullif(trim(p_extraction->>'note'),''),'')
 else coalesce(nullif(trim(p_review->>'purpose'),''),nullif(trim(p_purpose),''),
  nullif(trim(p_extraction->>'visible_payment_note'),''),nullif(trim(p_extraction->>'note'),''),'') end;
$$;

create table public.financial_owner_employee_profiles(
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  employee_id uuid not null references tamma_chart_os.employees(id) on delete restrict,
  employee_key text not null check(length(trim(employee_key))>0),
  business_unit_code text not null check(business_unit_code in
    ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other')),
  role_label text,
  salary_period text not null default 'unknown' check(salary_period in ('monthly','unknown')),
  salary_advance_aliases text[] not null default '{}'::text[],
  salary_advance_alias_approval_ref text,
  constraint financial_owner_employee_alias_approval_check check(
    public.financial_employee_advance_aliases_valid_v1(salary_advance_aliases,salary_advance_alias_approval_ref)),
  active boolean not null default true,
  revision integer not null default 1 check(revision>0),
  approval_ref text not null check(length(trim(approval_ref))>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(owner_group_hash,employee_id),
  unique(owner_group_hash,employee_key)
);
alter table public.financial_owner_employee_profiles enable row level security;
revoke all on public.financial_owner_employee_profiles from public,anon,authenticated;
grant select,insert,update on public.financial_owner_employee_profiles to service_role;

-- Profile changes use the same group lock as confirmation. This includes new
-- profiles, so a concurrent duplicate alias cannot appear after uniqueness review.
create function public.financial_employee_advance_profile_guard_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='DELETE' then
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(old.owner_group_hash,117))
   then raise exception 'employee_profile_busy'; end if;
  return old;
 end if;
 if tg_op='UPDATE' and (old.owner_group_hash is distinct from new.owner_group_hash
  or old.employee_id is distinct from new.employee_id) then raise exception 'employee_profile_identity_immutable'; end if;
 -- A row UPDATE may already hold its row lock before this trigger. Never wait
 -- for the group lock here: a confirmer may hold it and be waiting for this row.
 if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_group_hash,117))
  then raise exception 'employee_profile_busy'; end if;
 if tg_op='UPDATE' then
  if row(old.employee_key,old.business_unit_code,old.role_label,old.salary_period,old.active,
    old.salary_advance_aliases,old.salary_advance_alias_approval_ref) is distinct from
   row(new.employee_key,new.business_unit_code,new.role_label,new.salary_period,new.active,
    new.salary_advance_aliases,new.salary_advance_alias_approval_ref) then
   new.revision:=greatest(old.revision+1,new.revision); new.updated_at:=now();
  elsif new.revision<old.revision then raise exception 'employee_profile_revision_regressed'; end if;
 end if;
 return new;
end $$;
create trigger financial_employee_advance_profile_guard_v1
 before insert or update or delete on public.financial_owner_employee_profiles
 for each row execute function public.financial_employee_advance_profile_guard_v1();

alter table public.financial_employee_payroll_events
  add column employee_id uuid references tamma_chart_os.employees(id) on delete restrict,
  add column source_intake_id uuid references public.financial_owner_expense_intakes(id) on delete restrict,
  add column business_unit_code text,
  add column normalized_bank_reference text generated always as
    (nullif(lower(regexp_replace(coalesce(slip_extracted_data->>'reference_number',''),'[[:space:]]','','g')),'')) stored;
-- Fail closed at deployment if historical payroll already contains duplicates.
-- Do not resolve historical collisions by deleting/cancelling genuine payments.
create unique index financial_payroll_source_intake_unique_v2
  on public.financial_employee_payroll_events(owner_group_hash,source_intake_id)
  where source_intake_id is not null;
create unique index financial_payroll_bank_reference_unique_v2
  on public.financial_employee_payroll_events(owner_group_hash,normalized_bank_reference)
  where normalized_bank_reference is not null and status<>'cancelled';
create unique index financial_payroll_slip_message_unique_v2
 on public.financial_employee_payroll_events(owner_group_hash,slip_message_id)
 where nullif(slip_message_id,'') is not null and status<>'cancelled';
create unique index financial_payroll_slip_sha_unique_v2
 on public.financial_employee_payroll_events(owner_group_hash,slip_sha256)
 where nullif(slip_sha256,'') is not null and status<>'cancelled';
create index financial_payroll_employee_month_v2
  on public.financial_employee_payroll_events(owner_group_hash,employee_id,event_date);
alter table public.financial_owner_expense_intakes
  add column payroll_event_id uuid references public.financial_employee_payroll_events(id) on delete restrict;

create table public.financial_employee_advance_audit_events(
  id uuid primary key default gen_random_uuid(),
  owner_group_hash text not null,
  employee_id uuid references tamma_chart_os.employees(id) on delete restrict,
  intake_id uuid references public.financial_owner_expense_intakes(id) on delete restrict,
  event_id uuid references public.financial_employee_payroll_events(id) on delete restrict,
  action text not null check(action in ('profile_bound','staged','confirmed','imported','reverted')),
  source text not null check(source in ('line','backoffice')),
  actor_hash text,
  source_message_id text,
  approval_ref text not null check(length(trim(approval_ref))>0),
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.financial_employee_advance_audit_events enable row level security;
revoke all on public.financial_employee_advance_audit_events from public,anon,authenticated;
grant select,insert on public.financial_employee_advance_audit_events to service_role;
create unique index financial_advance_stage_message_unique_v1
 on public.financial_employee_advance_audit_events(owner_group_hash,intake_id,source_message_id)
 where action='staged';

-- Explicit nonpayment/incoming/multiple-document metadata always wins over OCR type.
-- Legacy transfer slips with absent metadata remain readable; a salary-advance
-- confirmation supplies outgoing purpose, but cannot override explicit incoming.
create function public.financial_employee_advance_evidence_ok_v1(p_type text,p_data jsonb)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(p_type='transfer_slip'
  and (not (p_data ? 'document_kind') or p_data->>'document_kind'='transfer_evidence')
  and (not (p_data ? 'funds_direction') or p_data->>'funds_direction' in ('unknown','outgoing'))
  and (not (p_data ? 'payment_document_count') or p_data->'payment_document_count'='1'::jsonb),false);
$$;

-- Serialize all payroll writers in the same owner group, including legacy RPCs,
-- so a card's monthly snapshot and commit share the same transaction boundary.
create function public.financial_employee_advance_group_lock_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='UPDATE' and old.owner_group_hash is distinct from new.owner_group_hash
  then raise exception 'payroll_owner_group_immutable'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_group_hash,117));
 return new;
end $$;
create trigger financial_employee_advance_group_lock_v1
 before insert or update on public.financial_employee_payroll_events
 for each row execute function public.financial_employee_advance_group_lock_v1();

-- Older generic expense cards must not bypass payroll review by carrying a
-- salary-advance purpose. No mutation of money or historical records occurs here.
create function public.financial_employee_advance_expense_guard_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_purpose text; v_ref text;
begin
 if new.status not in ('categorized','needs_review') then return new; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_group_hash,117));
 -- An explicit reviewed correction supersedes OCR; old OCR alone cannot override it.
 v_purpose:=coalesce(nullif(trim(new.review_data->>'purpose'),''),nullif(trim(new.purpose_raw),''),
  new.extraction_data->>'visible_payment_note','');
 if v_purpose ~ '(ไปซื้อ|ซื้อของ|ซื้อ|สำรองจ่าย)' then
  v_purpose:=regexp_replace(v_purpose,'ไม่ใช่[[:space:]]*(เบิก)?เงินเดือน(ล่วงหน้า)?','','g');
 end if;
 if new.payroll_event_id is not null or new.review_data->>'kind'='employee_advance'
  or v_purpose ~ '(เบิกเงินเดือน|เงินเดือนล่วงหน้า)'
  or (v_purpose ~ 'เบิก' and v_purpose !~ '(ซื้อ|สำรองจ่าย|ค่า|งบ|คืน)')
  then raise exception 'salary_advance_requires_payroll_review'; end if;
 if exists(select 1 from public.financial_owner_employee_profiles pr
  join tamma_chart_os.employees emp on emp.id=pr.employee_id
  where pr.owner_group_hash=new.owner_group_hash and pr.active and emp.status='ทำงานอยู่'
   and nullif(trim(pr.salary_advance_alias_approval_ref),'') is not null
   and exists(select 1 from unnest(pr.salary_advance_aliases) alias_note where
    public.financial_employee_advance_normalize_alias_v1(alias_note)=public.financial_employee_advance_normalize_alias_v1(v_purpose)))
  then raise exception 'salary_advance_requires_payroll_review'; end if;
 v_ref:=nullif(lower(regexp_replace(coalesce(new.reference_number,''),'[[:space:]]','','g')),'');
 if exists(select 1 from public.financial_employee_payroll_events p
  where p.owner_group_hash=new.owner_group_hash and p.status<>'cancelled' and
   (p.source_intake_id=new.id or p.slip_message_id=new.evidence_message_id or p.slip_sha256=new.evidence_sha256
    or (v_ref is not null and p.normalized_bank_reference=v_ref)))
  then raise exception 'evidence_already_counted_as_payroll'; end if;
 return new;
end $$;
create trigger financial_employee_advance_expense_guard_v1
 before insert or update on public.financial_owner_expense_intakes
 for each row execute function public.financial_employee_advance_expense_guard_v1();

-- Symmetric guard: an investment recorded after payroll cannot add the same
-- source payment a second time, including when the payroll source is backoffice.
create function public.financial_employee_advance_investment_guard_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.status<>'recorded' then return new; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.owner_group_hash,117));
 if exists(select 1 from public.financial_employee_payroll_events p
  where p.owner_group_hash=new.owner_group_hash and p.status<>'cancelled'
   and (p.slip_message_id=new.source_message_id or p.source_message_id=new.source_message_id))
  then raise exception 'evidence_already_counted_as_payroll'; end if;
 return new;
end $$;
create trigger financial_employee_advance_investment_guard_v1
 before insert or update on public.financial_investment_entries
 for each row execute function public.financial_employee_advance_investment_guard_v1();

create function public.owner_employee_advance_context_v1(
 p_group_hash text,p_employee_query text default null,p_employee_id uuid default null,
 p_event_date date default null
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v_start date; v_end date; v_candidates jsonb; v_aliases jsonb; v_alias jsonb;
begin
 if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
 v_start:=date_trunc('month',coalesce(p_event_date,timezone('Asia/Bangkok',now())::date))::date;
 v_end:=(v_start+interval '1 month')::date;
 select coalesce(jsonb_agg(jsonb_build_object('employee_id',pr.employee_id,
   'normalized_alias',public.financial_employee_advance_normalize_alias_v1(p_employee_query),
   'approval_ref',pr.salary_advance_alias_approval_ref,'profile_revision',pr.revision)),'[]'::jsonb)
 into v_aliases from public.financial_owner_employee_profiles pr
 join tamma_chart_os.employees emp on emp.id=pr.employee_id
 where pr.owner_group_hash=p_group_hash and pr.active and emp.status='ทำงานอยู่'
  and nullif(trim(pr.salary_advance_alias_approval_ref),'') is not null
  and public.financial_employee_advance_alias_note_ok_v1(p_employee_query)
  and exists(select 1 from unnest(pr.salary_advance_aliases) alias_note
   where public.financial_employee_advance_normalize_alias_v1(alias_note)=public.financial_employee_advance_normalize_alias_v1(p_employee_query));
 if jsonb_array_length(v_aliases)=1 and (p_employee_id is null or (v_aliases->0->>'employee_id')::uuid=p_employee_id)
  then v_alias:=v_aliases->0; end if;
 select coalesce(jsonb_agg(x.item order by x.label,x.employee_id),'[]'::jsonb) into v_candidates
 from (
  select e.id as employee_id,coalesce(nullif(e.nickname,''),e.full_name) as label,
   jsonb_build_object('employee_id',e.id,'employee_key',pr.employee_key,
    'label',coalesce(nullif(e.nickname,''),e.full_name),
    'employee_label',coalesce(nullif(e.nickname,''),e.full_name),
    'full_name',e.full_name,'nickname',e.nickname,'business_unit_code',pr.business_unit_code,
    'role_label',pr.role_label,'monthly_salary',case when pr.salary_period='monthly' then e.wage_amount else null end,
    'wage_amount',e.wage_amount,'salary_basis',case when pr.salary_period='monthly' then 'owner_confirmed_monthly' else 'unit_unknown' end,
    'profile_revision',pr.revision,'employee_updated_at',e.updated_at,
    'monthly_sum',coalesce(t.monthly_sum,0),'month_paid_advance',coalesce(t.monthly_sum,0),
    'advance_outstanding',coalesce(t.advance_outstanding,0)) as item
  from public.financial_owner_employee_profiles pr
  join tamma_chart_os.employees e on e.id=pr.employee_id
  left join lateral (
   select sum(p.amount) filter(where p.event_type='salary_advance' and p.status='paid'
        and p.event_date>=v_start and p.event_date<v_end) as monthly_sum,
    greatest(0,coalesce(sum(case when p.event_type='salary_advance' and p.status='paid' then p.amount
      when p.event_type='advance_deduction' and p.status='recorded' then -p.amount else 0 end),0)) as advance_outstanding
   from public.financial_employee_payroll_events p
   where p.owner_group_hash=pr.owner_group_hash
    and (p.employee_id=e.id or (p.employee_id is null and p.employee_key=pr.employee_key))
  ) t on true
  where pr.owner_group_hash=p_group_hash and pr.active
   and e.status='ทำงานอยู่'
   and (p_employee_id is null or e.id=p_employee_id)
   and (p_employee_id is not null or nullif(trim(p_employee_query),'') is null
    or position(lower(trim(p_employee_query)) in lower(coalesce(e.nickname,'')||' '||e.full_name||' '||pr.employee_key))>0
    or exists(select 1 from unnest(pr.salary_advance_aliases) alias_note where
      public.financial_employee_advance_normalize_alias_v1(alias_note)=public.financial_employee_advance_normalize_alias_v1(p_employee_query)))
 ) x;
 return jsonb_build_object('ok',true,'candidates',v_candidates,'month_start',v_start,'month_end',v_end,
  'month',to_char(v_start,'YYYY-MM'),'alias_resolution',v_alias,'alias_match_count',jsonb_array_length(v_aliases),'selected',case when jsonb_array_length(v_candidates)=1 then v_candidates->0 else null end);
end $$;

create function public.financial_stage_owner_employee_advance_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_message_id text,p_revision integer,p_proposal jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.financial_owner_expense_intakes%rowtype; a record; c jsonb; e jsonb;
 d jsonb; q jsonb:='[]'::jsonb; v_date date; v_amount numeric; v_employee uuid; v_funding text;
 v_note text; v_alias jsonb;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
 select * into r from public.financial_owner_expense_intakes where id=p_intake_id for update;
 if r.id is null or r.owner_group_hash is distinct from p_group_hash or nullif(trim(p_actor_hash),'') is null
   or r.source_user_hash is distinct from p_actor_hash or nullif(trim(p_message_id),'') is null then
  raise exception 'owner_review_identity_mismatch'; end if;
 select * into a from public.financial_employee_advance_audit_events
 where intake_id=r.id and owner_group_hash=p_group_hash and action='staged' and source_message_id=p_message_id;
 if a.id is not null then
  if a.after_data->'request_proposal' is distinct from p_proposal then raise exception 'idempotency_payload_mismatch'; end if;
  return jsonb_build_object('ok',true,'duplicate',true,'revision',r.review_revision,'proposal',r.review_data);
 end if;
 if r.payroll_event_id is not null or r.status not in ('awaiting_purpose','awaiting_business')
  or (r.review_state is not null and r.review_state<>'draft') or r.review_revision is distinct from p_revision
  then return jsonb_build_object('conflict',true); end if;
 if jsonb_typeof(p_proposal) is distinct from 'object' or p_proposal->>'kind' is distinct from 'employee_advance'
  or coalesce(p_proposal->>'event_type','') not in ('salary_advance','unknown') then raise exception 'invalid_advance_proposal'; end if;
 v_employee:=nullif(p_proposal->>'employee_id','')::uuid;
 v_amount:=nullif(p_proposal->>'amount','')::numeric;
 v_date:=nullif(p_proposal->>'occurred_on','')::date;
 v_funding:=coalesce(nullif(p_proposal->>'funding_source',''),'unknown');
 if v_funding not in ('owner_personal','business_account','cash','other','unknown') then raise exception 'invalid_funding_source'; end if;
 if v_amount is not null and (v_amount<=0 or v_amount>100000000) then raise exception 'invalid_advance_amount'; end if;
 if v_amount is not null and coalesce(r.amount,nullif(r.extraction_data->>'amount_total','')::numeric) is not null
  and v_amount is distinct from coalesce(r.amount,nullif(r.extraction_data->>'amount_total','')::numeric)
  then raise exception 'advance_amount_evidence_mismatch'; end if;
 if v_date is not null and nullif(r.extraction_data->>'document_date_local','') is not null
   and v_date is distinct from (r.extraction_data->>'document_date_local')::date then raise exception 'advance_date_evidence_mismatch'; end if;
 v_note:=public.financial_employee_advance_saved_note_v1(r.purpose_raw,r.review_data,r.extraction_data);
 if p_proposal->'alias_inference' is not null and p_proposal->'alias_inference'<>'null'::jsonb then
  -- Lock all alias-bearing employees, even currently inactive ones: their
  -- activation must not change uniqueness while this review decision commits.
  perform 1 from public.financial_owner_employee_profiles pr
   join tamma_chart_os.employees emp on emp.id=pr.employee_id
   where pr.owner_group_hash=p_group_hash and exists(select 1 from unnest(pr.salary_advance_aliases) alias_note
    where public.financial_employee_advance_normalize_alias_v1(alias_note)=public.financial_employee_advance_normalize_alias_v1(v_note))
   order by pr.employee_id for share of pr,emp;
  c:=public.owner_employee_advance_context_v1(p_group_hash,v_note,null,v_date); v_alias:=c->'alias_resolution';
  if v_alias is null or v_alias='null'::jsonb or v_alias is distinct from p_proposal->'alias_inference'
   or p_proposal->>'event_type'<>'salary_advance' or v_employee is distinct from (v_alias->>'employee_id')::uuid
   then return jsonb_build_object('changed',true,'alias_invalid',true); end if;
 end if;
 c:=public.owner_employee_advance_context_v1(p_group_hash,p_proposal->>'employee_query',v_employee,v_date);
 if v_employee is not null then
  e:=c->'selected';
  if e is null or e='null'::jsonb then raise exception 'employee_not_bound_to_owner_group'; end if;
  if nullif(p_proposal->>'business_unit_code','') is not null
   and p_proposal->>'business_unit_code' is distinct from e->>'business_unit_code' then raise exception 'employee_affiliation_mismatch'; end if;
 else q:=q||jsonb_build_array('ระบุพนักงานจากรายชื่อที่ผูกไว้'); end if;
 if p_proposal->>'event_type'<>'salary_advance' then q:=q||jsonb_build_array('ยืนยันว่าเป็นเบิกเงินเดือนล่วงหน้า ไม่ใช่เงินซื้อของ'); end if;
 if v_amount is null then q:=q||jsonb_build_array('ระบุยอดจากสลิป'); end if;
 if v_date is null or nullif(r.extraction_data->>'document_date_local','') is null
  then q:=q||jsonb_build_array('วันที่จ่ายจากหลักฐานยังไม่ชัด'); end if;
 if not public.financial_employee_advance_evidence_ok_v1(r.document_type,r.extraction_data)
  then q:=q||jsonb_build_array('ต้องเป็นสลิปโอนเงินออกหนึ่งรายการ ไม่ใช่ใบเสนอราคาหรือเงินเข้า'); end if;
 if coalesce(r.extraction_confidence,0)<0.8 then q:=q||jsonb_build_array('หลักฐานยังต้องตรวจความชัดเจน'); end if;
 d:=jsonb_build_object('kind','employee_advance','event_type',p_proposal->>'event_type',
  'employee_query',coalesce(p_proposal->>'employee_query',''),'employee_id',v_employee,
  'business_unit_code',e->>'business_unit_code','funding_source',v_funding,
  'amount',v_amount,'occurred_on',v_date,'purpose',coalesce(nullif(p_proposal->>'purpose',''),'พนักงานเบิก'),
  'questions',q,'employee',e,'monthly_sum_before',e->'monthly_sum',
  'alias_inference',v_alias,'alias_source_note',v_note,
  'evidence_message_id',r.evidence_message_id,'evidence_sha256',r.evidence_sha256,
  'evidence_reference',r.reference_number,'evidence_amount',r.amount,'evidence_date',r.occurred_on);
 update public.financial_owner_expense_intakes set review_state='draft',review_data=d,
  review_revision=review_revision+1,review_message_id=p_message_id,updated_at=now() where id=r.id;
 insert into public.financial_employee_advance_audit_events(owner_group_hash,employee_id,intake_id,action,source,actor_hash,source_message_id,approval_ref,before_data,after_data)
 values(p_group_hash,v_employee,r.id,'staged','line',p_actor_hash,p_message_id,p_message_id,
  jsonb_build_object('review_state',r.review_state,'review_revision',r.review_revision,'review_data',r.review_data),
  jsonb_build_object('request_proposal',p_proposal,'proposal',d,'revision',r.review_revision+1));
 return jsonb_build_object('ok',true,'revision',r.review_revision+1,'proposal',d);
end $$;

-- The commit core is not a client endpoint. Both wrappers below call it with a
-- guarded source record. It still validates all identity/evidence boundaries.
create function public.financial_commit_owner_employee_advance_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_revision integer,p_message_id text,
 p_source text,p_approval_ref text,p_proposal jsonb,p_expected_updated_at timestamptz default null
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.financial_owner_expense_intakes%rowtype; ev public.financial_employee_payroll_events%rowtype;
 c jsonb; e jsonb; d jsonb; v_id uuid; v_date date; v_amount numeric; v_ref text; v_before numeric; v_after jsonb; v_alias jsonb; v_note text;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
 select * into r from public.financial_owner_expense_intakes where id=p_intake_id for update;
 if r.id is null or r.owner_group_hash is distinct from p_group_hash then raise exception 'owner_group_mismatch'; end if;
 if p_source not in ('line','backoffice') or nullif(trim(p_message_id),'') is null
  or nullif(trim(p_approval_ref),'') is null then raise exception 'approval_reference_required'; end if;
 if p_source='line' and (nullif(trim(p_actor_hash),'') is null or r.source_user_hash is distinct from p_actor_hash)
  then raise exception 'owner_review_identity_mismatch'; end if;
 -- A repeated completed commit is read-only, and must still match its original intent.
 if r.payroll_event_id is not null then
  select * into ev from public.financial_employee_payroll_events where id=r.payroll_event_id;
  if ev.status<>'paid' or ev.owner_group_hash is distinct from p_group_hash
   or ev.source_channel is distinct from p_source
   or (p_source='backoffice' and ev.metadata->>'approval_ref' is distinct from p_approval_ref)
   or (p_source='line' and ev.created_by_hash is distinct from p_actor_hash)
   then raise exception 'advance_already_linked'; end if;
  if p_source='backoffice' and (ev.employee_id is distinct from (p_proposal->>'employee_id')::uuid
    or ev.amount is distinct from (p_proposal->>'amount')::numeric
    or ev.event_date is distinct from (p_proposal->>'occurred_on')::date
    or ev.funding_source is distinct from p_proposal->>'funding_source') then raise exception 'idempotency_payload_mismatch'; end if;
  c:=public.owner_employee_advance_context_v1(p_group_hash,null,ev.employee_id,ev.event_date); e:=c->'selected';
  return jsonb_build_object('ok',true,'duplicate',true,'event_id',ev.id,'employee',e,'amount',ev.amount,
   'occurred_on',ev.event_date,'funding_source',ev.funding_source,'monthly_sum',e->'monthly_sum','advance_outstanding',e->'advance_outstanding');
 end if;
 if r.status not in ('awaiting_purpose','awaiting_business') or r.review_revision is distinct from p_revision
  then return jsonb_build_object('conflict',true); end if;
 if p_source='line' then
  if r.review_state is distinct from 'draft' then return jsonb_build_object('conflict',true); end if;
  d:=r.review_data;
 else
  if p_expected_updated_at is null or r.updated_at is distinct from p_expected_updated_at
   then raise exception 'source_intake_changed'; end if;
  if r.review_state is not null and r.review_state<>'draft' then raise exception 'source_intake_not_pending'; end if;
  d:=p_proposal;
 end if;
 if d->>'kind' is distinct from 'employee_advance' or d->>'event_type' is distinct from 'salary_advance'
  or jsonb_typeof(d->'questions') is distinct from 'array' or jsonb_array_length(d->'questions')<>0
  then raise exception 'advance_review_incomplete'; end if;
 v_amount:=(d->>'amount')::numeric; v_date:=(d->>'occurred_on')::date;
 if v_amount is null or v_amount<=0 or v_amount>100000000 or v_date is null or nullif(d->>'employee_id','') is null
  then raise exception 'advance_review_incomplete'; end if;
 if coalesce(d->>'funding_source','') not in ('owner_personal','business_account','cash','other','unknown')
  then raise exception 'invalid_funding_source'; end if;
 if not public.financial_employee_advance_evidence_ok_v1(r.document_type,r.extraction_data)
  or r.currency is distinct from 'THB' or coalesce(r.extraction_confidence,0)<0.8
  or nullif(r.storage_path,'') is null or r.storage_bucket is distinct from 'owner-expense-evidence'
  or coalesce(r.evidence_sha256,'') !~ '^[a-f0-9]{64}$' then raise exception 'advance_evidence_not_ready'; end if;
 if coalesce(r.amount,nullif(r.extraction_data->>'amount_total','')::numeric) is distinct from v_amount
  then raise exception 'advance_amount_evidence_mismatch'; end if;
 if nullif(r.extraction_data->>'document_date_local','')::date is distinct from v_date
  then raise exception 'advance_date_evidence_mismatch'; end if;
 if d->>'evidence_message_id' is distinct from r.evidence_message_id
  or d->>'evidence_sha256' is distinct from r.evidence_sha256
  or d->>'evidence_reference' is distinct from r.reference_number then raise exception 'advance_evidence_changed'; end if;
 perform 1 from public.financial_owner_employee_profiles pr
  join tamma_chart_os.employees emp on emp.id=pr.employee_id
  where pr.owner_group_hash=p_group_hash and pr.employee_id=(d->>'employee_id')::uuid for share of pr,emp;
 c:=public.owner_employee_advance_context_v1(p_group_hash,null,(d->>'employee_id')::uuid,v_date); e:=c->'selected';
 if e is null or e='null'::jsonb then return jsonb_build_object('changed',true,'employee',null,'employee_missing',true); end if;
 if d->'alias_inference' is not null and d->'alias_inference'<>'null'::jsonb then
  v_note:=public.financial_employee_advance_saved_note_v1(r.purpose_raw,r.review_data,r.extraction_data);
  -- Lock all alias-bearing employees, even currently inactive ones: their
  -- activation must not change uniqueness while this review decision commits.
  perform 1 from public.financial_owner_employee_profiles pr
   join tamma_chart_os.employees emp on emp.id=pr.employee_id
   where pr.owner_group_hash=p_group_hash and exists(select 1 from unnest(pr.salary_advance_aliases) alias_note
    where public.financial_employee_advance_normalize_alias_v1(alias_note)=public.financial_employee_advance_normalize_alias_v1(v_note))
   order by pr.employee_id for share of pr,emp;
  v_alias:=public.owner_employee_advance_context_v1(p_group_hash,v_note,null,v_date)->'alias_resolution';
  if v_alias is null or v_alias='null'::jsonb or v_alias is distinct from d->'alias_inference'
   or (v_alias->>'employee_id')::uuid is distinct from (d->>'employee_id')::uuid
   then return jsonb_build_object('changed',true,'alias_invalid',true,'employee',e); end if;
 end if;
 if d->>'business_unit_code' is distinct from e->>'business_unit_code' then return jsonb_build_object('changed',true,'employee',e); end if;
 if d->'employee'->>'profile_revision' is distinct from e->>'profile_revision'
  or d->'employee'->>'employee_updated_at' is distinct from e->>'employee_updated_at'
  then return jsonb_build_object('changed',true,'employee',e); end if;
 v_before:=(e->>'monthly_sum')::numeric;
 if (d->>'monthly_sum_before')::numeric is distinct from v_before
  then return jsonb_build_object('changed',true,'employee',e,'monthly_sum',v_before); end if;
 v_ref:=nullif(lower(regexp_replace(coalesce(r.reference_number,''),'[[:space:]]','','g')),'');
 if exists(select 1 from public.financial_employee_payroll_events p where p.owner_group_hash=p_group_hash and p.status<>'cancelled'
   and (p.source_intake_id=r.id or p.slip_message_id=r.evidence_message_id or p.slip_sha256=r.evidence_sha256
    or (v_ref is not null and p.normalized_bank_reference=v_ref)))
  then return jsonb_build_object('duplicate_transaction',true); end if;
 -- Classified expense/capital copies must be resolved explicitly, never silently moved.
 if exists(select 1 from public.financial_owner_expense_intakes i where i.id<>r.id and i.owner_group_hash=p_group_hash
  and i.status in ('categorized','needs_review') and
   (i.evidence_sha256=r.evidence_sha256 or i.evidence_message_id=r.evidence_message_id or
    (v_ref is not null and lower(regexp_replace(coalesce(i.reference_number,''),'[[:space:]]','','g'))=v_ref)))
  then raise exception 'evidence_already_counted_as_expense'; end if;
 if exists(select 1 from public.financial_investment_entries i where i.owner_group_hash=p_group_hash
  and i.status='recorded' and i.source_message_id=r.evidence_message_id)
  then raise exception 'evidence_already_counted_as_investment'; end if;
 insert into public.financial_employee_payroll_events(
  event_type,employee_label,employee_key,employee_id,amount,event_date,pay_period,funding_source,status,
  source_channel,source_message_id,owner_group_hash,created_by_hash,slip_message_id,slip_sha256,
  storage_bucket,storage_path,mime_type,slip_amount,slip_confidence,slip_extracted_data,metadata,source_intake_id,business_unit_code)
 values('salary_advance',e->>'label',e->>'employee_key',(e->>'employee_id')::uuid,v_amount,v_date,null,
  d->>'funding_source','paid',p_source,p_message_id,p_group_hash,nullif(p_actor_hash,''),r.evidence_message_id,r.evidence_sha256,
  r.storage_bucket,r.storage_path,r.mime_type,v_amount,r.extraction_confidence,
  r.extraction_data||jsonb_build_object('reference_number',r.reference_number),
  jsonb_build_object('approval_ref',p_approval_ref,'approval_source',p_source,'privacy_scope','owner_only',
   'not_shop_expense',true,'not_capital_investment',true,'role_label',e->>'role_label',
   'funding_classification',case when d->>'funding_source'='unknown' then 'unknown' else 'owner_or_operator_confirmed' end,'original_intake_id',r.id,
   'alias_inference',d->'alias_inference',
   'classification_approval_refs',coalesce(d->'classification_approval_refs','[]'::jsonb),
   'funding_evidence_refs',coalesce(d->'funding_evidence_refs','[]'::jsonb)),r.id,e->>'business_unit_code')
 returning id into v_id;
 update public.financial_owner_expense_intakes set status='cancelled',review_state='confirmed',
  review_revision=review_revision+1,review_message_id=p_message_id,
  review_data=d||jsonb_build_object('payroll_event_id',v_id,'expense_representation_excluded',true,'payment_cancelled',false),
  payroll_event_id=v_id,updated_at=now() where id=r.id;
 insert into public.financial_owner_expense_audit_events(intake_id,action,source,actor_hash,message_id,reason,before_data,after_data)
 values(r.id,'reclassified',p_source,nullif(p_actor_hash,''),p_message_id,
  'Linked to paid salary advance; expense representation excluded, original payment and evidence retained. Approval: '||p_approval_ref,
  to_jsonb(r),jsonb_build_object('payroll_event_id',v_id,'status','cancelled','payment_cancelled',false));
 select * into ev from public.financial_employee_payroll_events where id=v_id;
 select to_jsonb(i) into v_after from public.financial_owner_expense_intakes i where id=r.id;
 insert into public.financial_employee_advance_audit_events(owner_group_hash,employee_id,intake_id,event_id,action,source,actor_hash,source_message_id,approval_ref,before_data,after_data)
 values(p_group_hash,ev.employee_id,r.id,v_id,case when p_source='line' then 'confirmed' else 'imported' end,
  p_source,nullif(p_actor_hash,''),p_message_id,p_approval_ref,
  jsonb_build_object('intake',to_jsonb(r),'monthly_sum',v_before),jsonb_build_object('event',to_jsonb(ev),'intake',v_after));
 c:=public.owner_employee_advance_context_v1(p_group_hash,null,ev.employee_id,v_date); e:=c->'selected';
 return jsonb_build_object('ok',true,'duplicate',false,'event_id',v_id,'employee',e,'amount',v_amount,
  'occurred_on',v_date,'funding_source',ev.funding_source,'monthly_sum_before',v_before,
  'monthly_sum',e->'monthly_sum','advance_outstanding',e->'advance_outstanding');
end $$;

create function public.financial_confirm_owner_employee_advance_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_revision integer,p_message_id text
) returns jsonb language sql security invoker set search_path='' as $$
 select public.financial_commit_owner_employee_advance_v1(p_intake_id,p_group_hash,p_actor_hash,p_revision,p_message_id,
  'line',p_message_id,null,null);
$$;

-- Explicit backoffice operation: caller has verified owner's approval outside
-- LINE and supplies exact expected facts. Never borrows the source LINE actor.
create function public.financial_import_owner_employee_advances_v1(
 p_group_hash text,p_approval_ref text,p_actor_hash text,p_rows jsonb,p_expected_total numeric
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j jsonb; r public.financial_owner_expense_intakes%rowtype; e tamma_chart_os.employees%rowtype;
 pr public.financial_owner_employee_profiles%rowtype; c jsonb; d jsonb; v_result jsonb; v_results jsonb:='[]'::jsonb;
 v_total numeric:=0; v_key text; v_aliases text[]; v_alias_approval text;
begin
 if length(trim(coalesce(p_group_hash,'')))<16 or nullif(trim(p_approval_ref),'') is null
  or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 25
  then raise exception 'invalid_import_request'; end if;
 if (select count(distinct x->>'intake_id') from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows)
  then raise exception 'duplicate_intake_in_request'; end if;
 if p_expected_total is null or p_expected_total is distinct from
  (select sum((x->>'amount')::numeric) from jsonb_array_elements(p_rows) x) then raise exception 'import_total_mismatch'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
 for j in select value from jsonb_array_elements(p_rows) order by value->>'intake_id' loop
  select * into e from tamma_chart_os.employees where id=(j->>'employee_id')::uuid for share;
  if e.id is null or e.restaurant_id is distinct from (j->>'expected_restaurant_id')::uuid
   or e.full_name is distinct from j->>'expected_employee_full_name'
   or e.wage_amount is distinct from (j->>'expected_salary')::numeric
   or e.updated_at is distinct from (j->>'expected_employee_updated_at')::timestamptz
   or e.status<>'ทำงานอยู่' then raise exception 'employee_changed'; end if;
  v_key:=lower(regexp_replace(trim(j->>'employee_key'),'[[:space:]]+',' ','g'));
  if nullif(v_key,'') is null or not coalesce(v_key=lower(regexp_replace(trim(e.full_name),'[[:space:]]+',' ','g'))
    or v_key=lower(regexp_replace(trim(e.nickname),'[[:space:]]+',' ','g')),false)
   then raise exception 'employee_key_mismatch'; end if;
  if j ? 'salary_advance_aliases' and jsonb_typeof(j->'salary_advance_aliases')<>'array' then raise exception 'invalid_alias_binding'; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(j->'salary_advance_aliases','[]'::jsonb)) a where jsonb_typeof(a)<>'string')
   then raise exception 'invalid_alias_binding'; end if;
  v_aliases:=array(select jsonb_array_elements_text(coalesce(j->'salary_advance_aliases','[]'::jsonb)));
  v_alias_approval:=nullif(trim(j->>'salary_advance_alias_approval_ref'),'');
  if not public.financial_employee_advance_aliases_valid_v1(v_aliases,v_alias_approval) then raise exception 'invalid_alias_binding'; end if;
  select * into pr from public.financial_owner_employee_profiles where owner_group_hash=p_group_hash and employee_id=e.id for update;
  if pr.employee_id is null then
   insert into public.financial_owner_employee_profiles(owner_group_hash,employee_id,employee_key,business_unit_code,role_label,salary_period,approval_ref,salary_advance_aliases,salary_advance_alias_approval_ref)
   values(p_group_hash,e.id,v_key,j->>'business_unit_code',j->>'role_label',coalesce(j->>'salary_period','unknown'),p_approval_ref,v_aliases,v_alias_approval);
   insert into public.financial_employee_advance_audit_events(owner_group_hash,employee_id,action,source,actor_hash,approval_ref,after_data)
   values(p_group_hash,e.id,'profile_bound','backoffice',nullif(p_actor_hash,''),p_approval_ref,
    jsonb_build_object('employee_key',v_key,'business_unit_code',j->>'business_unit_code','role_label',j->>'role_label','salary_period',coalesce(j->>'salary_period','unknown'),'salary_advance_aliases',to_jsonb(v_aliases),'salary_advance_alias_approval_ref',v_alias_approval));
  elsif not pr.active or pr.employee_key is distinct from v_key or pr.business_unit_code is distinct from j->>'business_unit_code'
   or pr.role_label is distinct from j->>'role_label' or pr.salary_period is distinct from coalesce(j->>'salary_period','unknown')
   or ((j ? 'salary_advance_aliases' or j ? 'salary_advance_alias_approval_ref') and
    (pr.salary_advance_aliases is distinct from v_aliases or pr.salary_advance_alias_approval_ref is distinct from v_alias_approval))
   then raise exception 'employee_profile_changed'; end if;
  select * into r from public.financial_owner_expense_intakes where id=(j->>'intake_id')::uuid for update;
  if r.id is null or r.owner_group_hash is distinct from p_group_hash then raise exception 'owner_group_mismatch'; end if;
  if r.reference_number is distinct from j->>'expected_reference'
   or r.evidence_message_id is distinct from j->>'expected_evidence_message_id'
   or r.evidence_sha256 is distinct from j->>'expected_evidence_sha256'
   then raise exception 'import_evidence_changed'; end if;
  c:=public.owner_employee_advance_context_v1(p_group_hash,null,e.id,(j->>'occurred_on')::date);
  d:=jsonb_build_object('kind','employee_advance','event_type','salary_advance','questions','[]'::jsonb,
   'employee_id',e.id,'employee',c->'selected','business_unit_code',j->>'business_unit_code',
   'funding_source',j->>'funding_source','amount',(j->>'amount')::numeric,'occurred_on',(j->>'occurred_on')::date,
   'purpose','เบิกเงินเดือนล่วงหน้า','monthly_sum_before',c->'selected'->'monthly_sum',
   'classification_approval_refs',coalesce(j->'classification_approval_refs','[]'::jsonb),
   'funding_evidence_refs',coalesce(j->'funding_evidence_refs','[]'::jsonb),
   'evidence_message_id',r.evidence_message_id,'evidence_sha256',r.evidence_sha256,'evidence_reference',r.reference_number);
  v_result:=public.financial_commit_owner_employee_advance_v1(r.id,p_group_hash,p_actor_hash,
   (j->>'expected_review_revision')::integer,'backoffice-advance:'||p_approval_ref||':'||r.id,
   'backoffice',p_approval_ref,d,(j->>'expected_updated_at')::timestamptz);
  if not coalesce((v_result->>'ok')::boolean,false) then raise exception 'import_conflict: %',v_result; end if;
  v_total:=v_total+(j->>'amount')::numeric; v_results:=v_results||jsonb_build_array(v_result);
 end loop;
 return jsonb_build_object('ok',true,'total',v_total,'results',v_results);
end $$;

-- Permission default denies every new helper/RPC to public/anon/authenticated.
-- service_role has existing access to the source tables; no source-table grants,
-- auth grants, keys, credentials, or RLS bypasses are introduced here.
revoke all on function public.owner_employee_advance_context_v1(text,text,uuid,date) from public,anon,authenticated;
revoke all on function public.financial_stage_owner_employee_advance_v1(uuid,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.financial_commit_owner_employee_advance_v1(uuid,text,text,integer,text,text,text,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.financial_confirm_owner_employee_advance_v1(uuid,text,text,integer,text) from public,anon,authenticated;
revoke all on function public.financial_import_owner_employee_advances_v1(text,text,text,jsonb,numeric) from public,anon,authenticated;
grant execute on function public.owner_employee_advance_context_v1(text,text,uuid,date) to service_role;
grant execute on function public.financial_stage_owner_employee_advance_v1(uuid,text,text,text,integer,jsonb) to service_role;
grant execute on function public.financial_commit_owner_employee_advance_v1(uuid,text,text,integer,text,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.financial_confirm_owner_employee_advance_v1(uuid,text,text,integer,text) to service_role;
grant execute on function public.financial_import_owner_employee_advances_v1(text,text,text,jsonb,numeric) to service_role;

revoke all on function public.financial_employee_advance_evidence_ok_v1(text,jsonb) from public,anon,authenticated;
grant execute on function public.financial_employee_advance_evidence_ok_v1(text,jsonb) to service_role;

revoke all on function public.financial_employee_advance_group_lock_v1() from public,anon,authenticated;
grant execute on function public.financial_employee_advance_group_lock_v1() to service_role;

revoke all on function public.financial_employee_advance_expense_guard_v1() from public,anon,authenticated;
grant execute on function public.financial_employee_advance_expense_guard_v1() to service_role;

-- Compensating reversal is a separate explicit backoffice approval, never DELETE.
-- It voids this bookkeeping representation only, does not reverse a bank payment,
-- retains the source link/evidence, and parks the source for manual reconciliation.
create function public.financial_revert_owner_employee_advance_v1(
 p_event_id uuid,p_group_hash text,p_approval_ref text,p_actor_hash text,p_reason text,
 p_expected_event_updated_at timestamptz,p_expected_intake_revision integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare ev public.financial_employee_payroll_events%rowtype; r public.financial_owner_expense_intakes%rowtype;
 a public.financial_employee_advance_audit_events%rowtype; v_after jsonb; c jsonb;
begin
 if nullif(trim(p_approval_ref),'') is null or nullif(trim(p_reason),'') is null
  then raise exception 'reversal_approval_and_reason_required'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
 select * into ev from public.financial_employee_payroll_events where id=p_event_id for update;
 if ev.id is null or ev.owner_group_hash is distinct from p_group_hash then raise exception 'owner_group_mismatch'; end if;
 if ev.status='cancelled' and ev.metadata->>'reversal_approval_ref'=p_approval_ref then
  return jsonb_build_object('ok',true,'duplicate',true,'event_id',ev.id,'payment_cancelled',false);
 end if;
 if ev.status<>'paid' or ev.event_type<>'salary_advance' or ev.source_intake_id is null
  or ev.updated_at is distinct from p_expected_event_updated_at then raise exception 'reversal_event_changed'; end if;
 select * into r from public.financial_owner_expense_intakes where id=ev.source_intake_id for update;
 if r.payroll_event_id is distinct from ev.id or r.review_revision is distinct from p_expected_intake_revision
  or r.status<>'cancelled' or r.review_state<>'confirmed' then raise exception 'reversal_intake_changed'; end if;
 select * into a from public.financial_employee_advance_audit_events
  where event_id=ev.id and action in ('confirmed','imported') order by created_at desc limit 1;
 if a.id is null or a.after_data->'event'->>'updated_at' is distinct from to_jsonb(ev)->>'updated_at'
  or a.after_data->'intake'->>'updated_at' is distinct from to_jsonb(r)->>'updated_at'
  then raise exception 'reversal_audit_mismatch'; end if;
 if exists(select 1 from public.financial_employee_payroll_events p
   where p.owner_group_hash=p_group_hash and p.created_at>=a.created_at
    and (p.employee_id=ev.employee_id or (p.employee_id is null and p.employee_key=ev.employee_key))
    and ((p.event_type='advance_deduction' and p.status='recorded') or (p.event_type='salary_payment' and p.status='paid')))
  then raise exception 'payroll_settlement_requires_manual_reconciliation'; end if;
 update public.financial_employee_payroll_events set status='cancelled',updated_at=now(),
  metadata=metadata||jsonb_build_object('reversal_approval_ref',p_approval_ref,'reversal_reason',p_reason,'payment_cancelled',false)
  where id=ev.id;
 update public.financial_owner_expense_intakes set status=a.before_data->'intake'->>'status',review_state='draft',
  review_revision=review_revision+1,review_message_id=null,updated_at=now(),
  review_data=coalesce(a.before_data->'intake'->'review_data','{}'::jsonb)||jsonb_build_object(
   'kind','employee_advance','payroll_event_id',ev.id,'reconciliation_required',true,'payment_cancelled',false,
   'questions',jsonb_build_array('รายการบัญชีถูกย้อนกลับ ต้องตรวจสอบก่อนจัดหมวดใหม่'),'reversal_approval_ref',p_approval_ref)
  where id=r.id;
 select to_jsonb(i) into v_after from public.financial_owner_expense_intakes i where id=r.id;
 insert into public.financial_employee_advance_audit_events(owner_group_hash,employee_id,intake_id,event_id,action,source,actor_hash,approval_ref,before_data,after_data)
 values(p_group_hash,ev.employee_id,r.id,ev.id,'reverted','backoffice',nullif(p_actor_hash,''),p_approval_ref,
  jsonb_build_object('event',to_jsonb(ev),'intake',to_jsonb(r)),
  jsonb_build_object('event_status','cancelled','intake',v_after,'reason',p_reason,'payment_cancelled',false));
 insert into public.financial_owner_expense_audit_events(intake_id,action,source,actor_hash,reason,before_data,after_data)
 values(r.id,'reclassified','backoffice',nullif(p_actor_hash,''),'Audited payroll representation reversal: '||p_reason,to_jsonb(r),v_after);
 c:=public.owner_employee_advance_context_v1(p_group_hash,null,ev.employee_id,ev.event_date);
 return jsonb_build_object('ok',true,'event_id',ev.id,'payment_cancelled',false,'reconciliation_required',true,
  'monthly_sum',c->'selected'->'monthly_sum');
end $$;
revoke all on function public.financial_revert_owner_employee_advance_v1(uuid,text,text,text,text,timestamptz,integer) from public,anon,authenticated;
grant execute on function public.financial_revert_owner_employee_advance_v1(uuid,text,text,text,text,timestamptz,integer) to service_role;

revoke all on function public.financial_employee_advance_investment_guard_v1() from public,anon,authenticated;
grant execute on function public.financial_employee_advance_investment_guard_v1() to service_role;

-- New helpers retain the same service-only, SECURITY INVOKER boundary.
revoke all on function public.financial_employee_advance_normalize_alias_v1(text) from public,anon,authenticated;
grant execute on function public.financial_employee_advance_normalize_alias_v1(text) to service_role;
revoke all on function public.financial_employee_advance_aliases_valid_v1(text[],text) from public,anon,authenticated;
grant execute on function public.financial_employee_advance_aliases_valid_v1(text[],text) to service_role;
revoke all on function public.financial_employee_advance_saved_note_v1(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.financial_employee_advance_saved_note_v1(text,jsonb,jsonb) to service_role;
revoke all on function public.financial_employee_advance_profile_guard_v1() from public,anon,authenticated;
grant execute on function public.financial_employee_advance_profile_guard_v1() to service_role;
revoke all on function public.financial_employee_advance_alias_note_ok_v1(text) from public,anon,authenticated;
grant execute on function public.financial_employee_advance_alias_note_ok_v1(text) to service_role;
