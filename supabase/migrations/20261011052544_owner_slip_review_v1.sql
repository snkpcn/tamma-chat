-- Existing intake is an evidence inbox. Draft JSON never changes its financial allocation.
alter table public.financial_owner_expense_intakes
  add column review_state text check(review_state in ('draft','confirmed','cancelled')),
  add column review_revision integer not null default 0,
  add column review_data jsonb,
  add column review_message_id text;

create function public.financial_capture_owner_slip_review_v1(
  p_group_hash text,p_message_id text,p_user_hash text,p_occurred_on date,
  p_image_sha256 text,p_storage_bucket text,p_storage_path text,p_mime_type text,p_extraction jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.financial_owner_expense_intakes%rowtype; v_result jsonb; v_ref text;
begin
  if nullif(trim(p_user_hash),'') is null then raise exception 'owner_actor_required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
  v_ref:=nullif(lower(regexp_replace(coalesce(p_extraction->>'reference_number',''),'\s','','g')),'');
  select * into v_row from public.financial_owner_expense_intakes
  where owner_group_hash=p_group_hash and (
    evidence_message_id=p_message_id or evidence_sha256=p_image_sha256 or
    (v_ref is not null and lower(regexp_replace(reference_number,'\s','','g'))=v_ref))
  order by created_at limit 1;
  if v_row.id is not null then
    return jsonb_build_object('ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status);
  end if;
  v_result:=public.financial_capture_owner_expense_slip_v1(p_group_hash,p_message_id,p_user_hash,p_occurred_on,
    p_image_sha256,p_storage_bucket,p_storage_path,p_mime_type,p_extraction);
  if not coalesce((v_result->>'duplicate')::boolean,false) then
    -- Backoffice also aggregates raw intake rows (not only the summary view).
    -- Keep the read amount in extraction/review metadata until confirmation.
    update public.financial_owner_expense_intakes set review_state='draft',amount=null
    where id=(v_result->>'intake_id')::uuid;
  end if;
  return v_result;
end $$;

create function public.financial_stage_owner_slip_review_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_message_id text,p_revision integer,p_proposal jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.financial_owner_expense_intakes%rowtype;
begin
  select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null or v_row.owner_group_hash is distinct from p_group_hash
    or nullif(trim(p_actor_hash),'') is null or v_row.source_user_hash is distinct from p_actor_hash
    or nullif(trim(p_message_id),'') is null then raise exception 'owner_review_identity_mismatch'; end if;
  if v_row.review_message_id=p_message_id or exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=p_message_id and action='purpose_staged'
  ) then
    return jsonb_build_object('ok',true,'duplicate',true,'revision',v_row.review_revision,'proposal',v_row.review_data);
  end if;
  if v_row.review_state is distinct from 'draft' or v_row.review_revision is distinct from p_revision then
    return jsonb_build_object('conflict',true);
  end if;
  if jsonb_typeof(p_proposal)<>'object' or jsonb_typeof(p_proposal->'questions') is distinct from 'array'
    then raise exception 'invalid_review_proposal'; end if;
  update public.financial_owner_expense_intakes
  set review_data=p_proposal,review_revision=review_revision+1,review_message_id=p_message_id,updated_at=now()
  where id=p_intake_id;
  insert into public.financial_owner_expense_audit_events(intake_id,action,source,actor_hash,message_id,before_data,after_data)
  values(p_intake_id,'purpose_staged','line',p_actor_hash,p_message_id,
    jsonb_build_object('review',v_row.review_data,'revision',v_row.review_revision),
    jsonb_build_object('review',p_proposal,'revision',p_revision+1));
  return jsonb_build_object('ok',true,'revision',p_revision+1,'proposal',p_proposal);
end $$;

create function public.financial_confirm_owner_slip_review_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_revision integer,p_message_id text,p_cancel boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_project public.owner_projects%rowtype;
  v_installment public.owner_project_installments%rowtype;
  v_data jsonb; v_project_id uuid; v_task_id uuid; v_installment_id uuid; v_amount numeric; v_date date; v_ref text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_group_hash,117));
  select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id for update;
  if v_row.id is null or v_row.owner_group_hash is distinct from p_group_hash
    or nullif(trim(p_actor_hash),'') is null or v_row.source_user_hash is distinct from p_actor_hash
    or nullif(trim(p_message_id),'') is null then raise exception 'owner_review_identity_mismatch'; end if;
  if v_row.review_state in ('confirmed','cancelled') then
    return jsonb_build_object('ok',true,'duplicate',true,'state',v_row.review_state);
  end if;
  if v_row.review_state is distinct from 'draft' or v_row.review_revision is distinct from p_revision then
    return jsonb_build_object('conflict',true);
  end if;
  if p_cancel is null then raise exception 'owner_review_action_required'; end if;
  if p_cancel then
    perform public.financial_mark_owner_expense_not_expense_v1(v_row.id,'Owner cancelled slip review',p_actor_hash,p_message_id);
    update public.financial_owner_expense_intakes set review_state='cancelled' where id=v_row.id;
    return jsonb_build_object('ok',true,'state','cancelled');
  end if;
  v_data:=v_row.review_data;
  if v_data is null or jsonb_typeof(v_data->'questions') is distinct from 'array'
    or jsonb_array_length(v_data->'questions')<>0
    or nullif(trim(v_data->>'purpose'),'') is null
    or coalesce(v_data->>'expense_class','') not in ('capital_investment','operating_expense')
    or coalesce(v_data->>'expense_category','other')='other'
    or coalesce(v_data->>'business_unit_code','other')='other'
    then raise exception 'owner_review_incomplete'; end if;
  v_amount:=(v_data->>'amount')::numeric;
  v_date:=(v_data->>'occurred_on')::date;
  if v_amount is null or v_amount<=0 or v_amount>100000000 or v_date is null then raise exception 'owner_review_amount_date_required'; end if;
  v_project_id:=(v_data->>'project_id')::uuid;
  v_task_id:=(v_data->>'task_id')::uuid;
  v_installment_id:=(v_data->>'installment_id')::uuid;
  if v_project_id is not null then
    select * into v_project from public.owner_projects where id=v_project_id for share;
    if v_project.id is null or v_project.owner_group_hash is distinct from p_group_hash or v_project.status='cancelled'
      or (v_project.business_unit_code is not null and v_project.business_unit_code is distinct from v_data->>'business_unit_code')
      then raise exception 'owner_review_project_changed'; end if;
  elsif v_installment_id is not null or v_task_id is not null then raise exception 'owner_review_project_required'; end if;
  if v_installment_id is not null then
    select * into v_installment from public.owner_project_installments where id=v_installment_id for update;
    if v_installment.id is null or v_installment.project_id is distinct from v_project_id
      or v_installment.task_id is distinct from v_task_id or v_installment.status in ('cancelled','paid')
      or (v_installment.amount is not null and v_installment.paid_amount+v_amount>v_installment.amount)
      then raise exception 'owner_review_installment_changed'; end if;
  end if;
  v_ref:=nullif(lower(regexp_replace(coalesce(v_row.reference_number,''),'\s','','g')),'');
  if exists(select 1 from public.financial_owner_expense_intakes i where i.id<>v_row.id
    and i.owner_group_hash=p_group_hash and i.status in ('categorized','needs_review')
    and (i.evidence_sha256=v_row.evidence_sha256 or
      (v_ref is not null and lower(regexp_replace(i.reference_number,'\s','','g'))=v_ref))) then
    return jsonb_build_object('duplicate_transaction',true);
  end if;
  -- This state change and all allocation/audit writes commit or roll back together.
  update public.financial_owner_expense_intakes set review_state='confirmed',amount=v_amount,occurred_on=v_date where id=v_row.id;
  perform public.financial_resolve_owner_expense_intake_v1(v_row.id,v_data->>'purpose',v_data->>'business_unit_code',
    v_data->>'expense_class',v_data->>'expense_category',v_data->>'expense_subcategory',0.95,p_actor_hash,p_message_id);
  update public.financial_owner_expense_intakes set classification_source='owner' where id=v_row.id;
  if v_project_id is not null then
    perform public.owner_project_link_financial_v1('owner_expense',v_row.id,v_project_id,v_task_id,v_installment_id,'line',p_actor_hash,'Owner confirmed slip summary');
  end if;
  if v_installment_id is not null then
    update public.owner_project_installments set paid_amount=paid_amount+v_amount,
      status=case when amount is not null and paid_amount+v_amount>=amount then 'paid' else 'due' end,
      paid_on=v_date,owner_expense_intake_id=v_row.id,updated_at=now() where id=v_installment_id;
    insert into public.owner_project_audit_events(entity_type,entity_id,action,source,actor_hash,before_data,after_data)
    select 'installment',id,'updated','line',p_actor_hash,to_jsonb(v_installment),to_jsonb(i) from public.owner_project_installments i where id=v_installment_id;
  end if;
  return jsonb_build_object('ok',true,'state','confirmed','intake_id',v_row.id);
