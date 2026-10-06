-- Update several confirmed Owner tasks in one transaction. An invalid or
-- out-of-group task rejects the entire request without changing any task.
create or replace function public.owner_project_set_task_states_from_line_v1(
  p_task_ids uuid[],
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
  v_task_id uuid;
  v_task public.owner_project_tasks%rowtype;
  v_before jsonb;
  v_count integer;
  v_unique_count integer;
  v_changed integer:=0;
  v_duplicate boolean;
  v_tasks jsonb:='[]'::jsonb;
begin
  v_count:=cardinality(p_task_ids);
  if v_count is null or v_count not between 2 and 20 then
    raise exception 'invalid_owner_project_task_state_count';
  end if;
  select count(distinct id) into v_unique_count from unnest(p_task_ids) as selected(id) where id is not null;
  if v_unique_count<>v_count then raise exception 'duplicate_or_null_owner_project_task_id'; end if;
  if p_state is null or p_state not in ('todo','done') then raise exception 'invalid_owner_project_line_task_state'; end if;
  if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  foreach v_task_id in array p_task_ids loop
    select task.* into v_task
    from public.owner_project_tasks task
    join public.owner_projects project on project.id=task.project_id
    where task.id=v_task_id
      and task.status<>'cancelled'
      and project.status<>'cancelled'
      and project.owner_group_hash=trim(p_group_hash)
    for update of task;
    if v_task.id is null then raise exception 'owner_project_task_not_found_for_group'; end if;

    v_duplicate:=v_task.status=p_state or exists (
      select 1 from public.owner_project_audit_events audit
      where audit.entity_type='task' and audit.entity_id=v_task.id
        and audit.action='status_changed' and audit.source='line'
        and audit.message_id=trim(p_message_id)
    );
    if not v_duplicate then
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
      v_changed:=v_changed+1;
    end if;
    v_tasks:=v_tasks || jsonb_build_array(jsonb_build_object(
      'task_id',v_task.id,'task_code',v_task.task_code,'task_title',v_task.title,
      'task_status',v_task.status,'batch_position',v_task.source_batch_position,
      'duplicate',v_duplicate
    ));
  end loop;
  return jsonb_build_object('ok',true,'task_count',v_count,'changed_count',v_changed,'tasks',v_tasks);
end;
$$;

revoke all on function public.owner_project_set_task_states_from_line_v1(uuid[],text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.owner_project_set_task_states_from_line_v1(uuid[],text,text,text,text)
  to service_role;
