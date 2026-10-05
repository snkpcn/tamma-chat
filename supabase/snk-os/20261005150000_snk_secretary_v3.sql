-- SNK LIFE OS secretary v3.
-- Additive: extends the canonical tasks/schedule/goals tables; it does not
-- create a second task or calendar system. OVERDUE is derived from due_date.

alter table public.tasks
  add column if not exists secretary_state text not null default 'OPEN'
    check (secretary_state in ('OPEN','IN_PROGRESS','WAITING','BLOCKED','DONE','SNOOZED','CANCELLED')),
  add column if not exists progress smallint null check (progress between 0 and 100),
  add column if not exists waiting_for text null,
  add column if not exists blocker text null,
  add column if not exists next_action text null,
  add column if not exists snoozed_until timestamptz null,
  add column if not exists next_check_in_at timestamptz null,
  add column if not exists last_check_in_at timestamptz null,
  add column if not exists secretary_key text null,
  add column if not exists secretary_kind text not null default 'TASK'
    check (secretary_kind in ('TASK','DEADLINE_TASK','RECURRING_TASK')),
  add column if not exists recurrence_rule jsonb null,
  add column if not exists owner_priority smallint null check (owner_priority between 0 and 100),
  add column if not exists priority_reason text null,
  add column if not exists consequence text null,
  add column if not exists estimate_minutes integer null check (estimate_minutes between 1 and 10080),
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

do $preserve_task_timestamps$
declare has_touch_trigger boolean;
begin
  select exists(select 1 from pg_trigger where tgrelid='public.tasks'::regclass
    and tgname='snk_touch_updated_at' and not tgisinternal) into has_touch_trigger;
  if has_touch_trigger then execute 'alter table public.tasks disable trigger snk_touch_updated_at'; end if;
  update public.tasks set secretary_state=case
    when completed_at is not null or status='done' then 'DONE'
    when status='doing' then 'IN_PROGRESS'
    else 'OPEN' end
  where secretary_state='OPEN' and (completed_at is not null or status in ('doing','done'));
  if has_touch_trigger then execute 'alter table public.tasks enable trigger snk_touch_updated_at'; end if;
exception when others then
  if has_touch_trigger then
    begin execute 'alter table public.tasks enable trigger snk_touch_updated_at'; exception when others then null; end;
  end if;
  raise;
end $preserve_task_timestamps$;

alter table public.schedule_events
  add column if not exists secretary_key text null,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;
alter table public.goals
  add column if not exists secretary_key text null,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists tasks_owner_secretary_key_open_uq
  on public.tasks(owner_id,secretary_key)
  where secretary_key is not null and archived_at is null and completed_at is null and secretary_state not in ('DONE','CANCELLED');
create index if not exists tasks_owner_secretary_priority_idx
  on public.tasks(owner_id,secretary_state,due_date,owner_priority desc) where archived_at is null;
create unique index if not exists schedule_owner_secretary_instance_uq
  on public.schedule_events(owner_id,secretary_key,start_time)
  where secretary_key is not null and archived_at is null and status<>'cancelled';

create table if not exists public.secretary_followup_policies(
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  cadence text not null default 'DAILY' check (cadence in ('DAILY','WEEKLY','CUSTOM')),
  interval_days integer not null default 1 check (interval_days between 1 and 365),
  active boolean not null default true,
  next_check_in_at timestamptz null,
  last_check_in_at timestamptz null,
  stopped_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id,task_id)
);

create table if not exists public.secretary_contexts(
  owner_id uuid not null references auth.users(id) on delete cascade,
  actor_hash text not null,
  last_item_type text null check (last_item_type is null or last_item_type in ('task','event','goal','obligation')),
  last_item_id uuid null,
  last_batch jsonb not null default '[]'::jsonb,
  last_message_id text null,
  updated_at timestamptz not null default now(),
  primary key(owner_id,actor_hash)
);

