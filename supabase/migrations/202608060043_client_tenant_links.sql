-- Administrator-managed mapping between registered client accounts and tenants.
-- Clients receive no direct access to this table or to public.tenants.

create table public.client_tenant_links (
  id uuid primary key default gen_random_uuid(),
  client_user_id uuid not null references public.client_profiles(user_id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  linked_at timestamptz not null default now(),
  linked_by uuid not null references public.admin_profiles(user_id) on delete restrict,
  archived_at timestamptz null,
  archived_by uuid null references public.admin_profiles(user_id) on delete restrict,
  check (
    (archived_at is null and archived_by is null)
    or (archived_at is not null and archived_by is not null)
  )
);

create unique index client_tenant_links_one_current_idx
  on public.client_tenant_links(client_user_id)
  where archived_at is null;

create index client_tenant_links_history_idx
  on public.client_tenant_links(client_user_id, linked_at desc);

create index client_tenant_links_current_tenant_idx
  on public.client_tenant_links(tenant_id)
  where archived_at is null;

alter table public.client_tenant_links enable row level security;
revoke all on public.client_tenant_links from anon, authenticated;
grant all on public.client_tenant_links to service_role;

create or replace function public.admin_link_client_tenant(
  p_client_user_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid;
  v_previous_tenant_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if not exists (
    select 1 from public.admin_profiles
    where user_id = p_actor_id and is_active
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;

  perform 1 from public.client_profiles
  where user_id = p_client_user_id and is_active
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'active client profile not found';
  end if;

  perform 1 from auth.users
  where id = p_client_user_id and email_confirmed_at is not null
  for update;
  if not found then
    raise exception using errcode = 'TT409', message = 'verified client email required';
  end if;

  if exists (
    select 1 from public.admin_profiles
    where user_id = p_client_user_id and is_active
  ) then
    raise exception using errcode = 'TT409', message = 'administrator identities cannot be linked as clients';
  end if;

  perform 1 from public.tenants
  where id = p_tenant_id and is_active and archived_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'current tenant not found';
  end if;

  select id, tenant_id into v_link_id, v_previous_tenant_id
  from public.client_tenant_links
  where client_user_id = p_client_user_id
    and archived_at is null
  for update;
  if v_previous_tenant_id = p_tenant_id then
    return v_link_id;
  end if;

  if v_previous_tenant_id is not null then
    update public.client_tenant_links
    set archived_at = now(), archived_by = p_actor_id
    where id = v_link_id;

    insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
    values (
      p_actor_id,
      'client.tenant_unlinked',
      'client_profile',
      p_client_user_id::text,
      jsonb_build_object('tenantId', v_previous_tenant_id)
    );
  end if;

  insert into public.client_tenant_links(client_user_id, tenant_id, linked_by)
  values (p_client_user_id, p_tenant_id, p_actor_id)
  returning id into v_link_id;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'client.tenant_linked',
    'client_profile',
    p_client_user_id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'tenantId', p_tenant_id,
      'previousTenantId', v_previous_tenant_id
    ))
  );

  return v_link_id;
end;
$$;

create or replace function public.admin_unlink_client_tenant(
  p_client_user_id uuid,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link_id uuid;
  v_tenant_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if not exists (
    select 1 from public.admin_profiles
    where user_id = p_actor_id and is_active
  ) then
    raise exception using errcode = '42501', message = 'active administrator required';
  end if;

  perform 1 from public.client_profiles where user_id = p_client_user_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'client profile not found';
  end if;

  select id, tenant_id into v_link_id, v_tenant_id
  from public.client_tenant_links
  where client_user_id = p_client_user_id and archived_at is null
  for update;

  update public.client_tenant_links
  set archived_at = now(), archived_by = p_actor_id
  where id = v_link_id;

  if v_link_id is not null then
    insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
    values (
      p_actor_id,
      'client.tenant_unlinked',
      'client_profile',
      p_client_user_id::text,
      jsonb_build_object('tenantId', v_tenant_id)
    );
  end if;

  return v_link_id;
end;
$$;

revoke all on function public.admin_link_client_tenant(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.admin_unlink_client_tenant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_link_client_tenant(uuid, uuid, uuid) to service_role;
grant execute on function public.admin_unlink_client_tenant(uuid, uuid) to service_role;

create or replace function public.archive_client_links_for_tenant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link record;
begin
  for v_link in
    update public.client_tenant_links
    set archived_at = coalesce(new.archived_at, now()),
        archived_by = coalesce(new.updated_by, linked_by)
    where tenant_id = new.id and archived_at is null
    returning client_user_id, tenant_id
  loop
    insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
    values (
      new.updated_by,
      'client.tenant_unlinked',
      'client_profile',
      v_link.client_user_id::text,
      jsonb_build_object('tenantId', v_link.tenant_id, 'reason', 'tenant_archived')
    );
  end loop;
  return new;
end;
$$;

revoke all on function public.archive_client_links_for_tenant() from public, anon, authenticated;

create trigger archive_client_links_after_tenant_archive
  after update of is_active, archived_at on public.tenants
  for each row
  when (
    (old.is_active and not new.is_active)
    or (old.archived_at is null and new.archived_at is not null)
  )
  execute function public.archive_client_links_for_tenant();
