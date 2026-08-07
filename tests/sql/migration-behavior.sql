\set ON_ERROR_STOP on

insert into auth.users(id) values ('00000000-0000-4000-8000-000000000001');
insert into public.admin_profiles(user_id, display_name)
values ('00000000-0000-4000-8000-000000000001', 'Migration Test Admin');

do $$
begin
  if exists (select 1 from public.site_sections where key = 'service_renovation') then
    raise exception 'legacy Renovation CMS section still exists';
  end if;
  if not exists (
    select 1
    from public.site_sections
    where key = 'service_trade_services'
      and display_name = 'Trade services'
      and schema_version >= 2
      and draft_content->>'eyebrow' = 'TRADE SERVICES'
      and published_content->>'eyebrow' = 'TRADE SERVICES'
  ) then
    raise exception 'Trade Services CMS migration did not complete';
  end if;
  if not exists (
    select 1
    from public.site_sections
    where key = 'service_rental_management'
      and display_name = 'Residential & commercial rental management'
      and schema_version >= 2
      and jsonb_array_length(draft_content->'managementTypes') = 2
      and jsonb_array_length(published_content->'managementTypes') = 2
      and draft_content #>> '{managementTypes,0,title}' = 'Residential Rental Management'
      and draft_content #>> '{managementTypes,1,title}' = 'Commercial Rental Management'
  ) then
    raise exception 'residential/commercial Rental Management CMS migration did not complete';
  end if;
  if exists (
    select 1 from public.site_sections
    where key in ('service_handyman', 'service_maintenance')
  ) then
    raise exception 'legacy Handyman or Property Maintenance CMS section still exists';
  end if;
  if not exists (
    select 1
    from public.site_sections
    where key = 'service_property_care'
      and display_name = 'Property care: handyman + maintenance'
      and schema_version >= 2
      and draft_content->>'eyebrow' = 'PROPERTY CARE · HANDYMAN + MAINTENANCE'
      and published_content->>'eyebrow' = 'PROPERTY CARE · HANDYMAN + MAINTENANCE'
      and jsonb_array_length(draft_content->'services') = 6
      and draft_content #>> '{heroImage,mediaAssetId}' = '11000000-0000-4000-8000-000000000006'
      and draft_content #>> '{storyImage,mediaAssetId}' = '11000000-0000-4000-8000-000000000009'
      and draft_content #>> '{gallery,2,image,mediaAssetId}' = '11000000-0000-4000-8000-000000000008'
  ) then
    raise exception 'Property Care CMS merge or media preservation did not complete';
  end if;
  if not exists (
    select 1
    from public.site_sections,
      jsonb_array_elements(published_content->'services') as service
    where key = 'property_services'
      and schema_version >= 5
      and service->>'key' = 'rental_management'
      and service->>'summary' like 'Residential and commercial%'
  ) then
    raise exception 'Rental Management homepage card migration did not complete';
  end if;
  if not exists (
    select 1
    from public.site_sections
    where key = 'property_services'
      and schema_version >= 6
      and jsonb_array_length(draft_content->'services') = 4
      and jsonb_array_length(published_content->'services') = 4
      and (
        select count(*)
        from jsonb_array_elements(published_content->'services') service
        where service->>'key' = 'property_care'
      ) = 1
      and not exists (
        select 1
        from jsonb_array_elements(published_content->'services') service
        where service->>'key' in ('handyman', 'maintenance')
      )
  ) then
    raise exception 'Property Care homepage merge did not complete';
  end if;
