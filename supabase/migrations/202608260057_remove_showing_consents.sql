-- Viewing bookings no longer collect explicit disclosure acknowledgements or
-- scheduling consent. Preserve historical timestamps, but leave both columns
-- null for new bookings.

alter table public.showing_requests
  alter column consent_at drop not null,
  alter column has_pets drop not null,
  alter column has_pets drop default,
  alter column needs_parking drop not null,
  alter column needs_parking drop default;

comment on column public.showing_requests.representation_disclosure_acknowledged_at is
  'Legacy disclosure acknowledgement timestamp. Historical values are preserved; new viewing bookings leave this null.';

comment on column public.showing_requests.consent_at is
  'Legacy scheduling consent timestamp. Historical values are preserved; new viewing bookings leave this null.';

comment on column public.showing_requests.has_pets is
  'Legacy viewing-request field. Historical values are preserved; new bookings leave this null and any volunteered pet details live only in notes.';

comment on column public.showing_requests.needs_parking is
  'Legacy viewing-request field. Historical values are preserved; new viewing bookings leave this null.';

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
