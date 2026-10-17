-- Permit direct application review without per-file clearance.
-- Rejected attachments still prevent approval; preserve Admin access, locking, versions, and audit.
create or replace function public.mcp_transition_application(
  p_id uuid, p_expected_updated_at timestamptz, p_next text, p_actor_id uuid
) returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v public.client_applications;
  v_next timestamptz;
  v_allowed boolean;
begin
  if not public.is_active_admin(p_actor_id) then raise exception 'inactive_admin' using errcode='42501'; end if;
  select * into v from public.client_applications where id=p_id and deleted_at is null for update;
  if not found or v.updated_at is distinct from p_expected_updated_at then
    raise exception 'application_changed' using errcode='TT409';
  end if;
  v_allowed := case v.status
    when 'submitted' then p_next in ('needs_information','under_review','withdrawn')
    when 'received' then p_next in ('needs_information','under_review','withdrawn')
    when 'needs_information' then p_next in ('under_review','withdrawn')
    when 'under_review' then p_next in ('needs_information','approved','declined','withdrawn')
    else false end;
  if not coalesce(v_allowed,false) then raise exception 'invalid_status' using errcode='TT409'; end if;
  perform 1 from public.client_application_files where application_id=p_id for share;
  if p_next='approved' and exists (
    select 1 from public.client_application_files where application_id=p_id and scan_status = 'rejected'
  ) then raise exception 'files_rejected' using errcode='TT409'; end if;
  update public.client_applications set status=p_next,
    updated_at=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond') where id=p_id returning updated_at into v_next;
  insert into public.client_application_audit_events(application_id,actor_user_id,actor_type,action,request_context)
    values(p_id,p_actor_id,'staff','application.status.'||p_next,'{"source":"admin"}'::jsonb);
  return v_next;
end;
$$;
revoke all on function public.mcp_transition_application(uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.mcp_transition_application(uuid,timestamptz,text,uuid) to service_role;

-- Legacy file-decision API uses the same parent lock as approval, so rejection
-- and approval cannot race or change attachments after a final decision.
create or replace function public.review_application_file(
  p_file_id uuid, p_decision text, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_application_id uuid;
  v_application public.client_applications;
  v_file public.client_application_files;
begin
  if not public.is_active_admin(p_actor_id) then raise exception 'inactive_admin' using errcode='42501'; end if;
  if p_decision not in ('cleared','rejected') or p_decision is null then
    raise exception 'invalid_file_decision' using errcode='TT409';
  end if;
  select application_id into v_application_id from public.client_application_files where id=p_file_id and deleted_at is null;
  if not found then raise exception 'file_not_found' using errcode='TT409'; end if;
  select * into v_application from public.client_applications where id=v_application_id and deleted_at is null for update;
  if not found or v_application.status in ('approved','declined','withdrawn') then
    raise exception 'application_not_reviewable' using errcode='TT409';
  end if;
  update public.client_application_files set scan_status=p_decision,reviewed_at=clock_timestamp()
    where id=p_file_id and application_id=v_application_id and deleted_at is null
      and scan_status in ('manual_review_required','screening_pending') returning * into v_file;
  if not found then raise exception 'file_already_reviewed' using errcode='TT409'; end if;
  insert into public.client_application_audit_events(application_id,actor_user_id,actor_type,action,request_context)
    values(v_application_id,p_actor_id,'staff','application.file_'||p_decision,jsonb_build_object('fileId',p_file_id));
  return to_jsonb(v_file);
end;
$$;
revoke all on function public.review_application_file(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.review_application_file(uuid,text,uuid) to service_role;