create index if not exists secretary_followup_policies_task_id_idx
  on public.secretary_followup_policies(task_id);

do $do$
declare t text;
begin
  foreach t in array array['secretary_followup_policies','secretary_contexts'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to service_role,authenticated',t);
    execute format('create policy %I on public.%I for select to authenticated using (owner_id=(select auth.uid()))',t||'_owner_read',t);
  end loop;
end $do$;

create or replace function public.secretary_i_task_key(p_text text) returns text
language sql immutable set search_path=public as $fn$
  select nullif(regexp_replace(
    regexp_replace(lower(trim(coalesce(p_text,''))),
      '(เตือน|ทุกวัน|จนกว่า(จะ)?เสร็จ|ให้จบ|ให้เสร็จ|ทำก่อน|ทำ|เช็ก|ตรวจ|เรื่อง|รายงาน|งาน)', ' ', 'g'),
    '[^a-z0-9ก-๙]+','','g'),'');
$fn$;

create or replace function public.secretary_task_sync() returns trigger
language plpgsql set search_path=public as $fn$
begin
  -- UI writes use todo/doing/done; secretary RPCs write secretary_state.  If
  -- only the UI status changed, translate it.  Otherwise the explicit
  -- secretary state wins so WAITING/BLOCKED/SNOOZED are not collapsed to todo.
  if tg_op='UPDATE' and new.status is distinct from old.status
      and new.secretary_state is not distinct from old.secretary_state then
    if new.status='done' then
      new.secretary_state:='DONE'; new.completed_at:=coalesce(new.completed_at,now());
    elsif new.status='doing' then
      new.secretary_state:='IN_PROGRESS'; new.completed_at:=null;
    elsif new.status in ('todo','inbox') then
      new.secretary_state:='OPEN'; new.completed_at:=null;
    end if;
  elsif new.status='done' or new.completed_at is not null or new.secretary_state='DONE' then
    new.secretary_state:='DONE'; new.status:='done'; new.completed_at:=coalesce(new.completed_at,now());
  elsif new.secretary_state='IN_PROGRESS' then
    new.status:='doing'; new.completed_at:=null;
  elsif new.secretary_state='CANCELLED' then
    new.status:='todo'; new.completed_at:=null; new.archived_at:=coalesce(new.archived_at,now());
  elsif new.secretary_state in ('OPEN','WAITING','BLOCKED','SNOOZED') then
    new.status:='todo'; new.completed_at:=null;
  end if;
  new.updated_at:=now();
  return new;
end $fn$;

drop trigger if exists secretary_task_sync_trg on public.tasks;
create trigger secretary_task_sync_trg before insert or update on public.tasks
for each row execute function public.secretary_task_sync();

create or replace function public.secretary_apply_batch(
  p_owner uuid,p_items jsonb,p_actor text,p_message text,p_idem text,p_today date
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare
  v_prev jsonb; v_item jsonb; v_kind text; v_title text; v_key text; v_id uuid; v_created boolean;
  v_results jsonb:='[]'::jsonb; v_ids jsonb:='[]'::jsonb; v_res jsonb; v_due date; v_start timestamptz; v_reminder_days integer[];
begin
  perform public.finance_i_engine();
  v_prev:=public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'secretary_batch_size'; end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_kind:=upper(coalesce(v_item->>'kind','TASK'));
    v_title:=left(trim(coalesce(v_item->>'title','')),160);
    v_key:=coalesce(nullif(v_item->>'key',''),public.secretary_i_task_key(v_title));
    if v_title='' or v_key is null then raise exception 'secretary_title_required'; end if;
    v_created:=false; v_id:=null;

    if v_kind in ('TASK','DEADLINE_TASK','RECURRING_TASK','WAITING','DAILY_FOLLOW_UP') then
      select id into v_id from public.tasks
       where owner_id=p_owner and archived_at is null and completed_at is null and secretary_state not in ('DONE','CANCELLED')
         and (secretary_key=v_key or (secretary_key is null and public.secretary_i_task_key(title)=v_key))
       order by created_at limit 1 for update;
      if v_id is null then
        insert into public.tasks(owner_id,title,status,due_date,due_time,priority,is_today_priority,secretary_state,secretary_kind,
          waiting_for,blocker,next_action,secretary_key,recurrence_rule,owner_priority,priority_reason,source_metadata)
        values(p_owner,v_title,case when v_kind='WAITING' then 'todo' else 'todo' end,
          nullif(v_item->>'due_date','')::date,nullif(v_item->>'due_time','')::time,
          coalesce(nullif(v_item->>'priority',''),'medium'),coalesce((v_item->>'today_priority')::boolean,false),
          case when v_kind='WAITING' then coalesce(nullif(v_item->>'state',''),'WAITING') else 'OPEN' end,
          case when v_kind in ('DEADLINE_TASK','RECURRING_TASK') then v_kind else 'TASK' end,
          nullif(v_item->>'waiting_for',''),nullif(v_item->>'blocker',''),nullif(v_item->>'next_action',''),v_key,
          v_item->'recurrence',nullif(v_item->>'owner_priority','')::smallint,nullif(v_item->>'priority_reason',''),
          jsonb_build_object('source','line_secretary','source_index',v_item->'source_index')) returning id into v_id;
        v_created:=true;
      else
        update public.tasks set
          secretary_key=coalesce(secretary_key,v_key),
          due_date=coalesce(nullif(v_item->>'due_date','')::date,due_date),
          due_time=coalesce(nullif(v_item->>'due_time','')::time,due_time),
          priority=coalesce(nullif(v_item->>'priority',''),priority),
          is_today_priority=case when v_item ? 'today_priority' then (v_item->>'today_priority')::boolean else is_today_priority end,
          secretary_state=case when v_kind='WAITING' then coalesce(nullif(v_item->>'state',''),'WAITING') else secretary_state end,
          waiting_for=coalesce(nullif(v_item->>'waiting_for',''),waiting_for),blocker=coalesce(nullif(v_item->>'blocker',''),blocker),
          next_action=coalesce(nullif(v_item->>'next_action',''),next_action),recurrence_rule=coalesce(v_item->'recurrence',recurrence_rule),
          owner_priority=coalesce(nullif(v_item->>'owner_priority','')::smallint,owner_priority),
          priority_reason=coalesce(nullif(v_item->>'priority_reason',''),priority_reason)
        where id=v_id;
      end if;
      if v_kind='DAILY_FOLLOW_UP' or coalesce((v_item->>'follow_up')::boolean,false) then
        insert into public.secretary_followup_policies(owner_id,task_id,cadence,interval_days,active,next_check_in_at,stopped_at)
        values(p_owner,v_id,'DAILY',1,true,((coalesce(p_today,timezone('Asia/Bangkok',now())::date)+1)::timestamp+time '08:00') at time zone 'Asia/Bangkok',null)
        on conflict(owner_id,task_id) do update set active=true,cadence='DAILY',interval_days=1,next_check_in_at=excluded.next_check_in_at,stopped_at=null,updated_at=now();
        update public.tasks set next_check_in_at=((coalesce(p_today,timezone('Asia/Bangkok',now())::date)+1)::timestamp+time '08:00') at time zone 'Asia/Bangkok' where id=v_id;
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('kind','task','id',v_id,'title',v_title,'created',v_created));
      v_ids:=v_ids||jsonb_build_array(jsonb_build_object('n',jsonb_array_length(v_ids)+1,'type','task','id',v_id,'title',v_title));

    elsif v_kind='CALENDAR_EVENT' then
      v_start:=nullif(v_item->>'start_at','')::timestamptz;
      if v_start is null then raise exception 'secretary_event_time_required'; end if;
      select id into v_id from public.schedule_events where owner_id=p_owner and archived_at is null and status<>'cancelled' and secretary_key=v_key and start_time=v_start limit 1;
      if v_id is null then
        insert into public.schedule_events(owner_id,title,start_time,end_time,category,status,all_day,location,notes,priority,reminder_at,rrule,secretary_key,source_metadata)
        values(p_owner,v_title,v_start,nullif(v_item->>'end_at','')::timestamptz,coalesce(nullif(v_item->>'category',''),'meeting'),'scheduled',
          coalesce((v_item->>'all_day')::boolean,false),nullif(v_item->>'location',''),nullif(v_item->>'notes',''),coalesce(nullif(v_item->>'priority',''),'medium'),
          nullif(v_item->>'reminder_at','')::timestamptz,case when v_item ? 'recurrence' then (v_item->'recurrence')::text else null end,v_key,
          jsonb_build_object('source','line_secretary','source_index',v_item->'source_index')) returning id into v_id;
        v_created:=true;
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('kind','event','id',v_id,'title',v_title,'created',v_created));
      v_ids:=v_ids||jsonb_build_array(jsonb_build_object('n',jsonb_array_length(v_ids)+1,'type','event','id',v_id,'title',v_title));

    elsif v_kind='GOAL' then
      select id into v_id from public.goals where owner_id=p_owner and archived_at is null and coalesce(status,'active')='active'
        and (secretary_key=v_key or (secretary_key is null and public.secretary_i_task_key(title)=v_key)) limit 1;
      if v_id is null then
        insert into public.goals(owner_id,title,level,deadline,priority,status,secretary_key,source_metadata)
        values(p_owner,v_title,coalesce(nullif(v_item->>'level',''),'quarter'),nullif(v_item->>'due_date','')::date,
          coalesce(nullif(v_item->>'priority',''),'medium'),'active',v_key,jsonb_build_object('source','line_secretary')) returning id into v_id;
        v_created:=true;
      end if;
      v_results:=v_results||jsonb_build_array(jsonb_build_object('kind','goal','id',v_id,'title',v_title,'created',v_created));
      v_ids:=v_ids||jsonb_build_array(jsonb_build_object('n',jsonb_array_length(v_ids)+1,'type','goal','id',v_id,'title',v_title));

    elsif v_kind='FINANCIAL_OBLIGATION' then
      v_due:=nullif(v_item->>'due_date','')::date;
      if v_due is null then raise exception 'first_due_required'; end if;
      v_reminder_days:=case when v_item ? 'reminder_days'
        then array(select jsonb_array_elements_text(v_item->'reminder_days')::integer)
        else array[7,3,1,0] end;
      v_res:=public.finance_create_obligation(p_owner,v_title,coalesce(nullif(v_item->>'money_kind',''),'EXPENSE'),
        nullif(v_item->>'amount','')::numeric,coalesce(nullif(v_item->>'frequency',''),'ONE_TIME'),nullif(v_item->>'interval_days','')::integer,
        extract(day from v_due)::integer,v_due,null,null,null,null,v_reminder_days,
        nullif(v_item->>'notes',''),p_actor,p_message,p_idem||':obligation:'||v_key);
      v_id:=(v_res->'obligation'->>'id')::uuid;
      v_created:=coalesce((v_res->>'created')::boolean,false);
      v_results:=v_results||jsonb_build_array(jsonb_build_object('kind','obligation','id',v_id,'title',v_title,'created',v_created));
      v_ids:=v_ids||jsonb_build_array(jsonb_build_object('n',jsonb_array_length(v_ids)+1,'type','obligation','id',v_id,'title',v_title));
    else raise exception 'secretary_invalid_kind';
    end if;
  end loop;

  insert into public.secretary_contexts(owner_id,actor_hash,last_item_type,last_item_id,last_batch,last_message_id)
  values(p_owner,p_actor,(v_results->-1)->>'kind',((v_results->-1)->>'id')::uuid,v_ids,p_message)
  on conflict(owner_id,actor_hash) do update set last_item_type=excluded.last_item_type,last_item_id=excluded.last_item_id,
    last_batch=excluded.last_batch,last_message_id=excluded.last_message_id,updated_at=now();
  perform public.finance_i_audit(p_owner,'SECRETARY_BATCH_APPLIED','secretary',null,p_actor,p_message,'{}'::jsonb,
    jsonb_build_object('items',jsonb_array_length(v_results)),jsonb_build_object('results',v_results));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'items',v_results,'count',jsonb_array_length(v_results)));
