-- CP8 follow-up: make automatic LIVE drawer-to-bag sweep correction-safe.
create or replace function public.financial_record_cash_sweep_live_v1(
  p_daily_close_id uuid,
  p_amount numeric,
  p_actor_hash text,
  p_source text default 'line'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_branch_id uuid;
  v_date date;
  v_env text;
  v_status text;
  v_movement_id uuid;
  v_ledger_id uuid;
  v_balance numeric(16,2);
  v_amount numeric(14,2):=greatest(coalesce(p_amount,0),0);
begin
  if p_source not in ('line','backoffice','import','system') then
    raise exception 'invalid_cash_custody_source';
  end if;

  select branch_id,local_date,environment,status
  into v_branch_id,v_date,v_env,v_status
  from public.financial_daily_closes
  where id=p_daily_close_id
  for update;

  if v_branch_id is null then raise exception 'daily_close_not_found'; end if;
  if v_env<>'live' then raise exception 'cash_custody_live_only'; end if;
  if v_status='confirmed' then raise exception 'confirmed_daily_close_is_immutable'; end if;

  select id into v_movement_id
  from public.financial_cash_custody_movements
  where branch_id=v_branch_id
    and environment='live'
    and source_channel=p_source
    and source_message_id='cash-sweep:'||p_daily_close_id::text
    and movement_type='drawer_to_bag'
  limit 1;

  select id into v_ledger_id
  from public.financial_daily_ledger_entries
  where daily_close_id=p_daily_close_id
    and source_channel=p_source
    and source_message_id='cash-sweep:'||p_daily_close_id::text
    and source_item_key='drawer_to_bag'
  limit 1;

  if v_amount<=0 then
    if v_ledger_id is not null then
      delete from public.financial_daily_ledger_entries where id=v_ledger_id;
      v_ledger_id:=null;
    end if;
    if v_movement_id is not null then
      delete from public.financial_cash_custody_movements where id=v_movement_id;
      v_movement_id:=null;
    end if;
  elsif v_movement_id is null then
    insert into public.financial_cash_custody_movements(
      branch_id,daily_close_id,local_date,environment,movement_type,direction,
      amount,source_channel,source_message_id,note,created_by_hash
    )
    values(
      v_branch_id,p_daily_close_id,v_date,'live','drawer_to_bag','bag_in',
      v_amount,p_source,'cash-sweep:'||p_daily_close_id::text,
      'Daily drawer excess moved to weekly owner-pickup bag',
      nullif(trim(coalesce(p_actor_hash,'')),'')
    )
    returning id into v_movement_id;

    insert into public.financial_daily_ledger_entries(
      daily_close_id,entry_type,accounting_role,amount,direction,payment_method,
      description,source_channel,source_message_id,source_item_key,metadata
    )
    values(
      p_daily_close_id,'other','memo',v_amount,'outflow','cash',
      'Cash sweep from drawer to weekly owner-pickup bag',
      p_source,'cash-sweep:'||p_daily_close_id::text,'drawer_to_bag',
      jsonb_build_object(
        'movement_type','drawer_to_bag',
        'custody_account','weekly_cash_bag',
        'is_expense',false,
        'custody_movement_id',v_movement_id,
        'auto_from_daily_close',true
      )
    )
    returning id into v_ledger_id;
  else
    update public.financial_cash_custody_movements
    set amount=v_amount,
        created_by_hash=coalesce(nullif(trim(coalesce(p_actor_hash,'')),''),created_by_hash),
        note='Daily drawer excess moved to weekly owner-pickup bag'
    where id=v_movement_id;

    if v_ledger_id is null then
      insert into public.financial_daily_ledger_entries(
        daily_close_id,entry_type,accounting_role,amount,direction,payment_method,
        description,source_channel,source_message_id,source_item_key,metadata
      )
      values(
        p_daily_close_id,'other','memo',v_amount,'outflow','cash',
        'Cash sweep from drawer to weekly owner-pickup bag',
        p_source,'cash-sweep:'||p_daily_close_id::text,'drawer_to_bag',
        jsonb_build_object(
          'movement_type','drawer_to_bag',
          'custody_account','weekly_cash_bag',
          'is_expense',false,
          'custody_movement_id',v_movement_id,
          'auto_from_daily_close',true
        )
      )
      returning id into v_ledger_id;
    else
      update public.financial_daily_ledger_entries
      set amount=v_amount,
          metadata=coalesce(metadata,'{}'::jsonb)
            || jsonb_build_object('auto_from_daily_close',true,'custody_movement_id',v_movement_id),
          updated_at=now()
      where id=v_ledger_id;
    end if;
  end if;

  select coalesce(sum(case when direction='bag_in' then amount else -amount end),0)
  into v_balance
  from public.financial_cash_custody_movements
  where branch_id=v_branch_id and environment='live';

  return jsonb_build_object(
    'ok',true,'movement_id',v_movement_id,'ledger_entry_id',v_ledger_id,
    'amount',v_amount,'bag_balance',v_balance,
    'reconciliation',public.financial_reconcile_daily_close_v1(p_daily_close_id)
  );
end;
$$;

revoke all on function public.financial_record_cash_sweep_live_v1(uuid,numeric,text,text)
from public,anon,authenticated;
grant execute on function public.financial_record_cash_sweep_live_v1(uuid,numeric,text,text)
to service_role;
