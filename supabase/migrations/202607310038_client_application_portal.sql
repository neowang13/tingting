-- Authenticated client application portal. Browser clients receive read-only,
-- ownership-scoped projections; all writes and private-file operations go through
-- same-origin server routes using the service role.

create table public.client_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  deactivated_at timestamptz null
);

create table public.application_form_versions (
  id uuid primary key default gen_random_uuid(),
  form_key text not null,
  version text not null,
  title text not null,
  filename text not null,
  content_type text not null check (content_type in ('text/plain', 'application/pdf')),
  content_text text null,
  storage_path text null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  legal_review_status text not null default 'pending'
    check (legal_review_status in ('pending', 'approved')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (form_key, version),
  check ((content_text is null) <> (storage_path is null))
);

create unique index application_form_one_active_idx
  on public.application_form_versions(form_key) where is_active;

create table public.application_terms_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null unique,
  displayed_text text not null,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  legal_review_status text not null default 'pending'
    check (legal_review_status in ('pending', 'approved')),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index application_terms_one_active_idx
  on public.application_terms_versions((is_active)) where is_active;

create table public.client_applications (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.client_profiles(user_id),
  rental_listing_id uuid null references public.rental_listings(id) on delete set null,
  property_title text not null,
  property_address text not null,
  form_version_id uuid not null references public.application_form_versions(id),
  terms_version_id uuid not null references public.application_terms_versions(id),
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'received', 'needs_information', 'under_review',
    'approved', 'declined', 'withdrawn'
  )),
  assigned_at timestamptz not null default now(),
  submitted_at timestamptz null,
  consented_at timestamptz null,
  consent_text text null,
  consent_terms_version text null,
  consent_terms_sha256 text null,
  consent_form_version text null,
  consent_form_sha256 text null,
  consent_request_context jsonb null,
  retain_until timestamptz null,
  retention_hold boolean not null default false,
  deletion_requested_at timestamptz null,
  deleted_at timestamptz null,
  updated_at timestamptz not null default now(),
  check (
    (status = 'draft' and submitted_at is null and consented_at is null) or
    (status <> 'draft' and submitted_at is not null and consented_at is not null)
  ),
  check (consent_terms_sha256 is null or consent_terms_sha256 ~ '^[0-9a-f]{64}$'),
  check (consent_form_sha256 is null or consent_form_sha256 ~ '^[0-9a-f]{64}$')
);

create index client_applications_owner_idx on public.client_applications(owner_user_id, assigned_at desc);
create index client_applications_staff_queue_idx on public.client_applications(status, submitted_at desc);
create index client_applications_retention_idx on public.client_applications(retain_until)
  where retain_until is not null and not retention_hold and deleted_at is null;

create table public.client_application_files (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.client_applications(id) on delete cascade,
  storage_path text not null unique,
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png')),
  byte_size bigint not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  scan_status text not null default 'screening_pending'
    check (scan_status in ('screening_pending', 'manual_review_required', 'cleared', 'rejected')),
  uploaded_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  deleted_at timestamptz null
);

create index client_application_files_application_idx
  on public.client_application_files(application_id, uploaded_at);

create table public.client_application_audit_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.client_applications(id) on delete cascade,
  actor_user_id uuid null references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('client', 'staff', 'system')),
  action text not null,
  request_context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index client_application_audit_idx
  on public.client_application_audit_events(application_id, created_at);

alter table public.client_profiles enable row level security;
alter table public.application_form_versions enable row level security;
alter table public.application_terms_versions enable row level security;
alter table public.client_applications enable row level security;
alter table public.client_application_files enable row level security;
alter table public.client_application_audit_events enable row level security;

revoke all on public.client_profiles from anon, authenticated;
revoke all on public.application_form_versions from anon, authenticated;
revoke all on public.application_terms_versions from anon, authenticated;
revoke all on public.client_applications from anon, authenticated;
revoke all on public.client_application_files from anon, authenticated;
revoke all on public.client_application_audit_events from anon, authenticated;

grant select on public.client_profiles, public.application_form_versions,
  public.application_terms_versions, public.client_applications,
  public.client_application_files, public.client_application_audit_events to authenticated;

create policy "clients read own active profile"
  on public.client_profiles for select to authenticated
  using (user_id = auth.uid() and is_active);

create policy "staff read client profiles"
  on public.client_profiles for select to authenticated
  using (public.is_active_admin(auth.uid()));

create policy "clients read assigned forms"
  on public.application_form_versions for select to authenticated
  using (exists (
    select 1 from public.client_applications application
    where application.form_version_id = application_form_versions.id
      and application.owner_user_id = auth.uid()
      and application.deleted_at is null
  ));

create policy "staff read application forms"
  on public.application_form_versions for select to authenticated
  using (public.is_active_admin(auth.uid()));

create policy "clients read assigned terms"
  on public.application_terms_versions for select to authenticated
  using (exists (
    select 1 from public.client_applications application
    where application.terms_version_id = application_terms_versions.id
      and application.owner_user_id = auth.uid()
      and application.deleted_at is null
  ));

create policy "staff read application terms"
  on public.application_terms_versions for select to authenticated
  using (public.is_active_admin(auth.uid()));

create policy "clients read own applications"
  on public.client_applications for select to authenticated
  using (owner_user_id = auth.uid() and deleted_at is null);

create policy "staff read applications"
  on public.client_applications for select to authenticated
  using (public.is_active_admin(auth.uid()));