end $$;

-- Fail closed if an older text/project route accidentally tries to allocate a new draft.
create function public.financial_guard_owner_slip_review_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.review_state='draft' and new.review_state='draft' and (
    new.status in ('categorized','needs_review') or new.amount is distinct from old.amount
    or new.owner_project_id is distinct from old.owner_project_id
    or new.owner_project_task_id is distinct from old.owner_project_task_id
    or new.owner_project_installment_id is distinct from old.owner_project_installment_id
    or new.business_unit_code is distinct from old.business_unit_code
  ) then raise exception 'owner_slip_confirmation_required'; end if;
  return new;
end $$;
create trigger financial_owner_slip_review_guard before update on public.financial_owner_expense_intakes
for each row execute function public.financial_guard_owner_slip_review_v1();

revoke all on function public.financial_capture_owner_slip_review_v1(text,text,text,date,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.financial_stage_owner_slip_review_v1(uuid,text,text,text,integer,jsonb) from public,anon,authenticated;
revoke all on function public.financial_confirm_owner_slip_review_v1(uuid,text,text,integer,text,boolean) from public,anon,authenticated;
revoke all on function public.financial_guard_owner_slip_review_v1() from public,anon,authenticated;
grant execute on function public.financial_capture_owner_slip_review_v1(text,text,text,date,text,text,text,text,jsonb) to service_role;
grant execute on function public.financial_stage_owner_slip_review_v1(uuid,text,text,text,integer,jsonb) to service_role;
grant execute on function public.financial_confirm_owner_slip_review_v1(uuid,text,text,integer,text,boolean) to service_role;

-- Draft evidence remains visible in the inbox, but contributes no dashboard totals.
create or replace view public.financial_owner_expense_summary_v1 with (security_invoker=true) as
select date_trunc('month',occurred_on)::date as month_start,owner_group_hash,
 coalesce(business_unit_code,'other') as business_unit_code,
 coalesce(expense_class,'uncategorized') as expense_class,
 coalesce(expense_category,'other') as expense_category,
 count(*)::integer as item_count,coalesce(sum(amount),0)::numeric(16,2) as total_amount,
 count(*) filter(where status='categorized')::integer as categorized_count,
 count(*) filter(where status in ('awaiting_purpose','awaiting_business','needs_review'))::integer as attention_count
from public.financial_owner_expense_intakes
where status<>'cancelled' and (review_state is null or review_state='confirmed') group by 1,2,3,4,5;

-- Preserve the separate payroll flow for an upload with no business note yet.
-- This changes routing metadata only; it does not create a payroll event or expense.
create function public.financial_handoff_owner_slip_payroll_v1(
 p_intake_id uuid,p_group_hash text,p_actor_hash text,p_revision integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_row public.financial_owner_expense_intakes%rowtype;
begin
 select * into v_row from public.financial_owner_expense_intakes where id=p_intake_id for update;
 if v_row.id is null or v_row.owner_group_hash is distinct from p_group_hash
   or nullif(trim(p_actor_hash),'') is null or v_row.source_user_hash is distinct from p_actor_hash
   then raise exception 'owner_review_identity_mismatch'; end if;
 if v_row.review_state is distinct from 'draft' or v_row.review_revision is distinct from p_revision
   or nullif(trim(v_row.review_data->>'purpose'),'') is not null
   or v_row.review_data->>'project_id' is not null then return jsonb_build_object('conflict',true); end if;
 update public.financial_owner_expense_intakes set review_state=null,
   amount=coalesce((review_data->>'amount')::numeric,(extraction_data->>'amount_total')::numeric),
   updated_at=now() where id=p_intake_id;
 insert into public.financial_owner_expense_audit_events(intake_id,action,source,actor_hash,reason,before_data,after_data)
 values(p_intake_id,'purpose_staged','line',p_actor_hash,'Unclassified evidence handed to existing payroll conversation',
   jsonb_build_object('review_state','draft'),jsonb_build_object('review_state',null));
 return jsonb_build_object('ok',true);
end $$;
revoke all on function public.financial_handoff_owner_slip_payroll_v1(uuid,text,text,integer) from public,anon,authenticated;
grant execute on function public.financial_handoff_owner_slip_payroll_v1(uuid,text,text,integer) to service_role;
