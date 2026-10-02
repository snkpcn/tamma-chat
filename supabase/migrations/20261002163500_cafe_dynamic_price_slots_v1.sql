-- Inthanin Café dynamic price-slot model.
-- Future drink styles are rows, not hard-coded columns or JSON keys.

create table if not exists public.cafe_menu_price_slots (
  id uuid primary key default gen_random_uuid(),
  menu_code text not null references public.cafe_master_menu_items(code) on delete cascade,
  slot_code text not null,
  label_th text not null,
  label_en text not null,
  price numeric(14,2) not null check(price>=0),
  active boolean not null default true,
  sort_order integer not null default 100,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique(menu_code,slot_code)
);

alter table public.cafe_menu_price_slots enable row level security;
revoke all on public.cafe_menu_price_slots from public,anon,authenticated;
grant select,insert,update,delete on public.cafe_menu_price_slots to service_role;

insert into public.cafe_menu_price_slots(menu_code,slot_code,label_th,label_en,price,active,sort_order)
select
  m.code,
  p.key,
  case p.key when 'hot' then 'ร้อน' when 'iced' then 'เย็น' when 'frappe' then 'ปั่น' else initcap(replace(p.key,'_',' ')) end,
  case p.key when 'hot' then 'Hot' when 'iced' then 'Iced' when 'frappe' then 'Frappe' else initcap(replace(p.key,'_',' ')) end,
  (p.value::text)::numeric,
  true,
  case p.key when 'hot' then 10 when 'iced' then 20 when 'frappe' then 30 else 100 end
from public.cafe_master_menu_items m
cross join lateral jsonb_each(m.prices) p
on conflict(menu_code,slot_code) do update
set price=excluded.price,
    label_th=excluded.label_th,
    label_en=excluded.label_en,
    active=true,
    sort_order=excluded.sort_order,
    updated_at=now();

create or replace function public.cafe_sync_menu_prices_v1(p_menu_code text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_prices jsonb;
begin
  select coalesce(jsonb_object_agg(slot_code,price order by sort_order,slot_code),'{}'::jsonb)
  into v_prices
  from public.cafe_menu_price_slots
  where menu_code=p_menu_code and active=true;

  update public.cafe_master_menu_items
  set prices=v_prices,updated_at=now()
  where code=p_menu_code;

  return jsonb_build_object('ok',true,'menu_code',p_menu_code,'prices',v_prices);
end;
$$;

create or replace function public.cafe_touch_slot_sync_v1()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  perform public.cafe_sync_menu_prices_v1(coalesce(new.menu_code,old.menu_code));
  return coalesce(new,old);
end;
$$;

drop trigger if exists cafe_menu_slot_sync on public.cafe_menu_price_slots;
create trigger cafe_menu_slot_sync
after insert or update or delete on public.cafe_menu_price_slots
for each row execute function public.cafe_touch_slot_sync_v1();

revoke all on function public.cafe_sync_menu_prices_v1(text) from public,anon,authenticated;
grant execute on function public.cafe_sync_menu_prices_v1(text) to service_role;
