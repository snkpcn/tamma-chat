-- Owner LINE can correct a reviewed expense on the same financial row.
-- The LINE message id makes retries idempotent; evidence and project links are not modified.

create or replace function public.financial_reclassify_owner_expense_from_line_v1(
  p_intake_id uuid,
  p_business_unit_code text,
  p_expense_class text,
  p_expense_category text,
  p_expense_subcategory text,
  p_user_hash text,
  p_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.financial_owner_expense_intakes%rowtype;
  v_before jsonb;
  v_status text;
  v_subcategory text;
begin
  if coalesce(trim(p_message_id),'')='' then raise exception 'message_id_required'; end if;
  if coalesce(trim(p_business_unit_code),'') not in (
    'inthanin','tamma_restaurant','huenstay','adventure','otop',
    'shared_infrastructure','shared','other'
  ) then raise exception 'invalid_business_unit'; end if;
  if p_expense_class not in ('capital_investment','operating_expense','owner_private','uncategorized') then
    raise exception 'invalid_expense_class';
  end if;
  if p_expense_category not in (
    'construction','land_infrastructure','kitchen_equipment','equipment',
    'furniture_fixtures','activity_assets','technology','licenses',
    'inventory','ingredients','beverages','packaging','consumables','cleaning',
    'maintenance','utilities','transport','staff','marketing','fees',
    'professional_services','tax','financing','petty_cash','other'
  ) then raise exception 'invalid_expense_category'; end if;

  select * into v_row
  from public.financial_owner_expense_intakes
  where id=p_intake_id
  for update;
  if v_row.id is null then raise exception 'owner_expense_not_found'; end if;

  if exists(
    select 1 from public.financial_owner_expense_audit_events
    where intake_id=p_intake_id and message_id=trim(p_message_id)
  ) then
    return jsonb_build_object(
      'ok',true,'duplicate',true,'intake_id',v_row.id,'status',v_row.status,'amount',v_row.amount,
      'business_unit_code',v_row.business_unit_code,'expense_class',v_row.expense_class,
      'expense_category',v_row.expense_category,'expense_subcategory',v_row.expense_subcategory
    );
  end if;
  if v_row.status='cancelled' then raise exception 'cancelled_owner_expense_immutable'; end if;
  if v_row.status<>'needs_review' then raise exception 'owner_expense_not_reviewable'; end if;

  v_status:=case
    when p_business_unit_code='other' or p_expense_category='other' then 'needs_review'
    else 'categorized'
  end;
  v_subcategory:=nullif(left(trim(coalesce(p_expense_subcategory,'')),120),'');

  v_before:=jsonb_build_object(
    'status',v_row.status,'business_unit_code',v_row.business_unit_code,
    'expense_class',v_row.expense_class,'expense_category',v_row.expense_category,
    'expense_subcategory',v_row.expense_subcategory,
    'classification_confidence',v_row.classification_confidence
  );

  update public.financial_owner_expense_intakes
  set status=v_status,
      business_unit_code=p_business_unit_code,
      expense_class=p_expense_class,
      expense_category=p_expense_category,
      expense_subcategory=coalesce(v_subcategory,expense_subcategory),
      classification_confidence=1,
      classification_source='owner',
      categorized_at=now(),
      updated_at=now()
  where id=p_intake_id;

  insert into public.financial_owner_expense_audit_events(
    intake_id,action,source,actor_hash,message_id,reason,before_data,after_data
  ) values (
    p_intake_id,'reclassified','line',nullif(trim(coalesce(p_user_hash,'')),''),trim(p_message_id),
    'เจ้าของยืนยันหมวด/กิจการผ่านข้อความใน LINE Owner',
    v_before,
    jsonb_build_object(
      'status',v_status,'business_unit_code',p_business_unit_code,
      'expense_class',p_expense_class,'expense_category',p_expense_category,
      'expense_subcategory',coalesce(v_subcategory,v_row.expense_subcategory),
      'classification_confidence',1
    )
  );

  return jsonb_build_object(
    'ok',true,'duplicate',false,'intake_id',p_intake_id,'status',v_status,'amount',v_row.amount,
    'business_unit_code',p_business_unit_code,'expense_class',p_expense_class,
    'expense_category',p_expense_category,
    'expense_subcategory',coalesce(v_subcategory,v_row.expense_subcategory)
  );
end;
$$;

revoke all on function public.financial_reclassify_owner_expense_from_line_v1(uuid,text,text,text,text,text,text)
  from public,anon,authenticated;
grant execute on function public.financial_reclassify_owner_expense_from_line_v1(uuid,text,text,text,text,text,text)
  to service_role;
