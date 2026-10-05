-- Owner Expense backoffice cancellation
--
-- A wrong expense is removed from every active total without deleting the
-- original evidence or its history. Only the server-side service role can
-- call this RPC.

create or replace function public.financial_cancel_owner_expense_intake_v1(
  p_intake_id uuid,
  p_reason text,
  p_actor_hash text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_reason text;
  v_before jsonb;
begin
  v_reason:=left(trim(coalesce(p_reason,'')),500);
  if length(v_reason)<3 then
    raise exception 'cancellation_reason_required';
  end if;

  select * into v_row
  from public.financial_owner_expense_intakes
  where id=p_intake_id
  for update;

  if v_row.id is null then
    raise exception 'owner_expense_not_found';
  end if;

  if v_row.status='cancelled' then
    return jsonb_build_object(
      'ok',true,
      'duplicate',true,
      'intake_id',v_row.id,
      'status',v_row.status
    );
  end if;

  v_before:=jsonb_build_object(
    'status',v_row.status,
    'occurred_on',v_row.occurred_on,
    'amount',v_row.amount,
    'purpose_raw',v_row.purpose_raw,
    'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,
    'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory
  );

  update public.financial_owner_expense_intakes
  set status='cancelled',updated_at=now()
  where id=v_row.id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,reason,before_data,after_data
  ) values (
    v_row.id,
    'cancelled',
    'backoffice',
    nullif(trim(coalesce(p_actor_hash,'')),''),
    v_reason,
    v_before,
    jsonb_build_object(
      'status','cancelled',
      'excluded_from_active_totals',true,
      'evidence_retained',true
    )
  );

  return jsonb_build_object(
    'ok',true,
    'duplicate',false,
    'intake_id',v_row.id,
    'status','cancelled',
    'evidence_retained',true
  );
end;
$$;

revoke all on function public.financial_cancel_owner_expense_intake_v1(uuid,text,text)
from public,anon,authenticated;
grant execute on function public.financial_cancel_owner_expense_intake_v1(uuid,text,text)
to service_role;