end $fn$;

create or replace function public.secretary_update_task(
  p_owner uuid,p_task uuid,p_patch jsonb,p_actor text,p_message text,p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_prev jsonb; v_t public.tasks%rowtype; v_state text; v_before jsonb;
begin
  perform public.finance_i_engine();
  v_prev:=public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_t from public.tasks where id=p_task and owner_id=p_owner and archived_at is null for update;
  if v_t.id is null then return jsonb_build_object('ok',false,'error','task_not_found'); end if;
  v_state:=coalesce(nullif(upper(p_patch->>'state'),''),v_t.secretary_state);
  if v_state not in ('OPEN','IN_PROGRESS','WAITING','BLOCKED','DONE','SNOOZED','CANCELLED') then raise exception 'invalid_task_state'; end if;
  v_before:=jsonb_build_object('state',v_t.secretary_state,'progress',v_t.progress,'due_date',v_t.due_date,'waiting_for',v_t.waiting_for);
  update public.tasks set secretary_state=v_state,
    status=case when v_state='DONE' then 'done' when v_state='IN_PROGRESS' then 'doing' else 'todo' end,
    completed_at=case when v_state='DONE' then coalesce(completed_at,now()) else null end,
    archived_at=case when v_state='CANCELLED' then coalesce(archived_at,now()) else archived_at end,
    progress=case when p_patch ? 'progress' then (p_patch->>'progress')::smallint when v_state='DONE' then 100 else progress end,
    waiting_for=case when p_patch ? 'waiting_for' then nullif(p_patch->>'waiting_for','') else waiting_for end,
    blocker=case when p_patch ? 'blocker' then nullif(p_patch->>'blocker','') else blocker end,
    next_action=case when p_patch ? 'next_action' then nullif(p_patch->>'next_action','') else next_action end,
    snoozed_until=case when p_patch ? 'snoozed_until' then nullif(p_patch->>'snoozed_until','')::timestamptz else snoozed_until end,
    due_date=case when p_patch ? 'due_date' then nullif(p_patch->>'due_date','')::date else due_date end,
    due_time=case when p_patch ? 'due_time' then nullif(p_patch->>'due_time','')::time else due_time end,
    owner_priority=case when p_patch ? 'owner_priority' then nullif(p_patch->>'owner_priority','')::smallint else owner_priority end,
    priority_reason=case when p_patch ? 'priority_reason' then nullif(p_patch->>'priority_reason','') else priority_reason end,
    recurrence_rule=case when p_patch ? 'recurrence' then p_patch->'recurrence' else recurrence_rule end,
    last_check_in_at=case when coalesce((p_patch->>'checked_in')::boolean,false) then now() else last_check_in_at end
   where id=p_task;
  if v_state in ('DONE','CANCELLED') or coalesce((p_patch->>'followup_active')::boolean,true)=false then
    update public.secretary_followup_policies set active=false,stopped_at=now(),updated_at=now() where owner_id=p_owner and task_id=p_task and active;
    update public.tasks set next_check_in_at=null where id=p_task;
  elsif coalesce((p_patch->>'followup_active')::boolean,false) then
    insert into public.secretary_followup_policies(owner_id,task_id,active,next_check_in_at) values(p_owner,p_task,true,now()+interval '1 day')
    on conflict(owner_id,task_id) do update set active=true,stopped_at=null,next_check_in_at=excluded.next_check_in_at,updated_at=now();
    update public.tasks set next_check_in_at=now()+interval '1 day' where id=p_task;
  end if;
  insert into public.secretary_contexts(owner_id,actor_hash,last_item_type,last_item_id,last_batch,last_message_id)
  values(p_owner,p_actor,'task',p_task,jsonb_build_array(jsonb_build_object('n',1,'type','task','id',p_task,'title',v_t.title)),p_message)
  on conflict(owner_id,actor_hash) do update set last_item_type='task',last_item_id=p_task,last_batch=excluded.last_batch,last_message_id=p_message,updated_at=now();
  perform public.finance_i_audit(p_owner,'SECRETARY_TASK_UPDATED','task',p_task,p_actor,p_message,v_before,
    jsonb_build_object('state',v_state,'patch',p_patch),jsonb_build_object('title',v_t.title));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'task',jsonb_build_object('id',p_task,'title',v_t.title,'state',v_state)));
