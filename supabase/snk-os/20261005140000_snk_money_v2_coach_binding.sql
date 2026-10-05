-- SNK MONEY x THONGTHAI v2 (runs on snk-life-os-private, after 20261005130000_snk_money_v1):
--   1. owner-less PENDING bindings + one-time binding codes issued by the AUTHENTICATED owner in the dashboard
--      (so no owner id / owner LINE id has to be configured anywhere: the owner is resolved from the verified binding)
--   2. DB-backed member roles
--   3. daily life coach: morning / evening data, task mutations, day close, once-per-day delivery claims
-- Additive.  No DROP statements (the migration tooling treats DROP as destructive).

-- ================================================================ binding: owner-less pending rows
alter table public.finance_channel_bindings alter column owner_id drop not null;

create table if not exists public.finance_binding_codes(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz null,
  used_group_hash text null,
  created_at timestamptz not null default now()
);
create unique index if not exists finance_binding_codes_hash_uq on public.finance_binding_codes(code_hash);
create index if not exists finance_binding_codes_owner_idx on public.finance_binding_codes(owner_id, created_at desc);

create table if not exists public.finance_binding_attempts(
  group_hash text primary key,
  failed integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_members(
  owner_id uuid not null references auth.users(id) on delete cascade,
  line_user_hash text not null,
  role text not null check (role in ('OWNER','AUTHORIZED_FINANCE_MEMBER')),
  created_via text not null default 'binding_code',
  created_at timestamptz not null default now(),
  primary key (owner_id, line_user_hash)
);

create table if not exists public.finance_coach_deliveries(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('MORNING','EVENING')),
  local_date date not null,
  status text not null default 'CLAIMED' check (status in ('CLAIMED','SENT','FAILED')),
  attempts integer not null default 1,
  last_error text null,
  claimed_at timestamptz not null default now(),
  sent_at timestamptz null,
  unique (owner_id, kind, local_date)
);

create table if not exists public.finance_day_closes(
  owner_id uuid not null references auth.users(id) on delete cascade,
  local_date date not null,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  context jsonb not null default '{}'::jsonb,
  closed_at timestamptz null,
  note text null,
  primary key (owner_id, local_date)
);

do $do$
declare t text;
begin
  foreach t in array array['finance_binding_codes','finance_binding_attempts','finance_members','finance_coach_deliveries','finance_day_closes'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
  foreach t in array array['finance_members','finance_coach_deliveries','finance_day_closes'] loop
    execute format('grant select on public.%I to authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id = (select auth.uid()))',t||'_owner_read',t);
  end loop;
  foreach t in array array['finance_binding_codes','finance_binding_attempts'] loop
    execute format('create policy %I on public.%I as restrictive for all to public using (false) with check (false)',t||'_no_client_access',t);
  end loop;
end $do$;

-- ================================================================ binding functions
-- The signed-in owner mints a one-time code in the dashboard.  The plaintext is returned once; only a hash is stored.
create or replace function public.finance_issue_binding_code() returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_owner uuid := auth.uid(); v_code text; v_exp timestamptz := now()+interval '15 minutes';
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  perform public.finance_i_engine();
  update public.finance_binding_codes set used_at=now() where owner_id=v_owner and used_at is null;      -- one live code at a time
  v_code := 'SNK-'||lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 100000000)::text,8,'0');
  insert into public.finance_binding_codes(owner_id,code_hash,expires_at)
  values(v_owner,encode(sha256(convert_to(v_code,'utf8')),'hex'),v_exp);
  perform public.finance_i_audit(v_owner,'GROUP_CODE_ISSUED','binding',null,null,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('channel','dashboard','expires_at',v_exp));
  return jsonb_build_object('ok',true,'code',v_code,'expires_at',v_exp);
end $fn$;

