-- A project completion is distinct from completing an individual task.
-- Keep every task, financial record, and audit event intact.
create or replace function public.owner_project_set_project_state_from_line_v1(
  p_project_id uuid,
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
  v_project public.owner_projects%rowtype;
  v_before jsonb;
  v_pending integer;
  v_pending_examples jsonb;
  v_duplicate boolean;
begin
  if p_state is null or p_state not in ('active','completed') then
    raise exception 'invalid_owner_project_line_state';
  end if;
  if length(trim(coalesce(p_group_hash,'')))<16 then raise exception 'owner_group_required'; end if;
  if coalesce(trim(p_actor_hash),'')='' then raise exception 'actor_required'; end if;
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;

  select * into v_project from public.owner_projects
  where id=p_project_id and owner_group_hash=trim(p_group_hash) and status<>'cancelled'
  for update;
  if v_project.id is null then raise exception 'owner_project_not_found_for_group'; end if;

  v_duplicate:=v_project.status=p_state or exists (
    select 1 from public.owner_project_audit_events audit
    where audit.entity_type='project' and audit.entity_id=v_project.id
      and audit.action='status_changed' and audit.source='line'
      and audit.message_id=trim(p_message_id)
  );
  if not v_duplicate and p_state='completed' then
    -- Lock the existing tasks before checking, so a concurrent task update
    -- cannot turn a pending task into a completed project by accident.
    perform id from public.owner_project_tasks where project_id=v_project.id for update;
    select count(*)::integer into v_pending from public.owner_project_tasks
    where project_id=v_project.id and status not in ('done','cancelled');
    if v_pending>0 then
      select coalesce(jsonb_agg(jsonb_build_object('code',task_code,'title',title)),'[]'::jsonb)
      into v_pending_examples from (
        select task_code,title from public.owner_project_tasks
        where project_id=v_project.id and status not in ('done','cancelled')
        order by created_at limit 5
      ) pending;
      return jsonb_build_object('ok',false,'blocked',true,'project_name',v_project.name,
        'pending_count',v_pending,'pending_tasks',v_pending_examples);
    end if;
  end if;

  if not v_duplicate then
    v_before:=to_jsonb(v_project);
    update public.owner_projects set status=p_state,updated_at=now()
    where id=v_project.id returning * into v_project;
    insert into public.owner_project_audit_events(
      entity_type,entity_id,action,source,actor_hash,message_id,reason,before_data,after_data
    ) values (
      'project',v_project.id,'status_changed','line',trim(p_actor_hash),trim(p_message_id),
      case when p_state='completed' then 'เจ้าของแจ้งว่าทั้งโครงการเสร็จจาก LINE'
           else 'เจ้าของเปิดโครงการกลับมาดำเนินการจาก LINE' end,
      v_before,to_jsonb(v_project)
    );
  end if;

  return jsonb_build_object('ok',true,'duplicate',v_duplicate,
    'project_id',v_project.id,'project_code',v_project.project_code,
    'project_name',v_project.name,'project_status',v_project.status);
end;
$$;

revoke all on function public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.owner_project_set_project_state_from_line_v1(uuid,text,text,text,text)
  to service_role;
