-- Remove manual receipt acknowledgement. Keep historical received rows actionable.
-- Preserve row locking, optimistic versions, screening gates, audit, and Admin-only access.
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
  if p_next in ('under_review','approved','declined') and exists (
    select 1 from public.client_application_files where application_id=p_id and scan_status <> 'cleared'
  ) then raise exception 'files_not_cleared' using errcode='TT409'; end if;
  update public.client_applications set status=p_next,
    updated_at=greatest(clock_timestamp(),v.updated_at+interval '1 microsecond') where id=p_id returning updated_at into v_next;
  insert into public.client_application_audit_events(application_id,actor_user_id,actor_type,action,request_context)
    values(p_id,p_actor_id,'staff','application.status.'||p_next,'{"source":"mcp"}'::jsonb);
  return v_next;
end;
$$;
revoke all on function public.mcp_transition_application(uuid,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.mcp_transition_application(uuid,timestamptz,text,uuid) to service_role;