create or replace function public.finance_binding_lookup_any(p_group_hash text) returns jsonb language sql stable security definer set search_path=public as $fn$
  select coalesce((select jsonb_build_object('id',id,'status',status,'owner_id',owner_id,'failed_attempts',failed_attempts)
    from public.finance_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') limit 1),
    jsonb_build_object('status','NONE'));
$fn$;

-- Join event: record the group as PENDING.  No owner yet, no permission.
create or replace function public.finance_binding_capture_pending(p_group_hash text, p_group_enc text, p_event_id text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_row public.finance_channel_bindings%rowtype;
begin
  if nullif(trim(coalesce(p_group_hash,'')),'') is null then raise exception 'group_hash_required'; end if;
  select * into v_row from public.finance_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE');
  if v_row.id is not null then return jsonb_build_object('ok',true,'created',false,'status',v_row.status); end if;
  insert into public.finance_channel_bindings(owner_id,group_id_hash,group_id_enc,captured_by_event) values(null,p_group_hash,p_group_enc,p_event_id);
  return jsonb_build_object('ok',true,'created',true,'status','PENDING');
end $fn$;

-- Activation by the dashboard-issued code: proves the person typing it controls the authenticated SNK OS owner session.
create or replace function public.finance_binding_activate_code(p_group_hash text, p_group_enc text, p_actor text, p_code text, p_group_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_att integer; v_code public.finance_binding_codes%rowtype; v_row public.finance_channel_bindings%rowtype;
begin
  perform public.finance_i_engine();
  select failed into v_att from public.finance_binding_attempts where group_hash=p_group_hash;
  if coalesce(v_att,0)>=5 then return jsonb_build_object('ok',false,'error','locked'); end if;
  select * into v_code from public.finance_binding_codes
   where code_hash=encode(sha256(convert_to(upper(trim(coalesce(p_code,''))),'utf8')),'hex') and used_at is null and expires_at>now() for update;
  if v_code.id is null then
    insert into public.finance_binding_attempts(group_hash,failed) values(p_group_hash,1)
    on conflict (group_hash) do update set failed=public.finance_binding_attempts.failed+1,updated_at=now();
    return jsonb_build_object('ok',false,'error','not_verified');
  end if;
  if exists(select 1 from public.finance_channel_bindings where owner_id=v_code.owner_id and status='ACTIVE' and group_id_hash<>p_group_hash) then
    perform public.finance_i_audit(v_code.owner_id,'GROUP_BIND_REJECTED','binding',null,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','another_group_active'));
    return jsonb_build_object('ok',false,'error','another_group_active');
  end if;
  select * into v_row from public.finance_channel_bindings where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') for update;
  if v_row.id is not null and v_row.status='ACTIVE' and v_row.owner_id is distinct from v_code.owner_id then
    return jsonb_build_object('ok',false,'error','not_verified');
  end if;
  if v_row.id is null then
    insert into public.finance_channel_bindings(owner_id,group_id_hash,group_id_enc,status,captured_by_event,verified_by_hash,verified_at,bound_at,group_name)
    values(v_code.owner_id,p_group_hash,p_group_enc,'ACTIVE','code_activation',nullif(p_actor,''),now(),now(),nullif(left(trim(coalesce(p_group_name,'')),120),''))
    returning * into v_row;
  elsif v_row.status='PENDING' then
    update public.finance_channel_bindings set owner_id=v_code.owner_id,status='ACTIVE',verified_by_hash=nullif(p_actor,''),verified_at=now(),bound_at=now(),
      group_id_enc=coalesce(group_id_enc,p_group_enc),group_name=nullif(left(trim(coalesce(p_group_name,'')),120),''),code_hash=null,code_expires_at=null,updated_at=now()
     where id=v_row.id;
  end if;
  update public.finance_binding_codes set used_at=now(),used_group_hash=p_group_hash where id=v_code.id;
  insert into public.finance_members(owner_id,line_user_hash,role,created_via) values(v_code.owner_id,p_actor,'OWNER','binding_code')
  on conflict (owner_id,line_user_hash) do update set role='OWNER';
  update public.finance_binding_attempts set failed=0,updated_at=now() where group_hash=p_group_hash;
  perform public.finance_i_audit(v_code.owner_id,'GROUP_BOUND','binding',v_row.id,p_actor,null,jsonb_build_object('status',coalesce(v_row.status,'NONE')),jsonb_build_object('status','ACTIVE'),jsonb_build_object('method','dashboard_code'));
  return jsonb_build_object('ok',true,'method','dashboard_code','owner_id',v_code.owner_id);
end $fn$;

create or replace function public.finance_member_role(p_owner uuid, p_actor text) returns text language sql stable security definer set search_path=public as $fn$
  select coalesce((select role from public.finance_members where owner_id=p_owner and line_user_hash=p_actor),'NONE');
$fn$;

create or replace function public.finance_active_targets() returns jsonb language sql stable security definer set search_path=public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'owner_id',owner_id,'group_id_enc',group_id_enc,'group_id_hash',group_id_hash)),'[]'::jsonb)
    from public.finance_channel_bindings where status='ACTIVE' and owner_id is not null;
$fn$;

create or replace function public.finance_binding_revoke_group(p_group_hash text, p_actor text) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_row public.finance_channel_bindings%rowtype;
begin
  perform public.finance_i_engine();
  update public.finance_channel_bindings set status='REVOKED',revoked_at=now(),updated_at=now()
   where group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_binding'); end if;
  if v_row.owner_id is not null then
    perform public.finance_i_audit(v_row.owner_id,'GROUP_UNBOUND','binding',v_row.id,p_actor,null,'{}'::jsonb,jsonb_build_object('status','REVOKED'));
  end if;
  return jsonb_build_object('ok',true);
end $fn$;

-- Operator/env-trusted-owner paths now also adopt owner-less pending rows.
create or replace function public.finance_binding_issue_code(p_owner uuid, p_group_hash text, p_ttl_minutes integer default 30)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_code text; v_row public.finance_channel_bindings%rowtype;
begin
  select * into v_row from public.finance_channel_bindings where (owner_id=p_owner or owner_id is null) and group_id_hash=p_group_hash and status='PENDING' for update;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_pending_binding'); end if;
  v_code := 'SNK-'||lpad((('x'||substr(replace(gen_random_uuid()::text,'-',''),1,8))::bit(32)::bigint % 1000000)::text,6,'0');
  update public.finance_channel_bindings set code_hash=encode(sha256(convert_to(v_code,'utf8')),'hex'),
    code_expires_at=now()+make_interval(mins=>least(greatest(p_ttl_minutes,1),240)),failed_attempts=0,updated_at=now() where id=v_row.id;
  perform public.finance_i_engine();
  perform public.finance_i_audit(p_owner,'GROUP_CODE_ISSUED','binding',v_row.id,null,null,'{}'::jsonb,'{}'::jsonb);
  return jsonb_build_object('ok',true,'code',v_code);
end $fn$;

create or replace function public.finance_binding_activate(p_owner uuid, p_group_hash text, p_actor text, p_owner_verified boolean, p_code text, p_group_name text default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_row public.finance_channel_bindings%rowtype; v_ok boolean := false; v_how text;
begin
  perform public.finance_i_engine();
  select * into v_row from public.finance_channel_bindings where (owner_id=p_owner or owner_id is null) and group_id_hash=p_group_hash and status in ('PENDING','ACTIVE') for update;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_pending_binding'); end if;
  if v_row.status='ACTIVE' then return jsonb_build_object('ok',true,'already_active',true); end if;
  if exists(select 1 from public.finance_channel_bindings where owner_id=p_owner and status='ACTIVE') then
    perform public.finance_i_audit(p_owner,'GROUP_BIND_REJECTED','binding',v_row.id,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','another_group_active'));
    return jsonb_build_object('ok',false,'error','another_group_active');
  end if;
  if v_row.failed_attempts>=5 then return jsonb_build_object('ok',false,'error','locked'); end if;
  if coalesce(p_owner_verified,false) then v_ok := true; v_how := 'owner_user';
  elsif nullif(trim(coalesce(p_code,'')),'') is not null and v_row.code_hash is not null and v_row.code_expires_at>now()
        and v_row.code_hash=encode(sha256(convert_to(upper(trim(p_code)),'utf8')),'hex') then v_ok := true; v_how := 'one_time_code';
  end if;
  if not v_ok then
    update public.finance_channel_bindings set failed_attempts=failed_attempts+1,updated_at=now() where id=v_row.id;
    perform public.finance_i_audit(p_owner,'GROUP_BIND_REJECTED','binding',v_row.id,p_actor,null,'{}'::jsonb,'{}'::jsonb,jsonb_build_object('reason','not_verified'));
    return jsonb_build_object('ok',false,'error','not_verified');
  end if;
  update public.finance_channel_bindings set owner_id=p_owner,status='ACTIVE',verified_by_hash=nullif(p_actor,''),verified_at=now(),bound_at=now(),
    group_name=nullif(left(trim(coalesce(p_group_name,'')),120),''),code_hash=null,code_expires_at=null,updated_at=now() where id=v_row.id;
  if nullif(p_actor,'') is not null then
    insert into public.finance_members(owner_id,line_user_hash,role,created_via) values(p_owner,p_actor,'OWNER',v_how)
    on conflict (owner_id,line_user_hash) do update set role='OWNER';
  end if;
  perform public.finance_i_audit(p_owner,'GROUP_BOUND','binding',v_row.id,p_actor,null,jsonb_build_object('status','PENDING'),jsonb_build_object('status','ACTIVE'),jsonb_build_object('method',v_how));
  return jsonb_build_object('ok',true,'method',v_how);
end $fn$;

-- ================================================================ daily coach: reads (SNK LIFE OS data)
create or replace function public.finance_coach_morning_data(p_owner uuid, p_today date) returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare
  v_from timestamptz := (p_today::timestamp at time zone 'Asia/Bangkok');
  v_to timestamptz := ((p_today+1)::timestamp at time zone 'Asia/Bangkok');
  v_prio jsonb; v_tasks jsonb; v_events jsonb; v_deadlines jsonb; v_recurring jsonb; v_exceptions jsonb; v_goals jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('position',tp.position,'item_type',tp.item_type,'item_id',tp.item_id,
           'title',coalesce(t.title,g.title,p.name,b.name),'done',(t.completed_at is not null or coalesce(t.status,'')='done')) order by tp.position),'[]'::jsonb)
    into v_prio
    from public.top_priorities tp
    left join public.tasks t on tp.item_type='task' and t.id=tp.item_id and t.owner_id=p_owner
    left join public.goals g on tp.item_type='goal' and g.id=tp.item_id and g.owner_id=p_owner
    left join public.projects p on tp.item_type='project' and p.id=tp.item_id
    left join public.businesses b on tp.item_type='business' and b.id=tp.item_id
   where tp.owner_id=p_owner and tp.priority_date=p_today;

  select coalesce(jsonb_agg(x.j order by x.ord),'[]'::jsonb) into v_tasks from (
    select jsonb_build_object('id',t.id,'title',t.title,'due_date',t.due_date,'due_time',t.due_time,'overdue',(t.due_date is not null and t.due_date<p_today),
             'priority',t.priority,'is_today_priority',t.is_today_priority,'goal',g.title) j,
           row_number() over (order by (t.due_date is not null and t.due_date<p_today) desc, t.is_today_priority desc, t.due_time nulls last, t.created_at) ord
      from public.tasks t left join public.goals g on g.id=t.goal_id
     where t.owner_id=p_owner and t.archived_at is null and t.completed_at is null and coalesce(t.status,'todo')<>'done'
       and ((t.due_date is not null and t.due_date<=p_today) or t.is_today_priority)
     limit 20) x;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time,'end_time',e.end_time,'all_day',e.all_day,'category',e.category,'location',e.location) order by e.start_time),'[]'::jsonb)
    into v_events from public.schedule_events e
   where e.owner_id=p_owner and e.archived_at is null and e.rrule is null and e.status not in ('cancelled','completed')
     and e.start_time>=v_from and e.start_time<v_to;

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time,'category',e.category) order by e.start_time),'[]'::jsonb)
    into v_deadlines from public.schedule_events e
   where e.owner_id=p_owner and e.archived_at is null and e.rrule is null and e.category='deadline' and e.status not in ('cancelled','completed')
     and e.start_time>=v_to and e.start_time<v_to+interval '3 days';

  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time,'end_time',e.end_time,'all_day',e.all_day,'category',e.category,'location',e.location,'rrule',e.rrule)),'[]'::jsonb)
    into v_recurring from public.schedule_events e
   where e.owner_id=p_owner and e.archived_at is null and e.rrule is not null and e.status<>'cancelled';

  select coalesce(jsonb_agg(jsonb_build_object('master_event_id',o.master_event_id,'occurrence_date',o.occurrence_date,'action',o.action,'title',o.title,'start_time',o.start_time,'end_time',o.end_time,'location',o.location,'status',o.status)),'[]'::jsonb)
    into v_exceptions from public.schedule_event_occurrences o
   where o.owner_id=p_owner and o.occurrence_date between p_today-1 and p_today+1;

  select coalesce(jsonb_agg(jsonb_build_object('id',g.id,'title',g.title,'level',g.level,'deadline',g.deadline,'priority',g.priority,'target',g.target_value,'current',g.current_value,'unit',g.unit,'tracking',g.tracking_configured) order by
           case g.priority when 'high' then 1 when 'medium' then 2 when 'med' then 2 else 3 end, g.deadline nulls last),'[]'::jsonb)
    into v_goals from (select * from public.goals where owner_id=p_owner and archived_at is null and coalesce(status,'active')='active'
                        order by case priority when 'high' then 1 when 'medium' then 2 when 'med' then 2 else 3 end, deadline nulls last limit 5) g;

  return jsonb_build_object('today',p_today,'priorities',v_prio,'tasks',v_tasks,'events',v_events,'deadlines',v_deadlines,
    'recurring_events',v_recurring,'occurrence_exceptions',v_exceptions,'goals',v_goals,
    'money_due',public.finance_list_upcoming(p_owner,p_today,p_today+3,30),'accounts',public.finance_get_accounts(p_owner));
