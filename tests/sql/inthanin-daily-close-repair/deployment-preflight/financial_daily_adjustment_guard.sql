CREATE OR REPLACE FUNCTION public.financial_guard_adjustment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  close_status text;
begin
  if tg_op in ('UPDATE','DELETE') then
    raise exception 'financial adjustments are append-only';
  end if;

  select status into close_status
  from public.financial_daily_closes
  where id = new.daily_close_id;

  if close_status is distinct from 'confirmed' then
    raise exception 'adjustments are allowed only after a daily close is confirmed';
  end if;

  return new;
end;
$function$