create policy "clients read own file metadata"
  on public.client_application_files for select to authenticated
  using (exists (
    select 1 from public.client_applications application
    where application.id = client_application_files.application_id
      and application.owner_user_id = auth.uid()
      and application.deleted_at is null
  ));

create policy "staff read application file metadata"
  on public.client_application_files for select to authenticated
  using (public.is_active_admin(auth.uid()));

create policy "clients read own application audit"
  on public.client_application_audit_events for select to authenticated
  using (exists (
    select 1 from public.client_applications application
    where application.id = client_application_audit_events.application_id
      and application.owner_user_id = auth.uid()
      and application.deleted_at is null
  ));

create policy "staff read application audit"
  on public.client_application_audit_events for select to authenticated
  using (public.is_active_admin(auth.uid()));

-- Versioned source material is seeded as pending legal review. Provisioning or a
-- later append-only migration must explicitly approve a version before launch.
insert into public.application_form_versions (
  form_key, version, title, filename, content_type, content_text, sha256,
  legal_review_status, is_active
) values (
  'residential-rental-application',
  '2026-07-31.1',
  'Residential rental application',
  'ting-ting-rental-application-2026-07-31.1.txt',
  'text/plain',
  E'TING TING XU — RESIDENTIAL RENTAL APPLICATION\nForm version: 2026-07-31.1\n\nComplete this form and upload it through the authenticated Client Login. Do not email the completed form. Only provide information requested for the rental application.\n\nRental/property: ______________________________________________\nApplicant legal name: _________________________________________\nPreferred phone: ______________________________________________\nPreferred email: ______________________________________________\nCurrent address: ______________________________________________\nRequested move-in date: _______________________________________\n\nEmployment/income information relevant to tenancy:\n_______________________________________________________________\n\nReferences (name, relationship, and contact information):\n_______________________________________________________________\n\nOther information you want considered:\n_______________________________________________________________\n\nDo not sign this downloaded copy. The required authorization and screening consent are shown and recorded separately when you submit through the Client Login.\n',
  encode(digest(E'TING TING XU — RESIDENTIAL RENTAL APPLICATION\nForm version: 2026-07-31.1\n\nComplete this form and upload it through the authenticated Client Login. Do not email the completed form. Only provide information requested for the rental application.\n\nRental/property: ______________________________________________\nApplicant legal name: _________________________________________\nPreferred phone: ______________________________________________\nPreferred email: ______________________________________________\nCurrent address: ______________________________________________\nRequested move-in date: _______________________________________\n\nEmployment/income information relevant to tenancy:\n_______________________________________________________________\n\nReferences (name, relationship, and contact information):\n_______________________________________________________________\n\nOther information you want considered:\n_______________________________________________________________\n\nDo not sign this downloaded copy. The required authorization and screening consent are shown and recorded separately when you submit through the Client Login.\n', 'sha256'), 'hex'),
  'pending',
  true
);

insert into public.application_terms_versions (
  version, displayed_text, sha256, legal_review_status, is_active
) values (
  '2026-07-31.1',
  E'Application collection and consent notice\n\nTing Ting Xu/property management collects the completed application and supporting documents to assess the rental application, verify the information supplied, contact references, and communicate about the application. Information may be shared with the landlord of the unit being applied for and with service providers used for authorized screening and secure processing, only for those purposes.\n\nBy affirmatively agreeing at submission, the applicant authorizes the property manager to share application information with the landlord of the unit and consents to credit-score and reference checks for the rental application. Declining means the application cannot be submitted through this workflow. This consent does not include marketing.\n\nAccess is limited to authorized applicant and staff accounts. Submitted records are retained only for the approved operational/legal period, normally 12 months after submission unless a decision, dispute, legal duty, or authorized retention hold requires otherwise, then securely deleted or de-identified. To request access, correction, withdrawal, or deletion review, contact tingtingtech@outlook.com. Withdrawal may not require deletion where retention is legally required.\n\nVersion 2026-07-31.1. Draft for final legal/privacy review before production launch. The controller identity, recipient details, screening provider, credit-check type, retention exceptions, and applicant rights must be confirmed.\n',
  encode(digest(E'Application collection and consent notice\n\nTing Ting Xu/property management collects the completed application and supporting documents to assess the rental application, verify the information supplied, contact references, and communicate about the application. Information may be shared with the landlord of the unit being applied for and with service providers used for authorized screening and secure processing, only for those purposes.\n\nBy affirmatively agreeing at submission, the applicant authorizes the property manager to share application information with the landlord of the unit and consents to credit-score and reference checks for the rental application. Declining means the application cannot be submitted through this workflow. This consent does not include marketing.\n\nAccess is limited to authorized applicant and staff accounts. Submitted records are retained only for the approved operational/legal period, normally 12 months after submission unless a decision, dispute, legal duty, or authorized retention hold requires otherwise, then securely deleted or de-identified. To request access, correction, withdrawal, or deletion review, contact tingtingtech@outlook.com. Withdrawal may not require deletion where retention is legally required.\n\nVersion 2026-07-31.1. Draft for final legal/privacy review before production launch. The controller identity, recipient details, screening provider, credit-check type, retention exceptions, and applicant rights must be confirmed.\n', 'sha256'), 'hex'),
  'pending',
  true
);

comment on table public.client_applications is
  'Private client-owned rental applications. Consent evidence is copied immutably at submission.';
comment on table public.client_application_files is
  'Private bucket object metadata only; storage paths must never be exposed as public URLs.';