end $fn$;

create or replace function public.finance_coach_evening_data(p_owner uuid, p_today date) returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare
  v_from timestamptz := (p_today::timestamp at time zone 'Asia/Bangkok');
  v_to timestamptz := ((p_today+1)::timestamp at time zone 'Asia/Bangkok');
  v_income numeric; v_expense numeric; v_inc_n integer; v_exp_n integer; v_pending integer; v_accounts jsonb; v_done jsonb; v_open jsonb; v_prio jsonb;
begin
  select coalesce(sum(amount) filter (where type='income'),0),coalesce(sum(amount) filter (where type='expense'),0),
         count(*) filter (where type='income'),count(*) filter (where type='expense')
    into v_income,v_expense,v_inc_n,v_exp_n from public.transactions
   where owner_id=p_owner and occurred_on=p_today and type in ('income','expense') and archived_at is null and status in ('CONFIRMED','PENDING_CLARIFICATION');
  select count(*) into v_pending from public.transactions where owner_id=p_owner and status='PENDING_CLARIFICATION' and archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'balance',a.current_balance,'balance_status',a.balance_status,
      'moved_today',exists(select 1 from public.transactions t where t.owner_id=p_owner and t.archived_at is null and t.status='CONFIRMED' and t.type in ('income','expense','transfer')
                            and t.occurred_on=p_today and (t.account_id=a.id or t.transfer_account_id=a.id)),
      'confirmed_today',(a.balance_confirmed_at is not null and (a.balance_confirmed_at at time zone 'Asia/Bangkok')::date=p_today)) order by a.created_at),'[]'::jsonb)
    into v_accounts from public.financial_accounts a where a.owner_id=p_owner and a.is_active and a.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title) order by t.completed_at),'[]'::jsonb) into v_done
    from public.tasks t where t.owner_id=p_owner and t.archived_at is null and t.completed_at>=v_from and t.completed_at<v_to;

  select coalesce(jsonb_agg(x.j order by x.ord),'[]'::jsonb) into v_open from (
    select jsonb_build_object('id',t.id,'title',t.title,'due_date',t.due_date,'overdue',(t.due_date is not null and t.due_date<p_today),'is_today_priority',t.is_today_priority) j,
           row_number() over (order by t.is_today_priority desc, (t.due_date is not null and t.due_date<p_today) desc, t.due_time nulls last, t.created_at) ord
      from public.tasks t
     where t.owner_id=p_owner and t.archived_at is null and t.completed_at is null and coalesce(t.status,'todo')<>'done'
       and ((t.due_date is not null and t.due_date<=p_today) or t.is_today_priority)
     limit 20) x;

  select coalesce(jsonb_agg(jsonb_build_object('position',tp.position,'item_type',tp.item_type,'item_id',tp.item_id,
           'title',coalesce(t.title,g.title,p.name,b.name),'done',(t.completed_at is not null or coalesce(t.status,'')='done')) order by tp.position),'[]'::jsonb)
    into v_prio from public.top_priorities tp
    left join public.tasks t on tp.item_type='task' and t.id=tp.item_id and t.owner_id=p_owner
    left join public.goals g on tp.item_type='goal' and g.id=tp.item_id and g.owner_id=p_owner
    left join public.projects p on tp.item_type='project' and p.id=tp.item_id
    left join public.businesses b on tp.item_type='business' and b.id=tp.item_id
   where tp.owner_id=p_owner and tp.priority_date=p_today;

  return jsonb_build_object('today',p_today,'income',v_income,'expense',v_expense,'income_count',v_inc_n,'expense_count',v_exp_n,
    'pending_clarification',v_pending,'money_due',public.finance_list_upcoming(p_owner,p_today,p_today,30),'accounts',v_accounts,
    'tasks_done',v_done,'tasks_open',v_open,'priorities',v_prio);
