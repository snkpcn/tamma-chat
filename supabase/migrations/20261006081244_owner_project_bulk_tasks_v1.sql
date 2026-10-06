-- Add ordered bulk-task capture and LINE task-state updates to the existing
-- Owner Project OS. No existing rows are deleted or rewritten.

alter table public.owner_project_tasks
  add column if not exists source_batch_position smallint null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='owner_project_tasks_batch_position_check'
      and conrelid='public.owner_project_tasks'::regclass
  ) then
    alter table public.owner_project_tasks
      add constraint owner_project_tasks_batch_position_check
      check(source_batch_position is null or source_batch_position between 1 and 100);
  end if;
end;
$$;

create index if not exists owner_project_tasks_source_batch_idx
  on public.owner_project_tasks(source_message_id,source_batch_position)
  where source_batch_position is not null;

create or replace function public.owner_project_confirm_bulk_tasks_v1(
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
  v_business text;
  v_due_on date;
  v_schedule text;
  v_responsible text;
  v_item jsonb;
  v_position integer;
  v_title text;
  v_item_due_on date;
  v_item_responsible text;
  v_first_task_id uuid;
  v_tasks jsonb:='[]'::jsonb;
  v_task_count integer;
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
    select coalesce(jsonb_agg(
      jsonb_build_object(
        'id',row.id,'task_code',row.task_code,'title',row.title,
        'position',row.source_batch_position
      ) order by row.source_batch_position
    ),'[]'::jsonb)
    into v_tasks
    from public.owner_project_tasks row
    where row.project_id=v_draft.confirmed_project_id
      and row.source_message_id=v_draft.confirmed_by_message_id
      and row.source_batch_position is not null;
    return jsonb_build_object(
      'ok',true,'duplicate',true,'draft_id',v_draft.id,
      'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
      'task_id',v_draft.confirmed_task_id,'task_count',jsonb_array_length(v_tasks),'tasks',v_tasks
    );
  end if;

  if v_draft.status<>'awaiting_confirmation' then raise exception 'owner_project_draft_not_ready'; end if;
  if cardinality(v_draft.missing_fields)>0 then raise exception 'owner_project_draft_missing_fields'; end if;
  if v_draft.expires_at<=now() then raise exception 'owner_project_draft_expired'; end if;
  if jsonb_typeof(coalesce(v_draft.data->'bulk_tasks','null'::jsonb))<>'array' then
    raise exception 'owner_project_bulk_tasks_required';
  end if;
  v_task_count:=jsonb_array_length(v_draft.data->'bulk_tasks');
  if v_task_count<2 or v_task_count>40 then raise exception 'invalid_owner_project_bulk_task_count'; end if;

  v_project_name:=left(trim(coalesce(v_draft.data->>'project_name','')),180);
  v_normalized_name:=left(regexp_replace(lower(v_project_name),'\s+',' ','g'),180);
  if length(v_project_name)<2 then raise exception 'owner_project_name_required'; end if;

  v_business:=nullif(trim(coalesce(v_draft.data->>'business_unit_code','')),'');
  if v_business is not null and v_business not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then v_business:='other'; end if;

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
      owner_group_hash,name,normalized_name,purpose,business_unit_code,status,
      source_channel,source_message_id,created_by_hash,confirmed_at
    ) values (
      v_draft.owner_group_hash,v_project_name,v_normalized_name,
      nullif(left(trim(coalesce(v_draft.data->>'project_purpose','')),2000),''),
      v_business,'active','line',trim(p_message_id),v_draft.actor_hash,now()
    ) returning * into v_project;

    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,after_data
    ) values (
      'project',v_project.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_project)
    );
  end if;

  v_due_on:=case
    when coalesce(v_draft.data->>'due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
      then (v_draft.data->>'due_on')::date
    else null end;
  v_schedule:=nullif(left(trim(coalesce(v_draft.data->>'schedule_text','')),240),'');
  v_responsible:=nullif(left(trim(coalesce(v_draft.data->>'responsible_name','')),180),'');

  for v_item,v_position in
    select value,ordinality::integer
    from jsonb_array_elements(v_draft.data->'bulk_tasks') with ordinality as items(value,ordinality)
  loop
    v_title:=left(trim(case
      when jsonb_typeof(v_item)='string' then trim(both '"' from v_item::text)
      else coalesce(v_item->>'title','')
    end),240);
    if length(v_title)<2 then raise exception 'owner_project_bulk_task_title_required'; end if;

    v_item_due_on:=case
      when coalesce(v_item->>'due_on','') ~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'
        then (v_item->>'due_on')::date
      else v_due_on end;
    v_item_responsible:=coalesce(
      nullif(left(trim(coalesce(v_item->>'responsible_name','')),180),''),
      v_responsible
    );

    insert into public.owner_project_tasks(
      project_id,title,description,task_kind,due_on,schedule_text,responsible_name,
      status,source_channel,source_message_id,source_batch_position,created_by_hash,confirmed_at
    ) values (
      v_project.id,v_title,
      nullif(left(trim(coalesce(v_item->>'description','')),2000),''),
      'one_time',v_item_due_on,v_schedule,v_item_responsible,
      'todo','line',trim(p_message_id),v_position,v_draft.actor_hash,now()
    ) returning * into v_task;

    if v_first_task_id is null then v_first_task_id:=v_task.id; end if;
    v_tasks:=v_tasks || jsonb_build_array(jsonb_build_object(
      'id',v_task.id,'task_code',v_task.task_code,'title',v_task.title,
      'position',v_task.source_batch_position
    ));

    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,after_data
    ) values ('task',v_task.id,'created','line',v_draft.actor_hash,trim(p_message_id),to_jsonb(v_task));
  end loop;

  update public.owner_project_conversation_drafts
  set status='confirmed',confirmed_by_message_id=trim(p_message_id),
      confirmed_project_id=v_project.id,confirmed_task_id=v_first_task_id,updated_at=now()
  where id=v_draft.id;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,after_data
  ) values (
    'draft',v_draft.id,'confirmed','line',v_draft.actor_hash,trim(p_message_id),
    jsonb_build_object('project_id',v_project.id,'task_ids',(
      select coalesce(jsonb_agg(value->'id'),'[]'::jsonb) from jsonb_array_elements(v_tasks)
    ),'task_count',v_task_count)
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'draft_id',v_draft.id,
    'project_id',v_project.id,'project_code',v_project.project_code,'project_name',v_project.name,
    'task_id',v_first_task_id,'task_count',v_task_count,'tasks',v_tasks
  );
