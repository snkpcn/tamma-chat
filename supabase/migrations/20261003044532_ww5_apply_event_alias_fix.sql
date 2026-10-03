-- WW-5 follow-up: qualify payment-intent columns in the provider-event
-- application RPC so PL/pgSQL output-column variables cannot shadow table fields.

create or replace function public.apply_commerce_payment_event_v1(
  p_event_id bigint,
  p_intent_id uuid,
  p_new_status text,
  p_provider_intent_id text default null
)
returns table(
  intent_id uuid,
  status text,
  captured_amount_minor bigint,
  refunded_amount_minor bigint
)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_event public.commerce_payment_events%rowtype;
  v_intent public.commerce_payment_intents%rowtype;
  v_refunded bigint;
begin
  select * into v_event
  from public.commerce_payment_events e
  where e.id=p_event_id
  for update;
  if not found then raise exception 'payment_event_not_found'; end if;

  select * into v_intent
  from public.commerce_payment_intents i
  where i.id=p_intent_id
  for update;
  if not found then raise exception 'payment_intent_not_found'; end if;

  if v_event.processing_status='processed' then
    if v_event.intent_id=p_intent_id and v_event.applied_status=p_new_status then
      return query select
        v_intent.id,v_intent.status,
        v_intent.captured_amount_minor,v_intent.refunded_amount_minor;
      return;
    end if;
    raise exception 'payment_event_already_processed';
  end if;

  if not v_event.signature_verified or v_event.processing_status='rejected' then
    raise exception 'provider_event_signature_not_verified';
  end if;
  if v_event.provider_code<>v_intent.provider_code then
    raise exception 'provider_event_provider_mismatch';
  end if;
  if v_event.provider_object_id is not null
     and v_intent.provider_intent_id is not null
     and v_event.provider_object_id<>v_intent.provider_intent_id then
    raise exception 'provider_intent_id_mismatch';
  end if;
  if p_provider_intent_id is not null
     and v_intent.provider_intent_id is not null
     and p_provider_intent_id<>v_intent.provider_intent_id then
    raise exception 'provider_intent_id_mismatch';
  end if;

  if v_event.money_semantics='intent_total' then
    if v_event.currency_code<>v_intent.currency_code then
      raise exception 'provider_event_currency_mismatch';
    end if;
    if v_event.amount_minor<>v_intent.amount_minor then
      raise exception 'provider_event_amount_mismatch';
    end if;
  elsif v_event.money_semantics='refund_delta' then
    if p_new_status not in ('partially_refunded','refunded') then
      raise exception 'refund_event_status_invalid';
    end if;
    if v_event.currency_code<>v_intent.currency_code then
      raise exception 'provider_event_currency_mismatch';
    end if;
    if v_intent.captured_amount_minor<=0 then
      raise exception 'refund_before_capture';
    end if;
    v_refunded:=v_intent.refunded_amount_minor+v_event.amount_minor;
    if v_refunded>v_intent.captured_amount_minor then
      raise exception 'refund_exceeds_capture';
    end if;
    if p_new_status='partially_refunded'
       and v_refunded>=v_intent.captured_amount_minor then
      raise exception 'partial_refund_must_be_less_than_capture';
    end if;
    if p_new_status='refunded'
       and v_refunded<>v_intent.captured_amount_minor then
      raise exception 'full_refund_must_equal_capture';
    end if;
  else
    if p_new_status in ('authorized','captured','partially_refunded','refunded') then
      raise exception 'payment_money_evidence_required';
    end if;
  end if;

  update public.commerce_payment_intents as target
  set
    provider_intent_id=coalesce(
      target.provider_intent_id,p_provider_intent_id,v_event.provider_object_id
    ),
    status=p_new_status,
    captured_amount_minor=case
      when p_new_status='captured' then target.amount_minor
      else target.captured_amount_minor
    end,
    refunded_amount_minor=case
      when p_new_status in ('partially_refunded','refunded') then v_refunded
      else target.refunded_amount_minor
    end,
    authorized_at=case
      when p_new_status='authorized' then coalesce(target.authorized_at,now())
      else target.authorized_at
    end,
    captured_at=case
      when p_new_status='captured' then coalesce(target.captured_at,now())
      else target.captured_at
    end,
    failed_at=case
      when p_new_status='failed' then coalesce(target.failed_at,now())
      else target.failed_at
    end,
    cancelled_at=case
      when p_new_status='cancelled' then coalesce(target.cancelled_at,now())
      else target.cancelled_at
    end,
    refunded_at=case
      when p_new_status='refunded' then coalesce(target.refunded_at,now())
      else target.refunded_at
    end
  where target.id=v_intent.id
  returning target.* into v_intent;

  update public.commerce_payment_events as target_event
  set processing_status='processed',
      intent_id=v_intent.id,
      applied_status=p_new_status,
      processed_at=now()
  where target_event.id=v_event.id;

  return query select
    v_intent.id,v_intent.status,
    v_intent.captured_amount_minor,v_intent.refunded_amount_minor;
end;
$$;

revoke all on function public.apply_commerce_payment_event_v1(
  bigint,uuid,text,text
) from public,anon,authenticated;
grant execute on function public.apply_commerce_payment_event_v1(
  bigint,uuid,text,text
) to service_role;