end $fn$;

create or replace function public.finance_coach_open_tasks(p_owner uuid, p_limit integer default 50) returns jsonb language sql stable security definer set search_path=public as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'title',x.title,'due_date',x.due_date) order by x.ord),'[]'::jsonb) from (
    select t.id,t.title,t.due_date,row_number() over (order by t.is_today_priority desc, t.due_date nulls last, t.created_at) ord
      from public.tasks t where t.owner_id=p_owner and t.archived_at is null and t.completed_at is null and coalesce(t.status,'todo')<>'done'
     limit least(greatest(coalesce(p_limit,50),1),200)) x;
$fn$;

-- ================================================================ daily coach: owner-reported task changes (audited)
create or replace function public.finance_task_set_done(p_owner uuid, p_task uuid, p_done boolean, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_prev jsonb; v_t public.tasks%rowtype; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_t from public.tasks where id=p_task and owner_id=p_owner and archived_at is null for update;
  if v_t.id is null then return jsonb_build_object('ok',false,'error','task_not_found'); end if;
  v_before := jsonb_build_object('status',v_t.status,'completed_at',v_t.completed_at,'due_date',v_t.due_date);
  update public.tasks set status=case when p_done then 'done' else 'todo' end,completed_at=case when p_done then now() else null end where id=v_t.id;
  perform public.finance_i_audit(p_owner,case when p_done then 'TASK_COMPLETED' else 'TASK_REOPENED' end,'task',v_t.id,p_actor,p_message,v_before,
    jsonb_build_object('status',case when p_done then 'done' else 'todo' end),jsonb_build_object('title',v_t.title));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'task',jsonb_build_object('id',v_t.id,'title',v_t.title,'done',p_done)));
