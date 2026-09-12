-- LINE-first membership completion without requiring email.
-- Existing customer/account, identity, consent, memory and merge tables are reused.

create or replace function public.refresh_customer_profile_completion(p_customer_id uuid)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_complete boolean;
begin
  select (
    c.member_status = 'member'
    and c.birth_date is not null
    and c.gender is not null
    and (public.customer_has_line(c.id) or public.customer_has_email(c.id))
  ) into v_complete
  from public.customer_accounts c
  where c.id = p_customer_id;

  if not found then return; end if;
  update public.customer_accounts
  set profile_completed_at = case when v_complete then coalesce(profile_completed_at, now()) else null end,
      updated_at = now()
  where id = p_customer_id
    and ((v_complete and profile_completed_at is null) or (not v_complete and profile_completed_at is not null));
end;
$$;

create or replace function public.upsert_line_member_profile(
  p_guest_id uuid,
  p_birth_date date default null,
  p_gender text default null,
  p_gender_self_description text default null,
  p_marketing_opt_in boolean default null,
  p_research_opt_in boolean default null,
  p_finalize boolean default false,
  p_consent_version text default 'v1'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_was_member boolean;
begin
  if p_guest_id is null then raise exception 'guest_id_required'; end if;
  if p_birth_date is not null and (p_birth_date < date '1900-01-01' or p_birth_date > current_date) then raise exception 'invalid_birth_date'; end if;
  if p_gender is not null and p_gender not in ('male','female','non_binary','self_described','prefer_not_to_say') then raise exception 'invalid_gender'; end if;

  select c.id, c.member_status = 'member' into v_customer_id, v_was_member
  from public.customer_accounts c
  where c.guest_id = p_guest_id
    and exists (
      select 1 from public.customer_channel_contacts cc
      where cc.customer_id = c.id and cc.provider = 'line' and cc.verified and cc.reachable
    )
  for update;
  if v_customer_id is null then raise exception 'verified_line_identity_required'; end if;

  update public.customer_accounts
  set birth_date = coalesce(p_birth_date, birth_date),
      gender = coalesce(p_gender, gender),
      gender_self_description = case
        when p_gender = 'self_described' then nullif(trim(p_gender_self_description), '')
        when p_gender is not null then null
        else gender_self_description
      end,
      preferred_contact = 'line',
      service_contact_allowed = true,
      member_status = case when p_finalize then 'member' else member_status end,
      membership_started_at = case when p_finalize then coalesce(membership_started_at, now()) else membership_started_at end,
      acquisition_source = case when acquisition_source = 'unknown' then 'line' else acquisition_source end,
      updated_at = now()
  where id = v_customer_id;

  if p_marketing_opt_in is not null then
    insert into public.customer_consents(customer_id, consent_type, granted, consent_version, source_channel)
    values(v_customer_id, 'marketing', p_marketing_opt_in, coalesce(nullif(trim(p_consent_version),''),'v1'), 'line');
  end if;
  if p_research_opt_in is not null then
    insert into public.customer_consents(customer_id, consent_type, granted, consent_version, source_channel)
    values(v_customer_id, 'research', p_research_opt_in, coalesce(nullif(trim(p_consent_version),''),'v1'), 'line');
  end if;

  if p_finalize then
    if not exists(select 1 from public.customer_accounts where id=v_customer_id and birth_date is not null and gender is not null) then
      raise exception 'member_profile_incomplete';
    end if;
    perform public.refresh_customer_profile_completion(v_customer_id);
    if not v_was_member then
      insert into public.customer_membership_events(customer_id, guest_id, event_type, source_channel, metadata)
      values(v_customer_id, p_guest_id, 'signup_completed', 'line', jsonb_build_object('line_first', true, 'email_required', false));
    else
      insert into public.customer_membership_events(customer_id, guest_id, event_type, source_channel, metadata)
      values(v_customer_id, p_guest_id, 'profile_updated', 'line', jsonb_build_object('line_first', true));
    end if;
  end if;
  return v_customer_id;
end;
$$;

revoke all on function public.upsert_line_member_profile(uuid,date,text,text,boolean,boolean,boolean,text) from public, anon, authenticated;
grant execute on function public.upsert_line_member_profile(uuid,date,text,text,boolean,boolean,boolean,text) to service_role;
revoke execute on function public.normalize_customer_acquisition_source() from public, anon, authenticated;
revoke usage, select on sequence public.customer_member_link_codes_id_seq from anon, authenticated;

select public.refresh_customer_profile_completion(id) from public.customer_accounts where member_status = 'member';
