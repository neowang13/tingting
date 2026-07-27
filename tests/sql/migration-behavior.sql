\set ON_ERROR_STOP on

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into public.admin_profiles(user_id, display_name)
values ('00000000-0000-4000-8000-000000000001', 'Migration Test Admin');

insert into public.site_sections(
  key, display_name, sort_order, schema_version, draft_content, published_content, updated_by
) values (
  'header',
  'Header',
  1,
  1,
  '{"brandName":"TING TING XU"}',
  '{"brandName":"OLD"}',
  '00000000-0000-4000-8000-000000000001'
);

do $$
declare
  v_admin uuid := '00000000-0000-4000-8000-000000000001';
  v_section public.site_sections;
  v_template jsonb;
  v_template_id uuid;
  v_tenant jsonb;
  v_tenant_id uuid;
  v_schedule_id uuid;
  v_run jsonb;
  v_batch jsonb;
  v_event public.notification_events;
  v_claim uuid;
  v_result jsonb;
  v_maintenance jsonb;
begin
  select * into v_section from public.site_sections where key = 'header';
  v_result := public.publish_site_section_with_media('header', v_section.updated_at, v_admin, '[]');
  if v_result->'published_content'->>'brandName' <> 'TING TING XU' then
    raise exception 'content publish transaction failed';
  end if;
  if not exists (select 1 from public.audit_events where action = 'section.published') then
    raise exception 'publish audit missing';
  end if;

  v_template := public.save_notification_template(
    null,
    jsonb_build_object(
      'name', 'Behavioral email template',
      'channel', 'email',
      'subjectTemplate', 'Rent reminder for {{property}}',
      'bodyTemplate', 'Hi {{tenant_name}}, rent is due {{due_date}}.',
      'isActive', true
    ),
    null,
    v_admin
  );
  v_template_id := (v_template->>'id')::uuid;

  update public.system_settings
  set value = jsonb_build_object(
        'paused', true,
        'leadDays', 3,
        'localTime', '09:00',
        'timezone', 'America/Vancouver',
        'emailTemplateId', v_template_id
      ),
      updated_at = now()
  where key = 'reminders';

  v_tenant := public.save_tenant(
    null,
    jsonb_build_object(
      'fullName', 'Behavioral Tenant',
      'propertyLabel', 'Test Property',
      'unitLabel', '1',
      'email', 'behavior@example.com',
      'phoneE164', null,
      'preferredChannels', jsonb_build_array('email'),
      'emailContactStatus', 'allowed',
      'smsContactStatus', 'unconfirmed',
      'emailContactStatusReason', 'behavioral fixture',
      'smsContactStatusReason', null,
      'emailContactStatusSource', 'test',
      'smsContactStatusSource', null,
      'contactPermissionNote', 'behavioral fixture',
      'contactPermissionUpdatedAt', now(),
      'timezone', 'America/Vancouver',
      'internalNotes', null,
      'isActive', true
    ),
    null,
    v_admin
  );
  v_tenant_id := (v_tenant->>'id')::uuid;
  if not exists (select 1 from public.audit_events where action = 'tenant.created') then
    raise exception 'tenant audit missing';
  end if;

  select id into v_schedule_id
  from public.reminder_schedules
  where tenant_id = v_tenant_id;
  update public.reminder_schedules
  set next_run_at = now() - interval '1 minute'
  where id = v_schedule_id;

  v_run := public.materialize_due_reminders(now(), true);
  if v_run->>'status' <> 'paused' then raise exception 'force pause failed'; end if;

  update public.system_settings
  set value = jsonb_set(value, '{paused}', 'false'::jsonb), updated_at = now()
  where key = 'reminders';
  v_run := public.materialize_due_reminders(now(), false);
  if (v_run->>'occurrences_created')::integer <> 1 then
    raise exception 'scheduled materialization failed: %', v_run;
  end if;

  update public.reminder_schedules
  set next_run_at = now() - interval '40 days'
  where id = v_schedule_id;
  v_run := public.materialize_due_reminders(now(), false);
  if not exists (
    select 1 from public.notification_events
    where schedule_id = v_schedule_id
      and status = 'expired'
      and render_error_code = 'occurrence_outside_grace_period'
      and destination is null
  ) then raise exception '24-hour grace policy failed'; end if;

  v_batch := public.create_notification_batch(
    jsonb_build_object(
      'requestId', gen_random_uuid(),
      'selectionMode', 'tenant_ids',
      'tenantIds', jsonb_build_array(v_tenant_id),
      'channels', jsonb_build_array('email'),
      'emailTemplateId', v_template_id
    ),
    v_admin
  );
  v_batch := public.confirm_notification_batch(
    (v_batch->>'id')::uuid,
    'behavioral-confirmation-key',
    (v_batch->>'eligible_count')::integer,
    v_admin
  );
  if v_batch->>'status' <> 'confirmed' then raise exception 'batch confirm failed'; end if;

  v_claim := gen_random_uuid();
  select * into v_event from public.claim_notification_events(now(), 1, v_claim) limit 1;
  v_result := public.begin_notification_attempt(v_event.id, v_claim);
  if v_result->>'status' <> 'processing' then raise exception 'attempt begin failed'; end if;
  v_result := public.fail_notification_attempt(
    v_event.id, v_claim, 'TRANSIENT_BEHAVIORAL_TEST', true, false
  );
  if v_result->>'status' <> 'scheduled' then raise exception 'retry transition failed'; end if;

  update public.notification_events set next_attempt_at = now() where id = v_event.id;
  v_claim := gen_random_uuid();
  select * into v_event from public.claim_notification_events(now(), 1, v_claim) limit 1;
  perform public.begin_notification_attempt(v_event.id, v_claim);
  perform public.mark_provider_request_started(v_event.id, v_claim);
  v_result := public.complete_notification_attempt(
    v_event.id, v_claim, 'mock_behavioral', 'sent', 'mock:accepted'
  );
  if v_result->>'status' <> 'sent' then raise exception 'attempt completion failed'; end if;

  update public.notification_events
  set created_at = now() - interval '100 days',
      destination = 'private@example.com',
      rendered_subject = 'Private subject',
      rendered_body = 'Private body'
  where id = v_event.id;
  v_result := public.apply_data_retention(now(), v_admin);
  if not exists (
    select 1 from public.notification_events
    where id = v_event.id
      and destination is null
      and rendered_body is null
      and destination_hash is not null
      and rendered_content_hash is not null
  ) then raise exception '90-day notification redaction failed'; end if;

  v_maintenance := public.run_daily_maintenance(now());
  if v_maintenance->>'status' <> 'completed' then raise exception 'daily maintenance failed'; end if;
  v_maintenance := public.run_daily_maintenance(now());
  if v_maintenance->>'status' <> 'already_completed' then
    raise exception 'daily maintenance idempotency failed';
  end if;

  if has_table_privilege('anon', 'public.tenants', 'select')
    or has_table_privilege('authenticated', 'public.notification_events', 'select')
    or has_table_privilege('anon', 'public.automation_service_accounts', 'select')
    or has_table_privilege('authenticated', 'public.tenant_import_rows', 'select')
  then raise exception 'private table grants are too broad'; end if;
  if has_function_privilege(
      'anon',
      'public.complete_automation_idempotency_key(uuid,uuid,integer,jsonb,text,text,timestamptz)',
      'execute'
    )
    or has_function_privilege(
      'authenticated',
      'public.get_tenant_import_for_automation(uuid)',
      'execute'
    )
    or has_function_privilege(
      'anon',
      'public.execute_automation_resource_confirmation(uuid,uuid,uuid,timestamptz,jsonb)',
      'execute'
    )
  then raise exception 'automation function grants are too broad'; end if;
  if not has_function_privilege(
      'service_role',
      'public.execute_automation_resource_confirmation(uuid,uuid,uuid,timestamptz,jsonb)',
      'execute'
    )
  then raise exception 'service role automation function grant is missing'; end if;
  if not has_table_privilege('anon', 'public.public_site_sections', 'select')
    or not has_table_privilege('authenticated', 'public.public_rental_listings', 'select')
  then raise exception 'published projection grants are missing'; end if;

  raise notice 'migration behavior suite passed';
