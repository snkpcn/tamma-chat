-- Owner Project & Work OS
--
-- Canonical project, task, weekly-check-in, and installment records shared by
-- the Owner LINE group and Backoffice. Existing investment/expense rows are
-- preserved and only receive nullable links to this new model.

create table if not exists public.owner_projects(
  id uuid primary key default gen_random_uuid(),
  project_code text not null unique default (
    'PJ-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  name text not null check(length(trim(name)) between 2 and 180),
  normalized_name text not null check(length(trim(normalized_name)) between 2 and 180),
  purpose text null,
  business_unit_code text null check(
    business_unit_code is null or business_unit_code in (
      'inthanin','tamma_restaurant','huenstay','adventure','otop',
      'shared_infrastructure','shared','other'
    )
  ),
  location_label text null,
  budget_amount numeric(14,2) null check(
    budget_amount is null or (budget_amount>=0 and budget_amount<=100000000)
  ),
  currency text not null default 'THB' check(currency='THB'),
  status text not null default 'planning' check(
    status in ('planning','approved','active','paused','completed','cancelled')
  ),
  start_on date null,
  due_on date null,
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  created_by_hash text null,
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists owner_projects_group_name_active_unique
  on public.owner_projects(owner_group_hash,normalized_name)
  where status<>'cancelled';

create index if not exists owner_projects_dashboard_idx
  on public.owner_projects(status,due_on,updated_at desc);

create table if not exists public.owner_project_tasks(
  id uuid primary key default gen_random_uuid(),
  task_code text not null unique default (
    'WK-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))
  ),
  project_id uuid not null references public.owner_projects(id) on delete restrict,
  title text not null check(length(trim(title)) between 2 and 240),
  description text null,
  task_kind text not null default 'one_time' check(
    task_kind in ('pre_opening','one_time','weekly')
  ),
  recurrence_weekdays smallint[] not null default '{}'::smallint[] check(
    recurrence_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  recurrence_start_on date null,
  recurrence_end_on date null,
  due_on date null,
  schedule_text text null,
  responsible_name text null,
  counterparty_name text null,
  budget_amount numeric(14,2) null check(
    budget_amount is null or (budget_amount>=0 and budget_amount<=100000000)
  ),
  status text not null default 'todo' check(
    status in ('todo','in_progress','blocked','done','cancelled')
  ),
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  created_by_hash text null,
  confirmed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists owner_project_tasks_dashboard_idx
  on public.owner_project_tasks(project_id,status,due_on,updated_at desc);

create index if not exists owner_project_tasks_weekly_idx
  on public.owner_project_tasks(task_kind,status)
  where task_kind='weekly' and status not in ('done','cancelled');

create table if not exists public.owner_project_task_checkins(
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.owner_project_tasks(id) on delete restrict,
  week_start date not null,
  state text not null default 'pending' check(state in ('pending','done','blocked','skipped')),
  note text null,
  actor_hash text null,
  source text not null check(source in ('line','backoffice','system')),
  source_message_id text null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id,week_start)
);

create index if not exists owner_project_task_checkins_week_idx
  on public.owner_project_task_checkins(week_start,state,task_id);

create table if not exists public.owner_project_installments(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.owner_projects(id) on delete restrict,
  task_id uuid not null references public.owner_project_tasks(id) on delete restrict,
  installment_no smallint not null check(installment_no between 1 and 120),
  title text not null,
  amount numeric(14,2) null check(amount is null or (amount>=0 and amount<=100000000)),
  due_on date null,
  counterparty_name text null,
  payment_method text null check(
    payment_method is null or payment_method in ('cash','transfer','card','other')
  ),
  status text not null default 'planned' check(
    status in ('planned','due','paid','cancelled')
  ),
  paid_amount numeric(14,2) not null default 0 check(paid_amount>=0 and paid_amount<=100000000),
  paid_on date null,
  financial_investment_entry_id uuid null,
  owner_expense_intake_id uuid null,
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  source_message_id text null,
  created_by_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id,installment_no)
);

create index if not exists owner_project_installments_due_idx
  on public.owner_project_installments(status,due_on,project_id)
  where status not in ('paid','cancelled');

create table if not exists public.owner_project_conversation_drafts(
  id uuid primary key default gen_random_uuid(),
  owner_group_hash text not null check(length(trim(owner_group_hash))>=16),
  actor_hash text not null check(length(trim(actor_hash))>=16),
  intent text not null check(intent in ('new_project','investment_plan','weekly_task','one_time_task')),
  status text not null default 'collecting' check(
    status in ('collecting','awaiting_confirmation','confirmed','cancelled','expired')
  ),
  data jsonb not null default '{}'::jsonb,
  missing_fields text[] not null default '{}'::text[],
  source_message_id text not null,
  last_message_id text not null,
  confirmed_by_message_id text null,
  confirmed_project_id uuid null references public.owner_projects(id) on delete restrict,
  confirmed_task_id uuid null references public.owner_project_tasks(id) on delete restrict,
  expires_at timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists owner_project_drafts_one_active_per_actor
  on public.owner_project_conversation_drafts(owner_group_hash,actor_hash)
  where status in ('collecting','awaiting_confirmation');

create unique index if not exists owner_project_drafts_confirm_message_unique
  on public.owner_project_conversation_drafts(confirmed_by_message_id)
  where confirmed_by_message_id is not null;

create index if not exists owner_project_drafts_active_idx
  on public.owner_project_conversation_drafts(owner_group_hash,actor_hash,updated_at desc)
  where status in ('collecting','awaiting_confirmation');

create table if not exists public.owner_project_conversation_messages(
  source_channel text not null default 'line' check(source_channel in ('line','backoffice','system')),
  message_id text not null,
  owner_group_hash text not null,
  actor_hash text not null,
  message_sha256 text not null check(message_sha256 ~ '^[0-9a-f]{64}$'),
  draft_id uuid null references public.owner_project_conversation_drafts(id) on delete restrict,
  reply_text text null,
  created_at timestamptz not null default now(),
  primary key(source_channel,message_id)
);

create table if not exists public.owner_project_audit_events(
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check(
    entity_type in ('project','task','installment','checkin','draft','expense_link')
  ),
  entity_id uuid not null,
  action text not null check(
    action in ('created','updated','status_changed','confirmed','cancelled','linked','payment_recorded')
  ),
  source text not null check(source in ('line','backoffice','import','system')),
  actor_hash text null,
  message_id text null,
  reason text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists owner_project_audit_entity_idx
  on public.owner_project_audit_events(entity_type,entity_id,created_at);

alter table public.financial_investment_entries
  add column if not exists owner_project_id uuid null references public.owner_projects(id) on delete restrict,
  add column if not exists owner_project_task_id uuid null references public.owner_project_tasks(id) on delete restrict,
  add column if not exists owner_project_installment_id uuid null references public.owner_project_installments(id) on delete restrict;

alter table public.financial_owner_expense_intakes
  add column if not exists owner_project_id uuid null references public.owner_projects(id) on delete restrict,
  add column if not exists owner_project_task_id uuid null references public.owner_project_tasks(id) on delete restrict,
  add column if not exists owner_project_installment_id uuid null references public.owner_project_installments(id) on delete restrict;

create index if not exists financial_investment_entries_owner_project_idx
  on public.financial_investment_entries(owner_project_id,occurred_on)
  where status='recorded' and owner_project_id is not null;

create index if not exists financial_owner_expense_owner_project_idx
  on public.financial_owner_expense_intakes(owner_project_id,occurred_on)
  where status<>'cancelled' and owner_project_id is not null;

alter table public.owner_projects enable row level security;
alter table public.owner_project_tasks enable row level security;
alter table public.owner_project_task_checkins enable row level security;
alter table public.owner_project_installments enable row level security;
alter table public.owner_project_conversation_drafts enable row level security;
alter table public.owner_project_conversation_messages enable row level security;
alter table public.owner_project_audit_events enable row level security;

revoke all on public.owner_projects from public,anon,authenticated;
revoke all on public.owner_project_tasks from public,anon,authenticated;
revoke all on public.owner_project_task_checkins from public,anon,authenticated;
revoke all on public.owner_project_installments from public,anon,authenticated;
revoke all on public.owner_project_conversation_drafts from public,anon,authenticated;
revoke all on public.owner_project_conversation_messages from public,anon,authenticated;
revoke all on public.owner_project_audit_events from public,anon,authenticated;

grant select,insert,update on public.owner_projects to service_role;
grant select,insert,update on public.owner_project_tasks to service_role;
grant select,insert,update on public.owner_project_task_checkins to service_role;
grant select,insert,update on public.owner_project_installments to service_role;
grant select,insert,update on public.owner_project_conversation_drafts to service_role;
grant select,insert,update on public.owner_project_conversation_messages to service_role;
grant select,insert on public.owner_project_audit_events to service_role;

create or replace function public.owner_project_confirm_draft_v1(
  p_draft_id uuid,
  p_message_id text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_draft public.owner_project_conversation_drafts%rowtype;
  v_project public.owner_projects%rowtype;
  v_task public.owner_project_tasks%rowtype;
  v_project_name text;
  v_normalized_name text;
  v_work_title text;
  v_business text;
  v_task_kind text;
  v_budget numeric(14,2);
  v_installment_count integer;
  v_counterparty text;
  v_responsible text;
  v_payment_method text;
  v_due_on date;
  v_first_due_on date;
  v_weekdays smallint[]:='{}'::smallint[];
  v_index integer;
  v_installment_amount numeric(14,2);
  v_running_amount numeric(14,2):=0;
begin
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;

  select * into v_draft
  from public.owner_project_conversation_drafts
  where id=p_draft_id
  for update;

  if v_draft.id is null then raise exception 'owner_project_draft_not_found'; end if;
  if v_draft.actor_hash<>trim(p_actor_hash) then raise exception 'owner_project_draft_actor_mismatch'; end if;

  if v_draft.status='confirmed' then
    select * into v_project from public.owner_projects where id=v_draft.confirmed_project_id;
    select * into v_task from public.owner_project_tasks where id=v_draft.confirmed_task_id;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'draft_id',v_draft.id,
      'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
      'task_id',v_task.id,'task_code',v_task.task_code
    );
  end if;

  if v_draft.status<>'awaiting_confirmation' then raise exception 'owner_project_draft_not_ready'; end if;
  if cardinality(v_draft.missing_fields)>0 then raise exception 'owner_project_draft_missing_fields'; end if;
  if v_draft.expires_at<=now() then raise exception 'owner_project_draft_expired'; end if;

  v_project_name:=left(trim(coalesce(v_draft.data->>'project_name','')),180);
  v_normalized_name:=left(regexp_replace(lower(v_project_name),'\s+',' ','g'),180);
  v_work_title:=left(trim(coalesce(v_draft.data->>'work_title','')),240);
  if length(v_project_name)<2 then raise exception 'owner_project_name_required'; end if;
  if length(v_work_title)<2 then raise exception 'owner_project_work_title_required'; end if;

  v_business:=nullif(trim(coalesce(v_draft.data->>'business_unit_code','')),'');
  if v_business is not null and v_business not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then v_business:='other'; end if;

  if coalesce(v_draft.data->>'budget_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then
    v_budget:=(v_draft.data->>'budget_amount')::numeric(14,2);
    if v_budget<0 or v_budget>100000000 then raise exception 'invalid_owner_project_budget'; end if;
  else
    v_budget:=null;
  end if;

  select * into v_project
  from public.owner_projects
  where owner_group_hash=v_draft.owner_group_hash
    and normalized_name=v_normalized_name
    and status<>'cancelled'
  order by created_at asc
  limit 1
  for update;

  if v_project.id is null then
    insert into public.owner_projects(
      owner_group_hash,name,normalized_name,purpose,business_unit_code,location_label,
      budget_amount,status,start_on,due_on,source_channel,source_message_id,
      created_by_hash,confirmed_at
    ) values (
      v_draft.owner_group_hash,v_project_name,v_normalized_name,
      nullif(left(trim(coalesce(v_draft.data->>'project_purpose','')),2000),''),
      v_business,nullif(left(trim(coalesce(v_draft.data->>'location_label','')),180),''),
      v_budget,'active',
      case when coalesce(v_draft.data->>'start_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then (v_draft.data->>'start_on')::date else null end,
      case when coalesce(v_draft.data->>'project_due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then (v_draft.data->>'project_due_on')::date else null end,
      'line',trim(p_message_id),v_draft.actor_hash,now()
    ) returning * into v_project;

    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,after_data
    ) values (
      'project',v_project.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_project)
    );
  elsif v_project.budget_amount is null and v_budget is not null then
    update public.owner_projects
    set budget_amount=v_budget,updated_at=now()
    where id=v_project.id
    returning * into v_project;
  end if;

  v_task_kind:=coalesce(nullif(trim(v_draft.data->>'task_kind'),''),'one_time');
  if v_task_kind not in ('pre_opening','one_time','weekly') then v_task_kind:='one_time'; end if;

  select coalesce(array_agg(value::smallint order by value::integer),'{}'::smallint[])
  into v_weekdays
  from jsonb_array_elements_text(coalesce(v_draft.data->'recurrence_weekdays','[]'::jsonb)) as weekday(value)
  where value ~ '^[0-6]$';

  v_due_on:=case
    when coalesce(v_draft.data->>'due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      then (v_draft.data->>'due_on')::date
    else null end;
  v_counterparty:=nullif(left(trim(coalesce(v_draft.data->>'counterparty_name','')),180),'');
  v_responsible:=nullif(left(trim(coalesce(v_draft.data->>'responsible_name','')),180),'');

  insert into public.owner_project_tasks(
    project_id,title,description,task_kind,recurrence_weekdays,recurrence_start_on,
    recurrence_end_on,due_on,schedule_text,responsible_name,counterparty_name,
    budget_amount,status,source_channel,source_message_id,created_by_hash,confirmed_at
  ) values (
    v_project.id,v_work_title,
    nullif(left(trim(coalesce(v_draft.data->>'description','')),2000),''),
    v_task_kind,v_weekdays,
    case when v_task_kind='weekly' then coalesce(v_due_on,(timezone('Asia/Bangkok',now()))::date) else null end,
    case when coalesce(v_draft.data->>'recurrence_end_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' then (v_draft.data->>'recurrence_end_on')::date else null end,
    case when v_task_kind='weekly' then null else v_due_on end,
    nullif(left(trim(coalesce(v_draft.data->>'schedule_text','')),240),''),
    v_responsible,v_counterparty,v_budget,'todo','line',trim(p_message_id),v_draft.actor_hash,now()
  ) returning * into v_task;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,after_data
  ) values ('task',v_task.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_task));

  if coalesce(v_draft.data->>'installment_count','') ~ '^[0-9]+$' then
    v_installment_count:=(v_draft.data->>'installment_count')::integer;
  else
    v_installment_count:=0;
  end if;
  if v_installment_count<0 or v_installment_count>120 then raise exception 'invalid_installment_count'; end if;

  v_payment_method:=nullif(trim(coalesce(v_draft.data->>'payment_method','')),'');
  if v_payment_method is not null and v_payment_method not in ('cash','transfer','card','other') then
    v_payment_method:='other';
  end if;
  v_first_due_on:=case
    when coalesce(v_draft.data->>'first_installment_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      then (v_draft.data->>'first_installment_on')::date
    else null end;

  if v_installment_count>0 then
    for v_index in 1..v_installment_count loop
      if v_budget is null then
        v_installment_amount:=null;
      elsif v_index<v_installment_count then
        v_installment_amount:=round(v_budget/v_installment_count,2);
      else
        v_installment_amount:=v_budget-v_running_amount;
      end if;
      v_running_amount:=v_running_amount+coalesce(v_installment_amount,0);

      insert into public.owner_project_installments(
        project_id,task_id,installment_no,title,amount,due_on,counterparty_name,
        payment_method,status,source_channel,source_message_id,created_by_hash
      ) values (
        v_project.id,v_task.id,v_index,'งวดที่ '||v_index,v_installment_amount,
        case when v_index=1 then v_first_due_on else null end,
        v_counterparty,v_payment_method,'planned','line',trim(p_message_id),v_draft.actor_hash
      );
    end loop;
  end if;

  update public.owner_project_conversation_drafts
  set status='confirmed',confirmed_by_message_id=trim(p_message_id),
      confirmed_project_id=v_project.id,confirmed_task_id=v_task.id,updated_at=now()
  where id=v_draft.id;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,after_data
  ) values (
    'draft',v_draft.id,'confirmed','line',v_draft.actor_hash,trim(p_message_id),
    jsonb_build_object('project_id',v_project.id,'task_id',v_task.id,'installment_count',v_installment_count)
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'draft_id',v_draft.id,
    'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
    'task_id',v_task.id,'task_code',v_task.task_code,'installment_count',v_installment_count
  );
end;
$$;

create or replace function public.owner_project_backoffice_update_v1(
  p_entity_type text,
  p_entity_id uuid,
  p_patch jsonb,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_reason text:=left(trim(coalesce(p_reason,'')),500);
  v_before jsonb;
  v_after jsonb;
  v_amount numeric(14,2);
  v_paid_amount numeric(14,2);
begin
  if length(v_reason)<3 then raise exception 'update_reason_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'invalid_update_patch'; end if;

  if p_entity_type='project' then
    select to_jsonb(row) into v_before from public.owner_projects row where id=p_entity_id for update;
    if v_before is null then raise exception 'owner_project_not_found'; end if;
    if p_patch ? 'budget_amount' then
      if jsonb_typeof(p_patch->'budget_amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'budget_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'budget_amount')::numeric;
      else raise exception 'invalid_owner_project_budget'; end if;
    end if;
    update public.owner_projects
    set name=case when p_patch ? 'name' then left(trim(p_patch->>'name'),180) else name end,
        normalized_name=case when p_patch ? 'name' then left(regexp_replace(lower(trim(p_patch->>'name')),'\s+',' ','g'),180) else normalized_name end,
        purpose=case when p_patch ? 'purpose' then nullif(left(trim(p_patch->>'purpose'),2000),'') else purpose end,
        budget_amount=case when p_patch ? 'budget_amount' then v_amount else budget_amount end,
        status=case when p_patch ? 'status' and p_patch->>'status' in ('planning','approved','active','paused','completed','cancelled') then p_patch->>'status' else status end,
        due_on=case when p_patch ? 'due_on' then case when coalesce(p_patch->>'due_on','')='' then null else (p_patch->>'due_on')::date end else due_on end,
        updated_at=now()
    where id=p_entity_id;
    select to_jsonb(row) into v_after from public.owner_projects row where id=p_entity_id;
  elsif p_entity_type='task' then
    select to_jsonb(row) into v_before from public.owner_project_tasks row where id=p_entity_id for update;
    if v_before is null then raise exception 'owner_project_task_not_found'; end if;
    if p_patch ? 'budget_amount' then
      if jsonb_typeof(p_patch->'budget_amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'budget_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'budget_amount')::numeric;
      else raise exception 'invalid_owner_task_budget'; end if;
    end if;
    update public.owner_project_tasks
    set title=case when p_patch ? 'title' then left(trim(p_patch->>'title'),240) else title end,
        description=case when p_patch ? 'description' then nullif(left(trim(p_patch->>'description'),2000),'') else description end,
        schedule_text=case when p_patch ? 'schedule_text' then nullif(left(trim(p_patch->>'schedule_text'),240),'') else schedule_text end,
        responsible_name=case when p_patch ? 'responsible_name' then nullif(left(trim(p_patch->>'responsible_name'),180),'') else responsible_name end,
        counterparty_name=case when p_patch ? 'counterparty_name' then nullif(left(trim(p_patch->>'counterparty_name'),180),'') else counterparty_name end,
        budget_amount=case when p_patch ? 'budget_amount' then v_amount else budget_amount end,
        status=case when p_patch ? 'status' and p_patch->>'status' in ('todo','in_progress','blocked','done','cancelled') then p_patch->>'status' else status end,
        due_on=case when p_patch ? 'due_on' then case when coalesce(p_patch->>'due_on','')='' then null else (p_patch->>'due_on')::date end else due_on end,
        updated_at=now()
    where id=p_entity_id;
    select to_jsonb(row) into v_after from public.owner_project_tasks row where id=p_entity_id;
  elsif p_entity_type='installment' then
    select to_jsonb(row) into v_before from public.owner_project_installments row where id=p_entity_id for update;
    if v_before is null then raise exception 'owner_project_installment_not_found'; end if;
    if p_patch ? 'amount' then
      if jsonb_typeof(p_patch->'amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'amount')::numeric;
      else raise exception 'invalid_installment_amount'; end if;
    end if;
    if p_patch ? 'paid_amount' then
      if coalesce(p_patch->>'paid_amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_paid_amount:=(p_patch->>'paid_amount')::numeric;
      else raise exception 'invalid_installment_paid_amount'; end if;
    end if;
    update public.owner_project_installments
    set amount=case when p_patch ? 'amount' then v_amount else amount end,
        due_on=case when p_patch ? 'due_on' then case when coalesce(p_patch->>'due_on','')='' then null else (p_patch->>'due_on')::date end else due_on end,
        counterparty_name=case when p_patch ? 'counterparty_name' then nullif(left(trim(p_patch->>'counterparty_name'),180),'') else counterparty_name end,
        status=case when p_patch ? 'status' and p_patch->>'status' in ('planned','due','paid','cancelled') then p_patch->>'status' else status end,
        paid_amount=case when p_patch ? 'paid_amount' then v_paid_amount else paid_amount end,
        paid_on=case when p_patch ? 'paid_on' then case when coalesce(p_patch->>'paid_on','')='' then null else (p_patch->>'paid_on')::date end else paid_on end,
        updated_at=now()
    where id=p_entity_id;
    select to_jsonb(row) into v_after from public.owner_project_installments row where id=p_entity_id;
  else
    raise exception 'invalid_owner_project_entity_type';
  end if;

  if coalesce(v_after->>'name',v_after->>'title','')='' then raise exception 'owner_project_title_required'; end if;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    p_entity_type,p_entity_id,
    case when v_after->>'status'='cancelled' and v_before->>'status'<>'cancelled' then 'cancelled'
         when v_after->>'status' is distinct from v_before->>'status' then 'status_changed'
         else 'updated' end,
    'backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),v_reason,v_before,v_after
  );

  return jsonb_build_object('ok',true,'entity_type',p_entity_type,'entity_id',p_entity_id,'record',v_after);
end;
$$;

create or replace function public.owner_project_set_week_state_v1(
  p_task_id uuid,
  p_week_start date,
  p_state text,
  p_note text,
  p_source text,
  p_actor_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_task public.owner_project_tasks%rowtype;
  v_row public.owner_project_task_checkins%rowtype;
  v_before jsonb:='{}'::jsonb;
begin
  if p_state not in ('pending','done','blocked','skipped') then raise exception 'invalid_week_state'; end if;
  if p_source not in ('line','backoffice','system') then raise exception 'invalid_week_state_source'; end if;
  select * into v_task from public.owner_project_tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'owner_project_task_not_found'; end if;
  if v_task.task_kind<>'weekly' then raise exception 'owner_project_task_not_weekly'; end if;
  select to_jsonb(row) into v_before from public.owner_project_task_checkins row
    where task_id=p_task_id and week_start=p_week_start for update;
  insert into public.owner_project_task_checkins(
    task_id,week_start,state,note,actor_hash,source,source_message_id,completed_at
  ) values (
    p_task_id,p_week_start,p_state,nullif(left(trim(coalesce(p_note,'')),500),''),
    nullif(trim(coalesce(p_actor_hash,'')),''),p_source,nullif(trim(coalesce(p_message_id,'')),''),
    case when p_state='done' then now() else null end
  )
  on conflict(task_id,week_start) do update set
    state=excluded.state,note=excluded.note,actor_hash=excluded.actor_hash,
    source=excluded.source,source_message_id=excluded.source_message_id,
    completed_at=excluded.completed_at,updated_at=now()
  returning * into v_row;
  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (
    'checkin',v_row.id,'status_changed',p_source,
    nullif(trim(coalesce(p_actor_hash,'')),''),nullif(trim(coalesce(p_message_id,'')),''),
    coalesce(v_before,'{}'::jsonb),to_jsonb(v_row)
  );
  return jsonb_build_object('ok',true,'checkin_id',v_row.id,'task_id',p_task_id,'state',p_state);
end;
$$;

create or replace function public.owner_project_link_financial_v1(
  p_financial_kind text,
  p_financial_id uuid,
  p_project_id uuid,
  p_task_id uuid,
  p_installment_id uuid,
  p_source text,
  p_actor_hash text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if p_source not in ('line','backoffice','system') then raise exception 'invalid_link_source'; end if;
  if not exists(
    select 1 from public.owner_projects
    where id=p_project_id and status<>'cancelled'
  ) then raise exception 'owner_project_not_found'; end if;

  if p_task_id is not null and not exists(
    select 1 from public.owner_project_tasks
    where id=p_task_id and project_id=p_project_id and status<>'cancelled'
  ) then raise exception 'owner_project_task_mismatch'; end if;

  if p_installment_id is not null and not exists(
    select 1 from public.owner_project_installments
    where id=p_installment_id and project_id=p_project_id
      and (p_task_id is null or task_id=p_task_id) and status<>'cancelled'
  ) then raise exception 'owner_project_installment_mismatch'; end if;

  if p_financial_kind='investment_entry' then
    select to_jsonb(row) into v_before
    from public.financial_investment_entries row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_investment_entry_not_found'; end if;
    update public.financial_investment_entries
    set owner_project_id=p_project_id,
        owner_project_task_id=p_task_id,
        owner_project_installment_id=p_installment_id
    where id=p_financial_id;
    select to_jsonb(row) into v_after
    from public.financial_investment_entries row where id=p_financial_id;
  elsif p_financial_kind='owner_expense' then
    select to_jsonb(row) into v_before
    from public.financial_owner_expense_intakes row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_owner_expense_not_found'; end if;
    update public.financial_owner_expense_intakes
    set owner_project_id=p_project_id,
        owner_project_task_id=p_task_id,
        owner_project_installment_id=p_installment_id,
        updated_at=now()
    where id=p_financial_id;
    select to_jsonb(row) into v_after
    from public.financial_owner_expense_intakes row where id=p_financial_id;
  else
    raise exception 'invalid_financial_kind';
  end if;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    'expense_link',p_financial_id,'linked',p_source,
    nullif(trim(coalesce(p_actor_hash,'')),''),
    nullif(left(trim(coalesce(p_reason,'')),500),''),v_before,v_after
  );
  return jsonb_build_object(
    'ok',true,'financial_kind',p_financial_kind,'financial_id',p_financial_id,
    'project_id',p_project_id,'task_id',p_task_id,'installment_id',p_installment_id
  );
end;
$$;

-- Edit/cancel financial rows with an audit record in the same transaction.
-- Owner expense cancellations continue to use the dedicated audited RPC.
create or replace function public.owner_project_update_financial_v1(
  p_financial_kind text,
  p_financial_id uuid,
  p_action text,
  p_patch jsonb,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_before jsonb;
  v_after jsonb;
  v_amount numeric(14,2);
  v_business text;
  v_class text;
  v_category text;
begin
  if length(trim(coalesce(p_reason,'')))<3 then raise exception 'financial_change_reason_required'; end if;
  if p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'invalid_financial_patch'; end if;

  if p_financial_kind='investment_entry' then
    select to_jsonb(row) into v_before
    from public.financial_investment_entries row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_investment_entry_not_found'; end if;
    if v_before->>'status'='cancelled' then raise exception 'financial_investment_entry_cancelled'; end if;

    if p_action='cancel' then
      update public.financial_investment_entries
      set status='cancelled',updated_at=now()
      where id=p_financial_id;
      insert into public.financial_investment_entry_audit_events(
        entry_id,action,source,actor_hash,before_data,after_data
      ) values (
        p_financial_id,'cancelled','backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),
        v_before,(select to_jsonb(row) from public.financial_investment_entries row where id=p_financial_id)
      );
    elsif p_action='update' then
      if not (p_patch ?| array['occurred_on','business_unit_code','title','category','amount','payment_method','vendor_name','notes']) then
        raise exception 'empty_financial_patch';
      end if;
      if p_patch ? 'amount' then
        if coalesce(p_patch->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'amount')::numeric;
        else raise exception 'invalid_investment_amount'; end if;
      end if;
      if p_patch ? 'business_unit_code' then
        v_business:=p_patch->>'business_unit_code';
        if v_business not in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other') then
          raise exception 'invalid_business_unit';
        end if;
      end if;
      if p_patch ? 'payment_method' and p_patch->>'payment_method' not in ('cash','transfer','card','other') then
        raise exception 'invalid_payment_method';
      end if;
      if p_patch ? 'title' and length(trim(coalesce(p_patch->>'title','')))<2 then raise exception 'investment_title_required'; end if;

      update public.financial_investment_entries
      set occurred_on=case when p_patch ? 'occurred_on' then (p_patch->>'occurred_on')::date else occurred_on end,
          business_unit_code=case when p_patch ? 'business_unit_code' then v_business else business_unit_code end,
          title=case when p_patch ? 'title' then left(trim(p_patch->>'title'),240) else title end,
          category=case when p_patch ? 'category' then coalesce(nullif(left(trim(p_patch->>'category'),120),''),'other') else category end,
          amount=case when p_patch ? 'amount' then v_amount else amount end,
          payment_method=case when p_patch ? 'payment_method' then p_patch->>'payment_method' else payment_method end,
          vendor_name=case when p_patch ? 'vendor_name' then nullif(left(trim(coalesce(p_patch->>'vendor_name','')),180),'') else vendor_name end,
          notes=case when p_patch ? 'notes' then nullif(left(trim(coalesce(p_patch->>'notes','')),2000),'') else notes end,
          updated_at=now()
      where id=p_financial_id;
    else
      raise exception 'invalid_financial_action';
    end if;

    select to_jsonb(row) into v_after
    from public.financial_investment_entries row where id=p_financial_id;
  elsif p_financial_kind='owner_expense' and p_action='update' then
    select to_jsonb(row) into v_before
    from public.financial_owner_expense_intakes row
    where id=p_financial_id for update;
    if v_before is null then raise exception 'financial_owner_expense_not_found'; end if;
    if v_before->>'status'='cancelled' then raise exception 'financial_owner_expense_cancelled'; end if;
    if not (p_patch ?| array['occurred_on','business_unit_code','expense_class','expense_category','expense_subcategory','purpose_raw','amount','vendor_label']) then
      raise exception 'empty_financial_patch';
    end if;
    if p_patch ? 'amount' then
      if jsonb_typeof(p_patch->'amount')='null' then v_amount:=null;
      elsif coalesce(p_patch->>'amount','') ~ '^[0-9]+([.][0-9]{1,2})?$' then v_amount:=(p_patch->>'amount')::numeric;
      else raise exception 'invalid_owner_expense_amount'; end if;
      if v_amount is not null and (v_amount<=0 or v_amount>100000000) then raise exception 'invalid_owner_expense_amount'; end if;
    end if;
    if p_patch ? 'business_unit_code' then
      v_business:=p_patch->>'business_unit_code';
      if v_business not in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other') then
        raise exception 'invalid_business_unit';
      end if;
    end if;
    if p_patch ? 'expense_class' then
      v_class:=p_patch->>'expense_class';
      if v_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then raise exception 'invalid_expense_class'; end if;
    end if;
    if p_patch ? 'expense_category' then
      v_category:=p_patch->>'expense_category';
      if v_category not in ('construction','land_infrastructure','kitchen_equipment','equipment','furniture_fixtures','activity_assets','technology','licenses','inventory','ingredients','beverages','packaging','consumables','cleaning','maintenance','utilities','transport','staff','marketing','fees','professional_services','tax','financing','petty_cash','other') then
        raise exception 'invalid_expense_category';
      end if;
    end if;
    update public.financial_owner_expense_intakes
    set occurred_on=case when p_patch ? 'occurred_on' then (p_patch->>'occurred_on')::date else occurred_on end,
        business_unit_code=case when p_patch ? 'business_unit_code' then v_business else business_unit_code end,
        expense_class=case when p_patch ? 'expense_class' then v_class else expense_class end,
        expense_category=case when p_patch ? 'expense_category' then v_category else expense_category end,
        expense_subcategory=case when p_patch ? 'expense_subcategory' then nullif(left(trim(coalesce(p_patch->>'expense_subcategory','')),120),'') else expense_subcategory end,
        purpose_raw=case when p_patch ? 'purpose_raw' then nullif(left(trim(coalesce(p_patch->>'purpose_raw','')),500),'') else purpose_raw end,
        amount=case when p_patch ? 'amount' then v_amount else amount end,
        vendor_label=case when p_patch ? 'vendor_label' then nullif(left(trim(coalesce(p_patch->>'vendor_label','')),180),'') else vendor_label end,
        classification_source=case when p_patch ?| array['business_unit_code','expense_class','expense_category'] then 'backoffice' else classification_source end,
        classification_confidence=case when p_patch ?| array['business_unit_code','expense_class','expense_category'] then 1 else classification_confidence end,
        categorized_at=case when p_patch ?| array['business_unit_code','expense_class','expense_category'] then now() else categorized_at end,
        updated_at=now()
    where id=p_financial_id;
    select to_jsonb(row) into v_after
    from public.financial_owner_expense_intakes row where id=p_financial_id;
  else
    raise exception 'invalid_financial_kind_or_action';
  end if;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    'expense_link',p_financial_id,
    case when p_action='cancel' then 'cancelled' else 'updated' end,
    'backoffice',nullif(trim(coalesce(p_actor_hash,'')),''),left(trim(p_reason),500),v_before,v_after
  );
  return jsonb_build_object('ok',true,'financial_kind',p_financial_kind,'financial_id',p_financial_id,'action',p_action,'record',v_after);
end;
$$;

-- Record a Backoffice investment and attach it to its project in one transaction.
create or replace function public.owner_project_record_investment_v1(
  p_occurred_on date,
  p_business_unit_code text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_payment_method text,
  p_vendor_name text,
  p_notes text,
  p_source_message_id text,
  p_actor_hash text,
  p_project_id uuid,
  p_task_id uuid,
  p_installment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_link jsonb;
begin
  if length(trim(coalesce(p_source_message_id,'')))<1 then raise exception 'investment_request_id_required'; end if;
  if p_project_id is null and (p_task_id is not null or p_installment_id is not null) then
    raise exception 'owner_project_required_for_link';
  end if;
  v_result:=public.financial_record_investment_v1(
    p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,
    p_vendor_name,p_notes,'backoffice',null,p_source_message_id,p_actor_hash
  );
  if p_project_id is not null then
    v_link:=public.owner_project_link_financial_v1(
      'investment_entry',(v_result->>'id')::uuid,p_project_id,p_task_id,p_installment_id,
      'backoffice',p_actor_hash,'บันทึกและผูกจากหน้าการลงทุน'
    );
  end if;
  return v_result || jsonb_build_object('link',v_link);
end;
$$;

revoke all on function public.owner_project_confirm_draft_v1(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_backoffice_update_v1(text,uuid,jsonb,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_set_week_state_v1(uuid,date,text,text,text,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_link_financial_v1(text,uuid,uuid,uuid,uuid,text,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_update_financial_v1(text,uuid,text,jsonb,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,uuid,uuid,uuid)
  from public,anon,authenticated;

grant execute on function public.owner_project_confirm_draft_v1(uuid,text,text)
  to service_role;
grant execute on function public.owner_project_backoffice_update_v1(text,uuid,jsonb,text,text)
  to service_role;
grant execute on function public.owner_project_set_week_state_v1(uuid,date,text,text,text,text,text)
  to service_role;
grant execute on function public.owner_project_link_financial_v1(text,uuid,uuid,uuid,uuid,text,text,text)
  to service_role;
grant execute on function public.owner_project_update_financial_v1(text,uuid,text,jsonb,text,text)
  to service_role;
grant execute on function public.owner_project_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,uuid,uuid,uuid)
  to service_role;