end $fn$;

create or replace function public.finance_task_defer(p_owner uuid, p_task uuid, p_to date, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_prev jsonb; v_t public.tasks%rowtype; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_t from public.tasks where id=p_task and owner_id=p_owner and archived_at is null for update;
  if v_t.id is null then return jsonb_build_object('ok',false,'error','task_not_found'); end if;
  if v_t.completed_at is not null or v_t.status='done' then return jsonb_build_object('ok',false,'error','already_done'); end if;
  v_before := jsonb_build_object('due_date',v_t.due_date,'is_today_priority',v_t.is_today_priority);
  update public.tasks set due_date=p_to,is_today_priority=false where id=v_t.id;
  perform public.finance_i_audit(p_owner,'TASK_DEFERRED','task',v_t.id,p_actor,p_message,v_before,jsonb_build_object('due_date',p_to),jsonb_build_object('title',v_t.title));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'task',jsonb_build_object('id',v_t.id,'title',v_t.title,'due_date',p_to)));
end $fn$;

-- owner says a task is today's priority (the same flag the SNK LIFE OS "today" star toggles)
create or replace function public.finance_task_set_today(p_owner uuid, p_task uuid, p_flag boolean, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_prev jsonb; v_t public.tasks%rowtype;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_t from public.tasks where id=p_task and owner_id=p_owner and archived_at is null for update;
  if v_t.id is null then return jsonb_build_object('ok',false,'error','task_not_found'); end if;
  if v_t.completed_at is not null or v_t.status='done' then return jsonb_build_object('ok',false,'error','already_done'); end if;
  update public.tasks set is_today_priority=p_flag where id=v_t.id;
  perform public.finance_i_audit(p_owner,'TASK_PRIORITY_CHANGED','task',v_t.id,p_actor,p_message,jsonb_build_object('is_today_priority',v_t.is_today_priority),
    jsonb_build_object('is_today_priority',p_flag),jsonb_build_object('title',v_t.title));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'task',jsonb_build_object('id',v_t.id,'title',v_t.title,'today',p_flag)));
