-- WW-9 performance hardening: cover all new foreign-key lookup paths.

create index if not exists commerce_fulfillment_shipments_market_service_idx
  on public.commerce_fulfillment_shipments(market_code,service_code);
create index if not exists commerce_fulfillment_shipments_destination_idx
  on public.commerce_fulfillment_shipments(destination_country_code);
create index if not exists commerce_fulfillment_shipments_currency_idx
  on public.commerce_fulfillment_shipments(currency_code);
create index if not exists commerce_fulfillment_shipments_quote_idx
  on public.commerce_fulfillment_shipments(shipping_quote_id);

create index if not exists commerce_fulfillment_notification_shipment_idx
  on public.commerce_fulfillment_notification_outbox(shipment_id);
create index if not exists commerce_fulfillment_notification_order_idx
  on public.commerce_fulfillment_notification_outbox(order_id);
create index if not exists commerce_fulfillment_notification_customer_idx
  on public.commerce_fulfillment_notification_outbox(customer_id)
  where customer_id is not null;

create index if not exists commerce_return_requests_shipment_idx
  on public.commerce_return_requests(shipment_id);
create index if not exists commerce_return_requests_market_idx
  on public.commerce_return_requests(market_code);
