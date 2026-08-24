\set ON_ERROR_STOP on

begin;

-- Normal migration order reaches the repair migration with all objects already
-- present. Reapplying it must remain safe.
\ir ../../supabase/migrations/202608240055_restore_client_tenant_links.sql

-- Reproduce the broken production shape: the migration history exists, but the
-- table, RPCs, and trigger are absent. PostgreSQL DDL is transactional, so the
-- surrounding rollback restores the test database after the repair assertions.
drop trigger if exists archive_client_links_after_tenant_archive on public.tenants;
drop function if exists public.archive_client_links_for_tenant();
drop function if exists public.admin_unlink_client_tenant(uuid, uuid);
drop function if exists public.admin_link_client_tenant(uuid, uuid, uuid);
drop table if exists public.client_tenant_links;

\ir ../../supabase/migrations/202608240055_restore_client_tenant_links.sql

do $$
begin
  if to_regclass('public.client_tenant_links') is null then
    raise exception 'repair migration did not restore client_tenant_links';
  end if;

  if to_regprocedure('public.admin_link_client_tenant(uuid,uuid,uuid)') is null
    or to_regprocedure('public.admin_unlink_client_tenant(uuid,uuid)') is null
    or to_regprocedure('public.archive_client_links_for_tenant()') is null then
    raise exception 'repair migration did not restore client tenant functions';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgname = 'archive_client_links_after_tenant_archive'
      and tgrelid = 'public.tenants'::regclass
      and not tgisinternal
  ) then
    raise exception 'repair migration did not restore tenant archive trigger';
  end if;

  if not exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'client_tenant_links'
      and indexname = 'client_tenant_links_one_current_idx'
  ) then
    raise exception 'repair migration did not restore current-link uniqueness';
  end if;

  if not (
    select relrowsecurity
    from pg_class
    where oid = 'public.client_tenant_links'::regclass
  ) then
    raise exception 'repair migration did not restore row-level security';
  end if;

  if has_table_privilege('authenticated', 'public.client_tenant_links', 'select')
    or has_function_privilege(
      'authenticated',
      'public.admin_link_client_tenant(uuid,uuid,uuid)',
      'execute'
    ) then
    raise exception 'repair migration exposed client tenant data to authenticated users';
  end if;

  if not has_table_privilege('service_role', 'public.client_tenant_links', 'select')
    or not has_function_privilege(
      'service_role',
      'public.admin_link_client_tenant(uuid,uuid,uuid)',
      'execute'
    ) then
    raise exception 'repair migration did not restore service role access';
  end if;
end;
$$;

rollback;