end;
$$;

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

  update public.tenants
  set rent_due_day = extract(day from (
        (now() at time zone 'America/Vancouver')::date + 1
      ))::smallint
  where id = v_tenant_id;
  update public.reminder_schedules
  set next_run_at = (
        (
          (now() at time zone 'America/Vancouver')::date
          + 1
          - 3
        )::date + time '09:00'
      ) at time zone 'America/Vancouver'
  where id = v_schedule_id;
  v_run := public.materialize_due_reminders(now(), false);
  if not exists (
    select 1 from public.notification_events
    where schedule_id = v_schedule_id
      and occurrence_local_date = (
        (now() at time zone 'America/Vancouver')::date - 2
      )
      and due_date = (
        (now() at time zone 'America/Vancouver')::date + 1
      )
      and status = 'scheduled'
      and render_error_code is null
      and destination = 'behavior@example.com'
  ) then raise exception 'new-tenant catch-up before due date failed: %', v_run; end if;

  update public.reminder_schedules
  set next_run_at = now() - interval '40 days'
  where id = v_schedule_id;
  v_run := public.materialize_due_reminders(now(), false);
  if not exists (
    select 1 from public.notification_events
    where schedule_id = v_schedule_id
      and status = 'expired'
      and render_error_code = 'occurrence_due_date_passed'
      and destination is null
  ) then raise exception 'past-due occurrence policy failed'; end if;

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

insert into auth.users(id) values
  ('00000000-0000-4000-8000-000000000009'),
  ('00000000-0000-4000-8000-000000000010');
insert into public.client_profiles(user_id, display_name) values
  ('00000000-0000-4000-8000-000000000009', 'Applicant One'),
  ('00000000-0000-4000-8000-000000000010', 'Applicant Two');

insert into public.client_applications(
  owner_user_id, property_title, property_address, form_version_id, terms_version_id
)
select client_id, 'RLS Test Rental', 'Private test address', form.id, terms.id
from (values
  ('00000000-0000-4000-8000-000000000009'::uuid),
  ('00000000-0000-4000-8000-000000000010'::uuid)
) clients(client_id)
cross join lateral (
  select id from public.application_form_versions where is_active limit 1
) form
cross join lateral (
  select id from public.application_terms_versions where is_active limit 1
) terms;

do $$
declare
  v_visible integer;
begin
  if has_table_privilege('anon', 'public.client_applications', 'select')
    or has_table_privilege('anon', 'public.client_application_files', 'select')
    or has_table_privilege('anon', 'public.application_form_versions', 'select')
  then
    raise exception 'anonymous application grants are too broad';
  end if;
  if not has_table_privilege('authenticated', 'public.client_applications', 'select')
    or has_table_privilege('authenticated', 'public.client_applications', 'insert')
    or has_table_privilege('authenticated', 'public.client_application_files', 'insert')
  then
    raise exception 'authenticated application grants do not enforce server-mediated writes';
  end if;
  if exists (
    select 1 from public.application_form_versions
    where is_active and legal_review_status <> 'pending'
  ) or exists (
    select 1 from public.application_terms_versions
    where is_active and legal_review_status <> 'pending'
  ) then
    raise exception 'seeded application legal material was incorrectly approved';
  end if;

  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000009', true);
  set local role authenticated;
  select count(*) into v_visible from public.client_applications;
  reset role;
  if v_visible <> 1 then
    raise exception 'client application RLS exposed % rows instead of one owned row', v_visible;
  end if;

  raise notice 'client application RLS and legal-review behavior suite passed';
end
$$;

do $$
declare
  v_admin uuid := '00000000-0000-4000-8000-000000000001';
  v_tenant_id uuid;
  v_receipt jsonb;
  v_payment jsonb;
  v_repeat jsonb;
  v_reopened jsonb;
