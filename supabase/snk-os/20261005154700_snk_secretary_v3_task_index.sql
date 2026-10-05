-- Cover the task_id cascade and lookup on secretary follow-up policies.
create index if not exists secretary_followup_policies_task_id_idx
  on public.secretary_followup_policies(task_id);
