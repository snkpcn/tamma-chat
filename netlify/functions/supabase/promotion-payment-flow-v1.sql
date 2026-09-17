-- Promotion OS Phase 2: thread the promo price into the real payment.
--
-- Additive only. tamma_chart_os.create_restaurant_preorder_v2 (the existing,
-- currently-live restaurant order path) is NOT modified -- its signature,
-- body, grants stay byte-identical, so ordinary non-promo ordering has zero
-- risk of regression. A brand new function create_restaurant_preorder_v3
-- (distinct name, no overload of v2 -- named-parameter RPC calls would
-- otherwise be ambiguous between two functions of the same name where the
-- extra params merely have defaults) is the only path that ever writes a
-- promotion-priced preorder, and it is only ever called from
-- redeemPromotion() in _promotions-runtime.ts after that function has
-- independently re-validated the promotion is really active/eligible.
--
-- Once total_amount is set correctly on the preorder at creation time, every
-- downstream step (payment_requests.amount via the existing
-- create_payment_for_restaurant_preorder / sync_restaurant_preorder_payment_amount
-- triggers, and team_settlements.gross_amount/amount_due via the existing
-- upsert_restaurant_settlement trigger) already reads that same number with
-- NO changes required -- this migration only has to get total_amount right
-- once, at the source.

alter table tamma_chart_os.restaurant_preorders
  add column if not exists promotion_campaign_id uuid references public.promotion_campaigns(id),
  add column if not exists promotion_redemption_id uuid references public.promotion_redemptions(id),
  add column if not exists normal_total_amount numeric,
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists pricing_source text not null default 'menu'
    check (pricing_source in ('menu','promotion'));

create index if not exists restaurant_preorders_promotion_idx
  on tamma_chart_os.restaurant_preorders (promotion_campaign_id)
  where promotion_campaign_id is not null;

alter table tamma_chart_os.restaurant_preorder_items
  add column if not exists normal_unit_price numeric,
  add column if not exists promo_unit_price numeric,
  add column if not exists discount_amount numeric not null default 0,
  add column if not exists promotion_item_id uuid references public.promotion_items(id),
  add column if not exists pricing_source text not null default 'menu'
    check (pricing_source in ('menu','promotion'));

-- DB-level insurance against a duplicate promotion_redemptions row ever
-- being written for the same preorder (the app layer already checks this,
-- see redeemPromotion's `created.duplicate` branch, but this makes it
-- impossible even under a race between two concurrent retries).
create unique index if not exists promotion_redemptions_related_entity_unique_idx
  on public.promotion_redemptions (related_entity_type, related_entity_id)
  where related_entity_id is not null;

