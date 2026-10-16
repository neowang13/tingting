\set ON_ERROR_STOP on
begin;
set local search_path = public,extensions;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000640','joint-owner@example.test',now(),'{"account_type":"client"}'),
 ('00000000-0000-4000-8000-000000000641','joint-second@example.test',now(),'{"account_type":"client"}'),
 ('00000000-0000-4000-8000-000000000642','joint-admin@example.test',now(),'{}');
insert into public.client_profiles(user_id,display_name,is_active) values
 ('00000000-0000-4000-8000-000000000640','Primary Applicant',true),('00000000-0000-4000-8000-000000000641','Second Applicant',true)
 on conflict(user_id) do update set is_active=true;
insert into public.admin_profiles(user_id,display_name,is_active) values ('00000000-0000-4000-8000-000000000642','Joint Admin',true);
insert into public.client_applications(id,owner_user_id,property_title,property_address,form_version_id,terms_version_id,draft_payload)
 select '00000000-0000-4000-8000-000000000643','00000000-0000-4000-8000-000000000640','Joint fixture','Unit 2, Test Street',f.id,t.id,
 '{"personal":{"legalFirstName":"Primary","legalLastName":"Applicant"},"tenancy":{"adultCount":2,"childCount":0},"creditReportVoluntary":false}'
 from public.application_form_versions f cross join public.application_terms_versions t where f.is_active and t.is_active limit 1;
select public.create_linked_applicant_invitation(
 '00000000-0000-4000-8000-000000000643','00000000-0000-4000-8000-000000000640',
 '00000000-0000-4000-8000-000000000644','00000000-0000-4000-8000-000000000645','Second Applicant','joint-second@example.test',repeat('6',64),now()+interval '48 hours',
 '{"personal":{"legalFirstName":"Second","legalLastName":"Applicant"},"creditReportVoluntary":true}', '{}');
do $$ begin
 if (select count(*) from public.owner_notification_deliveries where notification_key='co-applicant-invite:00000000-0000-4000-8000-000000000645') <> 1 then raise exception 'invitation and email were not atomic'; end if;
 if exists(select 1 from public.owner_notification_deliveries where payload ? 'token') then raise exception 'raw invitation token stored in outbox'; end if;
 begin
  perform public.claim_linked_applicant_invitation('00000000-0000-4000-8000-000000000640',repeat('6',64),repeat('7',64),now()+interval '12 hours','{}');
  raise exception 'wrong account accepted invitation';
 exception when insufficient_privilege then null; end;
 if (select status from public.application_applicant_invitations where id='00000000-0000-4000-8000-000000000645') <> 'active' then raise exception 'wrong account consumed invitation'; end if;
end $$;
select public.claim_linked_applicant_invitation('00000000-0000-4000-8000-000000000641',repeat('6',64),repeat('7',64),now()+interval '12 hours','{}');
update public.owner_notification_deliveries set status='delivered',provider_status='email.delivered' where notification_key='co-applicant-invite:00000000-0000-4000-8000-000000000645';
insert into public.client_application_files(id,application_id,applicant_id,document_type,storage_path,original_filename,mime_type,byte_size,sha256,scan_status)
 values('00000000-0000-4000-8000-000000000646','00000000-0000-4000-8000-000000000643','00000000-0000-4000-8000-000000000644','credit_score_report','qa/test-credit.pdf','test-credit.pdf','application/pdf',100,repeat('a',64),'cleared');