begin
  select id into v_tenant_id
  from public.tenants
  where email = 'behavior@example.com';

  update public.tenants
  set move_in_date = '2026-01-01',
      lease_type = 'month_to_month',
      lease_end_date = null,
      rent_due_day = 31,
      is_active = true,
      archived_at = null
  where id = v_tenant_id;

  if public.rent_payment_due_date('2028-02-01'::date, 31::smallint) <> '2028-02-29'::date then
    raise exception 'leap-year rent due date was not clamped';
  end if;
  if public.rent_payment_due_date('2027-02-01'::date, 31::smallint) <> '2027-02-28'::date then
    raise exception 'non-leap rent due date was not clamped';
  end if;

  perform public.materialize_tenant_rent_periods('2026-07-30');
  if not exists (
    select 1
    from public.tenant_rent_payments
    where tenant_id = v_tenant_id
      and payment_period = '2026-07-01'
      and due_date = '2026-07-31'
      and status = 'due'
  ) then
    raise exception 'monthly rent period was not materialized';
  end if;

  v_receipt := public.register_tenant_rent_receipt(
    v_tenant_id,
    '2026-07-01',
    'tests/rent/behavior-receipt.pdf',
    'behavior-receipt.pdf',
    'application/pdf',
    128,
    'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'admin',
    v_admin
  );
  v_payment := public.mark_tenant_rent_collected(
    v_tenant_id,
    '2026-07-01',
    (v_receipt->>'id')::uuid,
    'admin',
    v_admin,
    '2026-07-30T19:00:00Z',
    'migration behavior test'
  );
  v_repeat := public.mark_tenant_rent_collected(
    v_tenant_id,
    '2026-07-01',
    (v_receipt->>'id')::uuid,
    'admin',
    v_admin,
    '2026-07-30T19:00:00Z',
    null
  );
  if v_payment->>'status' <> 'collected'
    or (v_repeat->>'alreadyCollected')::boolean is not true
  then
    raise exception 'rent collection was not atomic and idempotent';
  end if;
  if (
    select count(*)
    from public.audit_events
    where action = 'rent.payment.collected'
      and target_id = v_payment->>'id'
  ) <> 1 then
    raise exception 'repeated rent collection created duplicate audit events';
  end if;

  v_reopened := public.reopen_tenant_rent_payment(
    v_tenant_id,
    '2026-07-01',
    (v_payment->>'updated_at')::timestamptz,
    v_admin,
    'behavior reopen'
  );
  begin
    perform public.reopen_tenant_rent_payment(
      v_tenant_id,
      '2026-07-01',
      (v_reopened->>'updated_at')::timestamptz,
      v_admin,
      'invalid second reopen'
    );
    raise exception 'a due rent payment was reopened';
  exception
    when sqlstate '22023' then null;
  end;

  if exists (
    select 1
    from storage.buckets
    where id = 'tenant-rent-payment-receipts'
      and public
  ) then
    raise exception 'rent receipt bucket is public';
  end if;
  if has_table_privilege('anon', 'public.tenant_rent_payments', 'select')
    or has_table_privilege('authenticated', 'public.tenant_rent_payment_receipts', 'select')
  then
    raise exception 'rent payment data grants are too broad';
  end if;

  raise notice 'tenant rent payment behavior suite passed';
end
$$;

do $$
declare
  v_tenant_id uuid;
  v_move_in_date date :=
    date_trunc('month', (now() at time zone 'America/Vancouver') + interval '5 years')::date;
  v_schedule public.reminder_schedules;
  v_expected record;
begin
  select id into v_tenant_id
  from public.tenants
  where email = 'behavior@example.com';

  update public.tenants
  set move_in_date = v_move_in_date,
      rent_due_day = 1,
      updated_at = now()
  where id = v_tenant_id;

  select * into v_schedule
  from public.reminder_schedules
  where tenant_id = v_tenant_id;

  select * into v_expected
  from public.next_move_in_aware_reminder_occurrence(
    1::smallint,
    v_move_in_date,
    3::smallint,
    '09:00'::time,
    'America/Vancouver',
    now(),
    true
  );

  if v_expected.due_date <> (v_move_in_date + interval '1 month')::date then
    raise exception 'move-in payment was treated as recurring rent: %', v_expected;
  end if;
  if v_schedule.next_run_at is distinct from v_expected.next_run_at then
    raise exception 'tenant trigger ignored move-in boundary: schedule %, expected %',
      v_schedule.next_run_at, v_expected.next_run_at;
  end if;

  raise notice 'move-in-aware reminder behavior suite passed';
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
