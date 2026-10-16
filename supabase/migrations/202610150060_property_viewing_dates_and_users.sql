-- Independent, date-only property calendars. Keep the former global calendar
-- and all historical appointment timestamps for recovery and audit.
create table public.property_viewing_schedules (
  rental_listing_id uuid primary key references public.rental_listings(id) on delete cascade,
  timezone text not null default 'America/Vancouver' check (timezone = 'America/Vancouver'),
  open_weekdays integer[] not null default '{}' check (open_weekdays <@ array[1,2,3,4,5,6,7]),
  date_overrides jsonb not null default '[]'::jsonb check (jsonb_typeof(date_overrides) = 'array'),
  updated_at timestamptz not null default clock_timestamp()
);

-- Preserve whether each day was open, without inventing a time for new bookings.
insert into public.property_viewing_schedules(rental_listing_id, timezone, open_weekdays, date_overrides)
select rental.id, calendar.timezone,
  array(select (entry->>'weekday')::integer
    from jsonb_array_elements(calendar.weekly_slots) entry
    where jsonb_array_length(entry->'times') > 0),
  coalesce((select jsonb_agg(jsonb_build_object(
    'date', entry->>'date', 'available', jsonb_array_length(entry->'times') > 0
  )) from jsonb_array_elements(calendar.date_overrides) entry), '[]'::jsonb)
from public.rental_listings rental cross join public.viewing_schedules calendar;

alter table public.property_viewing_schedules enable row level security;
revoke all on public.property_viewing_schedules from anon, authenticated;
grant all on public.property_viewing_schedules to service_role;

-- Always advance the optimistic concurrency token, including sub-millisecond writes.
create function public.bump_property_viewing_schedule_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
create trigger property_viewing_schedule_version before update on public.property_viewing_schedules
for each row execute function public.bump_property_viewing_schedule_version();
revoke all on function public.bump_property_viewing_schedule_version() from public, anon, authenticated;

-- Many visitors may book the same property and date. Old timestamps remain intact.
drop index public.showing_requests_one_accepted_start_idx;
alter table public.showing_requests
  alter column requested_start_at drop not null,
  alter column requested_local_time drop not null,
  add constraint showing_requests_time_pair_check check (
    (requested_start_at is null and requested_local_time is null)
    or (requested_start_at is not null and requested_local_time is not null)
  );
comment on column public.showing_requests.requested_start_at is
  'Historical timed appointments only. Date-only bookings leave this null; agents coordinate the time.';
create index showing_requests_property_date_idx
  on public.showing_requests(rental_listing_id, requested_local_date, created_at);

