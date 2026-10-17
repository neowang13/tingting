-- Private administrator MCP. No grants to website clients or public visitors.
create table public.mcp_operations (
  id uuid primary key,
  credential_id text not null,
  actor_user_id uuid not null references auth.users(id),
  tool text not null,
  input_sha256 text not null check (input_sha256 ~ '^[a-f0-9]{64}$'),
  status text not null default 'pending' check (status in ('pending','completed','uncertain')),
  result jsonb null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table public.mcp_operations enable row level security;
revoke all on public.mcp_operations from public, anon, authenticated;
grant all on public.mcp_operations to service_role;
create index mcp_operations_actor_created_idx on public.mcp_operations(actor_user_id,created_at);
comment on table public.mcp_operations is 'MCP write audit and deduplication. Retain operation IDs while their credentials are valid; pending/uncertain operations must be reconciled before retry. Never stores raw tokens or application payloads.';

-- The row lock, version check, screening gate and audit commit together.
create function public.mcp_transition_application(
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
    when 'submitted' then p_next in ('received','withdrawn')
    when 'received' then p_next in ('needs_information','under_review','withdrawn')
    when 'needs_information' then p_next in ('received','withdrawn')
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

create function public.mcp_manage_showing(
  p_id uuid, p_expected_updated_at timestamptz, p_action text, p_date date,
  p_time time, p_reason text, p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.showing_requests;
  v_calendar public.property_viewing_schedules;
  v_date date;
  v_start timestamptz;
  v_status text;
  v_available boolean;
  v_now timestamptz := clock_timestamp();
  v_today date := (v_now at time zone 'America/Vancouver')::date;
begin
  if not public.is_active_admin(p_actor_id) then raise exception 'inactive_admin' using errcode='42501'; end if;
  if p_action not in ('accept','decline','cancel','reschedule') or p_action is null
    or p_reason is null or length(trim(p_reason)) not between 1 and 500
    or (p_action='reschedule' and p_date is null)
    or (p_action in ('cancel','decline') and (p_date is not null or p_time is not null)) then
    raise exception 'invalid_showing_change' using errcode='TT409';
  end if;
  select * into v from public.showing_requests where id=p_id for update;
  if not found or v.updated_at is distinct from p_expected_updated_at or v.status in ('cancelled','declined') then
    raise exception 'showing_changed' using errcode='TT409';
  end if;
  v_date := coalesce(p_date,v.requested_local_date);
  if p_action in ('accept','reschedule') then
    perform 1 from public.rental_listings where id=v.rental_listing_id and status='published' for share;
    if not found then raise exception 'property_unavailable' using errcode='TT409'; end if;
    select * into v_calendar from public.property_viewing_schedules where rental_listing_id=v.rental_listing_id for share;
    if not found or v_date < v_today or v_date >= (v_today+interval '1 month')::date then
      raise exception 'date_unavailable' using errcode='TT409';
    end if;
    select (item->>'available')::boolean into v_available from jsonb_array_elements(v_calendar.date_overrides) item
      where item->>'date'=v_date::text limit 1;
    v_available := coalesce(v_available,extract(isodow from v_date)::integer=any(v_calendar.open_weekdays));
    if not v_available then raise exception 'date_unavailable' using errcode='TT409'; end if;
    if p_time is not null then
      v_start := (v_date+p_time) at time zone 'America/Vancouver';
      if v_start <= v_now or (v_start at time zone 'America/Vancouver') <> (v_date+p_time)
        or ((v_start-interval '1 hour') at time zone 'America/Vancouver')=(v_date+p_time)
        or ((v_start+interval '1 hour') at time zone 'America/Vancouver')=(v_date+p_time) then
        raise exception 'invalid_or_ambiguous_time' using errcode='TT409';
      end if;
    end if;
  end if;
  v_status := case p_action when 'cancel' then 'cancelled' when 'decline' then 'declined' else 'accepted' end;
  update public.showing_requests set status=v_status,
    accepted_at=case when v_status='accepted' then v_now else null end,
    requested_local_date=case when v_status='accepted' then v_date else requested_local_date end,
    requested_local_time=case when v_status='accepted' then p_time else requested_local_time end,
    requested_start_at=case when v_status='accepted' then v_start else requested_start_at end,
    updated_at=greatest(v_now,v.updated_at+interval '1 microsecond')
    where id=p_id returning * into v;
  insert into public.audit_events(actor_user_id,action,target_type,target_id,metadata)
    values(p_actor_id,'mcp.showing.'||p_action,'showing_request',p_id::text,jsonb_build_object('reason',p_reason));
  return jsonb_build_object('id',v.id,'status',v.status,'date',v.requested_local_date,'time',v.requested_local_time,
    'timezone',v.requested_timezone,'updatedAt',v.updated_at,'notification','not_sent');
end;
$$;
revoke all on function public.mcp_manage_showing(uuid,timestamptz,text,date,time,text,uuid) from public,anon,authenticated;
grant execute on function public.mcp_manage_showing(uuid,timestamptz,text,date,time,text,uuid) to service_role;
