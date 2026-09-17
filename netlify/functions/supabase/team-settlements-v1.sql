-- Internal settlement/payout ledger, layered on top of (never replacing)
-- payment_requests. "payment verified" (customer money into the owner's
-- PromptPay) and "settled" (owner's money out to the team) are distinct
-- financial states -- a restaurant order can be fully completed while its
-- settlement is still pending_transfer.

create table if not exists public.team_settlements (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null unique references public.payment_requests(id),
  entity_type text not null,
  entity_id uuid not null,
  entity_code text not null,
  team_code text not null,
  gross_amount numeric not null,
  adjustment_amount numeric not null default 0,
  amount_due numeric not null,
  currency text not null default 'THB',
  status text not null default 'pending_transfer'
    check (status in ('pending_transfer','transfer_submitted','transferred','acknowledged','cancelled')),
  environment text not null default 'live',
  transfer_reference text,
  transfer_proof_path text,
  created_at timestamptz not null default now(),
  created_by text,
  transferred_at timestamptz,
  transferred_by text,
  acknowledged_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists team_settlements_team_status_idx on public.team_settlements (team_code, status);
create index if not exists team_settlements_environment_idx on public.team_settlements (environment);

create or replace function public.team_settlements_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_team_settlements_updated_at on public.team_settlements;
create trigger trg_team_settlements_updated_at
before update on public.team_settlements
for each row
execute function public.team_settlements_set_updated_at();

-- Auto-create a pending settlement obligation the moment a restaurant
-- preorder payment verifies. Independent of the order lifecycle
-- (confirmed/preparing/ready/completed) -- this row only changes via the
-- owner's own "โอนให้ร้านแล้ว" action in the backoffice. No fee/commission
-- rule exists yet, so amount_due is always the full customer payment.
create or replace function public.upsert_restaurant_settlement()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'verified'
     and (old.status is distinct from 'verified')
     and new.entity_type = 'restaurant_preorder' then
    insert into public.team_settlements (
      payment_request_id, entity_type, entity_id, entity_code, team_code,
      gross_amount, adjustment_amount, amount_due, currency, status, environment
    ) values (
      new.id, new.entity_type, new.entity_id, new.entity_code, new.team_code,
      new.amount, 0, new.amount, new.currency, 'pending_transfer', new.environment
    )
    on conflict (payment_request_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_upsert_restaurant_settlement on public.payment_requests;
create trigger trg_upsert_restaurant_settlement
after update on public.payment_requests
for each row
execute function public.upsert_restaurant_settlement();

-- Notify the team's LINE group when a settlement is created (pending
-- transfer) and again once the owner marks it transferred. Same
-- pg_net + vault webhook-secret pattern as enqueue_tamma_payment_notification.
create or replace function public.enqueue_settlement_notification()
returns trigger
language plpgsql
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'ops_notification_webhook_secret'
  order by created_at desc
  limit 1;

  if v_secret is null or length(v_secret) < 24 then
    raise warning 'ops_notification_webhook_secret is missing; skipping settlement notification';
    return new;
  end if;

  perform net.http_post(
    url := 'https://tamma-chat.netlify.app/.netlify/functions/ops-settlement-notify',
    body := jsonb_build_object('id', new.id::text),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-ops-notification-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
exception
  when others then
    raise warning 'Could not enqueue settlement notification: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_enqueue_settlement_notification_insert on public.team_settlements;
create trigger trg_enqueue_settlement_notification_insert
after insert on public.team_settlements
for each row
execute function public.enqueue_settlement_notification();

drop trigger if exists trg_enqueue_settlement_notification_transferred on public.team_settlements;
create trigger trg_enqueue_settlement_notification_transferred
after update on public.team_settlements
for each row
when (new.status = 'transferred' and old.status is distinct from 'transferred')
execute function public.enqueue_settlement_notification();

-- Team payout destination config. Rows start with null bank fields --
-- never invented here -- until the owner sets them in the backoffice.
create table if not exists public.team_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  team_code text not null unique,
  bank_name text,
  account_name text,
  account_number text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.team_payout_accounts (team_code)
values ('restaurant')
on conflict (team_code) do nothing;

-- Private bucket for the owner's outbound-transfer proof, kept separate
-- from customer-submitted payment-slips (payment-slips bucket).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('settlement-proofs', 'settlement-proofs', false, 10485760, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
