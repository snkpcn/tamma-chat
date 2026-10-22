-- A completed AI/business turn may still have an undelivered LINE reply.
-- Store the rendered payload before sending, so redelivery never reruns it.
create table public.line_customer_deliveries (
  event_id text primary key,
  target_hash text not null,
  payload_enc text not null,
  status text not null default 'pending' check (status in ('pending','sending','delivered')),
  mode text not null default 'reply' check (mode in ('reply','reply_uncertain','push')),
  lease_id uuid,
  leased_at timestamptz,
  expires_at timestamptz not null default (now() + interval '24 hours')
);
create index line_customer_deliveries_expiry_idx on public.line_customer_deliveries(expires_at);
alter table public.line_customer_deliveries enable row level security;
revoke all on public.line_customer_deliveries from public, anon, authenticated;
grant select, insert, update on public.line_customer_deliveries to service_role;

create function public.prune_line_customer_deliveries()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.line_customer_deliveries where expires_at < now();
  return null;
end;
$$;
revoke all on function public.prune_line_customer_deliveries() from public, anon, authenticated;
create trigger prune_line_customer_deliveries after insert on public.line_customer_deliveries
for each statement execute function public.prune_line_customer_deliveries();
