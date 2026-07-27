# Data Model and Migration Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Goals

The schema must support:

- independently revocable service-account identity;
- least-privilege scopes;
- idempotent server-to-server mutations;
- expiring two-step confirmations;
- durable tenant-import previews and atomic commits;
- deterministic cross-file deduplication;
- audit attribution to both the service account and its delegating admin;
- bounded retention of uploaded tenant data.

All migrations are append-only and run after
`202607260009_operations_retention.sql`.

## 2. Actor model

Existing tables use `created_by` and `updated_by` foreign keys to
`admin_profiles`. Replacing every actor foreign key with a polymorphic model is
outside this integration's blast radius.

For v1, each service account has a `delegated_admin_user_id`:

- existing resource `created_by` and `updated_by` values continue to use that
  active admin UUID;
- `audit_events.actor_service_account_id` records the actual automation actor;
- automation audit metadata records the delegated admin UUID and request ID;
- disabling either the service account or delegated admin blocks new calls.

The UI must display automation actions as:

```text
OpenClaw Operations, delegated by Ting Ting
```

It must not display them as direct interactive admin actions.

## 3. New tables

### 3.1 `automation_service_accounts`

```sql
create table public.automation_service_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  delegated_admin_user_id uuid not null
    references public.admin_profiles(user_id),
  scopes text[] not null,
  is_active boolean not null default true,
  expires_at timestamptz null,
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(scopes) > 0)
);
```

Allowed scopes are enforced by an application enum and a database check
constraint generated from the same migration.

### 3.2 `automation_service_account_tokens`

```sql
create table public.automation_service_account_tokens (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  token_prefix text not null unique,
  token_hash text not null unique,
  is_active boolean not null default true,
  expires_at timestamptz null,
  last_used_at timestamptz null,
  last_used_ip_hash text null,
  rotated_from_token_id uuid null
    references public.automation_service_account_tokens(id),
  revoked_at timestamptz null,
  revoked_by uuid null references public.admin_profiles(user_id),
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now()
);

create index automation_tokens_active_prefix_idx
  on public.automation_service_account_tokens(token_prefix)
  where is_active and revoked_at is null;
```

No endpoint returns `token_hash`. Rotation may keep the previous token active
for a maximum 24-hour cutover window, after which it is revoked automatically.

### 3.3 `automation_idempotency_keys`

```sql
create table public.automation_idempotency_keys (
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  idempotency_key uuid not null,
  request_hash text not null,
  method text not null,
  normalized_path text not null,
  status text not null
    check (status in ('in_progress', 'completed', 'failed')),
  response_status integer null,
  result_resource_type text null,
  result_resource_id text null,
  result_resource_version timestamptz null,
  response_redacted jsonb null,
  failure_code text null,
  locked_until timestamptz null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  expires_at timestamptz not null,
  primary key (service_account_id, idempotency_key)
);
```

`response_redacted` cannot contain full email, phone, tenant notes, file
contents, message bodies, provider IDs, or signed URLs.

### 3.4 `automation_confirmation_intents`

```sql
create table public.automation_confirmation_intents (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  action text not null,
  target_type text not null,
  target_id text not null,
  target_version timestamptz null,
  request_digest text not null,
  payload jsonb not null,
  summary jsonb not null,
  required_acknowledgements text[] not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_by_idempotency_key uuid null,
  created_at timestamptz not null default now()
);

create index automation_confirmations_active_idx
  on public.automation_confirmation_intents
  (service_account_id, expires_at)
  where consumed_at is null;
```

`payload` stores canonical IDs and desired state, not raw source files. Import
confirmations reference a durable import record and source digest.

### 3.5 `automation_jobs`

```sql
create table public.automation_jobs (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  job_type text not null
    check (job_type in ('tenant_import')),
  status text not null check (status in (
    'queued', 'running', 'preview_ready', 'awaiting_confirmation',
    'committing', 'completed', 'failed', 'cancelled'
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
```

### 3.6 `tenant_imports`

```sql
create table public.tenant_imports (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique references public.automation_jobs(id),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  source_system text not null,
  import_mode text not null
    check (import_mode in ('create_only', 'create_or_update')),
  original_filename text not null,
  source_digest text not null,
  private_storage_path text not null unique,
  row_count integer not null default 0,
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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (service_account_id, source_digest)
);
```

The raw file is stored in a private `automation-imports` bucket and removed no
later than seven days after completion or failure.

### 3.7 `tenant_import_rows`

```sql
create table public.tenant_import_rows (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references public.tenant_imports(id) on delete cascade,
  row_number integer not null check (row_number > 1),
  row_digest text not null,
  outcome text not null check (outcome in (
    'new', 'update', 'unchanged', 'duplicate', 'conflict', 'invalid'
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
```

`normalized_payload` contains PII and follows the retention and access rules in
[10-security-privacy-audit.md](./10-security-privacy-audit.md).

### 3.8 `tenant_contact_permission_events`

```sql
create table public.tenant_contact_permission_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  channel text not null check (channel in ('email', 'sms')),
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
```

This is an append-only evidence log. The referenced source document is not
copied into this table.

## 4. Existing-table changes

### Rental external identity

