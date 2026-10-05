-- Investment OS is a global ledger: it deliberately does not belong to Restaurant OS.
-- Existing tamma_chart_os investments stay untouched and are exposed read-only below.

create table if not exists public.financial_investment_entries(
  id uuid primary key default gen_random_uuid(),
  occurred_on date not null default timezone('Asia/Bangkok',now())::date,
  business_unit_code text not null check(business_unit_code in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other')),
  title text not null check(length(trim(title)) between 2 and 240),
  category text not null default 'other',
  amount numeric(14,2) not null check(amount>0 and amount<=100000000),
  payment_method text not null check(payment_method in ('cash','transfer','card','other')),
  vendor_name text null,
  notes text null,
  source_channel text not null check(source_channel in ('line','backoffice','import','system')),
  owner_group_hash text null,
  source_message_id text null,
  source_user_hash text null,
  status text not null default 'recorded' check(status in ('recorded','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_channel,source_message_id)
);

create index if not exists financial_investment_entries_dashboard_idx
  on public.financial_investment_entries(occurred_on,business_unit_code,category)
  where status='recorded';

create table if not exists public.financial_investment_entry_audit_events(
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.financial_investment_entries(id) on delete restrict,
  action text not null check(action in ('recorded','cancelled')),
  source text not null check(source in ('line','backoffice','import','system')),
  actor_hash text null,
  message_id text null,
  before_data jsonb not null default '{}'::jsonb,
  after_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists financial_investment_entry_audit_idx
  on public.financial_investment_entry_audit_events(entry_id,created_at);

alter table public.financial_investment_entries enable row level security;
alter table public.financial_investment_entry_audit_events enable row level security;
revoke all on public.financial_investment_entries from public,anon,authenticated;
revoke all on public.financial_investment_entry_audit_events from public,anon,authenticated;
grant select,insert,update on public.financial_investment_entries to service_role;
grant select,insert on public.financial_investment_entry_audit_events to service_role;

create or replace view public.financial_investment_legacy_v1
with (security_invoker=true)
as select
  i.id::text as source_id,
  i.created_at,
  coalesce(i.paid_date,i.order_date,i.created_at::date) as occurred_on,
  'tamma_restaurant'::text as business_unit_code,
  i.name as title,
  coalesce(c.name,'อื่น ๆ') as category,
  i.budget_amount,
  i.actual_amount as amount,
  coalesce(nullif(i.payment_method,''),'other') as payment_method,
  i.vendor_name,
  i.notes,
  i.status,
  'legacy_restaurant'::text as source_kind
from tamma_chart_os.investments i
left join tamma_chart_os.investment_categories c on c.id=i.category_id
where coalesce(i.is_archived,false)=false;

revoke all on public.financial_investment_legacy_v1 from public,anon,authenticated;
grant select on public.financial_investment_legacy_v1 to service_role;

create or replace function public.financial_record_investment_v1(
  p_occurred_on date,
  p_business_unit_code text,
  p_title text,
  p_category text,
  p_amount numeric,
  p_payment_method text,
  p_vendor_name text,
  p_notes text,
  p_source_channel text,
  p_owner_group_hash text,
  p_source_message_id text,
  p_actor_hash text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_row public.financial_investment_entries%rowtype; v_id uuid;
begin
  if coalesce(trim(p_business_unit_code),'') not in ('inthanin','tamma_restaurant','huenstay','adventure','otop','shared_infrastructure','shared','other') then raise exception 'invalid_business_unit'; end if;
  if length(trim(coalesce(p_title,'')))<2 then raise exception 'investment_title_required'; end if;
  if p_amount is null or p_amount<=0 or p_amount>100000000 then raise exception 'invalid_investment_amount'; end if;
  if coalesce(trim(p_payment_method),'') not in ('cash','transfer','card','other') then raise exception 'invalid_payment_method'; end if;
  if coalesce(trim(p_source_channel),'') not in ('line','backoffice','import','system') then raise exception 'invalid_source_channel'; end if;
  if p_source_message_id is not null then
    select * into v_row from public.financial_investment_entries where source_channel=trim(p_source_channel) and source_message_id=trim(p_source_message_id);
    if v_row.id is not null then return jsonb_build_object('ok',true,'duplicate',true,'id',v_row.id); end if;
  end if;
  insert into public.financial_investment_entries(occurred_on,business_unit_code,title,category,amount,payment_method,vendor_name,notes,source_channel,owner_group_hash,source_message_id,source_user_hash)
  values(coalesce(p_occurred_on,timezone('Asia/Bangkok',now())::date),trim(p_business_unit_code),left(trim(p_title),240),coalesce(nullif(left(trim(coalesce(p_category,'')),120),''),'other'),p_amount,trim(p_payment_method),nullif(left(trim(coalesce(p_vendor_name,'')),180),''),nullif(left(trim(coalesce(p_notes,'')),2000),''),trim(p_source_channel),nullif(trim(coalesce(p_owner_group_hash,'')),''),nullif(trim(coalesce(p_source_message_id,'')),''),nullif(trim(coalesce(p_actor_hash,'')),'')) returning id into v_id;
  insert into public.financial_investment_entry_audit_events(entry_id,action,source,actor_hash,message_id,after_data)
  values(v_id,'recorded',trim(p_source_channel),nullif(trim(coalesce(p_actor_hash,'')),''),nullif(trim(coalesce(p_source_message_id,'')),''),jsonb_build_object('occurred_on',coalesce(p_occurred_on,timezone('Asia/Bangkok',now())::date),'business_unit_code',trim(p_business_unit_code),'title',left(trim(p_title),240),'amount',p_amount,'payment_method',trim(p_payment_method)));
  return jsonb_build_object('ok',true,'duplicate',false,'id',v_id);
end; $$;

revoke all on function public.financial_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.financial_record_investment_v1(date,text,text,text,numeric,text,text,text,text,text,text,text) to service_role;
