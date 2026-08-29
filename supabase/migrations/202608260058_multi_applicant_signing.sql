-- Multi-applicant applications. Browser roles remain read-only; owner and guest
-- mutations are mediated by server routes using the service role. Invitation and
-- session bearer values are never stored, only their SHA-256 hashes.

create table public.application_applicants (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.client_applications(id) on delete cascade,
  role text not null check (role in ('primary', 'co_applicant')),
  owner_user_id uuid null references auth.users(id) on delete set null,
  legal_name text not null check (char_length(legal_name) between 1 and 160),
  email text not null check (char_length(email) between 3 and 254),
  status text not null check (status in ('invited', 'in_progress', 'signed', 'revoked')),
  draft_payload jsonb not null default '{}'::jsonb check (jsonb_typeof(draft_payload) = 'object'),
  draft_updated_at timestamptz null,
  invitation_expires_at timestamptz null,
  signed_at timestamptz null,
  revoked_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (application_id, id),
  check (
    (role = 'primary' and owner_user_id is not null) or
    (role = 'co_applicant' and owner_user_id is null)
  )
);

create unique index application_applicants_one_primary_idx
  on public.application_applicants(application_id) where role = 'primary';
create unique index application_applicants_active_email_idx
  on public.application_applicants(application_id, lower(email)) where status <> 'revoked';
create index application_applicants_application_idx
  on public.application_applicants(application_id, created_at);

create table public.application_applicant_invitations (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.application_applicants(id) on delete cascade,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null default 'active' check (status in ('active', 'used', 'revoked')),
  expires_at timestamptz not null,
  sent_at timestamptz not null default now(),
  used_at timestamptz null,
  revoked_at timestamptz null,
  request_context jsonb not null default '{}'::jsonb
);

create index application_applicant_invitations_active_idx
  on public.application_applicant_invitations(applicant_id, expires_at desc)
  where status = 'active';