-- ---------------------------------------------------------------------------
-- create_restaurant_preorder_v3: promotion-priced sibling of
-- create_restaurant_preorder_v2. Mirrors v2's item-resolution / stock /
-- idempotency logic exactly, with two differences: every line's price comes
-- from p_pricing_override (built server-side in redeemPromotion from real,
-- currently-stored promotion_items.promo_price rows -- never an arbitrary
-- caller-supplied amount) instead of always using the live menu price, and
-- normal_total_amount/discount_amount/promotion_campaign_id are recorded for
-- audit. A promo price is refused outright if it is negative or exceeds the
-- CURRENT live menu price (defense in depth: even a corrupted or stale
-- override can never charge a customer more than menu price, and a menu
-- price drop below a stale promo snapshot fails safely instead of silently
-- overcharging).
-- ---------------------------------------------------------------------------
create or replace function tamma_chart_os.create_restaurant_preorder_v3(
  p_restaurant_id uuid, p_requested_for timestamptz, p_customer_name text, p_phone text,
  p_email text, p_source_channel text, p_customer_note text, p_items jsonb, p_guest_id uuid,
  p_environment text, p_idempotency_key text, p_promotion_campaign_id uuid, p_pricing_override jsonb
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
  v_unit_price numeric;
  v_discount_line numeric;
  v_total numeric := 0;
  v_normal_total numeric := 0;
  v_existing tamma_chart_os.restaurant_preorders%rowtype;
begin
  if p_customer_name is null or btrim(p_customer_name) = '' then raise exception 'customer_name_required'; end if;
  if p_requested_for is null then raise exception 'requested_for_required'; end if;
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'items_required'; end if;
  if p_promotion_campaign_id is null then raise exception 'promotion_campaign_id_required'; end if;

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    perform pg_advisory_xact_lock(hashtextextended(p_idempotency_key, 0));
    select * into v_existing from tamma_chart_os.restaurant_preorders
      where restaurant_id = p_restaurant_id and idempotency_key = p_idempotency_key limit 1;
    if found then
      return jsonb_build_object(
        'id', v_existing.id, 'preorderCode', v_existing.preorder_code, 'totalAmount', v_existing.total_amount,
        'normalTotalAmount', v_existing.normal_total_amount, 'discountAmount', v_existing.discount_amount,
        'status', v_existing.status, 'duplicate', true
      );
    end if;
  end if;

  lock table tamma_chart_os.restaurant_preorder_ingredient_reservations in share row exclusive mode;
  v_code := 'PO-' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD') || '-' || upper(substr(md5(v_preorder_id::text), 1, 8));
  insert into tamma_chart_os.restaurant_preorders (
    id, restaurant_id, preorder_code, guest_id, customer_name, phone, email, requested_for,
    source_channel, customer_note, status, total_amount, environment, idempotency_key,
    promotion_campaign_id, pricing_source
  ) values (
    v_preorder_id, p_restaurant_id, v_code, p_guest_id, btrim(p_customer_name), nullif(btrim(p_phone), ''),
    nullif(btrim(p_email), ''), p_requested_for, coalesce(nullif(p_source_channel, ''), 'line'),
    p_customer_note, 'requested', 0, p_environment, nullif(btrim(p_idempotency_key), ''),
    p_promotion_campaign_id, 'promotion'
  );

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := greatest(1, least(50, coalesce((v_item->>'quantity')::int, 1)));
    select * into v_menu from tamma_chart_os.restaurant_menu_live
      where restaurant_id = p_restaurant_id and menu_item_id = (v_item->>'menuItemId')::uuid limit 1;
    if not found then raise exception 'menu_item_not_found'; end if;
    if not v_menu.is_orderable or v_menu.available_servings < v_qty then raise exception 'menu_item_unavailable:%', v_menu.name; end if;

    v_unit_price := coalesce((p_pricing_override->>(v_menu.menu_item_id::text))::numeric, v_menu.selling_price);
    if v_unit_price < 0 or v_unit_price > v_menu.selling_price then
      raise exception 'invalid_promo_unit_price:%', v_menu.name;
    end if;
    v_discount_line := (v_menu.selling_price - v_unit_price) * v_qty;

    insert into tamma_chart_os.restaurant_preorder_items (
      restaurant_id, preorder_id, menu_item_id, menu_name, quantity, unit_price, line_total,
      normal_unit_price, promo_unit_price, discount_amount, pricing_source
    )
    values (
      p_restaurant_id, v_preorder_id, v_menu.menu_item_id, v_menu.name, v_qty, v_unit_price, v_unit_price * v_qty,
      v_menu.selling_price, v_unit_price, v_discount_line, 'promotion'
    );
    v_total := v_total + v_unit_price * v_qty;
    v_normal_total := v_normal_total + v_menu.selling_price * v_qty;

    insert into tamma_chart_os.restaurant_preorder_ingredient_reservations (restaurant_id, preorder_id, ingredient_id, quantity_base_unit)
    select p_restaurant_id, v_preorder_id, ri.ingredient_id, sum(ri.quantity * v_qty)
      from tamma_chart_os.recipe_ingredients ri where ri.recipe_id = v_menu.recipe_id group by ri.ingredient_id
    on conflict (preorder_id, ingredient_id) do update
      set quantity_base_unit = tamma_chart_os.restaurant_preorder_ingredient_reservations.quantity_base_unit + excluded.quantity_base_unit;
  end loop;

  if v_total <= 0 then
    raise exception 'invalid_promo_total';
  end if;

  update tamma_chart_os.restaurant_preorders
  set total_amount = v_total, normal_total_amount = v_normal_total, discount_amount = v_normal_total - v_total, updated_at = now()
  where id = v_preorder_id;
  return jsonb_build_object(
    'id', v_preorder_id, 'preorderCode', v_code, 'totalAmount', v_total,
    'normalTotalAmount', v_normal_total, 'discountAmount', v_normal_total - v_total,
    'status', 'requested', 'duplicate', false
  );
exception when others then
  delete from tamma_chart_os.restaurant_preorders where id = v_preorder_id;
  raise;
end;
$function$;

revoke all on function tamma_chart_os.create_restaurant_preorder_v3(uuid, timestamptz, text, text, text, text, text, jsonb, uuid, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function tamma_chart_os.create_restaurant_preorder_v3(uuid, timestamptz, text, text, text, text, text, jsonb, uuid, text, text, uuid, jsonb) to service_role;

-- Let the RPC be looked up once so PostgREST's schema cache (and any client
-- introspecting it) sees the new function/columns immediately.
