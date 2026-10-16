-- Account-linked joint applications, durable invitation delivery and voluntary report submission.
-- Existing signed application snapshots and authorizations are preserved.
set search_path = public, extensions;

alter table public.application_applicants
  drop constraint application_applicants_check,
  add constraint application_applicants_account_check check (role = 'co_applicant' or owner_user_id is not null),
  add column invitation_delivery_status text null check (invitation_delivery_status in ('scheduled','sent','delivered','failed')),
  add column credit_report_voluntary_at timestamptz null,
  add column credit_report_consent_version text null;
create unique index application_applicants_active_user_idx on public.application_applicants(application_id, owner_user_id)
  where owner_user_id is not null and status <> 'revoked';
create index application_applicants_user_idx on public.application_applicants(owner_user_id, application_id) where owner_user_id is not null;

alter table public.owner_notification_deliveries drop constraint owner_notification_deliveries_kind_check;
alter table public.owner_notification_deliveries add constraint owner_notification_deliveries_kind_check check (
  kind in ('tenant_upload','weekly_tenant_summary','daily_overdue_rent_summary','showing_confirmation','application_submission','co_applicant_invitation')
);

create or replace function public.enqueue_applicant_invitation_email() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_applicant public.application_applicants%rowtype;
begin
  select * into strict v_applicant from public.application_applicants where id = new.applicant_id;
  insert into public.owner_notification_deliveries(notification_key,kind,payload)
    values ('co-applicant-invite:' || new.id::text, 'co_applicant_invitation', jsonb_build_object(
      'invitationId',new.id,'applicationId',v_applicant.application_id,'applicantId',new.applicant_id,'recipient',v_applicant.email));
  update public.application_applicants set invitation_delivery_status = 'scheduled' where id = new.applicant_id;
  return new;
end;
$$;
create trigger enqueue_applicant_invitation_email_after_insert after insert on public.application_applicant_invitations
for each row execute function public.enqueue_applicant_invitation_email();

create or replace function public.record_applicant_invitation_delivery() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'co_applicant_invitation' and new.status in ('sent','delivered','failed') and new.safe_error_code is distinct from 'STALE_OR_RESOLVED_OVERDUE_RENT' then
    update public.application_applicants a set invitation_delivery_status = new.status
    where a.id = (new.payload->>'applicantId')::uuid and exists (
      select 1 from public.application_applicant_invitations i where i.id = (new.payload->>'invitationId')::uuid
      and i.applicant_id = a.id and i.status <> 'revoked'
      and not exists(select 1 from public.application_applicant_invitations later where later.applicant_id = a.id and later.sent_at > i.sent_at)
    );
  end if;
  return new;
end;
$$;
create trigger record_applicant_invitation_delivery_after_update after update on public.owner_notification_deliveries
for each row execute function public.record_applicant_invitation_delivery();

