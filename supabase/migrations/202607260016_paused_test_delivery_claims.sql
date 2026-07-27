-- Production dry runs must remain possible while scheduled reminders are
-- force-paused. This claim path can select only test events, whose destination
-- is frozen from the administrator-owned test-contact setting.

create or replace function public.claim_test_notification_events(
  p_now timestamptz,
  p_limit integer,
  p_claim_token uuid
)
returns setof public.notification_events
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_events
  set status = 'scheduled', claim_token = null, claim_expires_at = null,
      claimed_at = null, updated_at = now()
  where source = 'test'
    and status = 'processing'
    and claim_expires_at <= p_now
    and provider_request_started_at is null;

  update public.notification_events
  set status = 'unknown', claim_token = null, claim_expires_at = null,
      last_error_code = 'AMBIGUOUS_PROVIDER_OUTCOME', updated_at = now()
  where source = 'test'
    and status = 'processing'
    and claim_expires_at <= p_now
    and provider_request_started_at is not null
    and provider_message_id is null;

  return query
  with candidates as (
    select id
    from public.notification_events
    where source = 'test'
      and status = 'scheduled'
      and coalesce(next_attempt_at, p_now) <= p_now
      and (claim_expires_at is null or claim_expires_at <= p_now)
    order by created_at
    for update skip locked
    limit least(p_limit, 20)
  )
  update public.notification_events event
  set claim_token = p_claim_token,
      claim_expires_at = p_now + interval '10 minutes',
      claimed_at = p_now,
      updated_at = now()
  from candidates
  where event.id = candidates.id
  returning event.*;
end;
$$;

revoke all on function public.claim_test_notification_events(timestamptz, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_test_notification_events(timestamptz, integer, uuid)
  to service_role;

create or replace function public.begin_test_notification_attempt(
  p_event_id uuid,
  p_claim_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_events;
  v_tenant public.tenants;
  v_test_contacts jsonb;
  v_current_destination text;
begin
  select * into v_event
  from public.notification_events
  where id = p_event_id
    and source = 'test'
    and status = 'scheduled'
    and claim_token = p_claim_token
  for update;
  if not found then
    raise exception using errcode = 'TT409', message = 'test event claim changed';
  end if;

  select * into v_tenant from public.tenants where id = v_event.tenant_id;
  select value into v_test_contacts
  from public.system_settings
  where key = 'notification_test_contacts';
  v_current_destination := case
    when v_event.channel = 'email' then v_test_contacts->>'email'
    else v_test_contacts->>'phoneE164'
  end;

  if not v_tenant.is_active or v_tenant.archived_at is not null then
    update public.notification_events
    set status = 'cancelled', last_error_code = 'TENANT_INACTIVE', updated_at = now()
    where id = v_event.id returning * into v_event;
    return to_jsonb(v_event);
  end if;
  if v_current_destination is null or v_current_destination is distinct from v_event.destination then
    update public.notification_events
    set status = 'cancelled', last_error_code = 'TEST_DESTINATION_CHANGED', updated_at = now()
    where id = v_event.id returning * into v_event;
    return to_jsonb(v_event);
  end if;

  update public.notification_events
  set status = 'processing',
      attempt_count = attempt_count + 1,
      updated_at = now()
  where id = v_event.id
  returning * into v_event;

  insert into public.notification_attempts(event_id, attempt_number, started_at, provider)
  values (v_event.id, v_event.attempt_count, now(), v_event.provider);
  return to_jsonb(v_event);
end;
$$;

revoke all on function public.begin_test_notification_attempt(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.begin_test_notification_attempt(uuid, uuid)
  to service_role;
