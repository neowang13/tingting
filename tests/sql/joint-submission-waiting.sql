\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values ('00000000-0000-4000-8000-000000000700', 'waiting-owner@example.test', now(), '{"account_type":"client"}');
insert into public.client_profiles(user_id, display_name, is_active)
values ('00000000-0000-4000-8000-000000000700', 'Primary Applicant', true)
on conflict (user_id) do update set is_active = true;

create function pg_temp.waiting_application(p_adults jsonb) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.client_applications(id, owner_user_id, property_title, property_address, form_version_id, terms_version_id, draft_payload)
  select v_id, '00000000-0000-4000-8000-000000000700', 'Waiting test', 'Example Street', f.id, t.id,
    jsonb_build_object('personal', jsonb_build_object('legalFirstName', 'Primary', 'legalLastName', 'Applicant'),
      'tenancy', jsonb_build_object('adultCount', p_adults))
  from public.application_form_versions f cross join public.application_terms_versions t where f.is_active and t.is_active limit 1;
  return v_id;
end $$;

create function pg_temp.waiting_co(p_application uuid, p_status text default 'in_progress') returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_user uuid := gen_random_uuid(); v_email text := v_id::text || '@example.test';
begin
  insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values (v_user, v_email, now(), '{"account_type":"client"}');
  insert into public.client_profiles(user_id, display_name, is_active) values (v_user, 'Second Applicant', true) on conflict (user_id) do update set is_active = true;
  insert into public.application_applicants(id, application_id, role, owner_user_id, legal_name, email, status, draft_payload)
    values (v_id, p_application, 'co_applicant', v_user, 'Second Applicant', v_email, p_status,
      '{"personal":{"legalFirstName":"Second","legalLastName":"Applicant"}}'::jsonb ||
        jsonb_build_object('tenancy', (select draft_payload->'tenancy' from public.client_applications where id = p_application)));
  insert into public.application_guest_sessions(applicant_id, token_sha256, expires_at)
    values (v_id, repeat(md5(v_id::text), 2), now() + interval '12 hours');
  return v_id;
end $$;

create function pg_temp.waiting_files(p_applicant uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id::text, 'documentType', document_type, 'byteSize', byte_size, 'scanStatus', scan_status) order by id), '[]')
  from public.client_application_files where applicant_id = p_applicant and deleted_at is null;
$$;

create function pg_temp.waiting_primary_sign(p_application uuid, p_context jsonb, p_time timestamptz) returns void language plpgsql as $$
declare v_app public.client_applications%rowtype; v_primary uuid; v_form public.application_form_versions%rowtype; v_terms public.application_terms_versions%rowtype;
begin
  select * into strict v_app from public.client_applications where id = p_application;
  select id into strict v_primary from public.application_applicants where application_id = p_application and role = 'primary';
  select * into strict v_form from public.application_form_versions where id = v_app.form_version_id;
  select * into strict v_terms from public.application_terms_versions where id = v_app.terms_version_id;
  perform public.finalize_multi_applicant_application(p_application, v_app.owner_user_id, 'Primary Applicant',
    v_terms.version, v_terms.sha256, v_form.version, v_form.sha256, v_terms.displayed_text,
    v_app.draft_payload, pg_temp.waiting_files(v_primary), p_context, p_time, p_time + interval '12 months');
end $$;

create function pg_temp.waiting_co_sign(p_applicant uuid, p_time timestamptz) returns void language plpgsql as $$
declare v_app public.client_applications%rowtype; v_co public.application_applicants%rowtype; v_form public.application_form_versions%rowtype; v_terms public.application_terms_versions%rowtype;
begin
  select * into strict v_co from public.application_applicants where id = p_applicant;
  select * into strict v_app from public.client_applications where id = v_co.application_id;
  select * into strict v_form from public.application_form_versions where id = v_app.form_version_id;
  select * into strict v_terms from public.application_terms_versions where id = v_app.terms_version_id;
  perform public.sign_guest_application_applicant(repeat(md5(p_applicant::text), 2), 'Second Applicant',
    v_terms.version, v_terms.sha256, v_form.version, v_form.sha256, v_terms.displayed_text,
    v_co.draft_payload, pg_temp.waiting_files(p_applicant), '{}', p_time);
end $$;