end;
$$;

create or replace function public.owner_project_set_task_state_from_line_v1(
  p_task_id uuid,
  p_group_hash text,
  p_state text,
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
  v_before jsonb;
  v_project_name text;
begin
  if p_state not in ('todo','done') then raise exception 'invalid_owner_project_line_task_state'; end if;
  if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select task.* into v_task
  from public.owner_project_tasks task
  join public.owner_projects project on project.id=task.project_id
  where task.id=p_task_id
    and task.status<>'cancelled'
    and project.status<>'cancelled'
    and project.owner_group_hash=trim(p_group_hash)
  for update of task;

  if v_task.id is null then raise exception 'owner_project_task_not_found_for_group'; end if;
  select name into v_project_name from public.owner_projects where id=v_task.project_id;

  if v_task.status=p_state then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'task_id',v_task.id,'task_code',v_task.task_code,
      'task_title',v_task.title,'task_status',v_task.status,
      'project_name',v_project_name,'batch_position',v_task.source_batch_position
    );
  end if;

  v_before:=to_jsonb(v_task);
  update public.owner_project_tasks
  set status=p_state,updated_at=now()
  where id=v_task.id
  returning * into v_task;

  insert into public.owner_project_audit_events(
    entity_type,entity_id,action,source,actor_hash,message_id,reason,before_data,after_data
  ) values (
    'task',v_task.id,'status_changed','line',trim(p_actor_hash),trim(p_message_id),
    case when p_state='done' then 'เจ้าของแจ้งว่างานเสร็จจาก LINE' else 'เจ้าของย้ายงานกลับเป็นงานค้างจาก LINE' end,
    v_before,to_jsonb(v_task)
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'task_id',v_task.id,'task_code',v_task.task_code,
    'task_title',v_task.title,'task_status',v_task.status,
    'project_name',v_project_name,'batch_position',v_task.source_batch_position
  );
end;
$$;

revoke all on function public.owner_project_confirm_bulk_tasks_v1(uuid,text,text)
  from public,anon,authenticated;
revoke all on function public.owner_project_set_task_state_from_line_v1(uuid,text,text,text,text)
  from public,anon,authenticated;

grant execute on function public.owner_project_confirm_bulk_tasks_v1(uuid,text,text)
  to service_role;
grant execute on function public.owner_project_set_task_state_from_line_v1(uuid,text,text,text,text)
  to service_role;
