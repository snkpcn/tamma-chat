-- LOCAL PROPOSAL: requires independent review and real PostgreSQL concurrency tests.
-- No data backfill. Replaces only existing trigger functions; retains ACL/security modes.
-- New semantics limited to live inthanin_tadtone parent rows.
CREATE OR REPLACE FUNCTION public.financial_guard_daily_close()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  expected_branches integer;
begin
  if tg_op = 'DELETE' then
    if old.status = 'confirmed' then
      raise exception 'confirmed daily close is immutable; use an adjustment';
    end if;
    return old;
  end if;

  if old.status = 'confirmed' then
    raise exception 'confirmed daily close is immutable; use an adjustment';
  end if;

  if new.status = 'confirmed' and new.confirmed_at is null then
    new.confirmed_at = now();
  end if;

  -- RLS must not hide branch scope and make a financial parent edit skip its
  -- revision. Check both identities before applying the scoped semantics.
  if old.environment='live' or new.environment='live' then
    select count(distinct x) into expected_branches from unnest(array[old.branch_id,new.branch_id]) x where x is not null;
    if (select count(*) from public.operations_business_branches where id=any(array[old.branch_id,new.branch_id]))<>expected_branches then
      raise exception 'daily_close_branch_unavailable';
    end if;
  end if;
  -- Generated columns are not available in BEFORE UPDATE NEW; compare their
  -- source fields instead, so no-op writes cannot create spurious revisions.
  -- Scope new revision semantics to this live branch only.
  if new.environment='live' and exists (
    select 1 from public.operations_business_branches b
    where b.id=new.branch_id and b.code='inthanin_tadtone'
  ) then
    if (to_jsonb(new)-array['updated_at','revision','net_sales','payments_total','sales_payment_variance']) is distinct from
       (to_jsonb(old)-array['updated_at','revision','net_sales','payments_total','sales_payment_variance']) then
      new.revision := greatest(old.revision+1,coalesce(new.revision,old.revision));
    elsif new.revision is null or new.revision < old.revision then
      new.revision := old.revision;
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.financial_guard_close_child_mutation()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  close_status text;
  close_id uuid;
  affected_id uuid;
  affected_ids uuid[];
  direct_ids uuid[];
  claim_ids uuid[];
  claim_row record;
  expected_claims integer;
  locked_claims integer := 0;
  expected_parents integer;
  locked_parents integer := 0;
