\set ON_ERROR_STOP on

begin;

insert into auth.users(id, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000101',
  '{"display_name":"New Client","account_type":"client","role":"admin","is_admin":true}'::jsonb
);

do $$
begin
  if not exists (
    select 1
    from public.client_profiles
    where user_id = '00000000-0000-4000-8000-000000000101'
      and display_name = 'New Client'
      and is_active
  ) then
    raise exception 'auth user trigger did not create an active client profile';
  end if;

  if exists (
    select 1
    from public.admin_profiles
    where user_id = '00000000-0000-4000-8000-000000000101'
  ) then
    raise exception 'untrusted user metadata granted administrator access';
  end if;
end;
$$;

insert into auth.users(id, raw_user_meta_data)
values
  (
    '00000000-0000-4000-8000-000000000102',
    '{"display_name":"   "}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000103',
    jsonb_build_object('display_name', repeat('n', 121))
  ),
  (
    '00000000-0000-4000-8000-000000000104',
    '{"display_name":7}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000105',
    '{"display_name":"Owner Admin","account_type":"admin"}'::jsonb
  ),
  (
    '00000000-0000-4000-8000-000000000106',
    '{"display_name":"Unclassified Auth User"}'::jsonb
  );

do $$
begin
  if exists (
    select 1 from public.client_profiles
    where user_id in (
      '00000000-0000-4000-8000-000000000102',
      '00000000-0000-4000-8000-000000000103',
      '00000000-0000-4000-8000-000000000104',
      '00000000-0000-4000-8000-000000000105',
      '00000000-0000-4000-8000-000000000106'
    )
  ) then
    raise exception 'invalid or non-client metadata created a client profile';
  end if;
end;
$$;

rollback;
