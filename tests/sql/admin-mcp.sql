\set ON_ERROR_STOP on
begin;
set local search_path = public,extensions;
select set_config('request.jwt.claim.role','service_role',true);
insert into auth.users(id,email,raw_user_meta_data) values
 ('00000000-0000-4000-8000-000000000650','mcp-admin@example.test','{}'),
 ('00000000-0000-4000-8000-000000000651','mcp-client@example.test','{"account_type":"client"}');
insert into public.admin_profiles(user_id,display_name) values ('00000000-0000-4000-8000-000000000650','MCP Test Admin');
insert into public.client_profiles(user_id,display_name) values ('00000000-0000-4000-8000-000000000651','MCP Test Client') on conflict do nothing;
insert into public.rental_properties(id,property_type,street_address,city,province_code,created_by,updated_by)
 values('00000000-0000-4000-8000-000000000652','condo','1 Test Street','Vancouver','BC',
 '00000000-0000-4000-8000-000000000650','00000000-0000-4000-8000-000000000650');
insert into public.rental_listings(id,property_id,slug,title,address_line,city,monthly_rent_cents,bedrooms,bathrooms,description,status,published_at,created_by,updated_by)
 values('00000000-0000-4000-8000-000000000652','00000000-0000-4000-8000-000000000652','mcp-test','MCP Test','1 Test Street','Vancouver',100000,1,1,'Synthetic test','published',now(),
 '00000000-0000-4000-8000-000000000650','00000000-0000-4000-8000-000000000650');
insert into public.property_viewing_schedules(rental_listing_id,open_weekdays)
 values('00000000-0000-4000-8000-000000000652',array[1,2,3,4,5,6,7]);
insert into public.client_applications(id,owner_user_id,property_title,property_address,form_version_id,terms_version_id,status,submitted_at,consented_at)
 select '00000000-0000-4000-8000-000000000653','00000000-0000-4000-8000-000000000651','MCP Test','1 Test Street',f.id,t.id,'submitted',now(),now()
 from public.application_form_versions f cross join public.application_terms_versions t where f.is_active and t.is_active limit 1;
insert into public.client_application_files(id,application_id,applicant_id,document_type,storage_path,original_filename,mime_type,byte_size,sha256,scan_status)
 select '00000000-0000-4000-8000-000000000654','00000000-0000-4000-8000-000000000653',id,'employment_income_proof','mcp/test.pdf','test.pdf','application/pdf',100,repeat('a',64),'screening_pending'
 from public.application_applicants where application_id='00000000-0000-4000-8000-000000000653' and role='primary';

do $$
declare
 v_version timestamptz;
 v_new timestamptz;
 v_date date := (now() at time zone 'America/Vancouver')::date+1;
 v_result jsonb;
 v_count integer;
