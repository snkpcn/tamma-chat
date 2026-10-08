-- Allow a later paid expense to attach to a completed project. Completion
-- stops open work; it does not make subsequent payment evidence disappear.
create or replace function public.owner_project_record_line_investment_v1(
  p_occurred_on date, p_business_unit_code text, p_title text, p_category text,
  p_amount numeric, p_payment_method text, p_vendor_name text, p_notes text,
  p_owner_group_hash text, p_source_message_id text, p_actor_hash text,
  p_project_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_result jsonb;
  v_entry public.financial_investment_entries%rowtype;
begin
  if nullif(trim(coalesce(p_owner_group_hash,'')),'') is null
    or nullif(trim(coalesce(p_source_message_id,'')),'') is null then
    raise exception 'owner_line_group_and_message_required';
  end if;
  if p_project_id is not null and not exists (
    select 1 from public.owner_projects
    where id=p_project_id and owner_group_hash=trim(p_owner_group_hash)
      and status<>'cancelled'
      and (business_unit_code is null or business_unit_code=p_business_unit_code)
  ) then raise exception 'owner_project_group_or_business_mismatch'; end if;

  begin
    v_result:=public.financial_record_investment_v1(
      p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,
      p_vendor_name,p_notes,'line',p_owner_group_hash,p_source_message_id,p_actor_hash
    );
  exception when unique_violation then
    select * into v_entry from public.financial_investment_entries
    where source_channel='line' and source_message_id=trim(p_source_message_id);
    if v_entry.id is null then raise; end if;
    v_result:=jsonb_build_object('ok',true,'duplicate',true,'id',v_entry.id);
  end;

  select * into v_entry from public.financial_investment_entries
  where id=(v_result->>'id')::uuid for update;
  if v_entry.owner_group_hash is distinct from trim(p_owner_group_hash)
    or v_entry.business_unit_code is distinct from p_business_unit_code
    or v_entry.amount is distinct from p_amount
    or v_entry.title is distinct from left(trim(p_title),240)
    or v_entry.status='cancelled' then raise exception 'owner_line_message_conflict'; end if;
  if v_entry.owner_project_id is not null and v_entry.owner_project_id is distinct from p_project_id then
    raise exception 'owner_line_project_conflict';
  end if;
  if p_project_id is not null and v_entry.owner_project_id is null then
    perform public.owner_project_link_financial_v1(
      'investment_entry',v_entry.id,p_project_id,null,null,'line',p_actor_hash,
      'ผูกจากรายการจ่ายที่เจ้าของพิมพ์ในกลุ่ม LINE'
    );
  end if;
  return v_result || jsonb_build_object('project_id',p_project_id);
end;
$function$;

revoke all on function public.owner_project_record_line_investment_v1(
  date,text,text,text,numeric,text,text,text,text,text,text,uuid
) from public,anon,authenticated;
grant execute on function public.owner_project_record_line_investment_v1(
  date,text,text,text,numeric,text,text,text,text,text,text,uuid
) to service_role;

-- A one-word follow-up corrects the payment method of the same LINE record.
-- The ledger amount and original evidence are never reinserted or erased.
create or replace function public.owner_project_set_line_payment_method_v1(
  p_entry_id uuid, p_group_hash text, p_actor_hash text,
  p_method text, p_message_id text
) returns jsonb language plpgsql security definer set search_path = '' as $function$
declare
  v_entry public.financial_investment_entries%rowtype;
  v_before jsonb;
begin
  if p_method not in ('cash','transfer','card') then raise exception 'invalid_payment_method'; end if;
  if nullif(trim(coalesce(p_group_hash,'')),'') is null
    or nullif(trim(coalesce(p_actor_hash,'')),'') is null
    or nullif(trim(coalesce(p_message_id,'')),'') is null then
    raise exception 'owner_line_identity_required'; end if;
  select * into v_entry from public.financial_investment_entries
  where id=p_entry_id for update;
  if v_entry.id is null or v_entry.source_channel<>'line' or v_entry.status<>'recorded'
    or v_entry.owner_group_hash is distinct from trim(p_group_hash)
    or v_entry.source_user_hash is distinct from trim(p_actor_hash) then
    raise exception 'owner_line_entry_mismatch'; end if;
  if v_entry.payment_method=p_method then
    return jsonb_build_object('ok',true,'duplicate',true,'id',v_entry.id,'payment_method',p_method);
  end if;
  if v_entry.payment_method<>'other' then raise exception 'owner_line_payment_already_set'; end if;
  v_before:=to_jsonb(v_entry);
  update public.financial_investment_entries set payment_method=p_method,updated_at=now()
  where id=v_entry.id returning * into v_entry;
  insert into public.financial_investment_entry_audit_events(
    entry_id,action,source,actor_hash,message_id,before_data,after_data
  ) values (v_entry.id,'recorded','line',trim(p_actor_hash),trim(p_message_id),v_before,to_jsonb(v_entry));
  return jsonb_build_object('ok',true,'duplicate',false,'id',v_entry.id,'payment_method',p_method);
end;
$function$;

revoke all on function public.owner_project_set_line_payment_method_v1(uuid,text,text,text,text)
from public,anon,authenticated;
grant execute on function public.owner_project_set_line_payment_method_v1(uuid,text,text,text,text)
to service_role;
