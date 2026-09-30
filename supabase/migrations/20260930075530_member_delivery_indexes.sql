-- Cover the reusable-address foreign key used by account and fulfilment queries.
create index if not exists otop_orders_shipping_address_idx
  on public.otop_orders(shipping_address_id)
  where shipping_address_id is not null;