end $fn$;

create or replace function public.secretary_update_event(
  p_owner uuid,p_event uuid,p_patch jsonb,p_actor text,p_message text,p_idem text
) returns jsonb language plpgsql security definer set search_path=public as $fn$
declare v_prev jsonb; v_e public.schedule_events%rowtype;
begin
  perform public.finance_i_engine();
  v_prev:=public.finance_i_idem_get(p_owner,p_idem); if v_prev is not null then return v_prev; end if;
  select * into v_e from public.schedule_events where id=p_event and owner_id=p_owner and archived_at is null for update;
  if v_e.id is null then return jsonb_build_object('ok',false,'error','event_not_found'); end if;
  update public.schedule_events set
    start_time=case when p_patch ? 'start_at' then (p_patch->>'start_at')::timestamptz else start_time end,
    end_time=case when p_patch ? 'end_at' then nullif(p_patch->>'end_at','')::timestamptz else end_time end,
    status=case when coalesce((p_patch->>'cancelled')::boolean,false) then 'cancelled' else status end,
    reminder_at=case when p_patch ? 'reminder_at' then nullif(p_patch->>'reminder_at','')::timestamptz else reminder_at end,
    rrule=case when p_patch ? 'recurrence' then case when p_patch->'recurrence'='null'::jsonb then null else (p_patch->'recurrence')::text end else rrule end,
    updated_at=now() where id=p_event;
  insert into public.secretary_contexts(owner_id,actor_hash,last_item_type,last_item_id,last_batch,last_message_id)
  values(p_owner,p_actor,'event',p_event,jsonb_build_array(jsonb_build_object('n',1,'type','event','id',p_event,'title',v_e.title)),p_message)
  on conflict(owner_id,actor_hash) do update set last_item_type='event',last_item_id=p_event,last_batch=excluded.last_batch,last_message_id=p_message,updated_at=now();
  perform public.finance_i_audit(p_owner,'SECRETARY_EVENT_UPDATED','event',p_event,p_actor,p_message,'{}'::jsonb,p_patch,jsonb_build_object('title',v_e.title));
  return public.finance_i_idem_put(p_owner,p_idem,jsonb_build_object('ok',true,'event',jsonb_build_object('id',p_event,'title',v_e.title)));
