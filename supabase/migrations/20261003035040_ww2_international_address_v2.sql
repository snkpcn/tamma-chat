-- WW-2 International Address V2
-- Backward-compatible extension of customer_addresses.
-- V1 Thailand rows remain valid and keep their existing fields.
-- V2 international rows use generic locality/admin-area fields and E.164 phones.

alter table public.customer_addresses
  add column if not exists address_schema_version smallint not null default 1,
  add column if not exists country_code text not null default 'TH',
  add column if not exists organization_enc text null,
  add column if not exists dependent_locality_enc text null,
  add column if not exists locality_enc text null,
  add column if not exists administrative_area_enc text null;

alter table public.customer_addresses
  alter column district_enc drop not null,
  alter column province drop not null,
  alter column postal_code_enc drop not null;

alter table public.customer_addresses
  drop constraint if exists customer_addresses_address_schema_version_check;
alter table public.customer_addresses
  add constraint customer_addresses_address_schema_version_check
  check (address_schema_version in (1, 2));

alter table public.customer_addresses
  drop constraint if exists customer_addresses_country_code_check;
alter table public.customer_addresses
  add constraint customer_addresses_country_code_check
  check (country_code ~ '^[A-Z]{2}$');

alter table public.customer_addresses
  drop constraint if exists customer_addresses_shape_check;
alter table public.customer_addresses
  add constraint customer_addresses_shape_check
  check (
    (
      address_schema_version = 1
      and country_code = 'TH'
      and district_enc is not null
      and province is not null
      and postal_code_enc is not null
    )
    or
    (
      address_schema_version = 2
      and locality_enc is not null
    )
  );

create index if not exists customer_addresses_country_idx
  on public.customer_addresses(customer_id, country_code, active, created_at desc);

comment on column public.customer_addresses.address_schema_version is
  '1 = legacy Thailand address; 2 = WW-2 generic international address.';
comment on column public.customer_addresses.country_code is
  'Uppercase two-letter destination country code. Address storage is independent of market launch eligibility.';
comment on column public.customer_addresses.locality_enc is
  'Encrypted city/town/locality for Address V2.';
comment on column public.customer_addresses.administrative_area_enc is
  'Encrypted state/province/region for Address V2 when applicable.';
