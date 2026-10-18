-- The primary seals their signed draft immediately; the application becomes submitted
-- only after the exact declared adult roster has signed. Notifications are atomic.

alter table public.client_applications drop constraint client_applications_check;
alter table public.client_applications add constraint client_applications_check check (
  (status = 'draft' and submitted_at is null) or
  (status <> 'draft' and submitted_at is not null and consented_at is not null)
);

create or replace function public.application_adult_count(p_draft jsonb)
returns integer language plpgsql immutable set search_path = public, pg_temp as $$
declare v_count text := p_draft #>> '{tenancy,adultCount}';
begin
  if jsonb_typeof(p_draft #> '{tenancy,adultCount}') is distinct from 'number'
    or v_count !~ '^(1[0-2]|[1-9])$' then
    raise exception using errcode = 'TT422', message = 'tenancy_adult_count_required';
  end if;
  return v_count::integer;
end;
$$;

create or replace function public.assert_application_applicant_roster(p_application_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_draft jsonb; v_adults integer;
begin
  select draft_payload into v_draft from public.client_applications
    where id = p_application_id and deleted_at is null for update;
  if not found then raise exception using errcode = 'TT404', message = 'application_not_found'; end if;
  v_adults := public.application_adult_count(v_draft);
  if (select count(*) from public.application_applicants
      where application_id = p_application_id and role = 'co_applicant' and status <> 'revoked') <> v_adults - 1 then
    raise exception using errcode = 'TT409', message = 'co_applicant_roster_incomplete';
  end if;
end;
$$;

create or replace function public.assert_application_materials_approved(p_application_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_form_status text; v_terms_status text;
begin
  -- Hold review decisions stable until the signature/submission transaction commits.
  select f.legal_review_status into v_form_status from public.application_form_versions f
    join public.client_applications a on a.form_version_id = f.id where a.id = p_application_id for share of f;
  select t.legal_review_status into v_terms_status from public.application_terms_versions t
    join public.client_applications a on a.terms_version_id = t.id where a.id = p_application_id for share of t;
  if v_form_status is distinct from 'approved' or v_terms_status is distinct from 'approved' then
    raise exception using errcode = 'TT409', message = 'application_materials_not_approved';
  end if;
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
  elsif tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.status = 'revoked' or old.status = 'revoked') and new.status is distinct from old.status) then
    -- UPDATE/DELETE already own the applicant row. Never wait on a signer
    -- holding the parent while it waits to lock this applicant.
    begin
      perform 1 from public.client_applications where id = v_application_id for update nowait;
    exception when lock_not_available then
      raise exception using errcode = 'TT409', message = 'application_signing_in_progress';
    end;
  end if;
  if tg_op = 'UPDATE' and (new.application_id is distinct from old.application_id or new.role is distinct from old.role or new.id is distinct from old.id) then
    raise exception using errcode = 'TT409', message = 'applicant_identity_locked';
  end if;
  if tg_op = 'UPDATE' and old.status = 'signed' and (new.status is distinct from old.status or new.owner_user_id is distinct from old.owner_user_id or new.signed_at is distinct from old.signed_at) then
    raise exception using errcode = 'TT409', message = 'applicant_signed';
  end if;
  if tg_op = 'INSERT' and new.role = 'co_applicant'
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  elsif tg_op = 'DELETE' and old.role = 'co_applicant'
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  elsif tg_op = 'UPDATE'
    and ((new.legal_name is distinct from old.legal_name and old.status = 'signed')
      or (new.email is distinct from old.email and (old.role = 'co_applicant' or old.status = 'signed'))
      or (new.status = 'revoked' and old.status <> 'revoked'))
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  if tg_op = 'UPDATE' and new.draft_payload is distinct from old.draft_payload and old.status = 'signed' then
    raise exception using errcode = 'TT409', message = 'applicant_signed';
  end if;
  if (tg_op = 'INSERT' and new.role = 'co_applicant' and new.status <> 'revoked')
    or (tg_op = 'UPDATE' and new.role = 'co_applicant' and old.status = 'revoked' and new.status <> 'revoked') then
    if exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
      raise exception using errcode = 'TT409', message = 'application_signatures_locked';
    end if;
    if (select status from public.client_applications where id = v_application_id) <> 'draft' then
      raise exception using errcode = 'TT409', message = 'application_not_draft';
    end if;
    if (select count(*) from public.application_applicants where application_id = v_application_id and role = 'co_applicant' and status <> 'revoked')
      >= public.application_adult_count((select draft_payload from public.client_applications where id = v_application_id)) - 1 then
      raise exception using errcode = 'TT409', message = 'co_applicant_capacity_reached';
    end if;
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
  -- DELETE already owns the file row; fail cleanly rather than forming a
  -- file-to-parent / parent-to-file deadlock with a simultaneous signature.
  begin
    perform 1 from public.client_applications where id = v_application_id for update nowait;
  exception when lock_not_available then
    raise exception using errcode = 'TT409', message = 'application_signing_in_progress';
  end;
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


create or replace function public.complete_joint_application_if_ready(p_application_id uuid, p_completed_at timestamptz)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_application public.client_applications%rowtype;
  v_primary public.application_applicants%rowtype;
  v_signature public.application_applicant_signatures%rowtype;
  v_route jsonb;
  v_file record;
  v_groups jsonb := '[]'::jsonb;
  v_group jsonb := '[]'::jsonb;
  v_bytes bigint := 0;
  v_part integer;
  v_count integer;
  v_completed_at timestamptz;
begin
  select * into v_application from public.client_applications
    where id = p_application_id and deleted_at is null for update;
  if not found or v_application.status <> 'draft' then return false; end if;
  perform id from public.application_applicants where application_id = p_application_id order by id for update;
  select * into v_primary from public.application_applicants
    where application_id = p_application_id and role = 'primary' and status = 'signed';
  if not found then return false; end if;
  select * into v_signature from public.application_applicant_signatures where applicant_id = v_primary.id;
  if not found then raise exception using errcode = 'TT409', message = 'primary_signature_missing'; end if;
  perform public.assert_application_applicant_roster(p_application_id);
  if exists (select 1 from public.application_applicants where application_id = p_application_id
    and role = 'co_applicant' and status not in ('signed', 'revoked')) then return false; end if;
  if exists (select 1 from public.application_applicants a where a.application_id = p_application_id and a.status <> 'revoked'
    and not exists (select 1 from public.application_applicant_signatures s where s.applicant_id = a.id)) then
    raise exception using errcode = 'TT409', message = 'applicant_signature_missing';
  end if;
  perform public.assert_application_materials_approved(p_application_id);
  -- A delayed or backdated request must not predate any recorded signature.
  select greatest(p_completed_at, max(s.signed_at)) into v_completed_at
    from public.application_applicant_signatures s where s.application_id = p_application_id;
  update public.client_applications set status = 'submitted', submitted_at = v_completed_at,
    retain_until = v_completed_at + interval '12 months', updated_at = v_completed_at
    where id = p_application_id;
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
    values (p_application_id, v_application.owner_user_id, 'client', 'application.submitted', v_signature.request_context);

  v_route := v_signature.request_context->'submissionNotification';
  if nullif(trim(v_route->>'recipient'), '') is not null and nullif(trim(v_route->>'appBaseUrl'), '') is not null then
    for v_file in
      select f.id, f.byte_size from public.client_application_files f
      join public.application_applicants a on a.id = f.applicant_id and a.application_id = f.application_id
      where f.application_id = p_application_id and f.deleted_at is null and a.status <> 'revoked' order by f.id
    loop
      if jsonb_array_length(v_group) > 0 and v_bytes + v_file.byte_size > 26214400 then
        v_groups := v_groups || jsonb_build_array(v_group); v_group := '[]'::jsonb; v_bytes := 0;
      end if;
      v_group := v_group || jsonb_build_array(v_file.id); v_bytes := v_bytes + v_file.byte_size;
    end loop;
    if jsonb_array_length(v_group) > 0 or jsonb_array_length(v_groups) = 0 then
      v_groups := v_groups || jsonb_build_array(v_group);
    end if;
    v_count := jsonb_array_length(v_groups);
    for v_part in 1..v_count loop
      insert into public.owner_notification_deliveries(notification_key, kind, payload, scheduled_for, next_attempt_at)
        values ('application-submitted:' || p_application_id::text || case when v_count > 1 then ':part:' || v_part || '-of-' || v_count else '' end,
          'application_submission', jsonb_build_object('applicationId', p_application_id, 'fileIds', v_groups->(v_part - 1),
            'partIndex', v_part, 'partCount', v_count, 'recipient', v_route->>'recipient', 'appBaseUrl', v_route->>'appBaseUrl'),
          v_completed_at, v_completed_at)
        on conflict (notification_key) do nothing;
    end loop;
  end if;
  return true;
end;
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

  if v_applicant.draft_payload->'tenancy' is distinct from v_application.draft_payload->'tenancy' then
    raise exception using errcode = 'TT409', message = 'application_snapshot_changed';
  end if;
  perform public.assert_application_applicant_roster(v_application.id);

  perform public.assert_application_materials_approved(v_application.id);
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
  perform public.complete_joint_application_if_ready(v_application.id, p_signed_at);
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
  perform public.assert_application_applicant_roster(p_application_id);
  select * into v_primary from public.application_applicants
  where application_id = p_application_id and role = 'primary' for update;
  if not found then raise exception using errcode = 'TT500', message = 'primary_applicant_missing'; end if;
  if v_primary.status = 'signed' then raise exception using errcode = 'TT409', message = 'applicant_signed'; end if;

  perform public.assert_application_materials_approved(v_application.id);
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
    consented_at = p_submitted_at,
    consent_text = v_terms.displayed_text,
    consent_terms_version = p_terms_version, consent_terms_sha256 = p_terms_sha256,
    consent_form_version = p_form_version, consent_form_sha256 = p_form_sha256,
    consent_request_context = p_request_context, retain_until = p_retain_until, updated_at = p_submitted_at
  where id = p_application_id;
  insert into public.client_application_audit_events(application_id, actor_user_id, actor_type, action, request_context)
  values (p_application_id, p_owner_user_id, 'client', 'application.primary_signed', p_request_context);
  perform public.complete_joint_application_if_ready(p_application_id, p_submitted_at);
end;
$$;

revoke all on function public.application_adult_count(jsonb) from public, anon, authenticated;
revoke all on function public.assert_application_applicant_roster(uuid) from public, anon, authenticated;
revoke all on function public.complete_joint_application_if_ready(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.application_adult_count(jsonb) to service_role;
grant execute on function public.assert_application_applicant_roster(uuid) to service_role;
grant execute on function public.complete_joint_application_if_ready(uuid, timestamptz) to service_role;

revoke all on function public.assert_application_materials_approved(uuid) from public, anon, authenticated;
grant execute on function public.assert_application_materials_approved(uuid) to service_role;