create table public.application_guest_sessions (
  id uuid primary key default gen_random_uuid(),
  applicant_id uuid not null references public.application_applicants(id) on delete cascade,
  token_sha256 text not null unique check (token_sha256 ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz null
);

create index application_guest_sessions_applicant_idx
  on public.application_guest_sessions(applicant_id, expires_at desc)
  where revoked_at is null;

create table public.application_applicant_signatures (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.client_applications(id) on delete cascade,
  applicant_id uuid not null unique,
  signature_legal_name text not null check (char_length(signature_legal_name) between 1 and 160),
  sharing_authorized boolean not null check (sharing_authorized),
  screening_consented boolean not null check (screening_consented),
  terms_version text not null,
  terms_sha256 text not null check (terms_sha256 ~ '^[0-9a-f]{64}$'),
  form_version text not null,
  form_sha256 text not null check (form_sha256 ~ '^[0-9a-f]{64}$'),
  displayed_terms_text text not null,
  document_snapshot_sha256 text not null check (document_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  request_context jsonb not null default '{}'::jsonb,
  signed_at timestamptz not null default now(),
  foreign key (application_id, applicant_id)
    references public.application_applicants(application_id, id) on delete cascade
);

create index application_applicant_signatures_application_idx
  on public.application_applicant_signatures(application_id, signed_at);

create table public.application_credit_check_requests (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.client_applications(id) on delete cascade,
  applicant_id uuid not null unique,
  status text not null default 'pending' check (status in ('pending', 'requested', 'completed', 'failed', 'cancelled')),
  idempotency_key text not null unique,
  provider_request_id text null,
  requested_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (application_id, applicant_id)
    references public.application_applicants(application_id, id) on delete cascade
);

alter table public.client_application_files add column applicant_id uuid null;

insert into public.application_applicants (
  application_id, role, owner_user_id, legal_name, email, status, draft_payload, draft_updated_at
)
select application.id, 'primary', application.owner_user_id,
  coalesce(nullif(trim(profile.display_name), ''), 'Primary applicant'),
  coalesce(nullif(trim(auth_user.email), ''), 'unknown@example.invalid'),
  case when application.status = 'draft' then 'in_progress' else 'signed' end,
  application.draft_payload, application.draft_updated_at
from public.client_applications application
join public.client_profiles profile on profile.user_id = application.owner_user_id
left join auth.users auth_user on auth_user.id = application.owner_user_id
on conflict do nothing;

update public.client_application_files file
set applicant_id = applicant.id
from public.application_applicants applicant
where applicant.application_id = file.application_id
  and applicant.role = 'primary'
  and file.applicant_id is null;

alter table public.client_application_files
  alter column applicant_id set not null,
  add constraint client_application_files_applicant_fkey
    foreign key (application_id, applicant_id)
    references public.application_applicants(application_id, id) on delete cascade;

drop policy if exists "clients read own file metadata" on public.client_application_files;
create policy "clients read own primary file metadata"
  on public.client_application_files for select to authenticated
  using (exists (
    select 1
    from public.client_applications application
    join public.application_applicants applicant
      on applicant.application_id = application.id and applicant.role = 'primary'
    where application.id = client_application_files.application_id
      and applicant.id = client_application_files.applicant_id
      and application.owner_user_id = (select auth.uid())
      and application.deleted_at is null
  ));

create or replace function public.prevent_signed_application_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.draft_payload is distinct from old.draft_payload
    and exists (select 1 from public.application_applicant_signatures where application_id = old.id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  return new;
end;
$$;

create trigger prevent_signed_application_draft_update
before update of draft_payload on public.client_applications
for each row execute function public.prevent_signed_application_mutation();

create or replace function public.prevent_signed_applicant_roster_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application_id uuid := case when tg_op = 'DELETE' then old.application_id else new.application_id end;
begin
  if tg_op = 'INSERT' then
    perform 1 from public.client_applications where id = v_application_id for update;
  end if;
  if tg_op = 'INSERT' and new.role = 'co_applicant'
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  elsif tg_op = 'DELETE' and old.role = 'co_applicant'
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  elsif tg_op = 'UPDATE'
    and (new.legal_name is distinct from old.legal_name
      or new.email is distinct from old.email
      or (new.status = 'revoked' and old.status <> 'revoked'))
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  if tg_op = 'UPDATE' and new.draft_payload is distinct from old.draft_payload and old.status = 'signed' then
    raise exception using errcode = 'TT409', message = 'applicant_signed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger prevent_signed_applicant_roster_change
before insert or update or delete on public.application_applicants
for each row execute function public.prevent_signed_applicant_roster_mutation();

create or replace function public.prevent_signed_applicant_file_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application_id uuid := case when tg_op = 'DELETE' then old.application_id else new.application_id end;
  v_applicant_id uuid := case when tg_op = 'DELETE' then old.applicant_id else new.applicant_id end;
  v_applicant public.application_applicants%rowtype;
begin
  perform 1 from public.client_applications where id = v_application_id for update;
  select * into v_applicant from public.application_applicants
  where id = v_applicant_id and application_id = v_application_id for update;
  if v_applicant.status = 'signed'
    or (v_applicant.role = 'primary' and exists (
      select 1 from public.application_applicant_signatures where application_id = v_application_id
    )) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger prevent_signed_applicant_file_change
before insert or delete on public.client_application_files
for each row execute function public.prevent_signed_applicant_file_mutation();

create or replace function public.ensure_primary_application_applicant()
returns trigger
language plpgsql
security definer
set search_path = public, auth, pg_temp
as $$
begin
  insert into public.application_applicants(
    application_id, role, owner_user_id, legal_name, email, status, draft_payload, draft_updated_at
  )
  select new.id, 'primary', new.owner_user_id,
    coalesce(nullif(trim(profile.display_name), ''), 'Primary applicant'),
    coalesce(nullif(trim(auth_user.email), ''), 'unknown@example.invalid'),
    'in_progress', new.draft_payload, new.draft_updated_at
  from public.client_profiles profile
  left join auth.users auth_user on auth_user.id = new.owner_user_id
  where profile.user_id = new.owner_user_id;
  return new;
end;
$$;

create trigger ensure_primary_application_applicant_after_insert
after insert on public.client_applications
for each row execute function public.ensure_primary_application_applicant();

alter table public.client_application_audit_events
  drop constraint if exists client_application_audit_events_actor_type_check;
alter table public.client_application_audit_events
  add constraint client_application_audit_events_actor_type_check
  check (actor_type in ('client', 'guest', 'staff', 'system'));

drop policy if exists "clients read own application audit" on public.client_application_audit_events;
create policy "clients read own client-authored application audit"
  on public.client_application_audit_events for select to authenticated
  using (
    actor_type = 'client'
    and actor_user_id = (select auth.uid())
    and exists (
      select 1 from public.client_applications application
      where application.id = client_application_audit_events.application_id
        and application.owner_user_id = (select auth.uid())
        and application.deleted_at is null
    )
  );

create or replace function public.prevent_application_signature_tampering()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Cascading retention deletion is initiated by a parent-table FK trigger.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception using errcode = 'TT425', message = 'signature_evidence_immutable';
end;
$$;

create trigger application_signature_evidence_immutable
before update or delete on public.application_applicant_signatures
for each row execute function public.prevent_application_signature_tampering();

revoke update, delete on public.application_applicant_signatures from service_role;

create or replace function public.exchange_application_applicant_invitation(
  p_invitation_sha256 text,
  p_session_sha256 text,
  p_session_expires_at timestamptz,
  p_request_context jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_invitation public.application_applicant_invitations%rowtype;
  v_applicant public.application_applicants%rowtype;
begin
  select * into v_invitation
  from public.application_applicant_invitations
  where token_sha256 = p_invitation_sha256
  for update;
  if not found then raise exception using errcode = 'TT404', message = 'invitation_not_found'; end if;
  select * into v_applicant from public.application_applicants where id = v_invitation.applicant_id for update;
  if v_applicant.status = 'revoked' or v_invitation.status = 'revoked' then
    raise exception using errcode = 'TT410', message = 'invitation_revoked';
  end if;
  if v_invitation.status = 'used' then
    raise exception using errcode = 'TT409', message = 'invitation_used';
  end if;
  if v_invitation.expires_at <= now() then
    raise exception using errcode = 'TT410', message = 'invitation_expired';
  end if;
  update public.application_applicant_invitations
  set status = 'used', used_at = now()
  where id = v_invitation.id;
  update public.application_applicants
  set status = case when status = 'invited' then 'in_progress' else status end, updated_at = now()
  where id = v_applicant.id;
  insert into public.application_guest_sessions(applicant_id, token_sha256, expires_at)
  values (v_applicant.id, p_session_sha256, p_session_expires_at);
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
  values (v_applicant.application_id, null, 'guest', 'application.guest_session_started', p_request_context);
  return v_applicant.id;
end;
$$;

create or replace function public.resend_application_applicant_invitation(
  p_application_id uuid,
  p_owner_user_id uuid,
  p_applicant_id uuid,
  p_token_sha256 text,
  p_expires_at timestamptz,
  p_request_context jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.client_applications%rowtype;
  v_applicant public.application_applicants%rowtype;
  v_now timestamptz := now();
begin
  select * into v_application from public.client_applications
  where id = p_application_id and owner_user_id = p_owner_user_id and deleted_at is null
  for update;
  if not found then raise exception using errcode = 'TT404', message = 'application_not_found'; end if;
  if v_application.status <> 'draft' then raise exception using errcode = 'TT409', message = 'application_not_draft'; end if;

  select * into v_applicant from public.application_applicants
  where id = p_applicant_id and application_id = p_application_id and role = 'co_applicant'
  for update;
  if not found then raise exception using errcode = 'TT404', message = 'applicant_not_found'; end if;
  if v_applicant.status = 'revoked' then raise exception using errcode = 'TT409', message = 'applicant_revoked'; end if;
  if v_applicant.status = 'signed' then raise exception using errcode = 'TT409', message = 'applicant_signed'; end if;

  update public.application_applicant_invitations
  set status = 'revoked', revoked_at = v_now
  where applicant_id = p_applicant_id and status = 'active';
  update public.application_guest_sessions
  set revoked_at = v_now
  where applicant_id = p_applicant_id and revoked_at is null;
  insert into public.application_applicant_invitations(
    applicant_id, token_sha256, status, expires_at, sent_at, request_context
  ) values (
    p_applicant_id, p_token_sha256, 'active', p_expires_at, v_now, p_request_context
  );
  update public.application_applicants
  set invitation_expires_at = p_expires_at, updated_at = v_now
  where id = p_applicant_id;
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
  values (p_application_id, p_owner_user_id, 'client', 'application.co_applicant_reinvited',
    p_request_context || jsonb_build_object('applicantId', p_applicant_id));
end;
$$;

create or replace function public.normalize_application_legal_name(p_value text)
returns text
language sql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
  select lower(regexp_replace(trim(p_value), '\s+', ' ', 'g'));
$$;

create or replace function public.sign_guest_application_applicant(
  p_session_sha256 text,
  p_signature_legal_name text,
  p_terms_version text,
  p_terms_sha256 text,
  p_form_version text,
  p_form_sha256 text,
  p_displayed_terms_text text,
  p_expected_draft_payload jsonb,
  p_expected_files jsonb,
  p_request_context jsonb,
  p_signed_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.client_applications%rowtype;
  v_applicant public.application_applicants%rowtype;
  v_applicant_id uuid;
  v_application_id uuid;
  v_form public.application_form_versions%rowtype;
  v_terms public.application_terms_versions%rowtype;
  v_draft_name text;
  v_files jsonb;
  v_snapshot_sha256 text;
begin
  select applicant.id, applicant.application_id into v_applicant_id, v_application_id
  from public.application_guest_sessions session
  join public.application_applicants applicant on applicant.id = session.applicant_id
  where session.token_sha256 = p_session_sha256
  limit 1;
  if not found then raise exception using errcode = 'TT401', message = 'guest_session_invalid'; end if;

  select * into v_application from public.client_applications
  where id = v_application_id and deleted_at is null for update;
  if not found or v_application.status <> 'draft' then raise exception using errcode = 'TT409', message = 'application_not_draft'; end if;
  select * into v_applicant from public.application_applicants
  where id = v_applicant_id and application_id = v_application_id for update;
  if not found then raise exception using errcode = 'TT401', message = 'guest_session_invalid'; end if;
  perform 1 from public.application_guest_sessions
  where token_sha256 = p_session_sha256 and applicant_id = v_applicant.id
    and revoked_at is null and expires_at > now()
  for update;
  if not found then raise exception using errcode = 'TT401', message = 'guest_session_invalid'; end if;
  if v_applicant.status = 'revoked' then raise exception using errcode = 'TT410', message = 'applicant_revoked'; end if;
  if v_applicant.status = 'signed' then raise exception using errcode = 'TT409', message = 'applicant_signed'; end if;

  select * into v_form from public.application_form_versions where id = v_application.form_version_id;
  select * into v_terms from public.application_terms_versions where id = v_application.terms_version_id;
  if p_form_version <> v_form.version or p_form_sha256 <> v_form.sha256
    or p_terms_version <> v_terms.version or p_terms_sha256 <> v_terms.sha256
    or p_displayed_terms_text <> v_terms.displayed_text then
    raise exception using errcode = 'TT409', message = 'application_version_changed';
  end if;
  v_draft_name := concat_ws(' ',
    nullif(trim(v_applicant.draft_payload #>> '{personal,legalFirstName}'), ''),
    nullif(trim(v_applicant.draft_payload #>> '{personal,legalLastName}'), '')
  );
  if public.normalize_application_legal_name(p_signature_legal_name) <> public.normalize_application_legal_name(v_applicant.legal_name)
    or public.normalize_application_legal_name(v_draft_name) <> public.normalize_application_legal_name(v_applicant.legal_name) then
    raise exception using errcode = 'TT422', message = 'applicant_identity_mismatch';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked_file.id::text,
    'documentType', locked_file.document_type,
    'byteSize', locked_file.byte_size,
    'scanStatus', locked_file.scan_status
  ) order by locked_file.id), '[]'::jsonb) into v_files
  from (
    select id, document_type, byte_size, scan_status
    from public.client_application_files
    where application_id = v_application.id and applicant_id = v_applicant.id and deleted_at is null
    order by id for update
  ) locked_file;
  if v_applicant.draft_payload <> p_expected_draft_payload or v_files <> p_expected_files then
    raise exception using errcode = 'TT409', message = 'application_snapshot_changed';
  end if;
  v_snapshot_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'applicationId', v_application.id,
    'applicantId', v_applicant.id,
    'draft', v_applicant.draft_payload,
    'files', v_files,
    'signatureLegalName', p_signature_legal_name,
    'termsVersion', v_terms.version,
    'termsSha256', v_terms.sha256,
    'formVersion', v_form.version,
    'formSha256', v_form.sha256
  )::text, 'UTF8'), 'sha256'), 'hex');

  insert into public.application_applicant_signatures(
    application_id, applicant_id, signature_legal_name,
    sharing_authorized, screening_consented,
    terms_version, terms_sha256, form_version, form_sha256,
    displayed_terms_text, document_snapshot_sha256, request_context, signed_at
  ) values (
    v_applicant.application_id, v_applicant.id, p_signature_legal_name,
    true, true, p_terms_version, p_terms_sha256, p_form_version, p_form_sha256,
    v_terms.displayed_text, v_snapshot_sha256, p_request_context, p_signed_at
  );
  update public.application_applicants
  set status = 'signed', signed_at = p_signed_at, updated_at = p_signed_at
  where id = v_applicant.id;
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
  values (v_applicant.application_id, null, 'guest', 'application.co_applicant_signed',
    p_request_context || jsonb_build_object('applicantId', v_applicant.id, 'evidenceHash', v_snapshot_sha256));
  return v_applicant.id;
end;
$$;

create or replace function public.finalize_multi_applicant_application(
  p_application_id uuid,
  p_owner_user_id uuid,
  p_signature_legal_name text,
  p_terms_version text,
  p_terms_sha256 text,
  p_form_version text,
  p_form_sha256 text,
  p_displayed_terms_text text,
  p_expected_draft_payload jsonb,
  p_expected_files jsonb,
  p_request_context jsonb,
  p_submitted_at timestamptz,
  p_retain_until timestamptz
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application public.client_applications%rowtype;
  v_primary public.application_applicants%rowtype;
  v_form public.application_form_versions%rowtype;
  v_terms public.application_terms_versions%rowtype;
  v_draft_name text;
  v_files jsonb;
  v_snapshot_sha256 text;
begin
  select * into v_application from public.client_applications
  where id = p_application_id and owner_user_id = p_owner_user_id and deleted_at is null
  for update;
  if not found then raise exception using errcode = 'TT404', message = 'application_not_found'; end if;
  if v_application.status <> 'draft' then raise exception using errcode = 'TT409', message = 'application_not_draft'; end if;
  perform id from public.application_applicants where application_id = p_application_id order by id for update;
  if exists (
    select 1 from public.application_applicants
    where application_id = p_application_id and role = 'co_applicant'
      and status not in ('signed', 'revoked')
  ) then raise exception using errcode = 'TT409', message = 'co_applicants_unsigned'; end if;
  select * into v_primary from public.application_applicants
  where application_id = p_application_id and role = 'primary' for update;
  if not found then raise exception using errcode = 'TT500', message = 'primary_applicant_missing'; end if;

  select * into v_form from public.application_form_versions where id = v_application.form_version_id;
  select * into v_terms from public.application_terms_versions where id = v_application.terms_version_id;
  if p_form_version <> v_form.version or p_form_sha256 <> v_form.sha256
    or p_terms_version <> v_terms.version or p_terms_sha256 <> v_terms.sha256
    or p_displayed_terms_text <> v_terms.displayed_text then
    raise exception using errcode = 'TT409', message = 'application_version_changed';
  end if;
  v_draft_name := concat_ws(' ',
    nullif(trim(v_application.draft_payload #>> '{personal,legalFirstName}'), ''),
    nullif(trim(v_application.draft_payload #>> '{personal,legalLastName}'), '')
  );
  if public.normalize_application_legal_name(p_signature_legal_name) <> public.normalize_application_legal_name(v_draft_name) then
    raise exception using errcode = 'TT422', message = 'applicant_identity_mismatch';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', locked_file.id::text,
    'documentType', locked_file.document_type,
    'byteSize', locked_file.byte_size,
    'scanStatus', locked_file.scan_status
  ) order by locked_file.id), '[]'::jsonb) into v_files
  from (
    select id, document_type, byte_size, scan_status
    from public.client_application_files
    where application_id = v_application.id and applicant_id = v_primary.id and deleted_at is null
    order by id for update
  ) locked_file;
  if v_application.draft_payload <> p_expected_draft_payload or v_files <> p_expected_files then
    raise exception using errcode = 'TT409', message = 'application_snapshot_changed';
  end if;
  v_snapshot_sha256 := encode(extensions.digest(convert_to(jsonb_build_object(
    'applicationId', v_application.id,
    'applicantId', v_primary.id,
    'draft', v_application.draft_payload,
    'files', v_files,
    'signatureLegalName', p_signature_legal_name,
    'termsVersion', v_terms.version,
    'termsSha256', v_terms.sha256,
    'formVersion', v_form.version,
    'formSha256', v_form.sha256
  )::text, 'UTF8'), 'sha256'), 'hex');

  update public.application_applicants
  set legal_name = p_signature_legal_name, updated_at = p_submitted_at
  where id = v_primary.id;
  insert into public.application_applicant_signatures(
    application_id, applicant_id, signature_legal_name,
    sharing_authorized, screening_consented,
    terms_version, terms_sha256, form_version, form_sha256,
    displayed_terms_text, document_snapshot_sha256, request_context, signed_at
  ) values (
    p_application_id, v_primary.id, p_signature_legal_name,
    true, true, p_terms_version, p_terms_sha256, p_form_version, p_form_sha256,
    v_terms.displayed_text, v_snapshot_sha256, p_request_context, p_submitted_at
  );
  update public.application_applicants
  set status = 'signed', signed_at = p_submitted_at, updated_at = p_submitted_at
  where id = v_primary.id;
  insert into public.application_credit_check_requests(application_id, applicant_id, status, idempotency_key)
  select p_application_id, applicant.id, 'pending', p_application_id::text || ':' || applicant.id::text
  from public.application_applicants applicant
  where applicant.application_id = p_application_id and applicant.status = 'signed'
  on conflict (applicant_id) do nothing;
  update public.client_applications set
    status = 'submitted', submitted_at = p_submitted_at, consented_at = p_submitted_at,
    consent_text = v_terms.displayed_text,
    consent_terms_version = p_terms_version, consent_terms_sha256 = p_terms_sha256,
    consent_form_version = p_form_version, consent_form_sha256 = p_form_sha256,
    consent_request_context = p_request_context, retain_until = p_retain_until, updated_at = p_submitted_at
  where id = p_application_id;
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
  values (p_application_id, p_owner_user_id, 'client', 'application.submitted', p_request_context);
end;
$$;

alter table public.application_applicants enable row level security;
alter table public.application_applicant_invitations enable row level security;
alter table public.application_guest_sessions enable row level security;
alter table public.application_applicant_signatures enable row level security;
alter table public.application_credit_check_requests enable row level security;

revoke all on public.application_applicants,
  public.application_applicant_invitations,
  public.application_guest_sessions,
  public.application_applicant_signatures,
  public.application_credit_check_requests from anon, authenticated;

revoke all on function public.ensure_primary_application_applicant() from public, anon, authenticated;
revoke all on function public.prevent_signed_application_mutation() from public, anon, authenticated;
revoke all on function public.prevent_signed_applicant_roster_mutation() from public, anon, authenticated;
revoke all on function public.prevent_signed_applicant_file_mutation() from public, anon, authenticated;
revoke all on function public.prevent_application_signature_tampering() from public, anon, authenticated;
revoke all on function public.exchange_application_applicant_invitation(text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.resend_application_applicant_invitation(uuid, uuid, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
revoke all on function public.normalize_application_legal_name(text) from public, anon, authenticated;
revoke all on function public.sign_guest_application_applicant(text, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.finalize_multi_applicant_application(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.exchange_application_applicant_invitation(text, text, timestamptz, jsonb) to service_role;
grant execute on function public.resend_application_applicant_invitation(uuid, uuid, uuid, text, timestamptz, jsonb) to service_role;
grant execute on function public.sign_guest_application_applicant(text, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz) to service_role;
grant execute on function public.finalize_multi_applicant_application(uuid, uuid, text, text, text, text, text, text, jsonb, jsonb, jsonb, timestamptz, timestamptz) to service_role;

comment on table public.application_applicant_signatures is
  'Immutable per-person consent and typed-signature evidence associated with retained form/terms hashes.';
comment on table public.application_credit_check_requests is
  'Idempotent screening work items. Pending rows do not imply a vendor request has been performed.';