end $fn$;

-- ================================================================ daily coach: once-per-day delivery + day close
create or replace function public.finance_coach_claim(p_owner uuid, p_kind text, p_date date) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_row public.finance_coach_deliveries%rowtype;
begin
  perform public.finance_i_engine();
  if p_kind not in ('MORNING','EVENING') then raise exception 'invalid_kind'; end if;
  insert into public.finance_coach_deliveries(owner_id,kind,local_date) values(p_owner,p_kind,p_date)
  on conflict (owner_id,kind,local_date) do nothing returning * into v_row;
  if v_row.id is null then
    update public.finance_coach_deliveries set status='CLAIMED',attempts=attempts+1,claimed_at=now()
     where owner_id=p_owner and kind=p_kind and local_date=p_date and attempts<3
       and (status='FAILED' or (status='CLAIMED' and claimed_at<now()-interval '15 minutes'))
     returning * into v_row;
  end if;
  if v_row.id is null then return jsonb_build_object('claimed',false); end if;
  return jsonb_build_object('claimed',true,'delivery_id',v_row.id);
end $fn$;

create or replace function public.finance_coach_finish(p_owner uuid, p_delivery uuid, p_ok boolean, p_error text) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_row public.finance_coach_deliveries%rowtype;
begin
  perform public.finance_i_engine();
  update public.finance_coach_deliveries set status=case when p_ok then 'SENT' else 'FAILED' end,
         sent_at=case when p_ok then now() else sent_at end,last_error=case when p_ok then null else left(coalesce(p_error,'unknown'),300) end
   where id=p_delivery and owner_id=p_owner returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','delivery_not_found'); end if;
  perform public.finance_i_audit(p_owner,case when p_ok then 'COACH_SENT' else 'COACH_FAILED' end,'coach',v_row.id,null,null,'{}'::jsonb,
    jsonb_build_object('kind',v_row.kind,'date',v_row.local_date,'attempts',v_row.attempts),jsonb_build_object('error',p_error));
  return jsonb_build_object('ok',true,'status',v_row.status);
