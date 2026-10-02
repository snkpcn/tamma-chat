-- CP8 follow-up: keep unresolved payroll slips singular and prevent over-deducting salary advances.
do $$
declare ddl text;
begin
  select pg_get_functiondef(
    'public.financial_create_owner_payroll_event_v1(text,text,numeric,date,text,text,text,text)'::regprocedure
  ) into ddl;
  ddl:=replace(
    ddl,
    'and status=''awaiting_slip''',
    'and status in (''awaiting_slip'',''needs_review'')'
  );
  execute ddl;
end;
$$;

create or replace function public.financial_guard_employee_payroll_event_v1()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_outstanding numeric(16,2);
begin
  if new.event_type='advance_deduction' and new.status='recorded' then
    select greatest(
      0,
      coalesce(sum(case when event_type='salary_advance' and status='paid' then amount else 0 end),0)
      - coalesce(sum(case when event_type='advance_deduction' and status='recorded' then amount else 0 end),0)
    )
    into v_outstanding
    from public.financial_employee_payroll_events
    where employee_key=new.employee_key
      and (tg_op='INSERT' or id<>new.id);

    if new.amount>coalesce(v_outstanding,0)+0.009 then
      raise exception 'advance_deduction_exceeds_outstanding';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists financial_employee_payroll_guard
on public.financial_employee_payroll_events;
create trigger financial_employee_payroll_guard
before insert or update on public.financial_employee_payroll_events
for each row execute function public.financial_guard_employee_payroll_event_v1();

revoke all on function public.financial_guard_employee_payroll_event_v1()
from public,anon,authenticated;
