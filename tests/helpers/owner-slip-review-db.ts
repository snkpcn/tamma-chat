import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
export async function reviewDatabase() {
 const db=new PGlite();
 await db.exec(`    create role anon;
    create role authenticated;
    create role service_role;
    create table public.financial_investment_entries(
      id uuid primary key default gen_random_uuid(),
      occurred_on date not null default current_date,
      business_unit_code text not null default 'other',
      title text not null default 'รายการทดสอบ',
      category text not null default 'other',
      amount numeric(14,2) not null default 1,
      payment_method text not null default 'cash',
      vendor_name text,
      notes text,
      source_channel text not null default 'backoffice',
      owner_group_hash text,
      source_message_id text,
      source_user_hash text,
      status text not null default 'recorded',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      unique(source_channel,source_message_id)
    );
    create table public.financial_investment_entry_audit_events(
      id uuid primary key default gen_random_uuid(),
      entry_id uuid not null,
      action text not null,
      source text not null,
      actor_hash text,
      message_id text,
      before_data jsonb not null default '{}'::jsonb,
      after_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create function public.financial_record_investment_v1(
      p_occurred_on date,p_business_unit_code text,p_title text,p_category text,
      p_amount numeric,p_payment_method text,p_vendor_name text,p_notes text,
      p_source_channel text,p_owner_group_hash text,p_source_message_id text,p_actor_hash text
    ) returns jsonb language plpgsql as $$
    declare v_id uuid;
    begin
      select id into v_id from public.financial_investment_entries
      where source_channel=p_source_channel and source_message_id=p_source_message_id;
      if v_id is not null then return jsonb_build_object('ok',true,'duplicate',true,'id',v_id); end if;
      insert into public.financial_investment_entries(
        occurred_on,business_unit_code,title,category,amount,payment_method,vendor_name,notes,
        source_channel,owner_group_hash,source_message_id,source_user_hash
      ) values (
        p_occurred_on,p_business_unit_code,p_title,p_category,p_amount,p_payment_method,p_vendor_name,p_notes,
        p_source_channel,p_owner_group_hash,p_source_message_id,p_actor_hash
      ) returning id into v_id;
      return jsonb_build_object('ok',true,'duplicate',false,'id',v_id);
    end $$;

create schema storage;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
`);
 for(const file of ['20261005080000_owner_group_expense_inbox_v1.sql','20261005145713_owner_project_task_os_v1.sql','20261011052544_owner_slip_review_v1.sql']) await db.exec(readFileSync('supabase/migrations/'+file,'utf8'));
 return db;
}