create function pg_temp.waiting_file(p_application uuid, p_applicant uuid, p_deleted boolean default false) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into public.client_application_files(id, application_id, applicant_id, document_type, storage_path, original_filename, mime_type, byte_size, sha256, scan_status, deleted_at)
    values (v_id, p_application, p_applicant, 'employment_income_proof', 'qa/' || v_id::text || '.pdf', 'test.pdf', 'application/pdf',
      10485760, repeat('a', 64), 'cleared', case when p_deleted then now() else null end);
  return v_id;
end $$;

do $$
declare
  v_app uuid; v_primary uuid; v_co uuid; v_last uuid; v_revoked uuid; v_file uuid;
  v_primary_time timestamptz := now() - interval '1 minute'; v_completed timestamptz := now();
  v_route jsonb := '{"submissionNotification":{"recipient":"admin@example.test","appBaseUrl":"https://example.test"}}';
  v_form_id uuid; v_terms_id uuid;
  v_hash text; v_bad jsonb; v_index integer; v_file_count integer;
begin
  -- Missing adults, string values, fractional counts and out-of-range counts cannot be signed or invited.
  for v_bad in select value from jsonb_array_elements('[null,"2",0,13,1.5]') loop
    v_app := pg_temp.waiting_application(v_bad);
    begin
      perform pg_temp.waiting_primary_sign(v_app, '{}', v_primary_time);
      raise exception 'invalid adult count was signed: %', v_bad;
    exception when sqlstate 'TT422' then if sqlerrm <> 'tenancy_adult_count_required' then raise; end if; end;
    begin
      perform pg_temp.waiting_co(v_app);
      raise exception 'invalid adult count accepted a co-applicant: %', v_bad;
    exception when sqlstate 'TT422' then if sqlerrm <> 'tenancy_adult_count_required' then raise; end if; end;
  end loop;

  -- A single adult never gets a co-applicant, even through direct database inserts or the invite RPC.
  v_app := pg_temp.waiting_application('1');
  begin
    perform pg_temp.waiting_co(v_app);
    raise exception 'one-adult application accepted a co-applicant';
  exception when sqlstate 'TT409' then if sqlerrm <> 'co_applicant_capacity_reached' then raise; end if; end;
  begin
    perform public.create_linked_applicant_invitation(v_app, '00000000-0000-4000-8000-000000000700', gen_random_uuid(), gen_random_uuid(),
      'Unexpected Guest', 'unexpected@example.test', repeat('a',64), now() + interval '48 hours', '{}', '{}');
    raise exception 'one-adult application accepted an invitation';
  exception when sqlstate 'TT409' then if sqlerrm <> 'co_applicant_capacity_reached' then raise; end if; end;
  perform pg_temp.waiting_primary_sign(v_app, v_route, v_primary_time);
  if (select status from public.client_applications where id = v_app) <> 'submitted'
    or (select payload->'fileIds' from public.owner_notification_deliveries where notification_key = 'application-submitted:' || v_app) <> '[]'::jsonb then
    raise exception 'solo submission or its empty-attachment notification was lost';
  end if;

  -- Every declared adult must be invited before anyone can sign; unsigned invitees are enough for the primary.
  v_app := pg_temp.waiting_application('3');
  v_co := pg_temp.waiting_co(v_app);
  begin
    perform pg_temp.waiting_primary_sign(v_app, v_route, v_primary_time);
    raise exception 'primary sealed an incomplete adult roster';
  exception when sqlstate 'TT409' then if sqlerrm <> 'co_applicant_roster_incomplete' then raise; end if; end;
  begin
    perform pg_temp.waiting_co_sign(v_co, v_completed);
    raise exception 'co-applicant froze an incomplete adult roster';
  exception when sqlstate 'TT409' then if sqlerrm <> 'co_applicant_roster_incomplete' then raise; end if; end;
  if exists(select 1 from public.application_applicant_signatures where application_id = v_app) then raise exception 'failed roster check left signature evidence'; end if;
  v_last := pg_temp.waiting_co(v_app, 'invited');
  begin
    perform pg_temp.waiting_co(v_app);
    raise exception 'adult capacity exceeded';
  exception when sqlstate 'TT409' then if sqlerrm <> 'co_applicant_capacity_reached' then raise; end if; end;
  perform pg_temp.waiting_primary_sign(v_app, v_route, v_primary_time);
  select id into v_primary from public.application_applicants where application_id = v_app and role = 'primary';
  select document_snapshot_sha256 into v_hash from public.application_applicant_signatures where applicant_id = v_primary;
  if not exists(select 1 from public.client_applications where id = v_app and status = 'draft' and submitted_at is null and consented_at = v_primary_time)
    or not exists(select 1 from public.application_applicants where id = v_primary and status = 'signed')
    or exists(select 1 from public.owner_notification_deliveries where kind = 'application_submission' and payload->>'applicationId' = v_app::text) then
    raise exception 'primary was not sealed in the waiting state without notifying admin';
  end if;
  begin
    perform pg_temp.waiting_primary_sign(v_app, v_route, v_completed);
    raise exception 'waiting primary re-signed';
  exception when sqlstate 'TT409' then if sqlerrm <> 'applicant_signed' then raise; end if; end;
  begin
    update public.client_applications set draft_payload = '{}' where id = v_app;
    raise exception 'signed primary draft changed';
  exception when sqlstate 'TT409' then null; end;
  begin
    update public.application_applicants set status = 'in_progress' where id = v_primary;
    raise exception 'signed primary was reopened';
  exception when sqlstate 'TT409' then null; end;
  begin
    update public.application_applicants set status = 'revoked' where id = v_last;
    raise exception 'waiting roster was revoked';
  exception when sqlstate 'TT409' then null; end;
  begin
    perform pg_temp.waiting_file(v_app, v_primary);
    raise exception 'signed primary file changed';
  exception when sqlstate 'TT409' then null; end;
  perform pg_temp.waiting_co_sign(v_co, v_completed);
  if (select status from public.client_applications where id = v_app) <> 'draft' then raise exception 'application submitted before last signature'; end if;
  perform pg_temp.waiting_co_sign(v_last, v_completed);
  if not exists(select 1 from public.client_applications where id = v_app and status = 'submitted' and submitted_at = v_completed and consented_at = v_primary_time
    and retain_until = v_completed + interval '12 months') then raise exception 'completion changed original primary consent/retention or submission time'; end if;
  if not exists(select 1 from public.application_applicant_signatures where applicant_id = v_primary and signed_at = v_primary_time and document_snapshot_sha256 = v_hash) then
    raise exception 'completion changed sealed primary evidence'; end if;
  perform public.complete_joint_application_if_ready(v_app, v_completed);
  if (select count(*) from public.client_application_audit_events where application_id = v_app and action = 'application.submitted') <> 1
    or (select count(*) from public.owner_notification_deliveries where notification_key = 'application-submitted:' || v_app) <> 1 then
    raise exception 'completion retry duplicated submission or notification'; end if;

  -- Co-first signing waits for primary, then submits immediately; historical callers with no route enqueue no mail.
  -- Its deliberately backdated primary request cannot move submission before the co signature.
  v_app := pg_temp.waiting_application('2'); v_co := pg_temp.waiting_co(v_app);
  perform pg_temp.waiting_co_sign(v_co, v_completed);
  if (select status from public.client_applications where id = v_app) <> 'draft' then raise exception 'co signature submitted without primary'; end if;
  perform pg_temp.waiting_primary_sign(v_app, '{}', v_primary_time);
  if not exists(select 1 from public.client_applications where id = v_app and status = 'submitted' and submitted_at = v_completed
      and retain_until = v_completed + interval '12 months')
    or exists(select 1 from public.owner_notification_deliveries where kind = 'application_submission' and payload->>'applicationId' = v_app::text) then
    raise exception 'co-first submission or disabled routing failed'; end if;

  -- Multi-part outbox includes active, nondeleted files only and shares the existing TS delivery keys.
  v_app := pg_temp.waiting_application('2'); v_co := pg_temp.waiting_co(v_app); v_revoked := pg_temp.waiting_co(v_app, 'revoked');
  select id into v_primary from public.application_applicants where application_id = v_app and role = 'primary';
  perform pg_temp.waiting_file(v_app, v_primary);
  perform pg_temp.waiting_file(v_app, v_co);
  perform pg_temp.waiting_file(v_app, v_co);
  perform pg_temp.waiting_file(v_app, v_co, true);
  perform pg_temp.waiting_file(v_app, v_revoked);
  perform pg_temp.waiting_primary_sign(v_app, v_route, v_primary_time);
  perform pg_temp.waiting_co_sign(v_co, v_completed);
  perform public.complete_joint_application_if_ready(v_app, v_completed);
  if (select count(*) from public.owner_notification_deliveries where kind = 'application_submission' and payload->>'applicationId' = v_app::text) <> 2 then
    raise exception '30 MiB attachments were not atomically split into two notifications'; end if;
  for v_index in 1..2 loop
    if not exists(select 1 from public.owner_notification_deliveries where notification_key = 'application-submitted:' || v_app || ':part:' || v_index || '-of-2'
      and payload->>'recipient' = 'admin@example.test' and payload->>'appBaseUrl' = 'https://example.test'
      and (payload->>'partIndex')::integer = v_index and (payload->>'partCount')::integer = 2
      and jsonb_array_length(payload->'fileIds') = case when v_index = 1 then 2 else 1 end) then
      raise exception 'invalid notification part payload %', v_index;
    end if;
  end loop;
  select count(*) into v_file_count from public.owner_notification_deliveries d cross join lateral jsonb_array_elements_text(d.payload->'fileIds') f(id)
    where d.kind = 'application_submission' and d.payload->>'applicationId' = v_app::text;
  if v_file_count <> 3 or exists(
    select 1 from public.owner_notification_deliveries d cross join lateral jsonb_array_elements_text(d.payload->'fileIds') f(id)
    join public.client_application_files cf on cf.id = f.id::uuid join public.application_applicants a on a.id = cf.applicant_id
    where d.kind = 'application_submission' and d.payload->>'applicationId' = v_app::text and (cf.deleted_at is not null or a.status = 'revoked')
  ) then raise exception 'deleted/revoked files leaked into notification attachments'; end if;

  -- Even an old expected snapshot cannot sign stale shared tenancy after a concurrent primary edit.
  v_app := pg_temp.waiting_application('2'); v_co := pg_temp.waiting_co(v_app);
  update public.client_applications set draft_payload = jsonb_set(draft_payload, '{tenancy,leaseTerm}', '"month_to_month"') where id = v_app;
  begin
    perform pg_temp.waiting_co_sign(v_co, v_completed);
    raise exception 'co-applicant signed a stale shared tenancy snapshot';
  exception when sqlstate 'TT409' then if sqlerrm <> 'application_snapshot_changed' then raise; end if; end;
  if exists(select 1 from public.application_applicant_signatures where applicant_id = v_co) then
    raise exception 'stale tenancy left signed evidence'; end if;
  update public.application_applicants a set draft_payload = a.draft_payload || jsonb_build_object('tenancy', app.draft_payload->'tenancy')
    from public.client_applications app where app.id = v_app and a.id = v_co;
  perform pg_temp.waiting_co_sign(v_co, v_completed);

  -- Withdrawal of form or terms approval during waiting blocks both further signatures and finalization.
  v_app := pg_temp.waiting_application('2'); v_co := pg_temp.waiting_co(v_app);
  perform pg_temp.waiting_primary_sign(v_app, v_route, v_primary_time);
  select form_version_id, terms_version_id into v_form_id, v_terms_id from public.client_applications where id = v_app;
  update public.application_form_versions set legal_review_status = 'pending' where id = v_form_id;
  begin
    perform pg_temp.waiting_co_sign(v_co, v_completed);
    raise exception 'co-applicant signed after form approval withdrawal';
  exception when sqlstate 'TT409' then if sqlerrm <> 'application_materials_not_approved' then raise; end if; end;
  update public.application_form_versions set legal_review_status = 'approved' where id = v_form_id;
  update public.application_terms_versions set legal_review_status = 'pending' where id = v_terms_id;
  begin
    perform pg_temp.waiting_co_sign(v_co, v_completed);
    raise exception 'co-applicant signed after terms approval withdrawal';
  exception when sqlstate 'TT409' then if sqlerrm <> 'application_materials_not_approved' then raise; end if; end;
  if exists(select 1 from public.application_applicant_signatures where applicant_id = v_co) then
    raise exception 'withdrawn approval left new co-applicant evidence'; end if;

  -- Independently exercise the final helper's own check with fully recorded signatures.
  insert into public.application_applicant_signatures(application_id, applicant_id, signature_legal_name, sharing_authorized, screening_consented,
    terms_version, terms_sha256, form_version, form_sha256, displayed_terms_text, document_snapshot_sha256, request_context, signed_at)
    select v_app, v_co, 'Second Applicant', true, true, s.terms_version, s.terms_sha256, s.form_version, s.form_sha256,
      s.displayed_terms_text, repeat('f',64), '{}', v_completed
    from public.application_applicant_signatures s join public.application_applicants a on a.id = s.applicant_id
    where s.application_id = v_app and a.role = 'primary';
  update public.application_applicants set status = 'signed', signed_at = v_completed where id = v_co;
  begin
    perform public.complete_joint_application_if_ready(v_app, v_completed);
    raise exception 'joint helper submitted after terms approval withdrawal';
  exception when sqlstate 'TT409' then if sqlerrm <> 'application_materials_not_approved' then raise; end if; end;
  if not exists(select 1 from public.client_applications where id = v_app and status = 'draft' and submitted_at is null)
    or exists(select 1 from public.owner_notification_deliveries where kind = 'application_submission' and payload->>'applicationId' = v_app::text)
    or exists(select 1 from public.client_application_audit_events where application_id = v_app and action = 'application.submitted') then
    raise exception 'withdrawn approval produced submission or admin mail'; end if;
  update public.application_terms_versions set legal_review_status = 'approved' where id = v_terms_id;
  perform public.complete_joint_application_if_ready(v_app, v_completed);

  -- Twelve declared adults permits eleven invitees; the database no longer uses the obsolete eight-person cap.
  v_app := pg_temp.waiting_application('12');
  for v_index in 1..11 loop perform pg_temp.waiting_co(v_app); end loop;
  begin
    perform pg_temp.waiting_co(v_app);
    raise exception 'twelfth co-applicant exceeded eleven available adult slots';
  exception when sqlstate 'TT409' then if sqlerrm <> 'co_applicant_capacity_reached' then raise; end if; end;

  if has_function_privilege('anon', 'public.complete_joint_application_if_ready(uuid,timestamptz)', 'execute')
    or has_function_privilege('authenticated', 'public.complete_joint_application_if_ready(uuid,timestamptz)', 'execute')
    or not has_function_privilege('service_role', 'public.complete_joint_application_if_ready(uuid,timestamptz)', 'execute') then
    raise exception 'automatic completion helper privileges are unsafe'; end if;