end $fn$;

create or replace function public.finance_day_close_set_context(p_owner uuid, p_date date, p_context jsonb) returns jsonb language plpgsql security definer set search_path=public as $fn$
begin
  insert into public.finance_day_closes(owner_id,local_date,status,context) values(p_owner,p_date,'OPEN',coalesce(p_context,'{}'::jsonb))
  on conflict (owner_id,local_date) do update set context=excluded.context where public.finance_day_closes.status='OPEN';
  return jsonb_build_object('ok',true);
end $fn$;

create or replace function public.finance_day_close_get(p_owner uuid, p_since date) returns jsonb language sql stable security definer set search_path=public as $fn$
  select coalesce((select jsonb_build_object('local_date',local_date,'status',status,'context',context)
    from public.finance_day_closes where owner_id=p_owner and local_date>=p_since order by local_date desc limit 1),'null'::jsonb);
$fn$;

create or replace function public.finance_day_close(p_owner uuid, p_date date, p_note text, p_actor text, p_message text) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_row public.finance_day_closes%rowtype;
begin
  perform public.finance_i_engine();
  insert into public.finance_day_closes(owner_id,local_date,status,closed_at,note) values(p_owner,p_date,'CLOSED',now(),nullif(left(coalesce(p_note,''),500),''))
  on conflict (owner_id,local_date) do update set status='CLOSED',closed_at=coalesce(public.finance_day_closes.closed_at,now()),note=coalesce(nullif(left(coalesce(p_note,''),500),''),public.finance_day_closes.note)
  returning * into v_row;
  perform public.finance_i_audit(p_owner,'DAY_CLOSED','day',null,p_actor,p_message,'{}'::jsonb,jsonb_build_object('date',p_date),jsonb_build_object('note',p_note));
  return jsonb_build_object('ok',true,'date',v_row.local_date);
