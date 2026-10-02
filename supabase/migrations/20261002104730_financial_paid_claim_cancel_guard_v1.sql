create or replace function public.financial_guard_expense_claim()
returns trigger
language plpgsql
as $$
declare
  close_status text;
  settled_count integer := 0;
begin
  if tg_op = 'DELETE' then
    select status into close_status
    from public.financial_daily_closes
    where id = old.origin_daily_close_id;

    if close_status = 'confirmed' then
      raise exception 'expense claim belongs to a confirmed close and is immutable';
    end if;
    return old;
  end if;

  select status into close_status
  from public.financial_daily_closes
  where id = new.origin_daily_close_id;

  if tg_op = 'INSERT' then
    if close_status = 'confirmed' then
      raise exception 'cannot add expense claim directly to a confirmed close; use adjustment workflow';
    end if;
    return new;
  end if;

  if close_status = 'confirmed' then
    raise exception 'expense claim belongs to a confirmed close and is immutable';
  end if;

  if new.approval_status = 'cancelled' and old.approval_status <> 'cancelled' then
    select count(*) into settled_count
    from public.financial_daily_ledger_entries le
    where le.expense_claim_id=old.id
      and le.accounting_role='cash_settlement'
      and le.direction='outflow'
      and coalesce((le.metadata->>'superseded')::boolean,false)=false;

    if settled_count > 0 then
      new.approval_status := 'needs_review';
      new.metadata := coalesce(new.metadata,'{}'::jsonb)
        || jsonb_build_object(
          'cancel_blocked_due_cash_settlement',true,
          'cancel_blocked_at',now()
        );
    end if;
  end if;

  if new.approval_status = 'approved' then
    if new.approved_amount is null then
      new.approved_amount = new.claimed_amount;
    end if;
    if new.approved_at is null then
      new.approved_at = now();
    end if;
  end if;

  return new;
end;
$$;