do $$
declare v_form public.application_form_versions%rowtype; v_terms public.application_terms_versions%rowtype; v_draft jsonb; v_files jsonb; v_primary uuid; v_tenant uuid;
begin
 select f.* into v_form from public.application_form_versions f join public.client_applications a on a.form_version_id=f.id where a.id='00000000-0000-4000-8000-000000000643';
 select t.* into v_terms from public.application_terms_versions t join public.client_applications a on a.terms_version_id=t.id where a.id='00000000-0000-4000-8000-000000000643';
 select draft_payload into v_draft from public.application_applicants where id='00000000-0000-4000-8000-000000000644';
 if v_draft->>'creditReportVoluntary' <> 'false' then raise exception 'upload did not reset prior voluntary confirmation'; end if;
 if (select invitation_delivery_status from public.application_applicants where id='00000000-0000-4000-8000-000000000644') <> 'delivered' then raise exception 'delivery callback did not update applicant'; end if;
 v_files := jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000646','documentType','credit_score_report','byteSize',100,'scanStatus','cleared'));
 begin
  perform public.sign_guest_application_applicant(repeat('7',64),'Second Applicant',v_terms.version,v_terms.sha256,v_form.version,v_form.sha256,v_terms.displayed_text,v_draft,v_files,'{}',now());
  raise exception 'credit report accepted without voluntary confirmation';
 exception when sqlstate 'TT409' then if sqlerrm <> 'credit_report_confirmation_required' then raise; end if; end;
 update public.application_applicants set draft_payload=jsonb_set(draft_payload,'{creditReportVoluntary}','true') where id='00000000-0000-4000-8000-000000000644' returning draft_payload into v_draft;
 perform public.sign_guest_application_applicant(repeat('7',64),'Second Applicant',v_terms.version,v_terms.sha256,v_form.version,v_form.sha256,v_terms.displayed_text,v_draft,v_files,'{}',now());
 if not exists(select 1 from public.application_applicants where id='00000000-0000-4000-8000-000000000644' and owner_user_id='00000000-0000-4000-8000-000000000641' and credit_report_voluntary_at is not null and credit_report_consent_version='2026-10-15.1') then raise exception 'individual consent evidence missing'; end if;
 -- The unsigned primary can finish personal details and files after a co-applicant signs.
 update public.client_applications set draft_payload=draft_payload || '{"housing":{"currentAddress":"Primary finished after co signed"}}'::jsonb where id='00000000-0000-4000-8000-000000000643';
 update public.application_applicants set legal_name='Previous primary profile name' where application_id='00000000-0000-4000-8000-000000000643' and role='primary';
 begin
  update public.client_applications set draft_payload=jsonb_set(draft_payload,'{tenancy,adultCount}','3') where id='00000000-0000-4000-8000-000000000643';
  raise exception 'shared household changed after co-applicant signature';
 exception when sqlstate 'TT409' then null; end;
 select id into v_primary from public.application_applicants where application_id='00000000-0000-4000-8000-000000000643' and role='primary';
 insert into public.client_application_files(id,application_id,applicant_id,document_type,storage_path,original_filename,mime_type,byte_size,sha256,scan_status)
 values('00000000-0000-4000-8000-000000000648','00000000-0000-4000-8000-000000000643',v_primary,'employment_income_proof','qa/unsigned-primary.pdf','test.pdf','application/pdf',100,repeat('c',64),'cleared');
 delete from public.client_application_files where id='00000000-0000-4000-8000-000000000648';
 select draft_payload into v_draft from public.client_applications where id='00000000-0000-4000-8000-000000000643';
 perform public.finalize_multi_applicant_application('00000000-0000-4000-8000-000000000643','00000000-0000-4000-8000-000000000640','Primary Applicant',v_terms.version,v_terms.sha256,v_form.version,v_form.sha256,v_terms.displayed_text,v_draft,'[]','{}',now(),now()+interval '12 months');
 if exists(select 1 from public.application_credit_check_requests where application_id='00000000-0000-4000-8000-000000000643') then raise exception 'external credit query was queued'; end if;
 update public.client_applications set status='approved' where id='00000000-0000-4000-8000-000000000643';
 insert into public.client_application_lease_files(id,application_id,storage_path,original_filename,mime_type,byte_size,sha256,uploaded_by)
  values('00000000-0000-4000-8000-000000000647','00000000-0000-4000-8000-000000000643','qa/signed-joint-lease.pdf','signed-joint-lease.pdf','application/pdf',100,repeat('a',64),'00000000-0000-4000-8000-000000000642');
 v_tenant := public.convert_approved_application_to_tenant('00000000-0000-4000-8000-000000000643',jsonb_build_object(
  'fullName','Primary Applicant','propertyLabel','Test Street','unitLabel','2','moveInDate','2026-12-01','leaseType','month_to_month','leaseEndDate',null,'rentDueDay',1,
  'email','joint-owner@example.test','phoneE164',null,'preferredChannels',jsonb_build_array('email'),'emailContactStatus','allowed','smsContactStatus','unconfirmed',
  'emailContactStatusSource','signed_tenancy_agreement','contactPermissionNote','SQL test signed lease','contactPermissionUpdatedAt',now(),'timezone','America/Vancouver','isActive',true),
  '00000000-0000-4000-8000-000000000642');
 if (select count(*) from public.client_tenant_links where tenant_id=v_tenant and archived_at is null) <> 2 then raise exception 'both users were not linked to one signed lease tenancy'; end if;
 if has_function_privilege('authenticated','public.claim_linked_applicant_invitation(uuid,text,text,timestamptz,jsonb)','execute') or has_function_privilege('anon','public.create_linked_applicant_invitation(uuid,uuid,uuid,uuid,text,text,text,timestamptz,jsonb,jsonb)','execute') then raise exception 'linked applicant RPC privileges too broad'; end if;
end $$;
rollback;
