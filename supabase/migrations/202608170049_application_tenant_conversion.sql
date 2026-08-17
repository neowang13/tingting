-- Approved rental applications can become active tenant records only after an
-- administrator confirms that the tenancy agreement has been signed.

alter table public.client_applications
  add column converted_tenant_id uuid null references public.tenants(id) on delete restrict,
  add column converted_at timestamptz null,
  add column converted_by uuid null references public.admin_profiles(user_id) on delete restrict,
  add constraint client_applications_conversion_complete_check check (
    (converted_tenant_id is null and converted_at is null and converted_by is null)
    or (converted_tenant_id is not null and converted_at is not null and converted_by is not null)
  );

create unique index client_applications_converted_tenant_unique
  on public.client_applications(converted_tenant_id)
  where converted_tenant_id is not null;

create or replace function public.convert_approved_application_to_tenant(
  p_application_id uuid,
  p_tenant_payload jsonb,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.client_applications;
  v_tenant jsonb;
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

  select * into v_application
  from public.client_applications
  where id = p_application_id and deleted_at is null
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'application not found';
  end if;
  if v_application.status <> 'approved' then
    raise exception using errcode = 'TT409', message = 'application must be approved first';
  end if;
  if v_application.converted_tenant_id is not null then
    return v_application.converted_tenant_id;
  end if;

  v_tenant := public.save_tenant(null, p_tenant_payload, null, p_actor_id);
  v_tenant_id := (v_tenant->>'id')::uuid;

  perform public.admin_link_client_tenant(
    v_application.owner_user_id,
    v_tenant_id,
    p_actor_id
  );

  update public.client_applications
  set converted_tenant_id = v_tenant_id,
      converted_at = now(),
      converted_by = p_actor_id,
      updated_at = now()
  where id = p_application_id;

  insert into public.client_application_audit_events(
    application_id, actor_user_id, actor_type, action, request_context
  ) values (
    p_application_id,
    p_actor_id,
    'staff',
    'application.converted_to_tenant',
    jsonb_build_object('tenantId', v_tenant_id)
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.convert_approved_application_to_tenant(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_approved_application_to_tenant(uuid, jsonb, uuid)
  to service_role;

comment on column public.client_applications.converted_tenant_id is
  'Tenant created from this approved application after staff confirms a signed tenancy agreement.';
