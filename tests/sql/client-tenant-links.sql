\set ON_ERROR_STOP on

begin;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000200', '{}'::jsonb);
insert into public.admin_profiles(user_id, display_name)
values ('00000000-0000-4000-8000-000000000200', 'Link Test Admin');

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000201',
  'linked-client@example.test',
  now(),
  '{"display_name":"Linked Client","account_type":"client"}'::jsonb
);

insert into auth.users(id, email, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000202',
  'unverified-client@example.test',
  '{"display_name":"Unverified Client","account_type":"client"}'::jsonb
);

insert into public.tenants(
  id, full_name, property_label, rent_due_day, email, preferred_channels,
  email_contact_status, sms_contact_status, timezone, is_active, created_by, updated_by
) values
  ('00000000-0000-4000-8000-000000000301', 'Email Match', 'One', 1,
    'linked-client@example.test', array['email']::text[],
    'allowed', 'unconfirmed', 'America/Vancouver', true,
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000200'),
  ('00000000-0000-4000-8000-000000000302', 'Explicit Choice', 'Two', 1,
    'different@example.test', array['email']::text[],
    'allowed', 'unconfirmed', 'America/Vancouver', true,
    '00000000-0000-4000-8000-000000000200',
    '00000000-0000-4000-8000-000000000200');

do $$
begin
  begin
    perform public.admin_link_client_tenant(
      '00000000-0000-4000-8000-000000000202',
      '00000000-0000-4000-8000-000000000301',
      '00000000-0000-4000-8000-000000000200'
    );
    raise exception 'unverified client was linked to a tenant';
  exception
    when sqlstate 'TT409' then null;
  end;
end;
$$;

do $$
declare
  v_admin uuid := '00000000-0000-4000-8000-000000000200';
  v_client uuid := '00000000-0000-4000-8000-000000000201';
begin
  if exists (
    select 1 from public.client_tenant_links
    where client_user_id = v_client and archived_at is null
  ) then
    raise exception 'email matching created an implicit client tenant link';
  end if;

  perform public.admin_link_client_tenant(
    v_client,
    '00000000-0000-4000-8000-000000000301',
    v_admin
  );
  perform public.admin_link_client_tenant(
    v_client,
    '00000000-0000-4000-8000-000000000302',
    v_admin
  );

  if (select count(*) from public.client_tenant_links where client_user_id = v_client) <> 2 then
    raise exception 'reassignment did not preserve link history';
  end if;
  if (select count(*) from public.client_tenant_links where client_user_id = v_client and archived_at is null) <> 1 then
    raise exception 'client has more than one current tenant';
  end if;
  if not exists (
    select 1 from public.client_tenant_links
    where client_user_id = v_client
      and tenant_id = '00000000-0000-4000-8000-000000000302'
      and archived_at is null
  ) then
    raise exception 'explicitly selected tenant is not current';
  end if;

  perform public.admin_unlink_client_tenant(v_client, v_admin);
  if exists (
    select 1 from public.client_tenant_links
    where client_user_id = v_client and archived_at is null
  ) then
    raise exception 'unlink left a current tenant';
  end if;

  if (select count(*) from public.audit_events
      where target_type = 'client_profile' and target_id = v_client::text
        and action = 'client.tenant_linked') <> 2 then
    raise exception 'link or reassign audit is missing';
  end if;
  if (select count(*) from public.audit_events
      where target_type = 'client_profile' and target_id = v_client::text
        and action = 'client.tenant_unlinked') <> 2 then
    raise exception 'reassign or unlink audit is missing';
  end if;
  if exists (
    select 1 from public.audit_events
    where target_type = 'client_profile' and target_id = v_client::text
      and metadata - 'tenantId' - 'previousTenantId' <> '{}'::jsonb
  ) then
    raise exception 'client tenant audit contains unexpected metadata';
  end if;

  perform public.admin_link_client_tenant(
    v_client,
    '00000000-0000-4000-8000-000000000302',
    v_admin
  );
  update public.tenants
  set is_active = false, archived_at = now(), updated_by = v_admin
  where id = '00000000-0000-4000-8000-000000000302';
  if exists (
    select 1 from public.client_tenant_links
    where client_user_id = v_client and archived_at is null
  ) then
    raise exception 'archived tenant retained a current client link';
  end if;
  if not exists (
    select 1 from public.audit_events
    where target_type = 'client_profile'
      and target_id = v_client::text
      and action = 'client.tenant_unlinked'
      and metadata @> '{"reason":"tenant_archived"}'::jsonb
  ) then
    raise exception 'tenant archive did not audit automatic client unlink';
  end if;
end;
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.tenants', 'select') then
    raise exception 'client role gained tenants table read access';
  end if;
  if has_table_privilege('authenticated', 'public.client_tenant_links', 'select') then
    raise exception 'client role gained client tenant link table read access';
  end if;
end;
$$;

rollback;