end $$;
-- User document removal relies on the same row trigger as signed evidence.
do $$
declare v_app uuid; v_primary uuid; v_co uuid; v_primary_file uuid; v_co_file uuid;
begin
  v_app := pg_temp.waiting_application('2'); v_co := pg_temp.waiting_co(v_app);
  select id into strict v_primary from public.application_applicants where application_id=v_app and role='primary';
  v_primary_file := pg_temp.waiting_file(v_app, v_primary);
  v_co_file := pg_temp.waiting_file(v_app, v_co);
  delete from public.client_application_files where id=v_primary_file;
  if exists(select 1 from public.client_application_files where id=v_primary_file) then raise exception 'unsigned removal failed'; end if;
  v_primary_file := pg_temp.waiting_file(v_app, v_primary);
  perform pg_temp.waiting_primary_sign(v_app, '{}', now());
  begin
    delete from public.client_application_files where id=v_primary_file;
    raise exception 'signed primary evidence was deleted';
  exception when sqlstate 'TT409' then if sqlerrm <> 'application_signatures_locked' then raise; end if; end;
  -- The unsigned co-applicant can still correct their own documents.
  delete from public.client_application_files where id=v_co_file;
  if exists(select 1 from public.client_application_files where id=v_co_file) then raise exception 'unsigned co-applicant could not remove a file'; end if;
  v_co_file := pg_temp.waiting_file(v_app, v_co);
  perform pg_temp.waiting_co_sign(v_co, now());
  begin
    delete from public.client_application_files where id=v_co_file;
    raise exception 'signed co-applicant evidence was deleted';
  exception when sqlstate 'TT409' then if sqlerrm <> 'application_signatures_locked' then raise; end if; end;
  if has_table_privilege('authenticated','public.client_application_files','delete') then raise exception 'direct client deletion bypasses server ownership checks'; end if;
end $$;
rollback;
