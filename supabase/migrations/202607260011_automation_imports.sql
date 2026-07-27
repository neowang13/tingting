-- Durable tenant import jobs, rows, and permission evidence.
-- Rollback note: disable import flags and retain evidence; remove source objects
-- through retention rather than dropping committed metadata.

create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  job_type text not null check (job_type in ('tenant_import')),
  status text not null check (status in (
    'queued','running','preview_ready','awaiting_confirmation',
    'committing','completed','failed','cancelled'
  )),
  progress_current integer not null default 0,
  progress_total integer not null default 0,
  safe_error_code text null,
  safe_error_details jsonb null,
  started_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.tenant_imports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.automation_jobs(id),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  source_system text not null check (char_length(source_system) between 1 and 60),
  import_mode text not null check (import_mode in ('create_only','create_or_update')),
  original_filename text not null,
  source_digest text not null check (source_digest ~ '^sha256:[a-f0-9]{64}$'),
  private_storage_path text not null unique,
  row_count integer not null default 0 check (row_count between 0 and 1000),
  new_count integer not null default 0,
  update_count integer not null default 0,
  unchanged_count integer not null default 0,
  duplicate_count integer not null default 0,
  conflict_count integer not null default 0,
  invalid_count integer not null default 0,
  preview_version timestamptz null,
  committed_at timestamptz null,
  committed_by_service_account_id uuid null
    references public.automation_service_accounts(id),
  source_deleted_at timestamptz null,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_account_id, source_digest)
);

create table public.tenant_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.tenant_imports(id) on delete cascade,
  row_number integer not null check (row_number > 1),
  row_digest text not null check (row_digest ~ '^sha256:[a-f0-9]{64}$'),
  outcome text not null check (outcome in (
    'new','update','unchanged','duplicate','conflict','invalid'
  )),
  matched_tenant_id uuid null references public.tenants(id),
  expected_tenant_version timestamptz null,
  normalized_payload jsonb null,
  changed_fields text[] not null default '{}',
  error_codes text[] not null default '{}',
  warnings text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (import_id, row_number)
);

create index tenant_import_rows_outcome_idx
  on public.tenant_import_rows(import_id, outcome, row_number);

create table public.tenant_contact_permission_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel text not null check (channel in ('email','sms')),
  previous_status text not null,
  new_status text not null,
  source text null,
  reason text null,
  evidence_reference text null,
  permission_recorded_at timestamptz null,
  actor_user_id uuid null references public.admin_profiles(user_id),
  actor_service_account_id uuid null
    references public.automation_service_accounts(id),
  created_at timestamptz not null default now()
);

alter table public.automation_jobs enable row level security;
alter table public.tenant_imports enable row level security;
alter table public.tenant_import_rows enable row level security;
alter table public.tenant_contact_permission_events enable row level security;

revoke all on public.automation_jobs from anon, authenticated;
revoke all on public.tenant_imports from anon, authenticated;
revoke all on public.tenant_import_rows from anon, authenticated;
revoke all on public.tenant_contact_permission_events from anon, authenticated;
grant all on public.automation_jobs to service_role;
grant all on public.tenant_imports to service_role;
grant all on public.tenant_import_rows to service_role;
grant all on public.tenant_contact_permission_events to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'automation-imports',
  'automation-imports',
  false,
  10485760,
  array[
    'text/csv',
    'application/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do update
set public = false, file_size_limit = 10485760;

create or replace function public.persist_tenant_import_preview(
  p_import jsonb,
  p_rows jsonb
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job_id uuid := (p_import->>'jobId')::uuid;
  v_import_id uuid := (p_import->>'id')::uuid;
  v_row jsonb;
  v_counts jsonb := p_import->'counts';
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into public.automation_jobs(
    id, service_account_id, job_type, status, progress_current,
    progress_total, started_at
  ) values (
    v_job_id, (p_import->>'serviceAccountId')::uuid, 'tenant_import',
    'preview_ready', (p_import->>'rowCount')::integer,
    (p_import->>'rowCount')::integer, now()
  );
  insert into public.tenant_imports(
    id, job_id, service_account_id, source_system, import_mode,
    original_filename, source_digest, private_storage_path, row_count,
    new_count, update_count, unchanged_count, duplicate_count,
    conflict_count, invalid_count, preview_version
  ) values (
    v_import_id, v_job_id, (p_import->>'serviceAccountId')::uuid,
    p_import->>'sourceSystem', p_import->>'importMode',
    p_import->>'originalFilename', p_import->>'sourceDigest',
    p_import->>'privateStoragePath', (p_import->>'rowCount')::integer,
    coalesce((v_counts->>'new')::integer, 0),
    coalesce((v_counts->>'update')::integer, 0),
    coalesce((v_counts->>'unchanged')::integer, 0),
    coalesce((v_counts->>'duplicate')::integer, 0),
    coalesce((v_counts->>'conflict')::integer, 0),
    coalesce((v_counts->>'invalid')::integer, 0),
    (p_import->>'previewVersion')::timestamptz
  );
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    insert into public.tenant_import_rows(
      id, import_id, row_number, row_digest, outcome,
      matched_tenant_id, expected_tenant_version, normalized_payload,
      changed_fields, error_codes, warnings
    ) values (
      (v_row->>'id')::uuid, v_import_id, (v_row->>'rowNumber')::integer,
      v_row->>'rowDigest', v_row->>'outcome',
      nullif(v_row->>'matchedTenantId', '')::uuid,
      nullif(v_row->>'expectedTenantVersion', '')::timestamptz,
      v_row->'normalizedPayload',
      coalesce(array(select jsonb_array_elements_text(v_row->'changedFields')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_row->'errorCodes')), '{}'),
      coalesce(array(select jsonb_array_elements_text(v_row->'warnings')), '{}')
    );
  end loop;
  return v_import_id;
end;
$$;

create or replace function public.get_tenant_import_for_automation(
  p_import_id uuid
) returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id,
    'jobId', i.job_id,
    'serviceAccountId', i.service_account_id,
    'sourceSystem', i.source_system,
    'importMode', i.import_mode,
    'originalFilename', i.original_filename,
    'sourceDigest', i.source_digest,
    'rowCount', i.row_count,
    'counts', jsonb_build_object(
      'new', i.new_count, 'update', i.update_count,
      'unchanged', i.unchanged_count, 'duplicate', i.duplicate_count,
      'conflict', i.conflict_count, 'invalid', i.invalid_count
    ),
    'previewVersion', i.preview_version,
    'committedAt', i.committed_at,
    'createdAt', i.created_at,
    'status', j.status,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'rowNumber', r.row_number,
        'rowDigest', r.row_digest,
        'outcome', r.outcome,
        'matchedTenantId', r.matched_tenant_id,
        'expectedTenantVersion', r.expected_tenant_version,
        'normalizedPayload', r.normalized_payload,
        'changedFields', r.changed_fields,
        'errorCodes', r.error_codes,
        'warnings', r.warnings,
        'display', concat('Row ', r.row_number),
        'emailMasked', null,
        'phoneMasked', null
      ) order by r.row_number)
      from public.tenant_import_rows r
      where r.import_id = i.id
    ), '[]'::jsonb)
  )
  from public.tenant_imports i
  join public.automation_jobs j on j.id = i.job_id
  where i.id = p_import_id;
$$;

revoke all on function public.persist_tenant_import_preview(jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.get_tenant_import_for_automation(uuid)
  from public, anon, authenticated;
grant execute on function public.persist_tenant_import_preview(jsonb, jsonb)
  to service_role;
grant execute on function public.get_tenant_import_for_automation(uuid)
  to service_role;