end $fn$;

create or replace function public.secretary_state_snapshot(p_owner uuid,p_actor text,p_today date) returns jsonb
language plpgsql stable security definer set search_path=public as $fn$
declare v_tasks jsonb; v_waiting jsonb; v_events jsonb; v_context jsonb; v_followups jsonb;
begin
  select coalesce(jsonb_agg(x.j order by x.score desc,x.due_date nulls last,x.created_at),'[]'::jsonb) into v_tasks from (
    select t.due_date,t.created_at,
      (coalesce(t.owner_priority,0)*10000 + case tp.position when 1 then 1200000 when 2 then 1100000 when 3 then 1000000 else 0 end
       + case when t.is_today_priority then 500000 else 0 end
       + case when t.due_date<p_today then 400000+least(90000,(p_today-t.due_date)*1000)
              when t.due_date=p_today then 350000 when t.due_date=p_today+1 then 250000
              when t.due_date<=p_today+3 then 150000 else 0 end
       + case when f.next_check_in_at<=(((p_today+1)::timestamp) at time zone 'Asia/Bangkok') then 60000 else 0 end
       + case t.priority when 'high' then 50000 when 'medium' then 20000 else 0 end
       + case when g.priority='high' then 30000 else 0 end
       + case when t.consequence is not null then 20000 else 0 end
       + least(9999,greatest(0,p_today-t.created_at::date)))::bigint score,
      jsonb_build_object('id',t.id,'title',t.title,'state',case when t.due_date<p_today then 'OVERDUE'
          when t.secretary_state='SNOOZED' and t.snoozed_until<=now() then 'OPEN' else t.secretary_state end,
        'stored_state',t.secretary_state,'progress',t.progress,'due_date',t.due_date,'due_time',t.due_time,'priority',t.priority,
        'owner_priority',t.owner_priority,'next_action',t.next_action,'score',
        (coalesce(t.owner_priority,0)*10000 + case tp.position when 1 then 1200000 when 2 then 1100000 when 3 then 1000000 else 0 end
         + case when t.is_today_priority then 500000 else 0 end
         + case when t.due_date<p_today then 400000+least(90000,(p_today-t.due_date)*1000) when t.due_date=p_today then 350000 when t.due_date=p_today+1 then 250000 when t.due_date<=p_today+3 then 150000 else 0 end
         + case when f.next_check_in_at<=(((p_today+1)::timestamp) at time zone 'Asia/Bangkok') then 60000 else 0 end
         + case t.priority when 'high' then 50000 when 'medium' then 20000 else 0 end
         + case when g.priority='high' then 30000 else 0 end + case when t.consequence is not null then 20000 else 0 end),
        'reason',case when tp.position is not null then 'เจ้าของจัดเป็นอันดับ '||tp.position||' วันนี้'
          when coalesce(t.owner_priority,0)>=90 then coalesce(t.priority_reason,'เจ้าของกำหนดให้สำคัญที่สุด')
          when t.due_date<p_today then 'เลยกำหนด '||(p_today-t.due_date)||' วัน' when t.due_date=p_today then 'ครบกำหนดวันนี้'
          when t.due_date=p_today+1 then 'ครบกำหนดพรุ่งนี้' when t.is_today_priority then 'ถูกเลือกเป็นงานวันนี้'
          when f.next_check_in_at<=(((p_today+1)::timestamp) at time zone 'Asia/Bangkok') then 'ถึงรอบติดตามวันนี้'
          when g.priority='high' then 'เชื่อมกับเป้าหมายสำคัญ'
          when t.priority='high' then 'ตั้งความสำคัญสูง' else 'งานค้างที่พร้อมทำ' end) j
    from public.tasks t
    left join public.goals g on g.id=t.goal_id and g.owner_id=p_owner and g.archived_at is null
    left join public.secretary_followup_policies f on f.owner_id=p_owner and f.task_id=t.id and f.active
    left join lateral (select min(p.position) position from public.top_priorities p
      where p.owner_id=p_owner and p.priority_date=p_today and p.item_type='task' and p.item_id=t.id) tp on true
    where t.owner_id=p_owner and t.archived_at is null and t.completed_at is null
      and (t.secretary_state in ('OPEN','IN_PROGRESS') or (t.secretary_state='SNOOZED' and t.snoozed_until<=now()))) x;

  select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'title',t.title,'state',t.secretary_state,'waiting_for',t.waiting_for,
    'blocker',t.blocker,'next_action',t.next_action,'next_check_in_at',t.next_check_in_at) order by t.next_check_in_at nulls last,t.updated_at),'[]'::jsonb)
    into v_waiting from public.tasks t where t.owner_id=p_owner and t.archived_at is null and t.completed_at is null and t.secretary_state in ('WAITING','BLOCKED');
  select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'title',e.title,'start_time',e.start_time,'end_time',e.end_time,'status',e.status,
    'location',e.location,'all_day',e.all_day,'rrule',e.rrule) order by e.start_time),'[]'::jsonb)
    into v_events from public.schedule_events e where e.owner_id=p_owner and e.archived_at is null and e.status='scheduled'
      and e.start_time>=((p_today::timestamp) at time zone 'Asia/Bangkok') and e.start_time<(((p_today+31)::timestamp) at time zone 'Asia/Bangkok');
  select to_jsonb(c) into v_context from public.secretary_contexts c where c.owner_id=p_owner and c.actor_hash=p_actor;
  select coalesce(jsonb_agg(jsonb_build_object('task_id',f.task_id,'title',t.title,'active',f.active,'next_check_in_at',f.next_check_in_at)),'[]'::jsonb)
    into v_followups from public.secretary_followup_policies f join public.tasks t on t.id=f.task_id where f.owner_id=p_owner and f.active;
  return jsonb_build_object('today',p_today,'tasks',v_tasks,'top_three',coalesce((select jsonb_agg(e) from (select e from jsonb_array_elements(v_tasks) e limit 3)s),'[]'::jsonb),
    'waiting',v_waiting,'events',v_events,'followups',v_followups,'context',coalesce(v_context,'null'::jsonb));