end
$$;

do $$
declare
  v_admin uuid := '00000000-0000-4000-8000-000000000001';
  v_media uuid := gen_random_uuid();
  v_payload jsonb;
  v_saved jsonb;
  v_published jsonb;
  v_private_save jsonb;
  v_public_rent integer;
  v_listing_id uuid;
begin
  insert into public.media_assets(
    id, draft_storage_path, original_filename, mime_type, byte_size,
    width, height, alt_text, created_by
  ) values (
    v_media, 'tests/rental-v2.jpg', 'rental-v2.jpg', 'image/jpeg', 1024,
    1200, 800, 'Synthetic Listing V2 migration test image', v_admin
  );

  v_payload := jsonb_build_object(
    'slug', 'seasons-1703-migration-test',
    'title', 'Seasons 1703 Migration Test',
    'property', jsonb_build_object(
      'id', null, 'expectedVersion', null, 'propertyType', 'condo',
      'buildingName', 'Seasons', 'unitNumber', '1703',
      'streetAddress', '5028 Kwantlen Street',
      'neighbourhood', 'Lansdowne Village', 'city', 'Richmond',
      'provinceCode', 'BC', 'postalCode', 'V6X 4K2', 'countryCode', 'CA'
    ),
    'pricing', jsonb_build_object('monthlyRentCents', 260000, 'currencyCode', 'CAD'),
    'layout', jsonb_build_object(
      'bedrooms', 2, 'bathrooms', 2, 'denCount', 0,
      'squareFeet', 838, 'furnishedStatus', 'unfurnished'
    ),
    'availability', jsonb_build_object(
      'status', 'available_now', 'availableOn', null,
      'leaseType', 'fixed_term', 'minimumLeaseMonths', 12
    ),
    'parking', jsonb_build_object(
      'available', true, 'type', 'underground', 'stalls', 1,
      'included', true, 'visitorAvailable', true, 'notes', null
    ),
    'storage', jsonb_build_object(
      'available', true, 'lockers', 1, 'included', true, 'notes', null
    ),
    'pets', jsonb_build_object(
      'status', 'considered', 'catsAllowed', true, 'dogsAllowed', true,
      'maxCount', 2, 'sizeLimitLbs', null, 'notes', null
    ),
    'smokingPolicy', 'not_allowed',
    'applicationRequirements', jsonb_build_object(
      'creditCheckRequired', true, 'referencesRequired', true
    ),
    'amenityCodes', jsonb_build_array('balcony', 'dishwasher', 'fitness_room', 'public_transit'),
    'includedUtilityCodes', jsonb_build_array('water', 'hot_water', 'gas'),
    'fees', jsonb_build_array(jsonb_build_object(
      'feeType', 'security_deposit', 'label', null, 'amountCents', 130000,
      'frequency', 'one_time', 'refundable', true, 'required', true,
      'notes', null, 'sortOrder', 0
    )),
    'contact', jsonb_build_object(
      'mode', 'site_default', 'name', null, 'email', null, 'phone', null
    ),
    'utilitiesNotes', null,
    'amenityNotes', null,
    'description', 'Synthetic complete Listing V2 migration behavior fixture.',
    'images', jsonb_build_array(jsonb_build_object(
      'mediaAssetId', v_media, 'sortOrder', 0, 'isCover', true
    ))
  );

  v_saved := public.save_rental_listing_v2(null, v_payload, null, v_admin);
  v_listing_id := (v_saved->>'id')::uuid;
  if jsonb_array_length(v_saved->'fees') <> 1
    or array_length(array(select jsonb_array_elements_text(v_saved->'amenity_codes')), 1) <> 4
  then raise exception 'v2 aggregate save omitted child records'; end if;

  v_published := public.set_rental_status_with_media(
    v_listing_id,
    'publish',
    (v_saved->>'updated_at')::timestamptz,
    v_admin,
    jsonb_build_array(jsonb_build_object(
      'id', v_media,
      'path', 'rentals/tests/rental-v2.jpg',
      'url', 'https://example.test/rentals/rental-v2.jpg'
    ))
  );
  select monthly_rent_cents into v_public_rent
  from public.public_rental_listings_v2
  where id = v_listing_id;
  if v_public_rent <> 260000 then raise exception 'v2 publication projection failed'; end if;

  v_payload := jsonb_set(v_payload, '{pricing,monthlyRentCents}', '275000'::jsonb);
  v_payload := jsonb_set(v_payload, '{property,id}', v_published->'property'->'id');
  v_payload := jsonb_set(v_payload, '{property,expectedVersion}', v_published->'property'->'updatedAt');
  v_private_save := public.save_rental_listing_v2(
    v_listing_id,
    v_payload,
    (v_published->>'updated_at')::timestamptz,
    v_admin
  );
  select monthly_rent_cents into v_public_rent
  from public.public_rental_listings_v2
  where id = v_listing_id;
  if v_public_rent <> 260000 then
    raise exception 'private v2 save changed immutable public output';
  end if;
  if v_private_save->>'draft_digest' = v_private_save->>'published_source_digest' then
    raise exception 'unpublished changes digest was not detected';
  end if;

  begin
    perform public.save_rental_listing_v2(
      v_listing_id,
      jsonb_set(v_payload, '{pricing,monthlyRentCents}', '300000'::jsonb),
      (v_published->>'updated_at')::timestamptz - interval '1 second',
      v_admin
    );
    raise exception 'stale aggregate save unexpectedly succeeded';
  exception when sqlstate 'TT409' then
    null;
  end;
  if (select monthly_rent_cents from public.rental_listings where id = v_listing_id) <> 275000 then
    raise exception 'stale save changed aggregate state';
  end if;

  if has_table_privilege('anon', 'public.rental_properties', 'select')
    or has_table_privilege('authenticated', 'public.rental_listing_fees', 'select')
    or has_function_privilege(
      'anon',
      'public.save_rental_listing_v2(uuid,jsonb,timestamp with time zone,uuid)',
      'execute'
    )
  then raise exception 'v2 private data or mutation grant is too broad'; end if;
  if not has_table_privilege('anon', 'public.public_rental_listings_v2', 'select') then
    raise exception 'v2 public projection grant is missing';
  end if;

  raise notice 'rental listing v2 behavior suite passed';
end
$$;
