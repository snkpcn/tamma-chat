-- Production precursor migration retained for migration-history parity.
-- The canonical CP6 engine is finalized by later CP6 migrations.

CREATE OR REPLACE FUNCTION public.financial_add_cafe_test_adjustment_v1(p_daily_close_id uuid, p_field_name text, p_new_value numeric, p_reason text, p_actor_hash text, p_source text DEFAULT 'backoffice'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  c record;
  current_value numeric;
  base_value numeric;
  prior_delta numeric;
  delta numeric;
  adjustment_id uuid;
begin
  if p_new_value<0 then raise exception 'adjustment_value_must_be_nonnegative'; end if;
  if coalesce(trim(p_reason),'')='' then raise exception 'adjustment_reason_required'; end if;

  select dc.* into c
  from public.financial_daily_closes dc
  join public.operations_business_branches b on b.id=dc.branch_id
  where dc.id=p_daily_close_id
    and b.code='inthanin_tadtone'
  limit 1;

  if c.id is null then raise exception 'inthanin_daily_close_not_found'; end if;
  if c.environment<>'test' then raise exception 'adjustment_test_only'; end if;
  if c.status<>'confirmed' then raise exception 'adjustment_requires_confirmed_close'; end if;

  base_value:=case p_field_name
    when 'gross_sales' then c.gross_sales
    when 'discounts' then c.discounts
    when 'refunds' then c.refunds
    when 'payment_cash' then c.payment_cash
    when 'payment_qr' then c.payment_qr
    when 'payment_card' then c.payment_card
    when 'payment_delivery' then c.payment_delivery
    when 'payment_other' then c.payment_other
    when 'waste_reported_value' then c.waste_reported_value
    when 'staff_count' then coalesce(c.staff_count,0)
    when 'cup_count' then coalesce(c.cup_count,0)
    when 'bill_count' then coalesce(c.bill_count,0)
    when 'cash_opening_float' then coalesce(c.cash_opening_float,0)
    when 'cash_counted_closing' then coalesce(c.cash_counted_closing,0)
    when 'economic_expense_amount' then (
      select coalesce(r.economic_expense_amount,0)
      from public.financial_daily_expense_rollup r
      where r.daily_close_id=c.id
    )
    when 'ledger_cash_outflow_amount' then (
      select coalesce(r.cash_outflow_amount,0)
      from public.financial_daily_expense_rollup r
      where r.daily_close_id=c.id
    )
    else null
  end;

  if base_value is null then raise exception 'adjustment_field_not_allowed'; end if;

  select coalesce(sum(a.amount_delta),0)
  into prior_delta
  from public.financial_daily_close_adjustments a
  where a.daily_close_id=c.id
    and a.field_name=p_field_name;

  current_value:=base_value+prior_delta;
  delta:=p_new_value-current_value;

  if abs(delta)<0.0001 then
    return jsonb_build_object(
      'ok',true,'changed',false,'field_name',p_field_name,
      'old_value',current_value,'new_value',p_new_value,'amount_delta',0
    );
  end if;

  insert into public.financial_daily_close_adjustments(
    daily_close_id,adjustment_type,field_name,amount_delta,
    old_value,new_value,reason,created_by_hash,source_channel
  )
  values(
    c.id,'correction',p_field_name,delta,
    to_jsonb(current_value),to_jsonb(p_new_value),
    trim(p_reason),nullif(trim(coalesce(p_actor_hash,'')),''),
    case when p_source in ('line','backoffice','import','system') then p_source else 'backoffice' end
  )
  returning id into adjustment_id;

  return jsonb_build_object(
    'ok',true,'changed',true,'adjustment_id',adjustment_id,
    'field_name',p_field_name,'old_value',current_value,
    'new_value',p_new_value,'amount_delta',delta
  );
end;
$function$


revoke all on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) from public;
revoke all on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) from anon;
revoke all on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) from authenticated;
grant execute on function public.financial_add_cafe_test_adjustment_v1(uuid,text,numeric,text,text,text) to service_role;
