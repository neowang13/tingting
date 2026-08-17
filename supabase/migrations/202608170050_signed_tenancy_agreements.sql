-- Signed tenancy agreements are private Admin-only records. A current signed
-- agreement is mandatory before an approved application can become a tenant.

create table public.client_application_lease_files (
  id uuid primary key,
  application_id uuid not null references public.client_applications(id) on delete restrict,
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type = 'application/pdf'),
  byte_size bigint not null check (byte_size between 5 and 20971520),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by uuid not null references public.admin_profiles(user_id) on delete restrict,
  uploaded_at timestamptz not null default now(),
  superseded_at timestamptz null,
  superseded_by uuid null references public.admin_profiles(user_id) on delete restrict,
  deleted_at timestamptz null,
  check (
    (superseded_at is null and superseded_by is null)
    or (superseded_at is not null and superseded_by is not null)
  )
);

create unique index client_application_lease_files_one_current_idx
  on public.client_application_lease_files(application_id)
  where superseded_at is null and deleted_at is null;

create index client_application_lease_files_application_history_idx
  on public.client_application_lease_files(application_id, uploaded_at desc);

alter table public.client_application_lease_files enable row level security;
revoke all on public.client_application_lease_files from anon, authenticated;
grant all on public.client_application_lease_files to service_role;

alter table public.client_applications
  add column converted_lease_file_id uuid null
    references public.client_application_lease_files(id) on delete restrict,
  add constraint client_applications_converted_lease_required_check check (
    converted_tenant_id is null or converted_lease_file_id is not null
  );

create or replace function public.register_application_lease_file(
  p_application_id uuid,
  p_file jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_application public.client_applications;
  v_previous public.client_application_lease_files;
  v_file_id uuid;
  v_storage_path text;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if not exists (
    select 1 from public.admin_profiles where user_id = p_actor_id and is_active
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
    raise exception using errcode = 'TT409', message = 'application already converted to tenant';
  end if;

  v_file_id := (p_file->>'id')::uuid;
  v_storage_path := p_file->>'storagePath';
  if v_storage_path <> format('leases/%s/%s.pdf', p_application_id, v_file_id) then
    raise exception using errcode = '22023', message = 'invalid lease storage path';
  end if;
  if p_file->>'mimeType' <> 'application/pdf'
     or (p_file->>'byteSize')::bigint not between 5 and 20971520
     or p_file->>'sha256' !~ '^[0-9a-f]{64}$'
     or char_length(p_file->>'originalFilename') not between 1 and 180 then
    raise exception using errcode = '22023', message = 'invalid lease file metadata';
  end if;

  select * into v_previous
  from public.client_application_lease_files
  where application_id = p_application_id
    and superseded_at is null
    and deleted_at is null
  for update;

  if v_previous.id is not null then
    update public.client_application_lease_files
    set superseded_at = now(), superseded_by = p_actor_id
    where id = v_previous.id;
  end if;

  insert into public.client_application_lease_files(
    id, application_id, storage_path, original_filename, mime_type,
    byte_size, sha256, uploaded_by, uploaded_at
  ) values (
    v_file_id,
    p_application_id,
    v_storage_path,
    p_file->>'originalFilename',
    'application/pdf',
    (p_file->>'byteSize')::bigint,
    p_file->>'sha256',
    p_actor_id,
    coalesce(nullif(p_file->>'uploadedAt', '')::timestamptz, now())
  );

  insert into public.client_application_audit_events(
    application_id, actor_user_id, actor_type, action, request_context
  ) values (
    p_application_id,
    p_actor_id,
    'staff',
    'application.lease_document_uploaded',
    jsonb_strip_nulls(jsonb_build_object(
      'leaseFileId', v_file_id,
      'supersededLeaseFileId', v_previous.id
    ))
  );

  return jsonb_build_object(
    'id', v_file_id,
    'previousStoragePath', v_previous.storage_path
  );
end;
$$;

revoke all on function public.register_application_lease_file(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.register_application_lease_file(uuid, jsonb, uuid)
  to service_role;

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
  v_lease_file_id uuid;
  v_tenant jsonb;
  v_tenant_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;
  if not exists (
    select 1 from public.admin_profiles where user_id = p_actor_id and is_active
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

  select id into v_lease_file_id
  from public.client_application_lease_files
  where application_id = p_application_id
    and superseded_at is null
    and deleted_at is null
  for update;
  if v_lease_file_id is null then
    raise exception using errcode = 'TT409', message = 'signed tenancy agreement required';
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
      converted_lease_file_id = v_lease_file_id,
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
    jsonb_build_object('tenantId', v_tenant_id, 'leaseFileId', v_lease_file_id)
  );

  return v_tenant_id;
end;
$$;

revoke all on function public.convert_approved_application_to_tenant(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.convert_approved_application_to_tenant(uuid, jsonb, uuid)
  to service_role;

comment on table public.client_application_lease_files is
  'Private signed tenancy agreements. Service-role access only; never expose storage paths or public URLs.';
