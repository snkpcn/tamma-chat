-- Production hardening for Thongthai Operations V1.

create index if not exists bookings_guest_idx on public.bookings(guest_id);
create index if not exists bookings_resource_idx on public.bookings(resource_id);
create index if not exists cafe_inquiries_customer_idx on public.cafe_inquiries(customer_id, created_at desc);
create index if not exists cafe_inquiries_guest_idx on public.cafe_inquiries(guest_id, created_at desc);
create index if not exists customer_contact_logs_customer_idx on public.customer_contact_logs(customer_id, created_at desc);
create index if not exists customer_contact_logs_booking_idx on public.customer_contact_logs(booking_id, created_at desc);
create index if not exists customer_contact_logs_order_idx on public.customer_contact_logs(order_id, created_at desc);
create index if not exists customer_contact_logs_inquiry_idx on public.customer_contact_logs(inquiry_id, created_at desc);
create index if not exists otop_order_items_product_idx on public.otop_order_items(product_id);
create index if not exists otop_orders_guest_idx on public.otop_orders(guest_id, created_at desc);
create index if not exists otop_products_offering_idx on public.otop_products(offering_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end $$;

create or replace function public.otop_order_item_stock_guard()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_stock integer;
  v_active boolean;
  v_verified boolean;
  v_order_status text;
  v_delta integer;
begin
  if tg_op='INSERT' then
    select status into v_order_status from public.otop_orders where id=new.order_id;
    if not found then raise exception 'order_not_found'; end if;
    if v_order_status='cancelled' then return new; end if;
    select stock_qty,active,verified into v_stock,v_active,v_verified
      from public.otop_products where id=new.product_id for update;
    if not found or not v_active or not v_verified then raise exception 'product_not_available'; end if;
    if v_stock<new.quantity then raise exception 'insufficient_stock'; end if;
    update public.otop_products set stock_qty=stock_qty-new.quantity,updated_at=now() where id=new.product_id;
    return new;
  elsif tg_op='UPDATE' then
    if old.product_id<>new.product_id then raise exception 'changing_product_not_supported'; end if;
    select status into v_order_status from public.otop_orders where id=new.order_id;
    if not found then raise exception 'order_not_found'; end if;
    if v_order_status='cancelled' then return new; end if;
    v_delta:=new.quantity-old.quantity;
    if v_delta>0 then
      select stock_qty,active,verified into v_stock,v_active,v_verified
        from public.otop_products where id=new.product_id for update;
      if not found or not v_active or not v_verified then raise exception 'product_not_available'; end if;
      if v_stock<v_delta then raise exception 'insufficient_stock'; end if;
      update public.otop_products set stock_qty=stock_qty-v_delta,updated_at=now() where id=new.product_id;
    elsif v_delta<0 then
      update public.otop_products set stock_qty=stock_qty+abs(v_delta),updated_at=now() where id=new.product_id;
    end if;
    return new;
  else
    select status into v_order_status from public.otop_orders where id=old.order_id;
    if not found then return old; end if;
    if v_order_status<>'cancelled' then
      update public.otop_products set stock_qty=stock_qty+old.quantity,updated_at=now() where id=old.product_id;
    end if;
    return old;
  end if;
end;
$$;

drop trigger if exists otop_order_items_stock_guard on public.otop_order_items;
create trigger otop_order_items_stock_guard
before insert or update or delete on public.otop_order_items
for each row execute function public.otop_order_item_stock_guard();

create or replace function public.otop_order_status_stock_guard()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare r record; v_stock integer;
begin
  if old.status<>'cancelled' and new.status='cancelled' then
    for r in select product_id,quantity from public.otop_order_items where order_id=new.id loop
      update public.otop_products set stock_qty=stock_qty+r.quantity,updated_at=now() where id=r.product_id;
    end loop;
  elsif old.status='cancelled' and new.status<>'cancelled' then
    for r in select product_id,quantity from public.otop_order_items where order_id=new.id loop
      select stock_qty into v_stock from public.otop_products where id=r.product_id for update;
      if v_stock<r.quantity then raise exception 'insufficient_stock'; end if;
      update public.otop_products set stock_qty=stock_qty-r.quantity,updated_at=now() where id=r.product_id;
    end loop;
  end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists otop_orders_status_stock_guard on public.otop_orders;
create trigger otop_orders_status_stock_guard
before update of status on public.otop_orders
for each row execute function public.otop_order_status_stock_guard();

revoke execute on function public.booking_allocation_capacity_guard() from public,anon,authenticated;
revoke execute on function public.booking_status_capacity_guard() from public,anon,authenticated;
revoke execute on function public.handle_new_customer_auth_user() from public,anon,authenticated;
revoke execute on function public.otop_order_item_stock_guard() from public,anon,authenticated;
revoke execute on function public.otop_order_status_stock_guard() from public,anon,authenticated;
revoke execute on function public.touch_updated_at() from public,anon,authenticated;

grant execute on function public.booking_allocation_capacity_guard() to service_role;
grant execute on function public.booking_status_capacity_guard() to service_role;
grant execute on function public.handle_new_customer_auth_user() to service_role;
grant execute on function public.otop_order_item_stock_guard() to service_role;
grant execute on function public.otop_order_status_stock_guard() to service_role;
grant execute on function public.touch_updated_at() to service_role;

create or replace view public.ops_booking_queue with (security_invoker=true) as
select b.id,b.booking_code,b.service_type,r.code resource_code,r.name resource_name,b.start_at,b.end_at,b.party_size,b.quantity,b.status,b.contact_status,b.assigned_to,b.customer_note,b.staff_note,b.source_channel,b.environment,b.customer_id,c.full_name_enc,c.email_enc,c.phone_enc,c.preferred_contact,c.is_test,c.test_label,b.created_at,b.updated_at
from public.bookings b join public.service_resources r on r.id=b.resource_id left join public.customer_accounts c on c.id=b.customer_id;

create or replace view public.ops_schedule_capacity with (security_invoker=true) as
select s.id,r.code resource_code,r.service_type,r.name resource_name,s.start_at,s.end_at,s.capacity_total,s.capacity_reserved,greatest(0,s.capacity_total-s.capacity_reserved) capacity_available,s.status,s.environment,s.metadata,s.updated_at
from public.service_schedules s join public.service_resources r on r.id=s.resource_id;

create or replace view public.ops_order_queue with (security_invoker=true) as
select o.id,o.order_code,o.status,o.fulfillment_type,o.total_amount,o.contact_status,o.source_channel,o.environment,o.customer_id,c.full_name_enc,c.email_enc,c.phone_enc,c.preferred_contact,c.is_test,c.test_label,o.customer_note,o.staff_note,o.created_at,o.updated_at
from public.otop_orders o left join public.customer_accounts c on c.id=o.customer_id;

create or replace view public.ops_cafe_queue with (security_invoker=true) as
select i.id,i.inquiry_code,i.question,i.status,i.response_note,i.assigned_to,i.source_channel,i.environment,i.customer_id,c.full_name_enc,c.email_enc,c.phone_enc,c.preferred_contact,c.is_test,c.test_label,i.created_at,i.updated_at
from public.cafe_inquiries i left join public.customer_accounts c on c.id=i.customer_id;

revoke all on public.ops_booking_queue from anon,authenticated;
revoke all on public.ops_schedule_capacity from anon,authenticated;
revoke all on public.ops_order_queue from anon,authenticated;
revoke all on public.ops_cafe_queue from anon,authenticated;