end $fn$;

create or replace function public.secretary_morning_data(p_owner uuid,p_actor text,p_today date) returns jsonb
language sql stable security definer set search_path=public as $fn$
  select public.finance_coach_morning_data(p_owner,p_today) || jsonb_build_object(
    'top_three',s->'top_three','waiting',s->'waiting','followups',s->'followups',
    'secretary_tasks',s->'tasks','secretary_events',s->'events','secretary_context',s->'context',
    'missed_days',coalesce((select jsonb_agg(d::date order by d) from generate_series(p_today-7,p_today-1,interval '1 day') d
      where (exists(select 1 from public.transactions t where t.owner_id=p_owner and t.occurred_on=d::date and t.archived_at is null)
          or exists(select 1 from public.tasks t where t.owner_id=p_owner and (t.created_at at time zone 'Asia/Bangkok')::date=d::date))
        and not exists(select 1 from public.finance_day_closes c where c.owner_id=p_owner and c.local_date=d::date and c.status='CLOSED')),'[]'::jsonb))
  from (select public.secretary_state_snapshot(p_owner,p_actor,p_today) s) x;
$fn$;

create or replace function public.secretary_evening_data(p_owner uuid,p_actor text,p_today date) returns jsonb
language sql stable security definer set search_path=public as $fn$
  select public.finance_coach_evening_data(p_owner,p_today) || jsonb_build_object(
    'secretary',public.secretary_state_snapshot(p_owner,p_actor,p_today),
    'missed_days',coalesce((select jsonb_agg(d::date order by d) from generate_series(p_today-7,p_today-1,interval '1 day') d
      where (exists(select 1 from public.transactions t where t.owner_id=p_owner and t.occurred_on=d::date and t.archived_at is null)
          or exists(select 1 from public.tasks t where t.owner_id=p_owner and (t.created_at at time zone 'Asia/Bangkok')::date=d::date))
        and not exists(select 1 from public.finance_day_closes c where c.owner_id=p_owner and c.local_date=d::date and c.status='CLOSED')),'[]'::jsonb));
$fn$;

do $do$
declare r record;
begin
  for r in select p.oid::regprocedure sig,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'secretary\_%' loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.sig);
    if r.proname not like 'secretary\_i\_%' and r.proname<>'secretary_task_sync' then
      execute format('grant execute on function %s to service_role',r.sig);
    end if;
  end loop;
end $do$;
