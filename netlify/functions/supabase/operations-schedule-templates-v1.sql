-- Recurring schedule templates for restaurant / stay / activity resources.
-- Live templates are intentionally not seeded: owner/staff must enter verified operating schedules.

create table if not exists public.service_schedule_templates (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.service_resources(id) on delete cascade,
  name text not null,
  day_of_week integer not null check (day_of_week between 0 and 6),
  start_local time not null,
  end_local time not null,
  capacity_total integer not null check (capacity_total >= 0),
  valid_from date not null default current_date,
  valid_to date null,
  active boolean not null default true,
  environment text not null default 'live' check (environment in ('live','test')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_schedule_templates_date_order check (valid_to is null or valid_to >= valid_from)
);
create index if not exists service_schedule_templates_resource_idx on public.service_schedule_templates(resource_id,environment,active);

alter table public.service_schedule_templates enable row level security;
revoke all on public.service_schedule_templates from anon,authenticated;

create or replace function public.generate_service_schedules(p_from date,p_to date,p_environment text default 'live')
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare d date; t record; inserted_count integer:=0; start_ts timestamptz; end_ts timestamptz;
begin
  if p_environment not in ('live','test') then raise exception 'invalid_environment'; end if;
  if p_from is null or p_to is null or p_to<p_from or p_to>p_from+180 then raise exception 'invalid_date_range'; end if;
  for d in select generate_series(p_from,p_to,interval '1 day')::date loop
    for t in select * from public.service_schedule_templates where active=true and environment=p_environment and extract(dow from d)::integer=day_of_week and d>=valid_from and (valid_to is null or d<=valid_to) loop
      start_ts := (d::timestamp+t.start_local) at time zone 'Asia/Bangkok';
      end_ts := (((case when t.end_local<=t.start_local then d+1 else d end)::timestamp)+t.end_local) at time zone 'Asia/Bangkok';
      insert into public.service_schedules(resource_id,start_at,end_at,capacity_total,capacity_reserved,status,environment,metadata)
      values(t.resource_id,start_ts,end_ts,t.capacity_total,0,'open',p_environment,t.metadata||jsonb_build_object('template_id',t.id,'template_name',t.name))
      on conflict(resource_id,start_at,environment) do nothing;
      if found then inserted_count:=inserted_count+1; end if;
    end loop;
  end loop;
  return inserted_count;
end;
$$;

revoke execute on function public.generate_service_schedules(date,date,text) from public,anon,authenticated;
grant execute on function public.generate_service_schedules(date,date,text) to service_role;