begin
  -- Moving a child must never remove it from an immutable old direct parent.
  if tg_op='UPDATE' and exists (
    select 1 from public.financial_daily_closes where id=old.daily_close_id and status='confirmed'
  ) then
    raise exception 'confirmed daily close children are immutable; use an adjustment';
  end if;
  close_id := case when tg_op = 'DELETE' then old.daily_close_id else new.daily_close_id end;

  select status into close_status
  from public.financial_daily_closes
  where id = close_id;

  if close_status = 'confirmed' then
    raise exception 'confirmed daily close children are immutable; use an adjustment';
  end if;

  if tg_op='UPDATE' then
    affected_ids:=array[old.daily_close_id,new.daily_close_id];
  elsif tg_op='DELETE' then affected_ids:=array[old.daily_close_id];
  else affected_ids:=array[new.daily_close_id]; end if;

  direct_ids:=affected_ids;
  -- Settlement/evidence can reference a claim from an earlier close. Lock claim
  -- identities before resolving origins, so concurrent reparenting cannot escape.
  if tg_op='UPDATE' then
    claim_ids:=array[(to_jsonb(old)->>'expense_claim_id')::uuid,(to_jsonb(new)->>'expense_claim_id')::uuid];
  elsif tg_op='DELETE' then claim_ids:=array[(to_jsonb(old)->>'expense_claim_id')::uuid];
  else claim_ids:=array[(to_jsonb(new)->>'expense_claim_id')::uuid]; end if;
  select count(distinct x) into expected_claims from unnest(claim_ids) x where x is not null;
  if expected_claims>0 then
  for claim_row in select c.id,c.origin_daily_close_id from public.financial_expense_claims c
    where c.id=any(claim_ids) order by c.id for share of c
  loop
    locked_claims:=locked_claims+1;
    affected_ids:=array_append(affected_ids,claim_row.origin_daily_close_id);
  end loop;
  if locked_claims<>expected_claims then raise exception 'linked_expense_claim_lock_unavailable'; end if;
  end if;

  -- Invoker triggers must fail closed when RLS hides a dependency or prevents
  -- a required lock. A successful child write must never silently skip revision.
  select count(distinct x) into expected_parents from unnest(affected_ids) x where x is not null;
  if (select count(*) from public.financial_daily_closes d join public.operations_business_branches b on b.id=d.branch_id where d.id=any(affected_ids))<>expected_parents then
    raise exception 'daily_close_parent_unavailable';
  end if;
  select count(*) into expected_parents from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone';
  -- Lock old/new direct parents and linked claim origins in stable order.
  for affected_id in
    select d.id from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone'
    order by d.id for update of d
  loop
    locked_parents:=locked_parents+1;
    select status into close_status from public.financial_daily_closes where id=affected_id;
    if close_status='confirmed' and affected_id=any(direct_ids) then
      raise exception 'confirmed daily close children are immutable; use an adjustment';
    end if;
    if close_status<>'confirmed' and (tg_op<>'UPDATE' or (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at')) then
      update public.financial_daily_closes set revision=revision+1 where id=affected_id;
    end if;
  end loop;

  if locked_parents<>expected_parents then raise exception 'daily_close_parent_lock_unavailable'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

CREATE OR REPLACE FUNCTION public.financial_guard_expense_claim()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  close_status text;
  settled_count integer := 0;
  affected_id uuid;
  affected_ids uuid[];
  expected_parents integer;
  locked_parents integer := 0;
begin
  if tg_op='UPDATE' then affected_ids:=array[old.origin_daily_close_id,new.origin_daily_close_id];
  elsif tg_op='DELETE' then affected_ids:=array[old.origin_daily_close_id];
  else affected_ids:=array[new.origin_daily_close_id]; end if;
  -- Invoker triggers must fail closed when RLS hides a dependency or prevents
  -- a required lock. A successful child write must never silently skip revision.
  select count(distinct x) into expected_parents from unnest(affected_ids) x where x is not null;
  if (select count(*) from public.financial_daily_closes d join public.operations_business_branches b on b.id=d.branch_id where d.id=any(affected_ids))<>expected_parents then
    raise exception 'daily_close_parent_unavailable';
  end if;
  select count(*) into expected_parents from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone';
  for affected_id in
    select d.id from public.financial_daily_closes d
    join public.operations_business_branches b on b.id=d.branch_id
    where d.id=any(affected_ids) and d.environment='live' and b.code='inthanin_tadtone'
    order by d.id for update of d
  loop
    locked_parents:=locked_parents+1;
    select status into close_status from public.financial_daily_closes where id=affected_id;
    if close_status='confirmed' then
      raise exception 'expense claim belongs to a confirmed close and is immutable';
    end if;
  end loop;
  if locked_parents<>expected_parents then raise exception 'daily_close_parent_lock_unavailable'; end if;
  if tg_op = 'DELETE' then
    select status into close_status
    from public.financial_daily_closes
    where id = old.origin_daily_close_id;

    if close_status = 'confirmed' then
      raise exception 'expense claim belongs to a confirmed close and is immutable';
    end if;
    update public.financial_daily_closes d set revision=d.revision+1
    from public.operations_business_branches b
    where b.id=d.branch_id and b.code='inthanin_tadtone' and d.environment='live'
      and d.id=any(affected_ids);
    return old;
  end if;

  select status into close_status
  from public.financial_daily_closes
  where id = new.origin_daily_close_id;

  if tg_op = 'INSERT' then
    if close_status = 'confirmed' then
      raise exception 'cannot add expense claim directly to a confirmed close; use adjustment workflow';
    end if;
    update public.financial_daily_closes d set revision=d.revision+1
    from public.operations_business_branches b
    where b.id=d.branch_id and b.code='inthanin_tadtone' and d.environment='live'
      and d.id=any(affected_ids);
    return new;
  end if;

  if close_status = 'confirmed' then
    raise exception 'expense claim belongs to a confirmed close and is immutable';
  end if;

  if new.approval_status = 'cancelled' and old.approval_status <> 'cancelled' then
    -- A filtered ledger count cannot establish that a claim has no settlement.
    -- Keep invoker privileges: restricted direct writers must fail closed rather
    -- than cancel against an incomplete RLS view. Service/definer application
    -- writers retain their existing complete-ledger visibility and behavior.
    if expected_parents>0 and pg_catalog.row_security_active('public.financial_daily_ledger_entries'::regclass) then
      raise exception 'complete_settlement_visibility_required';
    end if;
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

  if (to_jsonb(new)-'updated_at') is distinct from (to_jsonb(old)-'updated_at') then
    update public.financial_daily_closes d set revision=d.revision+1
    from public.operations_business_branches b
    where b.id=d.branch_id and b.code='inthanin_tadtone' and d.environment='live'
      and d.id=any(affected_ids);
  end if;
  return new;
end;
$function$;