-- Recheck the property's calendar inside the booking transaction, taking a shared
-- lock so a concurrent calendar edit cannot invalidate an in-flight reservation.
create or replace function public.reserve_viewing_appointment(
  p_request_id uuid, p_rental_listing_id uuid, p_property_slug text,
  p_property_title text, p_property_address text, p_name text, p_phone text,
  p_email text, p_requested_start_at timestamptz, p_requested_local_date date,
  p_requested_local_time time, p_notes text, p_created_at timestamptz,
  p_notification_payload jsonb default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_schedule public.property_viewing_schedules;
  v_available boolean;
  v_today date := (now() at time zone 'America/Vancouver')::date;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if p_requested_start_at is not null or p_requested_local_time is not null then
    raise exception using errcode = '22023', message = 'date-only booking required';
  end if;
  if p_requested_local_date is null or p_requested_local_date < v_today
    or p_requested_local_date >= (v_today + interval '1 month')::date then
    raise exception using errcode = 'TT409', message = 'viewing date outside booking window';
  end if;
  perform 1 from public.rental_listings
    where id = p_rental_listing_id and status = 'published' and published_at is not null
    for share;
  if not found then
    raise exception using errcode = 'TT409', message = 'property unavailable';
  end if;
  select * into v_schedule from public.property_viewing_schedules
    where rental_listing_id = p_rental_listing_id for share;
  if not found then
    raise exception using errcode = 'TT409', message = 'property calendar not configured';
  end if;
  select (entry->>'available')::boolean into v_available
    from jsonb_array_elements(v_schedule.date_overrides) entry
    where entry->>'date' = p_requested_local_date::text;
  v_available := coalesce(v_available, extract(isodow from p_requested_local_date)::integer = any(v_schedule.open_weekdays));
  if not v_available then
    raise exception using errcode = 'TT409', message = 'viewing date unavailable';
  end if;
  insert into public.showing_requests(
    id, rental_listing_id, property_slug, property_title, property_address,
    name, phone, email, requested_start_at, requested_local_date, requested_local_time,
    requested_timezone, notes, status, accepted_at, created_at, updated_at
  ) values (
    p_request_id, p_rental_listing_id, p_property_slug, p_property_title, p_property_address,
    p_name, p_phone, p_email, null, p_requested_local_date, null,
    'America/Vancouver', p_notes, 'accepted', p_created_at, p_created_at, p_created_at
  );
  if p_notification_payload is not null then
    insert into public.owner_notification_deliveries(
      notification_key, kind, tenant_id, payload, status, scheduled_for, next_attempt_at
    ) values (
      'showing-confirmation:' || p_request_id::text, 'showing_confirmation', null,
      p_notification_payload, 'scheduled', p_created_at, p_created_at
    );
  end if;
  return p_request_id;
end;
$$;
revoke all on function public.reserve_viewing_appointment(uuid, uuid, text, text, text, text, text, text, timestamptz, date, time, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.reserve_viewing_appointment(uuid, uuid, text, text, text, text, text, text, timestamptz, date, time, text, timestamptz, jsonb) to service_role;

-- Prior conversions already required an administrator-confirmed signed PDF.
-- Preserve those confirmations; unproven legacy links remain unverified.
alter table public.client_applications
  add column signed_agreement_confirmed_at timestamptz null;
update public.client_applications
set signed_agreement_confirmed_at = converted_at
where converted_tenant_id is not null and converted_lease_file_id is not null;

create or replace function public.admin_link_client_tenant(
  p_client_user_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid;
  v_previous_tenant_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if not exists (
    select 1 from public.admin_profiles
    where user_id = p_actor_id and is_active
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;

  perform 1 from public.client_profiles
  where user_id = p_client_user_id and is_active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active client profile not found';
  end if;

  perform 1 from auth.users
  where id = p_client_user_id and email_confirmed_at is not null
  for update;
  if not found then
    raise exception using errcode = 'TT409', message = 'verified client email required';
  end if;

  if exists (
    select 1 from public.admin_profiles
    where user_id = p_client_user_id and is_active
  ) then
    raise exception using errcode = 'TT409', message = 'administrator identities cannot be linked as clients';
  end if;

  perform 1 from public.tenants
  where id = p_tenant_id and is_active and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'current tenant not found';
  end if;

  if not exists (
    select 1 from public.client_applications application
    join public.client_application_lease_files lease
      on lease.id = application.converted_lease_file_id
      and lease.application_id = application.id
    where application.owner_user_id = p_client_user_id
      and application.converted_tenant_id = p_tenant_id
      and application.status = 'approved'
      and application.signed_agreement_confirmed_at is not null
      and application.deleted_at is null
      and lease.deleted_at is null
  ) then
    raise exception using errcode = 'TT409', message = 'confirmed signed lease required to link user as tenant';
  end if;

  select id, tenant_id into v_link_id, v_previous_tenant_id
  from public.client_tenant_links
  where client_user_id = p_client_user_id
    and archived_at is null
  for update;
  if v_previous_tenant_id = p_tenant_id then
    return v_link_id;
  end if;

  if v_previous_tenant_id is not null then
    update public.client_tenant_links
    set archived_at = now(), archived_by = p_actor_id
    where id = v_link_id;

    insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
    values (
      p_actor_id,
      'client.tenant_unlinked',
      'client_profile',
      p_client_user_id::text,
      jsonb_build_object('tenantId', v_previous_tenant_id)
    );
  end if;

  insert into public.client_tenant_links(client_user_id, tenant_id, linked_by)
  values (p_client_user_id, p_tenant_id, p_actor_id)
  returning id into v_link_id;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'client.tenant_linked',
    'client_profile',
    p_client_user_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'tenantId', p_tenant_id,
      'previousTenantId', v_previous_tenant_id
    ))
  );

  return v_link_id;
end;
$$;


create or replace function public.convert_approved_application_to_tenant(
  p_application_id uuid,
  p_tenant_payload jsonb,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.client_applications;
  v_lease_file_id uuid;
  v_tenant jsonb;
  v_tenant_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if not exists (
    select 1 from public.admin_profiles where user_id = p_actor_id and is_active
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;

  select * into v_application
  from public.client_applications
  where id = p_application_id and deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'application not found';
  end if;
  if v_application.status <> 'approved' then
    raise exception using errcode = 'TT409', message = 'application must be approved first';
  end if;
  if v_application.converted_tenant_id is not null then
    return v_application.converted_tenant_id;
  end if;

  select id into v_lease_file_id
  from public.client_application_lease_files
  where application_id = p_application_id
    and superseded_at is null
    and deleted_at is null
  for update;
  if v_lease_file_id is null then
    raise exception using errcode = 'TT409', message = 'signed tenancy agreement required';
  end if;

  v_tenant := public.save_tenant(null, p_tenant_payload, null, p_actor_id);
  v_tenant_id := (v_tenant->>'id')::uuid;

  update public.client_applications
  set converted_tenant_id = v_tenant_id,
      converted_lease_file_id = v_lease_file_id,
      signed_agreement_confirmed_at = now(),
      converted_at = now(),
      converted_by = p_actor_id,
      updated_at = now()
  where id = p_application_id;

  perform public.admin_link_client_tenant(
    v_application.owner_user_id,
    v_tenant_id,
    p_actor_id
  );

  insert into public.client_application_audit_events(
    application_id, actor_user_id, actor_type, action, request_context
  ) values (
    p_application_id,
    p_actor_id,
    'staff',
    'application.converted_to_tenant',
    jsonb_build_object('tenantId', v_tenant_id, 'leaseFileId', v_lease_file_id, 'signedAgreementConfirmed', true)
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.convert_approved_application_to_tenant(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_approved_application_to_tenant(uuid, jsonb, uuid)
  to service_role;
