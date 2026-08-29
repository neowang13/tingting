-- Administrators configure one global viewing calendar. Specific-date
-- overrides replace the matching weekly times; an empty override closes a day.

create table public.viewing_schedules (
  id smallint primary key default 1 check (id = 1),
  timezone text not null default 'America/Vancouver'
    check (timezone = 'America/Vancouver'),
  weekly_slots jsonb not null default '[]'::jsonb
    check (jsonb_typeof(weekly_slots) = 'array'),
  date_overrides jsonb not null default '[]'::jsonb
    check (jsonb_typeof(date_overrides) = 'array'),
  updated_at timestamptz not null default now()
);

-- Production starts closed. An administrator must publish the real weekly
-- schedule before any visitor can auto-confirm a viewing.
insert into public.viewing_schedules(id, weekly_slots)
values (1, '[]'::jsonb);

alter table public.viewing_schedules enable row level security;
revoke all on public.viewing_schedules from anon, authenticated;
grant all on public.viewing_schedules to service_role;

comment on table public.viewing_schedules is
  'Singleton global viewing schedule; weekly slots use ISO weekdays 1-7 and date overrides replace weekly times.';

-- Accepted appointments reserve a start time globally, regardless of rental.
-- Cancelled, declined, and reschedule-requested rows do not block that time.
do $$
declare
  duplicate_starts text;
begin
  select string_agg(requested_start_at::text, ', ' order by requested_start_at)
  into duplicate_starts
  from (
    select requested_start_at
    from public.showing_requests
    where status = 'accepted'
    group by requested_start_at
    having count(*) > 1
  ) duplicates;

  if duplicate_starts is not null then
    raise exception 'Cannot enforce unique viewing spots; duplicate accepted starts exist: %', duplicate_starts
      using hint = 'Keep one accepted request per start time. Change the others to reschedule_requested and clear accepted_at, then rerun this migration.';
  end if;
end
$$;

create unique index showing_requests_one_accepted_start_idx
  on public.showing_requests(requested_start_at)
  where status = 'accepted';

comment on index public.showing_requests_one_accepted_start_idx is
  'Prevents two accepted showing requests from reserving the same global viewing spot.';

-- Viewing bookings no longer collect these legacy fields. Preserve historical
-- values while allowing new bookings to leave them unknown/null.
alter table public.showing_requests
  alter column consent_at drop not null,
  alter column has_pets drop not null,
  alter column has_pets drop default,
  alter column needs_parking drop not null,
  alter column needs_parking drop default;

alter table public.owner_notification_deliveries
  drop constraint if exists owner_notification_deliveries_kind_check;
alter table public.owner_notification_deliveries
  add constraint owner_notification_deliveries_kind_check check (
    kind in (
      'tenant_upload',
      'weekly_tenant_summary',
      'daily_overdue_rent_summary',
      'showing_confirmation'
    )
  );

-- The appointment and its administrator-email outbox record commit together.
-- Only the service role may invoke this function.
create or replace function public.reserve_viewing_appointment(
  p_request_id uuid,
  p_rental_listing_id uuid,
  p_property_slug text,
  p_property_title text,
  p_property_address text,
  p_name text,
  p_phone text,
  p_email text,
  p_requested_start_at timestamptz,
  p_requested_local_date date,
  p_requested_local_time time,
  p_notes text,
  p_created_at timestamptz,
  p_notification_payload jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.showing_requests (
    id,
    rental_listing_id,
    property_slug,
    property_title,
    property_address,
    name,
    phone,
    email,
    requested_start_at,
    requested_local_date,
    requested_local_time,
    requested_timezone,
    notes,
    status,
    accepted_at,
    created_at,
    updated_at
  ) values (
    p_request_id,
    p_rental_listing_id,
    p_property_slug,
    p_property_title,
    p_property_address,
    p_name,
    p_phone,
    p_email,
    p_requested_start_at,
    p_requested_local_date,
    p_requested_local_time,
    'America/Vancouver',
    p_notes,
    'accepted',
    p_created_at,
    p_created_at,
    p_created_at
  );

  if p_notification_payload is not null then
    insert into public.owner_notification_deliveries (
      notification_key,
      kind,
      tenant_id,
      payload,
      status,
      scheduled_for,
      next_attempt_at
    ) values (
      'showing-confirmation:' || p_request_id::text,
      'showing_confirmation',
      null,
      p_notification_payload,
      'scheduled',
      p_created_at,
      p_created_at
    );
  end if;

  return p_request_id;
end;
$$;

revoke all on function public.reserve_viewing_appointment(
  uuid, uuid, text, text, text, text, text, text,
  timestamptz, date, time, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.reserve_viewing_appointment(
  uuid, uuid, text, text, text, text, text, text,
  timestamptz, date, time, text, timestamptz, jsonb
) to service_role;