create or replace function public.create_linked_applicant_invitation(
  p_application_id uuid,p_owner_user_id uuid,p_applicant_id uuid,p_invitation_id uuid,p_legal_name text,p_email text,
  p_token_sha256 text,p_expires_at timestamptz,p_draft jsonb,p_request_context jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() <> 'service_role' then raise insufficient_privilege; end if;
  perform 1 from public.client_applications where id=p_application_id and owner_user_id=p_owner_user_id and status='draft' and deleted_at is null for update;
  if not found then raise exception using errcode='TT409',message='application_not_draft'; end if;
  if exists(select 1 from public.application_applicant_signatures where application_id=p_application_id) then
    raise exception using errcode='TT409',message='application_signatures_locked'; end if;
  if (select count(*) from public.application_applicants where application_id=p_application_id and role='co_applicant' and status<>'revoked') >= 8 then
    raise exception using errcode='TT409',message='too_many_applicants'; end if;
  if exists(select 1 from auth.users where id=p_owner_user_id and lower(email)=lower(p_email)) then
    raise exception using errcode='23505',message='applicant_email_already_used'; end if;
  insert into public.application_applicants(id,application_id,role,legal_name,email,status,invitation_expires_at,draft_payload)
    values(p_applicant_id,p_application_id,'co_applicant',p_legal_name,lower(p_email),'invited',p_expires_at,p_draft);
  insert into public.application_applicant_invitations(id,applicant_id,token_sha256,expires_at,request_context)
    values(p_invitation_id,p_applicant_id,p_token_sha256,p_expires_at,p_request_context);
  insert into public.client_application_audit_events(application_id,actor_user_id,actor_type,action,request_context)
    values(p_application_id,p_owner_user_id,'client','application.co_applicant_invited',p_request_context || jsonb_build_object('applicantId',p_applicant_id));
  return p_applicant_id;
end;
$$;

create or replace function public.claim_linked_applicant_invitation(
 p_user_id uuid,p_invitation_sha256 text,p_session_sha256 text,p_session_expires_at timestamptz,p_request_context jsonb
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_applicant public.application_applicants%rowtype; v_id uuid;
begin
  if auth.role() <> 'service_role' then raise insufficient_privilege; end if;
  select a.* into v_applicant from public.application_applicants a join public.application_applicant_invitations i on i.applicant_id=a.id
    where i.token_sha256=p_invitation_sha256;
  if not found then raise exception using errcode='TT404',message='invitation_not_found'; end if;
  perform 1 from public.client_applications where id=v_applicant.application_id and deleted_at is null for update;
  if not found then raise exception using errcode='TT404',message='application_not_found'; end if;
  select * into v_applicant from public.application_applicants where id=v_applicant.id for update;
  if v_applicant.role <> 'co_applicant' or (v_applicant.owner_user_id is not null and v_applicant.owner_user_id <> p_user_id)
    or not exists(select 1 from auth.users u join public.client_profiles p on p.user_id=u.id and p.is_active
      where u.id=p_user_id and u.email_confirmed_at is not null and lower(u.email)=lower(v_applicant.email))
    or exists(select 1 from public.admin_profiles where user_id=p_user_id and is_active)
    or exists(select 1 from public.client_applications where id=v_applicant.application_id and owner_user_id=p_user_id)
    then raise exception using errcode='42501',message='invitation_account_mismatch'; end if;
  -- Existing exchange checks single-use, expiry and revocation under row locks.
  v_id := public.exchange_application_applicant_invitation(p_invitation_sha256,p_session_sha256,p_session_expires_at,p_request_context);
  update public.application_applicants set owner_user_id=p_user_id where id=v_id;
  insert into public.client_application_audit_events(application_id,actor_user_id,actor_type,action,request_context)
    values(v_applicant.application_id,p_user_id,'client','application.co_applicant_account_linked',jsonb_build_object('applicantId',v_id));
  return v_id;
end;
$$;

create or replace function public.resume_linked_applicant_session(p_user_id uuid,p_applicant_id uuid,p_session_sha256 text,p_expires_at timestamptz)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.role() <> 'service_role' then raise insufficient_privilege; end if;
  perform 1 from public.application_applicants a join public.client_applications app on app.id=a.application_id
    join public.client_profiles p on p.user_id=a.owner_user_id and p.is_active
    join auth.users u on u.id=p.user_id and u.email_confirmed_at is not null
    where a.id=p_applicant_id and a.owner_user_id=p_user_id and a.role='co_applicant' and a.status<>'revoked' and app.deleted_at is null
      and not exists(select 1 from public.admin_profiles where user_id=p_user_id and is_active)
    for update of a;
  if not found then raise exception using errcode='TT404',message='applicant_not_found'; end if;
  insert into public.application_guest_sessions(applicant_id,token_sha256,expires_at) values(p_applicant_id,p_session_sha256,p_expires_at);
  return p_applicant_id;
end;
$$;

-- New signatures must acknowledge a provided report; no external credit query is queued.
create or replace function public.record_voluntary_credit_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_applicant public.application_applicants%rowtype; v_draft jsonb; v_has_report boolean;
begin
  select * into strict v_applicant from public.application_applicants where id=new.applicant_id;
  if v_applicant.role='co_applicant' and v_applicant.owner_user_id is null then
    raise exception using errcode='42501',message='verified_applicant_account_required'; end if;
  if v_applicant.role='primary' then select draft_payload into v_draft from public.client_applications where id=new.application_id;
  else v_draft := v_applicant.draft_payload; end if;
  select exists(select 1 from public.client_application_files where applicant_id=new.applicant_id and document_type='credit_score_report') into v_has_report;
  if v_has_report and (v_draft->>'creditReportVoluntary') is distinct from 'true' then
    raise exception using errcode='TT409',message='credit_report_confirmation_required'; end if;
  update public.application_applicants set credit_report_voluntary_at=case when v_has_report then new.signed_at else null end,
    credit_report_consent_version=case when v_has_report then '2026-10-15.1' else null end where id=new.applicant_id;
  return new;
end;
$$;
create trigger record_voluntary_credit_report_before_signature before insert on public.application_applicant_signatures
for each row execute function public.record_voluntary_credit_report();

create or replace function public.reset_voluntary_credit_report() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.document_type='credit_score_report' then
    if exists(select 1 from public.application_applicants where id=new.applicant_id and role='primary') then
      update public.client_applications set draft_payload=jsonb_set(draft_payload,'{creditReportVoluntary}','false'::jsonb) where id=new.application_id;
    else
      update public.application_applicants set draft_payload=jsonb_set(draft_payload,'{creditReportVoluntary}','false'::jsonb) where id=new.applicant_id;
    end if;
  end if;
  return new;
end;
$$;
create trigger reset_voluntary_credit_report_before_upload before insert on public.client_application_files
for each row execute function public.reset_voluntary_credit_report();

update public.application_credit_check_requests set status='cancelled',updated_at=now() where status='pending' and provider_request_id is null;

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

create or replace function public.resend_linked_applicant_invitation(
  p_application_id uuid,
  p_owner_user_id uuid,
  p_applicant_id uuid,
  p_token_sha256 text,
  p_expires_at timestamptz,
  p_invitation_id uuid,
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
    id, applicant_id, token_sha256, status, expires_at, sent_at, request_context
  ) values (
    p_invitation_id, p_applicant_id, p_token_sha256, 'active', p_expires_at, v_now, p_request_context
  );
  update public.application_applicants
  set invitation_expires_at = p_expires_at, updated_at = v_now
  where id = p_applicant_id;
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
  values (p_application_id, p_owner_user_id, 'client', 'application.co_applicant_reinvited',
    p_request_context || jsonb_build_object('applicantId', p_applicant_id));
end;
$$;

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

  if not exists (
    select 1 from public.client_applications application
    join public.client_application_lease_files lease
      on lease.id = application.converted_lease_file_id
      and lease.application_id = application.id
    where (application.owner_user_id = p_client_user_id or exists (select 1 from public.application_applicants member where member.application_id=application.id and member.owner_user_id=p_client_user_id and member.role='co_applicant' and member.status='signed'))
      and application.converted_tenant_id = p_tenant_id
      and application.status = 'approved'
      and application.signed_agreement_confirmed_at is not null
      and application.deleted_at is null
      and lease.deleted_at is null
  ) then
    raise exception using errcode = 'TT409', message = 'confirmed signed lease required to link user as tenant';
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

create or replace function public.link_joint_lease_members() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_member record;
begin
  if new.converted_tenant_id is not null and new.signed_agreement_confirmed_at is not null and new.converted_lease_file_id is not null
    and old.converted_tenant_id is null then
    for v_member in select owner_user_id from public.application_applicants where application_id=new.id and role='co_applicant' and status='signed' and owner_user_id is not null order by owner_user_id
    loop
      perform public.admin_link_client_tenant(v_member.owner_user_id,new.converted_tenant_id,new.converted_by);
    end loop;
  end if;
  return new;
end;
$$;
create trigger link_joint_lease_members_after_confirmation after update of converted_tenant_id on public.client_applications
for each row execute function public.link_joint_lease_members();

do $migration$
declare v_id uuid; v_terms text := $terms$Application collection and consent notice

Ting Ting Xu/property management collects the completed application and supporting
documents to assess the rental application, verify the information supplied, contact
references, and communicate about the application. Information may be shared with the
landlord of the unit being applied for and with service providers used for authorized
verification and secure processing, only for those purposes.

By affirmatively agreeing at submission, the applicant authorizes the property manager
to share application information with the landlord of the unit and consents to reference,
housing and income verification and review of documents voluntarily provided. The
website does not request credit checks from credit agencies. Each applicant who uploads
a credit score report must personally confirm that they voluntarily provide it for
assessment of their rental application. Declining the required verification means the application
cannot be submitted through this workflow. This consent does not include marketing.

Access is limited to authorized applicant and staff accounts. Submitted records are
retained only for the approved operational/legal period, normally 12 months after
submission unless a decision, dispute, legal duty, or authorized retention hold requires
otherwise, then securely deleted or de-identified. To request access, correction,
withdrawal, or deletion review, contact info@silverkey.ca. Withdrawal may not
require deletion where retention is legally required.

Version 2026-10-15.1.
$terms$;
begin
  insert into public.application_terms_versions(version,displayed_text,sha256,legal_review_status,is_active)
    values('2026-10-15.1',v_terms,encode(extensions.digest(v_terms,'sha256'),'hex'),'approved',false) returning id into v_id;
  update public.application_terms_versions set is_active=false where is_active;
  update public.application_terms_versions set is_active=true where id=v_id;
  update public.client_applications a set terms_version_id=v_id,updated_at=now() where status='draft'
    and not exists(select 1 from public.application_applicant_signatures s where s.application_id=a.id);
end;
$migration$;

revoke all on function public.create_linked_applicant_invitation(uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb) from public, anon, authenticated;
grant execute on function public.create_linked_applicant_invitation(uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb) to service_role;

revoke all on function public.claim_linked_applicant_invitation(uuid,text,text,timestamptz,jsonb) from public, anon, authenticated;
grant execute on function public.claim_linked_applicant_invitation(uuid,text,text,timestamptz,jsonb) to service_role;

revoke all on function public.resume_linked_applicant_session(uuid,uuid,text,timestamptz) from public, anon, authenticated;
grant execute on function public.resume_linked_applicant_session(uuid,uuid,text,timestamptz) to service_role;

revoke all on function public.resend_linked_applicant_invitation(uuid,uuid,uuid,text,timestamptz,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.resend_linked_applicant_invitation(uuid,uuid,uuid,text,timestamptz,uuid,jsonb) to service_role;

revoke all on function public.enqueue_applicant_invitation_email() from public, anon, authenticated;

revoke all on function public.record_applicant_invitation_delivery() from public, anon, authenticated;

revoke all on function public.record_voluntary_credit_report() from public, anon, authenticated;

revoke all on function public.reset_voluntary_credit_report() from public, anon, authenticated;

revoke all on function public.link_joint_lease_members() from public, anon, authenticated;

-- Personal drafts and files lock only when their own applicant signs.
-- Shared household details and the co-applicant roster lock when anyone signs.
create or replace function public.prevent_signed_application_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.draft_payload is distinct from old.draft_payload
    and exists (select 1 from public.application_applicant_signatures s join public.application_applicants a on a.id=s.applicant_id where s.application_id=old.id and (a.role='primary' or (new.draft_payload->'tenancy') is distinct from (old.draft_payload->'tenancy'))) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  return new;
end;
$$;


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
    and (((new.legal_name is distinct from old.legal_name or new.email is distinct from old.email) and (old.role='co_applicant' or old.status='signed'))
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
    or exists (select 1 from public.application_applicant_signatures where applicant_id=v_applicant_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;


