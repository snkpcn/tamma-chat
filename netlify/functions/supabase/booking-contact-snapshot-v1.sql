-- Preserve per-booking customer contact as it was submitted for that booking.
-- customer_accounts remains the mutable profile; bookings need immutable
-- snapshots so a later booking in the same web/LINE guest session cannot make
-- older queue rows display the wrong customer name or phone.

alter table public.bookings
  add column if not exists booking_customer_name_enc text null,
  add column if not exists booking_phone_enc text null,
  add column if not exists booking_email_enc text null;

create or replace view public.ops_booking_queue with (security_invoker=true) as
select
  b.id,
  b.booking_code,
  b.service_type,
  r.code resource_code,
  r.name resource_name,
  b.start_at,
  b.end_at,
  b.party_size,
  b.quantity,
  b.status,
  b.contact_status,
  b.assigned_to,
  b.customer_note,
  b.staff_note,
  b.source_channel,
  b.environment,
  b.customer_id,
  coalesce(b.booking_customer_name_enc, c.full_name_enc) full_name_enc,
  coalesce(b.booking_email_enc, c.email_enc) email_enc,
  coalesce(b.booking_phone_enc, c.phone_enc) phone_enc,
  c.preferred_contact,
  c.is_test,
  c.test_label,
  b.created_at,
  b.updated_at,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'resource_id', sr2.id,
      'code', sr2.code,
      'name', sr2.name,
      'bedrooms', ar2.bedrooms,
      'max_guests', ar2.max_guests
    ) order by sr2.code)
    from public.booking_unit_assignments bua
    join public.service_resources sr2 on sr2.id = bua.resource_id
    left join public.accommodation_room_types ar2 on ar2.id = sr2.accommodation_room_type_id
    where bua.booking_id = b.id
  ), '[]'::jsonb) assigned_units
from public.bookings b
join public.service_resources r on r.id = b.resource_id
left join public.customer_accounts c on c.id = b.customer_id;

revoke all on public.ops_booking_queue from anon, authenticated;
grant select on public.ops_booking_queue to service_role;
