\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000600');
insert into public.admin_profiles(user_id, display_name)
values ('00000000-0000-4000-8000-000000000600', 'Calendar Test Admin');
insert into public.rental_properties(id, property_type, street_address, city, province_code, created_by, updated_by)
select id, 'condo', address, 'Vancouver', 'BC',
  '00000000-0000-4000-8000-000000000600', '00000000-0000-4000-8000-000000000600'
from (values
  ('00000000-0000-4000-8000-000000000601'::uuid, '1 Calendar Test Street'),
  ('00000000-0000-4000-8000-000000000602'::uuid, '2 Calendar Test Street')
) fixture(id, address);
insert into public.rental_listings(
  id, property_id, slug, title, address_line, city, monthly_rent_cents, bedrooms, bathrooms,
  description, status, published_at, created_by, updated_by
)
select id, id, slug, 'Calendar Test', '1 Test Street', 'Vancouver', 100000, 1, 1,
  'Synthetic calendar test listing', 'published', now(),
  '00000000-0000-4000-8000-000000000600', '00000000-0000-4000-8000-000000000600'
from (values
  ('00000000-0000-4000-8000-000000000601'::uuid, 'calendar-test-one'),
  ('00000000-0000-4000-8000-000000000602'::uuid, 'calendar-test-two')
) fixture(id, slug);
insert into public.property_viewing_schedules(rental_listing_id, open_weekdays)
values ('00000000-0000-4000-8000-000000000601', array[1,2,3,4,5,6,7]),
       ('00000000-0000-4000-8000-000000000602', array[1,2,3,4,5,6,7]);

do $$
declare
  v_date date := (now() at time zone 'America/Vancouver')::date + 1;
  v_property uuid;
  v_version timestamptz;
  v_count integer;
  v_draft jsonb;
  v_rental_version timestamptz;
  v_revision uuid;
begin
  -- Repeat a property/date twice, and book the same date on another property.
  foreach v_property in array array[
    '00000000-0000-4000-8000-000000000601'::uuid,
    '00000000-0000-4000-8000-000000000601'::uuid,
    '00000000-0000-4000-8000-000000000602'::uuid
  ] loop
    perform public.reserve_viewing_appointment(
      gen_random_uuid(), v_property, 'calendar-test', 'Test home', '1 Test Street',
      'Visitor', '6045550100', 'visitor@example.test', null, v_date, null,
      '', now(), null
    );
  end loop;
  select count(*) into v_count from public.showing_requests
    where rental_listing_id in ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602')
      and requested_local_date = v_date and requested_start_at is null and requested_local_time is null;
  if v_count <> 3 then raise exception 'date bookings were blocked or invented appointment times'; end if;

  select updated_at into v_version from public.property_viewing_schedules
    where rental_listing_id = '00000000-0000-4000-8000-000000000601';
  update public.property_viewing_schedules
    set date_overrides = jsonb_build_array(jsonb_build_object('date', v_date, 'available', false))
    where rental_listing_id = '00000000-0000-4000-8000-000000000601';
  if (select updated_at from public.property_viewing_schedules where rental_listing_id = '00000000-0000-4000-8000-000000000601') <= v_version
    then raise exception 'calendar version did not advance'; end if;
  begin
    perform public.reserve_viewing_appointment(
      gen_random_uuid(), '00000000-0000-4000-8000-000000000601', 'calendar-test', 'Test home', '1 Test Street',
      'Visitor', '6045550101', 'visitor2@example.test', null, v_date, null, '', now(), null
    );
    raise exception 'closed date accepted a booking';
  exception when sqlstate 'TT409' then null;
  end;
  perform public.reserve_viewing_appointment(
    gen_random_uuid(), '00000000-0000-4000-8000-000000000602', 'calendar-test', 'Test home', '1 Test Street',
    'Visitor', '6045550102', 'visitor3@example.test', null, v_date, null, '', now(), null
  );
  select updated_at into v_version from public.property_viewing_schedules
    where rental_listing_id = '00000000-0000-4000-8000-000000000602';
  v_draft := public.save_property_viewing_draft(
    '00000000-0000-4000-8000-000000000602',
    '{"timezone":"America/Vancouver","openWeekdays":[],"dateOverrides":[]}'::jsonb,
    null, v_version, '00000000-0000-4000-8000-000000000600'
  );
  if (v_draft->>'updated_at')::timestamptz <> v_version
    or (select open_weekdays from public.property_viewing_schedules where rental_listing_id = '00000000-0000-4000-8000-000000000602') <> array[1,2,3,4,5,6,7]
    then raise exception 'private draft changed the live calendar'; end if;
  select updated_at into v_rental_version from public.rental_listings
    where id = '00000000-0000-4000-8000-000000000602';
  begin
    -- The fixture lacks required publication fields/images.
    perform public.publish_rental_with_viewing_dates(
      '00000000-0000-4000-8000-000000000602', v_rental_version,
      '00000000-0000-4000-8000-000000000600', '[]'::jsonb,
      (v_draft->>'draft_updated_at')::timestamptz, v_version
    );
    raise exception 'invalid property was published';
  exception when sqlstate '23514' then null;
  end;
  if (select updated_at from public.rental_listings where id = '00000000-0000-4000-8000-000000000602') <> v_rental_version
    or (select updated_at from public.property_viewing_schedules where rental_listing_id = '00000000-0000-4000-8000-000000000602') <> v_version
    then raise exception 'failed publication changed a public version'; end if;
  insert into public.rental_listing_revisions(rental_listing_id, content_snapshot, action, created_by)
  values ('00000000-0000-4000-8000-000000000602', '{}'::jsonb, 'publish',
    '00000000-0000-4000-8000-000000000600') returning id into v_revision;
  update public.rental_listings set published_revision_id = v_revision
    where id = '00000000-0000-4000-8000-000000000602';
  select updated_at into v_rental_version from public.rental_listings
    where id = '00000000-0000-4000-8000-000000000602';
  -- Deletion is version-checked and removes published revisions and calendar,
  -- while existing bookings keep their property/date/contact snapshots.
  begin
    perform public.delete_rental_listing('00000000-0000-4000-8000-000000000602',
      v_rental_version - interval '1 second', '00000000-0000-4000-8000-000000000600');
    raise exception 'stale property deletion succeeded';
  exception when sqlstate 'TT409' then null;
  end;
  perform public.delete_rental_listing('00000000-0000-4000-8000-000000000602',
    v_rental_version, '00000000-0000-4000-8000-000000000600');
  if exists (select 1 from public.rental_listings where id = '00000000-0000-4000-8000-000000000602')
    or exists (select 1 from public.property_viewing_schedules where rental_listing_id = '00000000-0000-4000-8000-000000000602')
    or exists (select 1 from public.rental_listing_revisions where rental_listing_id = '00000000-0000-4000-8000-000000000602')
    then raise exception 'deleted property is still stored'; end if;
  if (select count(*) from public.showing_requests where rental_listing_id is null
    and property_slug = 'calendar-test' and requested_local_date = v_date) <> 2
    then raise exception 'deletion lost booking history'; end if;
  if has_table_privilege('anon', 'public.property_viewing_schedules', 'select')
    or has_table_privilege('authenticated', 'public.property_viewing_schedules', 'select')
    then raise exception 'private calendars exposed'; end if;
end;
$$;
rollback;
