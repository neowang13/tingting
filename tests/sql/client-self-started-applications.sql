\set ON_ERROR_STOP on

begin;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000400', '{}'::jsonb);

insert into public.admin_profiles(user_id, display_name)
values ('00000000-0000-4000-8000-000000000400', 'Self Start Test Admin');

insert into public.rental_properties(
  id, property_type, street_address, city, province_code, postal_code,
  created_by, updated_by
) values (
  '00000000-0000-4000-8000-000000000410', 'apartment',
  '401 Test Street', 'Vancouver', 'BC', 'V6B 1A1',
  '00000000-0000-4000-8000-000000000400',
  '00000000-0000-4000-8000-000000000400'
);

insert into public.rental_listings(
  id, slug, title, address_line, city, monthly_rent_cents, bedrooms,
  bathrooms, description, status, property_id, created_by, updated_by,
  published_at
) values (
  '00000000-0000-4000-8000-000000000411', 'self-start-rental',
  'Self Start Rental', '401 Test Street', 'Vancouver', 250000, 1, 1,
  'Published rental fixture for Client self-start behavior.', 'published',
  '00000000-0000-4000-8000-000000000410',
  '00000000-0000-4000-8000-000000000400',
  '00000000-0000-4000-8000-000000000400', now()
);

insert into public.rental_listing_revisions(
  id, rental_listing_id, content_snapshot, action, schema_version,
  source_digest, created_by
) values (
  '00000000-0000-4000-8000-000000000412',
  '00000000-0000-4000-8000-000000000411',
  '{"slug":"self-start-rental","title":"Self Start Rental","address_line":"401 Test Street","city":"Vancouver","monthly_rent_cents":250000,"bedrooms":1,"bathrooms":1,"description":"Published rental fixture for Client self-start behavior.","images":[]}'::jsonb,
  'publish', 2, repeat('a', 64),
  '00000000-0000-4000-8000-000000000400'
);

update public.rental_listings
set published_revision_id = '00000000-0000-4000-8000-000000000412'
where id = '00000000-0000-4000-8000-000000000411';

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000401',
  'self-start-client@example.test',
  now(),
  '{"display_name":"Self Start Client","account_type":"client"}'::jsonb
);

do $$
declare
  v_slug text;
  v_first uuid;
  v_repeated uuid;
begin
  v_slug := 'self-start-rental';

  begin
    perform public.start_client_application(
      '00000000-0000-4000-8000-000000000401',
      v_slug
    );
    raise exception 'pending legal material started an application';
  exception
    when sqlstate '55000' then null;
  end;

  update public.application_form_versions
  set legal_review_status = 'approved'
  where form_key = 'residential-rental-application' and is_active;
  update public.application_terms_versions
  set legal_review_status = 'approved'
  where is_active;

  if v_slug is null then
    raise exception 'a published rental is required for the self-start test';
  end if;

  v_first := public.start_client_application(
    '00000000-0000-4000-8000-000000000401',
    v_slug
  );
  v_repeated := public.start_client_application(
    '00000000-0000-4000-8000-000000000401',
    v_slug
  );

  if v_first <> v_repeated then
    raise exception 'repeat start created a duplicate application';
  end if;

  if (select count(*) from public.client_applications
      where owner_user_id = '00000000-0000-4000-8000-000000000401'
        and deleted_at is null) <> 1 then
    raise exception 'self-start did not create exactly one owned application';
  end if;

  if (select count(*) from public.client_application_audit_events
      where application_id = v_first
        and actor_user_id = '00000000-0000-4000-8000-000000000401'
        and action = 'application.client_started') <> 1 then
    raise exception 'self-start audit event is missing or duplicated';
  end if;

  if has_function_privilege('authenticated', 'public.start_client_application(uuid,text)', 'execute')
    or has_function_privilege('anon', 'public.start_client_application(uuid,text)', 'execute')
    or not has_function_privilege('service_role', 'public.start_client_application(uuid,text)', 'execute') then
    raise exception 'self-start function privileges are unsafe';
  end if;
end;
$$;

rollback;
