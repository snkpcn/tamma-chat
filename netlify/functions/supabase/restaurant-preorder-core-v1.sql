-- Restaurant preorder core schema (documentation/backfill migration)
--
-- These objects (restaurant_menu_live, restaurant_preorders,
-- restaurant_preorder_items, restaurant_preorder_ingredient_reservations,
-- create_restaurant_preorder_v2, set_restaurant_preorder_status,
-- restaurant_add_stock_by_name, restaurant_set_stock_by_name) were already
-- live in production (verified via pg_get_functiondef/pg_get_viewdef against
-- the tamma-customer-data project on 2026-09-17) but had no corresponding
-- migration file in this repo. This migration is a byte-faithful backfill of
-- what is already running, written with CREATE OR REPLACE / IF NOT EXISTS so
-- it is a safe no-op against the live database — it exists purely so the
-- repo's migration history matches reality, per "ใช้ของเดิมให้มากที่สุด /
-- ห้ามทำ duplicate table". No new behavior is introduced here.
--
-- Everything below reuses the tamma_chart_os schema already built for the
-- ตำมา-ชาติ OS backoffice (recipes/ingredients/stock) — the restaurant menu
-- and Food Cost chain are the single source of truth for both the backoffice
-- UI and this LINE ordering flow.

-- ---------------------------------------------------------------------------
-- restaurant_menu_live: orderable menu, joined live against recipe/ingredient
-- stock so a preorder can never be created against an item that's actually
-- out of stock. available_servings is floor(min(stock available / recipe
-- qty needed)) across every ingredient the recipe uses.
-- ---------------------------------------------------------------------------
create or replace view tamma_chart_os.restaurant_menu_live as
select
  m.restaurant_id,
  m.id as menu_item_id,
  mc.name as category_name,
  mc.sort_order as category_sort_order,
  m.sort_order,
  m.name,
  m.selling_price,
  m.description,
  m.is_signature,
  m.image_path,
  m.recipe_id,
  array_remove(array_agg(i.name order by ri.sort_order) filter (where i.id is not null), null::text) as ingredient_names,
  array_remove(
    array_agg(i.name order by ri.sort_order) filter (where i.id is not null and coalesce(sl.available, 0::numeric) < ri.quantity),
    null::text
  ) as unavailable_ingredients,
  coalesce(floor(min(coalesce(sl.available, 0::numeric) / nullif(ri.quantity, 0::numeric)) filter (where ri.id is not null)), 0::numeric)::integer as available_servings,
  m.status = 'ใช้งาน'::text and m.is_available and r.status = 'ใช้งาน'::text
    and coalesce(bool_and(coalesce(sl.available, 0::numeric) >= ri.quantity) filter (where ri.id is not null), false) as is_orderable,
  max(m.updated_at) as source_updated_at
from tamma_chart_os.menu_items m
  join tamma_chart_os.menu_categories mc on mc.id = m.category_id
  join tamma_chart_os.recipes r on r.id = m.recipe_id
  left join tamma_chart_os.recipe_ingredients ri on ri.recipe_id = r.id
  left join tamma_chart_os.ingredients i on i.id = ri.ingredient_id
  left join tamma_chart_os.ingredient_stock_live sl on sl.ingredient_id = i.id
group by m.restaurant_id, m.id, mc.name, mc.sort_order, m.sort_order, m.name, m.selling_price,
  m.description, m.is_signature, m.image_path, m.recipe_id, m.status, m.is_available, r.status;