```sql
alter table public.rental_listings
  add column source_system text null,
  add column external_reference text null;

create unique index rental_external_reference_idx
  on public.rental_listings(source_system, external_reference)
  where source_system is not null and external_reference is not null;
```

### Tenant external identity

```sql
alter table public.tenants
  add column source_system text null,
  add column external_reference text null;

create unique index tenant_external_reference_idx
  on public.tenants(source_system, external_reference)
  where source_system is not null and external_reference is not null;
```

### Audit attribution

```sql
alter table public.audit_events
  add column actor_service_account_id uuid null
    references public.automation_service_accounts(id),
  add column request_id uuid null;

create index audit_events_service_actor_idx
  on public.audit_events(actor_service_account_id, created_at desc)
  where actor_service_account_id is not null;
```

The existing `actor_user_id` remains the delegated admin for automation
actions. System events may continue to have both actor columns null.

## 5. Database functions

Add the following service-role-only functions:

```text
create_automation_confirmation(...)
execute_automation_confirmation(...)
save_automation_rental_draft(...)
save_automation_tenant(...)
preview_tenant_import(...)
commit_tenant_import(...)
save_automation_schedule(...)
set_automation_schedule_status(...)
record_automation_permission_event(...)
claim_automation_idempotency_key(...)
complete_automation_idempotency_key(...)
fail_automation_idempotency_key(...)
```

### `commit_tenant_import`

The transaction must:

1. lock the import, job, confirmation, and all matched tenant rows;
2. verify the source digest and preview version;
3. require zero invalid or unresolved conflict rows;
4. recheck every matched tenant's `updated_at`;
5. insert new tenants and update matched tenants;
6. write permission events only for explicitly evidenced transitions;
7. keep all imported schedules disabled;
8. write per-tenant and batch audit events;
9. mark the import and job completed;
10. consume the confirmation intent.

Any failure rolls back the full batch.

### `execute_automation_confirmation`

This function dispatches only allowlisted action names. It must not execute SQL,
table names, or function names supplied by the request.

## 6. Repository changes

Introduce:

```ts
interface AutomationActor {
  serviceAccountId: string;
  delegatedAdminUserId: string;
  requestId: string;
  scopes: AutomationScope[];
}
```

Do not overload the existing `actorId: string` with a service-account UUID.
Automation service methods accept `AutomationActor`, then pass the delegated
admin UUID and service-account UUID separately to RPCs.

Proposed interfaces:

```ts
interface AutomationRepository {
  searchRentals(input: RentalSearchInput): Promise<CursorPage<RentalListing>>;
  saveRentalDraft(
    id: string | null,
    input: AutomationRentalInput,
    expectedVersion: string | null,
    actor: AutomationActor
  ): Promise<RentalListing>;
  createRentalStatusPreview(...): Promise<ConfirmationIntent>;
  createTenantImport(...): Promise<AutomationJob>;
  previewTenantImport(...): Promise<TenantImportSummary>;
  createTenantImportCommitPreview(...): Promise<ConfirmationIntent>;
  saveDisabledSchedule(...): Promise<ReminderSchedule>;
  createScheduleStatusPreview(...): Promise<ConfirmationIntent>;
  executeConfirmation(...): Promise<AutomationExecutionResult>;
}
```

The existing `DataRepository` remains unchanged for browser-admin and public
flows.

## 7. RLS and grants

- Enable RLS on every new table.
- Revoke all access from `anon` and `authenticated`.
- Grant access only to `service_role`.
- OpenClaw never receives Supabase credentials.
- No public view includes service accounts, import rows, jobs, confirmation
  payloads, or idempotency rows.
- Add integration tests proving anonymous and ordinary authenticated clients
  cannot read every new table.

## 8. Storage

Create one private bucket:

```text
automation-imports
```

Rules:

- no public URLs;
- no browser direct upload;
- maximum object size 10 MB;
- `.csv` and `.xlsx` only after content inspection;
- delete raw objects after seven days;
- never execute spreadsheet macros, formulas, hyperlinks, or embedded files.

Rental images continue to use the existing draft/public media buckets.

## 9. Retention

| Data | Retention |
|---|---|
| Service account identity/audit | Account lifetime + 24 months |
| Completed idempotency keys | 30 days |
| Failed idempotency keys | 7 days |
| Confirmation intents | 30 days after expiry/consumption |
| Raw tenant import files | Maximum 7 days |
| Import row normalized payloads | 30 days after completion/failure |
| Import aggregate metadata | 24 months |
| Contact permission events | Tenant lifetime plus approved legal period |
| Automation audit events | 24 months |

Retention functions must preserve rows under an applicable legal hold.

## 10. Migration sequence

1. Create service-account, token, and idempotency tables.
2. Add audit attribution columns.
3. Add external-reference columns and indexes.
4. Create jobs, imports, import rows, and permission events.
5. Create confirmation functions.
6. Create import preview/commit functions.
7. Add RLS, grants, retention, and storage provisioning.
8. Deploy code with all automation feature flags off.
9. Provision one inactive service account.
10. Run migrations and integration tests.
11. Activate read-only scopes first.

Every migration needs a corresponding rollback note, but production rollback
uses forward repair. Applied migrations are never edited or deleted.
