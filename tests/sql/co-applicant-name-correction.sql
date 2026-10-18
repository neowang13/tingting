\set ON_ERROR_STOP on
begin;
set local search_path = public, extensions;
select set_config('request.jwt.claim.role', 'service_role', true);

insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data) values
  ('00000000-0000-4000-8000-000000000690', 'name-owner@example.test', now(), '{"account_type":"client"}'),
  ('00000000-0000-4000-8000-000000000691', 'name-first@example.test', now(), '{"account_type":"client"}'),
  ('00000000-0000-4000-8000-000000000692', 'name-second@example.test', now(), '{"account_type":"client"}');
insert into public.client_profiles(user_id, display_name, is_active) values
  ('00000000-0000-4000-8000-000000000690', 'Name Owner', true),
  ('00000000-0000-4000-8000-000000000691', 'First Invitee', true),
  ('00000000-0000-4000-8000-000000000692', 'Second Invitee', true)
on conflict (user_id) do update set is_active = true;
insert into public.client_applications(id, owner_user_id, property_title, property_address, form_version_id, terms_version_id)
select '00000000-0000-4000-8000-000000000693', '00000000-0000-4000-8000-000000000690',
  'Name correction fixture', 'Example Street', f.id, t.id
from public.application_form_versions f cross join public.application_terms_versions t
where f.is_active and t.is_active limit 1;
update public.client_applications set draft_payload = '{"tenancy":{"adultCount":3}}'::jsonb
where id = '00000000-0000-4000-8000-000000000693';

insert into public.application_applicants(id, application_id, owner_user_id, role, legal_name, email, status, draft_payload) values
  ('00000000-0000-4000-8000-000000000694', '00000000-0000-4000-8000-000000000693', '00000000-0000-4000-8000-000000000691',
   'co_applicant', 'First Nickname', 'name-first@example.test', 'in_progress', '{"personal":{"legalFirstName":"First","legalLastName":"Nickname"}}'),
  ('00000000-0000-4000-8000-000000000695', '00000000-0000-4000-8000-000000000693', '00000000-0000-4000-8000-000000000692',
   'co_applicant', 'Second Nickname', 'name-second@example.test', 'in_progress', '{"personal":{"legalFirstName":"Second","legalLastName":"Nickname"}}');
update public.application_applicants set draft_payload = draft_payload || '{"tenancy":{"adultCount":3}}'::jsonb
where application_id = '00000000-0000-4000-8000-000000000693' and role = 'co_applicant';
insert into public.application_guest_sessions(applicant_id, token_sha256, expires_at) values
  ('00000000-0000-4000-8000-000000000694', repeat('a', 64), now() + interval '12 hours'),
  ('00000000-0000-4000-8000-000000000695', repeat('b', 64), now() + interval '12 hours');

do $$
declare v_form public.application_form_versions%rowtype; v_terms public.application_terms_versions%rowtype; v_draft jsonb;
begin
  select f.* into v_form from public.application_form_versions f join public.client_applications a on a.form_version_id = f.id where a.id = '00000000-0000-4000-8000-000000000693';
  select t.* into v_terms from public.application_terms_versions t join public.client_applications a on a.terms_version_id = t.id where a.id = '00000000-0000-4000-8000-000000000693';
  update public.application_applicants
    set legal_name = 'First Legalname', draft_payload = '{"personal":{"legalFirstName":"First","legalLastName":"Legalname"},"tenancy":{"adultCount":3}}'
    where id = '00000000-0000-4000-8000-000000000694' returning draft_payload into v_draft;
  perform public.sign_guest_application_applicant(repeat('a', 64), 'First Legalname', v_terms.version, v_terms.sha256, v_form.version, v_form.sha256, v_terms.displayed_text, v_draft, '[]', '{}', now());

  -- Another person's signature must not freeze this invitee's unsigned name.
  update public.application_applicants
    set legal_name = 'Second Legalname', draft_payload = '{"personal":{"legalFirstName":"Second","legalLastName":"Legalname"},"tenancy":{"adultCount":3}}'
    where id = '00000000-0000-4000-8000-000000000695' returning draft_payload into v_draft;
  begin
    update public.application_applicants set email = 'different@example.test' where id = '00000000-0000-4000-8000-000000000695';
    raise exception 'invitation recipient changed after a signature';
  exception when sqlstate 'TT409' then null; end;
  begin
    perform public.sign_guest_application_applicant(repeat('b', 64), 'Second Nickname', v_terms.version, v_terms.sha256, v_form.version, v_form.sha256, v_terms.displayed_text, v_draft, '[]', '{}', now());
    raise exception 'signature used stale invitation name';
  exception when sqlstate 'TT422' then null; end;
  perform public.sign_guest_application_applicant(repeat('b', 64), ' SECOND   LEGALNAME ', v_terms.version, v_terms.sha256, v_form.version, v_form.sha256, v_terms.displayed_text, v_draft, '[]', '{}', now());
  begin
    update public.application_applicants set legal_name = 'Changed After Signing' where id = '00000000-0000-4000-8000-000000000695';
    raise exception 'signed legal name was editable';
  exception when sqlstate 'TT409' then null; end;
  begin
    update public.application_applicants set draft_payload = '{}' where id = '00000000-0000-4000-8000-000000000695';
    raise exception 'signed personal details were editable';
  exception when sqlstate 'TT409' then null; end;
end $$;
rollback;