begin
 if has_table_privilege('anon','public.mcp_operations','SELECT') or has_table_privilege('authenticated','public.mcp_operations','INSERT')
   or has_function_privilege('authenticated','public.mcp_transition_application(uuid,timestamptz,text,uuid)','EXECUTE')
   or has_function_privilege('authenticated','public.review_application_file(uuid,text,uuid)','EXECUTE')
   or has_function_privilege('anon','public.mcp_manage_showing(uuid,timestamptz,text,date,time,text,uuid)','EXECUTE') then
   raise exception 'MCP privilege boundary leaked';
 end if;
 select updated_at into strict v_version from public.client_applications where id='00000000-0000-4000-8000-000000000653';
 if not exists(select 1 from public.client_application_files where id='00000000-0000-4000-8000-000000000654') then raise exception 'test file fixture missing'; end if;
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_version,'needs_information','00000000-0000-4000-8000-000000000651');
   raise exception 'non-admin changed application';
 exception when insufficient_privilege then null; end;
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_version,'received','00000000-0000-4000-8000-000000000650');
   raise exception 'removed receipt step was accepted';
 exception when sqlstate 'TT409' then null; end;
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_version,'approved','00000000-0000-4000-8000-000000000650');
   raise exception 'submitted application approved without review';
 exception when sqlstate 'TT409' then null; end;
 if (select status from public.client_applications where id='00000000-0000-4000-8000-000000000653') <> 'submitted' then raise exception 'failed transition partly committed'; end if;
 v_new := public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_version,'under_review','00000000-0000-4000-8000-000000000650');
 if v_new <= v_version then raise exception 'application version failed to advance'; end if;
 begin
   perform public.review_application_file('00000000-0000-4000-8000-000000000654','rejected','00000000-0000-4000-8000-000000000651');
   raise exception 'non-admin reviewed file';
 exception when insufficient_privilege then null; end;
 perform public.review_application_file('00000000-0000-4000-8000-000000000654','rejected','00000000-0000-4000-8000-000000000650');
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_new,'approved','00000000-0000-4000-8000-000000000650');
   raise exception 'rejected file allowed approval';
 exception when sqlstate 'TT409' then null; end;
 update public.client_application_files set scan_status='screening_pending' where id='00000000-0000-4000-8000-000000000654';
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_version,'needs_information','00000000-0000-4000-8000-000000000650');
   raise exception 'stale version was accepted';
 exception when sqlstate 'TT409' then null; end;
 v_new := public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_new,'needs_information','00000000-0000-4000-8000-000000000650');
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_new,'received','00000000-0000-4000-8000-000000000650');
   raise exception 'information required another receipt step';
 exception when sqlstate 'TT409' then null; end;
 v_new := public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_new,'under_review','00000000-0000-4000-8000-000000000650');
 v_new := public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_new,'approved','00000000-0000-4000-8000-000000000650');
 begin
   perform public.mcp_transition_application('00000000-0000-4000-8000-000000000653',v_new,'approved','00000000-0000-4000-8000-000000000650');
   raise exception 'terminal application approved twice';
 exception when sqlstate 'TT409' then null; end;
 begin
   perform public.review_application_file('00000000-0000-4000-8000-000000000654','rejected','00000000-0000-4000-8000-000000000650');
   raise exception 'file changed after approval';
 exception when sqlstate 'TT409' then null; end;
 if (select scan_status from public.client_application_files where id='00000000-0000-4000-8000-000000000654') <> 'screening_pending' then raise exception 'terminal file partly changed'; end if;
 select count(*) into v_count from public.client_application_audit_events where application_id='00000000-0000-4000-8000-000000000653' and request_context->>'source'='admin';
 if v_count <> 4 then raise exception 'application audit did not commit exactly once per transition'; end if;

 insert into public.client_applications(id,owner_user_id,property_title,property_address,form_version_id,terms_version_id,status,submitted_at,consented_at)
 select '00000000-0000-4000-8000-000000000657','00000000-0000-4000-8000-000000000651','Historical received application','1 Test Street',f.id,t.id,'received',now(),now()
 from public.application_form_versions f cross join public.application_terms_versions t where f.is_active and t.is_active limit 1;
 select updated_at into strict v_version from public.client_applications where id='00000000-0000-4000-8000-000000000657';
 perform public.mcp_transition_application('00000000-0000-4000-8000-000000000657',v_version,'under_review','00000000-0000-4000-8000-000000000650');
 if (select status from public.client_applications where id='00000000-0000-4000-8000-000000000657') <> 'under_review' then raise exception 'historical received application stranded'; end if;

 perform public.reserve_viewing_appointment('00000000-0000-4000-8000-000000000655','00000000-0000-4000-8000-000000000652','mcp-test','MCP Test','1 Test Street',
   'Visitor','6045550111','mcp-visitor@example.test',null,v_date,null,'',now(),null);
 select updated_at into strict v_version from public.showing_requests where id='00000000-0000-4000-8000-000000000655';
 v_result := public.mcp_manage_showing('00000000-0000-4000-8000-000000000655',v_version,'accept',null,'14:00','Confirmed with visitor','00000000-0000-4000-8000-000000000650');
 if v_result->>'time' <> '14:00:00' or v_result->>'notification' <> 'not_sent' then raise exception 'appointment time/notification result inaccurate'; end if;
 begin
   perform public.mcp_manage_showing('00000000-0000-4000-8000-000000000655',v_version,'cancel',null,null,'stale request','00000000-0000-4000-8000-000000000650');
   raise exception 'stale viewing update accepted';
 exception when sqlstate 'TT409' then null; end;
 v_version := (v_result->>'updatedAt')::timestamptz;
 update public.property_viewing_schedules set open_weekdays='{}' where rental_listing_id='00000000-0000-4000-8000-000000000652';
 begin
   perform public.mcp_manage_showing('00000000-0000-4000-8000-000000000655',v_version,'reschedule',v_date+1,null,'closed calendar','00000000-0000-4000-8000-000000000650');
   raise exception 'closed date was accepted';
 exception when sqlstate 'TT409' then null; end;
 v_result := public.mcp_manage_showing('00000000-0000-4000-8000-000000000655',v_version,'cancel',null,null,'Visitor cancelled','00000000-0000-4000-8000-000000000650');
 if v_result->>'status' <> 'cancelled' then raise exception 'cancellation failed'; end if;
 begin
   perform public.mcp_manage_showing('00000000-0000-4000-8000-000000000655',(v_result->>'updatedAt')::timestamptz,'accept',null,null,'reopen','00000000-0000-4000-8000-000000000650');
   raise exception 'cancelled viewing reopened';
 exception when sqlstate 'TT409' then null; end;
 if (select count(*) from public.audit_events where target_id='00000000-0000-4000-8000-000000000655' and action like 'mcp.showing.%') <> 2 then raise exception 'viewing audit missing/duplicated'; end if;
 if exists(select 1 from public.owner_notification_deliveries where notification_key='showing-confirmation:00000000-0000-4000-8000-000000000655') then raise exception 'unexpected notification'; end if;

 insert into public.mcp_operations(id,credential_id,actor_user_id,tool,input_sha256) values
 ('00000000-0000-4000-8000-000000000656','test','00000000-0000-4000-8000-000000000650','test',repeat('a',64));
 begin
   insert into public.mcp_operations(id,credential_id,actor_user_id,tool,input_sha256) values
   ('00000000-0000-4000-8000-000000000656','test','00000000-0000-4000-8000-000000000650','test',repeat('a',64));
   raise exception 'duplicate operation claimed';
 exception when unique_violation then null; end;
end $$;
rollback;
