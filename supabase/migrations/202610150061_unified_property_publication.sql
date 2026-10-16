-- Keep date edits private until the property's single Publish action succeeds.
alter table public.property_viewing_schedules
  add column draft_schedule jsonb null,
  add column draft_updated_at timestamptz null,
  add constraint property_viewing_draft_pair_check check (
    (draft_schedule is null and draft_updated_at is null)
    or (draft_schedule is not null and jsonb_typeof(draft_schedule) = 'object' and draft_updated_at is not null)
  );

-- Saving a private calendar draft must not change the live calendar's version.
create or replace function public.bump_property_viewing_schedule_version()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.timezone is distinct from old.timezone
    or new.open_weekdays is distinct from old.open_weekdays
    or new.date_overrides is distinct from old.date_overrides
    or new.updated_at is distinct from old.updated_at then
    new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  else
    new.updated_at := old.updated_at;
  end if;
  return new;
end;
$$;

create function public.save_property_viewing_draft(
  p_id uuid, p_schedule jsonb, p_expected_draft_updated_at timestamptz,
  p_expected_published_updated_at timestamptz, p_actor_id uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_schedule public.property_viewing_schedules;
begin
  if auth.role() <> 'service_role' or not exists (
    select 1 from public.admin_profiles where user_id = p_actor_id and is_active
  ) then raise exception using errcode = '42501', message = 'active administrator required'; end if;
  if p_schedule->>'timezone' is distinct from 'America/Vancouver'
    or jsonb_typeof(p_schedule->'openWeekdays') is distinct from 'array'
    or jsonb_typeof(p_schedule->'dateOverrides') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'invalid viewing calendar';
  end if;
  -- Consistent lock order with publication: property first, calendar second.
  perform 1 from public.rental_listings where id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'property not found'; end if;
  select * into v_schedule from public.property_viewing_schedules where rental_listing_id = p_id for update;
  if not found then
    if p_expected_draft_updated_at is not null or p_expected_published_updated_at is not null then
      raise exception using errcode = 'TT409', message = 'viewing calendar changed';
    end if;
    insert into public.property_viewing_schedules(rental_listing_id) values (p_id) returning * into v_schedule;
  elsif v_schedule.draft_updated_at is distinct from p_expected_draft_updated_at
    or v_schedule.updated_at is distinct from p_expected_published_updated_at then
    raise exception using errcode = 'TT409', message = 'viewing calendar changed';
  end if;
  update public.property_viewing_schedules
  set draft_schedule = p_schedule,
      draft_updated_at = greatest(clock_timestamp(), coalesce(v_schedule.draft_updated_at + interval '1 microsecond', '-infinity'::timestamptz))
  where rental_listing_id = p_id returning * into v_schedule;
  return to_jsonb(v_schedule);
end;
$$;
revoke all on function public.save_property_viewing_draft(uuid, jsonb, timestamptz, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.save_property_viewing_draft(uuid, jsonb, timestamptz, timestamptz, uuid) to service_role;

-- The rental's published snapshot and its public calendar change in one transaction.
-- A validation/version error rolls back both, leaving the private edits intact.
create function public.publish_rental_with_viewing_dates(
  p_id uuid, p_expected_updated_at timestamptz, p_actor_id uuid, p_media jsonb,
  p_expected_draft_updated_at timestamptz, p_expected_published_updated_at timestamptz
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_schedule public.property_viewing_schedules;
  v_rental jsonb;
begin
  if auth.role() <> 'service_role' or not exists (
    select 1 from public.admin_profiles where user_id = p_actor_id and is_active
  ) then raise exception using errcode = '42501', message = 'active administrator required'; end if;
  perform 1 from public.rental_listings where id = p_id and updated_at = p_expected_updated_at for update;
  if not found then raise exception using errcode = 'TT409', message = 'property changed'; end if;
  select * into v_schedule from public.property_viewing_schedules where rental_listing_id = p_id for update;
  if not found or v_schedule.draft_schedule is null
    or v_schedule.draft_updated_at is distinct from p_expected_draft_updated_at
    or v_schedule.updated_at is distinct from p_expected_published_updated_at then
    raise exception using errcode = 'TT409', message = 'viewing calendar changed';
  end if;
  v_rental := public.set_rental_status_with_media(p_id, 'publish', p_expected_updated_at, p_actor_id, p_media);
  update public.property_viewing_schedules
  set timezone = v_schedule.draft_schedule->>'timezone',
      open_weekdays = array(select jsonb_array_elements_text(v_schedule.draft_schedule->'openWeekdays')::integer),
      date_overrides = v_schedule.draft_schedule->'dateOverrides',
      updated_at = clock_timestamp()
  where rental_listing_id = p_id returning * into v_schedule;
  return jsonb_build_object('rental', v_rental, 'viewing_schedule', to_jsonb(v_schedule));
end;
$$;
revoke all on function public.publish_rental_with_viewing_dates(uuid, timestamptz, uuid, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.publish_rental_with_viewing_dates(uuid, timestamptz, uuid, jsonb, timestamptz, timestamptz) to service_role;
