\set ON_ERROR_STOP on

begin;

select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
values (
  '00000000-0000-4000-8000-000000000580',
  'multi-owner@example.test', now(),
  '{"display_name":"Multi Owner","account_type":"client"}'::jsonb
);

insert into public.client_profiles(user_id, display_name, is_active)
values ('00000000-0000-4000-8000-000000000580', 'Multi Owner', true)
on conflict (user_id) do update set display_name = excluded.display_name, is_active = true;

insert into public.client_applications(
  id, owner_user_id, property_title, property_address, form_version_id, terms_version_id
)
select '00000000-0000-4000-8000-000000000581',
  '00000000-0000-4000-8000-000000000580',
  'Multi Applicant Test Rental', '580 Test Street', form.id, terms.id
from public.application_form_versions form
cross join public.application_terms_versions terms
where form.is_active and terms.is_active
limit 1;

insert into public.application_applicants(
  id, application_id, role, legal_name, email, status, draft_payload, invitation_expires_at
) values (
  '00000000-0000-4000-8000-000000000582',
  '00000000-0000-4000-8000-000000000581',
  'co_applicant', 'Guest Applicant', 'multi-guest@example.test', 'in_progress',
  '{"personal":{"legalFirstName":"Wrong","legalLastName":"Person"}}'::jsonb,
  now() + interval '48 hours'
);

insert into public.application_applicant_invitations(applicant_id, token_sha256, status, expires_at)
values ('00000000-0000-4000-8000-000000000582', repeat('1', 64), 'used', now() + interval '48 hours');
insert into public.application_guest_sessions(applicant_id, token_sha256, expires_at)
values ('00000000-0000-4000-8000-000000000582', repeat('2', 64), now() + interval '12 hours');

select public.resend_application_applicant_invitation(
  '00000000-0000-4000-8000-000000000581',
  '00000000-0000-4000-8000-000000000580',
  '00000000-0000-4000-8000-000000000582',
  repeat('3', 64), now() + interval '48 hours', '{"requestId":"resend-test"}'::jsonb
);

do $$
declare
  v_form public.application_form_versions%rowtype;
  v_terms public.application_terms_versions%rowtype;
  v_draft jsonb;
begin
  if not exists (select 1 from public.application_guest_sessions where token_sha256 = repeat('2', 64) and revoked_at is not null) then
    raise exception 'resend did not revoke the old guest session';
  end if;
  if (select count(*) from public.application_applicant_invitations where applicant_id = '00000000-0000-4000-8000-000000000582' and status = 'active') <> 1
    or not exists (select 1 from public.application_applicant_invitations where token_sha256 = repeat('3', 64) and status = 'active') then
    raise exception 'resend did not atomically leave exactly one new active invitation';
  end if;

  perform public.exchange_application_applicant_invitation(
    repeat('3', 64), repeat('4', 64), now() + interval '12 hours', '{}'::jsonb
  );
  select form.* into v_form
  from public.client_applications application
  join public.application_form_versions form on form.id = application.form_version_id
  where application.id = '00000000-0000-4000-8000-000000000581';
  select terms.* into v_terms
  from public.client_applications application
  join public.application_terms_versions terms on terms.id = application.terms_version_id
  where application.id = '00000000-0000-4000-8000-000000000581';
  select draft_payload into v_draft from public.application_applicants where id = '00000000-0000-4000-8000-000000000582';

  begin
    perform public.sign_guest_application_applicant(
      repeat('4', 64), 'Guest Applicant', v_terms.version, v_terms.sha256,
      v_form.version, v_form.sha256, v_terms.displayed_text,
      v_draft, '[]'::jsonb, '{}'::jsonb, now()
    );
    raise exception 'mismatched invited/draft legal names were signed';
  exception when sqlstate 'TT422' then null;
  end;

  update public.application_applicants
  set draft_payload = '{"personal":{"legalFirstName":"Guest","legalLastName":"Applicant"}}'::jsonb
  where id = '00000000-0000-4000-8000-000000000582';
  select draft_payload into v_draft from public.application_applicants where id = '00000000-0000-4000-8000-000000000582';
  perform public.sign_guest_application_applicant(
    repeat('4', 64), '  guest   applicant ', v_terms.version, v_terms.sha256,
    v_form.version, v_form.sha256, v_terms.displayed_text,
    v_draft, '[]'::jsonb, '{}'::jsonb, now()
  );

  begin
    update public.application_applicant_signatures set signature_legal_name = 'Tampered'
    where applicant_id = '00000000-0000-4000-8000-000000000582';
    raise exception 'signature evidence was updateable';
  exception when sqlstate 'TT425' then null;
  end;
  begin
    delete from public.application_applicant_signatures
    where applicant_id = '00000000-0000-4000-8000-000000000582';
    raise exception 'signature evidence was directly deletable';
  exception when insufficient_privilege then null;
    when sqlstate 'TT425' then null;
  end;
end;
$$;

do $$
begin
  if has_table_privilege('authenticated', 'public.application_applicants', 'select')
    or has_table_privilege('authenticated', 'public.application_applicant_invitations', 'select')
    or has_table_privilege('authenticated', 'public.application_guest_sessions', 'select')
    or has_table_privilege('authenticated', 'public.application_applicant_signatures', 'select')
    or has_table_privilege('authenticated', 'public.application_credit_check_requests', 'select')
    or has_table_privilege('anon', 'public.application_applicants', 'select')
    or has_table_privilege('anon', 'public.application_applicant_invitations', 'select')
    or has_table_privilege('anon', 'public.application_guest_sessions', 'select')
    or has_table_privilege('anon', 'public.application_applicant_signatures', 'select')
    or has_table_privilege('anon', 'public.application_credit_check_requests', 'select') then
    raise exception 'browser roles received unsafe multi-applicant privileges';
  end if;
  if has_function_privilege('authenticated', 'public.exchange_application_applicant_invitation(text,text,timestamptz,jsonb)', 'execute')
    or has_function_privilege('anon', 'public.exchange_application_applicant_invitation(text,text,timestamptz,jsonb)', 'execute')
    or not has_function_privilege('service_role', 'public.exchange_application_applicant_invitation(text,text,timestamptz,jsonb)', 'execute') then
    raise exception 'guest invitation exchange function privileges are unsafe';
  end if;
  if has_table_privilege('service_role', 'public.application_applicant_signatures', 'update')
    or has_table_privilege('service_role', 'public.application_applicant_signatures', 'delete') then
    raise exception 'service role can directly tamper with signature evidence';
  end if;
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'client_application_audit_events'
      and policyname = 'clients read own client-authored application audit'
      and qual like '%actor_type%client%'
      and qual like '%actor_user_id%'
  ) then
    raise exception 'owner audit RLS does not exclude guest/system evidence';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name in ('application_applicant_invitations', 'application_guest_sessions')
      and column_name in ('token', 'raw_token', 'bearer_token')
  ) then
    raise exception 'raw bearer token column exists';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.application_credit_check_requests'::regclass
      and contype = 'u'
  ) then
    raise exception 'credit-check idempotency uniqueness is missing';
  end if;
end;
$$;

rollback;