end $fn$;

-- ================================================================ daily close: "ยอดตรง" (the stated balance is confirmed as-is; no transaction is created)
create or replace function public.finance_confirm_balance(p_owner uuid, p_account uuid, p_expected numeric, p_actor text, p_message text, p_idem text)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_prev jsonb; v_acc public.financial_accounts%rowtype; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev := public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_acc from public.financial_accounts where id=p_account and owner_id=p_owner and is_active and archived_at is null for update;
  if v_acc.id is null then raise exception 'account_not_found'; end if;
  if v_acc.balance_status='UNKNOWN' or v_acc.current_balance is null then return jsonb_build_object('ok',false,'error','balance_unknown'); end if;
  if p_expected is not null and p_expected<>v_acc.current_balance then
    return jsonb_build_object('ok',false,'error','balance_changed','balance',v_acc.current_balance);
  end if;
  v_before := public.finance_i_account_json(v_acc.id);
  update public.financial_accounts set balance_status='CONFIRMED',balance_confirmed_at=now(),balance_confirmed_amount=v_acc.current_balance,
         balance_confirmed_seq=(select coalesce(max(seq),0) from public.transactions where owner_id=p_owner) where id=v_acc.id;
  perform public.finance_i_audit(p_owner,'BALANCE_CONFIRMED','account',v_acc.id,p_actor,p_message,v_before,public.finance_i_account_json(v_acc.id),jsonb_build_object('reason','OWNER_CONFIRMED_MATCH'));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'account',public.finance_i_account_json(v_acc.id)));
end $fn$;

-- ================================================================ dashboard: LINE channel status + disconnect (owner only, authenticated)
create or replace function public.finance_binding_status() returns jsonb language plpgsql stable security definer set search_path=public as $fn$
declare v_owner uuid := auth.uid();
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  return jsonb_build_object(
    'active',(select jsonb_build_object('group_name',group_name,'bound_at',bound_at) from public.finance_channel_bindings where owner_id=v_owner and status='ACTIVE' limit 1),
    'pending_groups',(select count(*) from public.finance_channel_bindings where owner_id is null and status='PENDING'),
    'coach',coalesce((select jsonb_agg(jsonb_build_object('kind',kind,'date',local_date,'status',status) order by local_date desc,kind)
                        from (select kind,local_date,status from public.finance_coach_deliveries where owner_id=v_owner order by local_date desc,kind limit 4) d),'[]'::jsonb));
end $fn$;

create or replace function public.finance_unbind_active() returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_owner uuid := auth.uid(); v_row public.finance_channel_bindings%rowtype;
begin
  if v_owner is null then raise exception 'not_authenticated'; end if;
  perform public.finance_i_engine();
  update public.finance_channel_bindings set status='REVOKED',revoked_at=now(),updated_at=now() where owner_id=v_owner and status='ACTIVE' returning * into v_row;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','no_binding'); end if;
  perform public.finance_i_audit(v_owner,'GROUP_UNBOUND','binding',v_row.id,null,null,jsonb_build_object('status','ACTIVE'),jsonb_build_object('status','REVOKED'),jsonb_build_object('channel','dashboard'));
  return jsonb_build_object('ok',true);
end $fn$;

-- ================================================================ grants (internal helpers stay unreachable; only the owner may mint a code)
do $do$
declare r record;
begin
  for r in select p.oid::regprocedure as sig, p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname like 'finance\_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
    if r.proname not like 'finance\_i\_%' then
      execute format('grant execute on function %s to service_role',r.sig);
    end if;
  end loop;
  revoke all on function public.finance_issue_binding_code() from service_role;
  revoke all on function public.finance_binding_status() from service_role;
  revoke all on function public.finance_unbind_active() from service_role;
  grant execute on function public.finance_issue_binding_code() to authenticated;
  grant execute on function public.finance_binding_status() to authenticated;
  grant execute on function public.finance_unbind_active() to authenticated;
end $do$;