grant all on tamma_chart_os.restaurant_menu_live to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- restaurant_preorders / restaurant_preorder_items: the durable order + PO
-- number record. One preorder = one PO-YYMMDD-XXXXXXXX code; items carry
-- their own unit_price/line_total captured at order time (never recomputed
-- later if the menu price subsequently changes, same discipline as sale_items
-- in the backoffice).
-- ---------------------------------------------------------------------------
create table if not exists tamma_chart_os.restaurant_preorders (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references tamma_chart_os.restaurants (id) on delete cascade,
  preorder_code text not null unique,
  customer_name text not null,
  phone text,
  email text,
  requested_for timestamptz not null,
  source_channel text not null default 'line',
  customer_note text,
  status text not null default 'requested'
    check (status in ('requested','confirmed','preparing','ready','completed','cancelled')),
  total_amount numeric not null default 0 check (total_amount >= 0),
  environment text not null default 'live' check (environment in ('live','test')),
  guest_id uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists tamma_chart_os.restaurant_preorder_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references tamma_chart_os.restaurants (id) on delete cascade,
  preorder_id uuid not null references tamma_chart_os.restaurant_preorders (id) on delete cascade,
  menu_item_id uuid not null references tamma_chart_os.menu_items (id) on delete restrict,
  menu_name text not null,
  quantity integer not null check (quantity > 0),
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

-- One ingredient reservation row per (preorder, ingredient) — quantities from
-- multiple order lines that share an ingredient are summed into it (see
-- create_restaurant_preorder_v2's ON CONFLICT DO UPDATE), so completing the
-- order writes exactly one stock_movements row per ingredient, not one per
-- menu line.
create table if not exists tamma_chart_os.restaurant_preorder_ingredient_reservations (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references tamma_chart_os.restaurants (id) on delete cascade,
  preorder_id uuid not null references tamma_chart_os.restaurant_preorders (id) on delete cascade,
  ingredient_id uuid not null references tamma_chart_os.ingredients (id) on delete restrict,
  quantity_base_unit numeric not null check (quantity_base_unit > 0),
  created_at timestamptz not null default now(),
  unique (preorder_id, ingredient_id)
);

alter table tamma_chart_os.restaurant_preorders enable row level security;
alter table tamma_chart_os.restaurant_preorder_items enable row level security;
alter table tamma_chart_os.restaurant_preorder_ingredient_reservations enable row level security;

drop policy if exists restaurant_preorders_restaurant_scope on tamma_chart_os.restaurant_preorders;
create policy restaurant_preorders_restaurant_scope on tamma_chart_os.restaurant_preorders
  for all using (restaurant_id = tamma_chart_os.auth_restaurant_id())
  with check (restaurant_id = tamma_chart_os.auth_restaurant_id());

drop policy if exists restaurant_preorder_items_restaurant_scope on tamma_chart_os.restaurant_preorder_items;
create policy restaurant_preorder_items_restaurant_scope on tamma_chart_os.restaurant_preorder_items
  for all using (restaurant_id = tamma_chart_os.auth_restaurant_id())
  with check (restaurant_id = tamma_chart_os.auth_restaurant_id());

drop policy if exists restaurant_preorder_reservations_restaurant_scope on tamma_chart_os.restaurant_preorder_ingredient_reservations;
create policy restaurant_preorder_reservations_restaurant_scope on tamma_chart_os.restaurant_preorder_ingredient_reservations
  for all using (restaurant_id = tamma_chart_os.auth_restaurant_id())
  with check (restaurant_id = tamma_chart_os.auth_restaurant_id());

grant all on tamma_chart_os.restaurant_preorders to authenticated, service_role;
grant all on tamma_chart_os.restaurant_preorder_items to authenticated, service_role;
grant all on tamma_chart_os.restaurant_preorder_ingredient_reservations to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- create_restaurant_preorder_v2: the one place a preorder is ever created.
-- Real menu-price resolution (never hardcoded — reads restaurant_menu_live
-- at insert time), idempotency-key dedup under an advisory lock (a retried
-- LINE webhook delivery or a double tool-call from the brain returns the
-- existing PO instead of creating a second one), and ingredient reservation
-- so available_servings reflects outstanding preorders immediately.
-- ---------------------------------------------------------------------------
create or replace function tamma_chart_os.create_restaurant_preorder_v2(
  p_restaurant_id uuid, p_requested_for timestamptz, p_customer_name text, p_phone text,
  p_email text, p_source_channel text, p_customer_note text, p_items jsonb, p_guest_id uuid,
  p_environment text, p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path to 'tamma_chart_os', 'pg_temp'
as $function$
declare
  v_preorder_id uuid := gen_random_uuid();
  v_code text;
  v_item jsonb;
  v_menu tamma_chart_os.restaurant_menu_live%rowtype;
  v_qty int;
  v_total numeric := 0;
  v_existing tamma_chart_os.restaurant_preorders%rowtype;
begin
  if p_customer_name is null or btrim(p_customer_name) = '' then raise exception 'customer_name_required'; end if;
  if p_requested_for is null then raise exception 'requested_for_required'; end if;
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    select * into v_existing from tamma_chart_os.restaurant_preorders
      where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object('id', v_existing.id, 'preorderCode', v_existing.preorder_code, 'totalAmount', v_existing.total_amount, 'status', v_existing.status, 'duplicate', true);
    end if;
  end if;

  lock table tamma_chart_os.restaurant_preorder_ingredient_reservations in share row exclusive mode;
  v_code := 'PO-' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD') || '-' || upper(substr(md5(v_preorder_id::text), 1, 8));
  insert into tamma_chart_os.restaurant_preorders (
    id, restaurant_id, preorder_code, guest_id, customer_name, phone, email, requested_for,
    source_channel, customer_note, status, total_amount, environment, idempotency_key
  ) values (
    v_preorder_id, p_restaurant_id, v_code, p_guest_id, btrim(p_customer_name), nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''), p_requested_for, coalesce(nullif(p_source_channel, ''), 'line'),
    p_customer_note, 'requested', 0, p_environment, nullif(btrim(p_idempotency_key), '')
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, least(50, coalesce((v_item->>'quantity')::int, 1)));
    select * into v_menu from tamma_chart_os.restaurant_menu_live
      where restaurant_id = p_restaurant_id and menu_item_id = (v_item->>'menuItemId')::uuid limit 1;
    if not found then raise exception 'menu_item_not_found'; end if;
    if not v_menu.is_orderable or v_menu.available_servings < v_qty then raise exception 'menu_item_unavailable:%', v_menu.name; end if;

    insert into tamma_chart_os.restaurant_preorder_items (restaurant_id, preorder_id, menu_item_id, menu_name, quantity, unit_price, line_total)
    values (p_restaurant_id, v_preorder_id, v_menu.menu_item_id, v_menu.name, v_qty, v_menu.selling_price, v_menu.selling_price * v_qty);
    v_total := v_total + v_menu.selling_price * v_qty;

    insert into tamma_chart_os.restaurant_preorder_ingredient_reservations (restaurant_id, preorder_id, ingredient_id, quantity_base_unit)
    select p_restaurant_id, v_preorder_id, ri.ingredient_id, sum(ri.quantity * v_qty)
      from tamma_chart_os.recipe_ingredients ri where ri.recipe_id = v_menu.recipe_id group by ri.ingredient_id
    on conflict (preorder_id, ingredient_id) do update
      set quantity_base_unit = tamma_chart_os.restaurant_preorder_ingredient_reservations.quantity_base_unit + excluded.quantity_base_unit;
  end loop;

  update tamma_chart_os.restaurant_preorders set total_amount = v_total, updated_at = now() where id = v_preorder_id;
  return jsonb_build_object('id', v_preorder_id, 'preorderCode', v_code, 'totalAmount', v_total, 'status', 'requested', 'duplicate', false);
exception when others then
  delete from tamma_chart_os.restaurant_preorders where id = v_preorder_id;
  raise;
end;
$function$;

revoke all on function tamma_chart_os.create_restaurant_preorder_v2(uuid, timestamptz, text, text, text, text, text, jsonb, uuid, text, text) from public, anon, authenticated;
grant execute on function tamma_chart_os.create_restaurant_preorder_v2(uuid, timestamptz, text, text, text, text, text, jsonb, uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- set_restaurant_preorder_status: staff LINE-button status transitions.
-- Finalized states (completed/cancelled) are locked. Completing an order
-- writes real stock_movements (one per ingredient, deduped by a
-- 'PREORDER:<code>' reference so a repeated postback never double-deducts
-- stock) — the same ledger the backoffice stock page reads.
-- ---------------------------------------------------------------------------
create or replace function tamma_chart_os.set_restaurant_preorder_status(p_preorder_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'tamma_chart_os', 'pg_temp'
as $function$
declare v_p tamma_chart_os.restaurant_preorders%rowtype; v_r record;
begin
  if p_status not in ('requested','confirmed','preparing','ready','completed','cancelled') then raise exception 'invalid_preorder_status'; end if;
  select * into v_p from tamma_chart_os.restaurant_preorders where id = p_preorder_id for update;
  if not found then raise exception 'preorder_not_found'; end if;
  if v_p.status in ('completed','cancelled') and v_p.status <> p_status then raise exception 'preorder_finalized'; end if;
  if p_status = 'completed' and v_p.status <> 'completed' then
    for v_r in
      select r.ingredient_id, r.quantity_base_unit, i.latest_cost_per_base_unit
      from tamma_chart_os.restaurant_preorder_ingredient_reservations r
      join tamma_chart_os.ingredients i on i.id = r.ingredient_id
      where r.preorder_id = p_preorder_id
    loop
      if not exists (
        select 1 from tamma_chart_os.stock_movements
        where restaurant_id = v_p.restaurant_id and ingredient_id = v_r.ingredient_id and reference = 'PREORDER:' || v_p.preorder_code
      ) then
        insert into tamma_chart_os.stock_movements (restaurant_id, ingredient_id, movement_type, quantity_base_unit, cost_per_base_unit, reference, reason, notes)
        values (v_p.restaurant_id, v_r.ingredient_id, 'ขาย', -v_r.quantity_base_unit, v_r.latest_cost_per_base_unit, 'PREORDER:' || v_p.preorder_code, 'ตัดสต๊อกออเดอร์ล่วงหน้า', v_p.preorder_code);
      end if;
    end loop;
  end if;
  update tamma_chart_os.restaurant_preorders set status = p_status, updated_at = now() where id = p_preorder_id;
  return jsonb_build_object('id', p_preorder_id, 'preorderCode', v_p.preorder_code, 'status', p_status);
end;
$function$;

revoke all on function tamma_chart_os.set_restaurant_preorder_status(uuid, text) from public, anon, authenticated;
grant execute on function tamma_chart_os.set_restaurant_preorder_status(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- LINE staff stock text commands ("ของเข้า <name> <qty>", "ของหมด <name>")
-- — same stock_movements ledger, so backoffice/customer menu/Thongthai all
-- read one source of truth.
-- ---------------------------------------------------------------------------
create or replace function tamma_chart_os.restaurant_add_stock_by_name(
  p_restaurant_id uuid, p_ingredient_name text, p_quantity numeric, p_reason text default 'LINE staff stock received'
)
returns jsonb
language plpgsql
security definer
set search_path to 'tamma_chart_os', 'pg_temp'
as $function$
declare v_ing tamma_chart_os.ingredients%rowtype; v_after numeric;
begin
  if p_quantity <= 0 then raise exception 'quantity_must_be_positive'; end if;
  select * into v_ing from tamma_chart_os.ingredients where restaurant_id = p_restaurant_id and name = p_ingredient_name and status = 'ใช้งาน' limit 1;
  if not found then raise exception 'ingredient_not_found'; end if;
  insert into tamma_chart_os.stock_movements (restaurant_id, ingredient_id, movement_type, quantity_base_unit, cost_per_base_unit, reference, reason, notes)
  values (p_restaurant_id, v_ing.id, 'รับเข้า', p_quantity, v_ing.latest_cost_per_base_unit, 'LINE-RECEIVE-' || to_char(now(), 'YYYYMMDDHH24MISSMS'), p_reason, 'รับของผ่านทองไทย');
  select coalesce(sum(quantity_base_unit), 0) into v_after from tamma_chart_os.stock_movements where restaurant_id = p_restaurant_id and ingredient_id = v_ing.id;
  return jsonb_build_object('ingredient', v_ing.name, 'baseUnit', v_ing.base_unit, 'onHand', v_after);
end;
$function$;

revoke all on function tamma_chart_os.restaurant_add_stock_by_name(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function tamma_chart_os.restaurant_add_stock_by_name(uuid, text, numeric, text) to service_role;

create or replace function tamma_chart_os.restaurant_set_stock_by_name(
  p_restaurant_id uuid, p_ingredient_name text, p_quantity numeric, p_reason text default 'LINE staff update'
)
returns jsonb
language plpgsql
security definer
set search_path to 'tamma_chart_os', 'pg_temp'
as $function$
declare v_ing tamma_chart_os.ingredients%rowtype; v_current numeric; v_delta numeric; v_affected text[];
begin
  if p_quantity < 0 then raise exception 'quantity_must_be_nonnegative'; end if;
  select * into v_ing from tamma_chart_os.ingredients where restaurant_id = p_restaurant_id and name = p_ingredient_name and status = 'ใช้งาน' limit 1;
  if not found then raise exception 'ingredient_not_found'; end if;
  select coalesce(sum(quantity_base_unit), 0) into v_current from tamma_chart_os.stock_movements where restaurant_id = p_restaurant_id and ingredient_id = v_ing.id;
  v_delta := p_quantity - v_current;
  if v_delta <> 0 then
    insert into tamma_chart_os.stock_movements (restaurant_id, ingredient_id, movement_type, quantity_base_unit, cost_per_base_unit, reference, reason, notes)
    values (p_restaurant_id, v_ing.id, 'ปรับยอด', v_delta, v_ing.latest_cost_per_base_unit, 'LINE-STOCK-' || to_char(now(), 'YYYYMMDDHH24MISSMS'), p_reason, 'อัปเดตผ่านทองไทย');
  end if;
  select array_agg(name order by sort_order) into v_affected from tamma_chart_os.restaurant_menu_live
    where restaurant_id = p_restaurant_id and p_ingredient_name = any(ingredient_names) and not is_orderable;
  return jsonb_build_object('ingredient', v_ing.name, 'baseUnit', v_ing.base_unit, 'previous', v_current, 'onHand', p_quantity, 'affectedMenus', coalesce(to_jsonb(v_affected), '[]'::jsonb));
end;
$function$;

revoke all on function tamma_chart_os.restaurant_set_stock_by_name(uuid, text, numeric, text) from public, anon, authenticated;
grant execute on function tamma_chart_os.restaurant_set_stock_by_name(uuid, text, numeric, text) to service_role;
