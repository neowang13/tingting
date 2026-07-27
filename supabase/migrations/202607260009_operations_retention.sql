create table public.operational_alert_deliveries (
  id uuid primary key default gen_random_uuid(),
  alert_code text not null,
  bucket_start timestamptz not null,
  message text not null,
  status text not null check (status in ('processing', 'sent', 'failed')),
  provider_message_id text null,
  safe_error_code text null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  unique (alert_code, bucket_start)
);

create table public.retention_holds (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('notification_event', 'audit_event', 'tenant')),
  target_id uuid not null,
  reason text not null check (char_length(reason) between 1 and 500),
  expires_at timestamptz null,
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  unique (target_type, target_id)
);

create table public.maintenance_runs (
  run_date date primary key,
  started_at timestamptz not null,
  completed_at timestamptz null,
  status text not null check (status in ('running', 'completed', 'failed')),
  result jsonb not null default '{}'::jsonb
);

alter table public.operational_alert_deliveries enable row level security;
alter table public.retention_holds enable row level security;
alter table public.maintenance_runs enable row level security;
revoke all on public.operational_alert_deliveries, public.retention_holds, public.maintenance_runs
  from anon, authenticated;

alter table public.notification_events
  add column destination_hash text null,
  add column rendered_content_hash text null;

create or replace function public.save_tenant(
  p_id uuid,
  p_payload jsonb,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_action text;
begin
  if not public.is_active_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'active admin required';
  end if;

  if p_id is null then
    insert into public.tenants(
      full_name, property_label, unit_label, email, phone_e164, preferred_channels,
      email_contact_status, sms_contact_status, email_contact_status_reason,
      sms_contact_status_reason, email_contact_status_source, sms_contact_status_source,
      contact_permission_note, contact_permission_updated_at, timezone, internal_notes,
      is_active, created_by, updated_by
    ) values (
      p_payload->>'fullName',
      p_payload->>'propertyLabel',
      nullif(p_payload->>'unitLabel', ''),
      nullif(p_payload->>'email', ''),
      nullif(p_payload->>'phoneE164', ''),
      coalesce(array(select jsonb_array_elements_text(p_payload->'preferredChannels')), '{}'::text[]),
      coalesce(p_payload->>'emailContactStatus', 'unconfirmed'),
      coalesce(p_payload->>'smsContactStatus', 'unconfirmed'),
      nullif(p_payload->>'emailContactStatusReason', ''),
      nullif(p_payload->>'smsContactStatusReason', ''),
      nullif(p_payload->>'emailContactStatusSource', ''),
      nullif(p_payload->>'smsContactStatusSource', ''),
      nullif(p_payload->>'contactPermissionNote', ''),
      nullif(p_payload->>'contactPermissionUpdatedAt', '')::timestamptz,
      coalesce(nullif(p_payload->>'timezone', ''), 'America/Vancouver'),
      nullif(p_payload->>'internalNotes', ''),
      coalesce((p_payload->>'isActive')::boolean, true),
      p_actor_id,
      p_actor_id
    )
    returning * into v_tenant;
    v_action := 'tenant.created';
  else
    select * into v_tenant from public.tenants where id = p_id for update;
    if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;
    if v_tenant.updated_at <> p_expected_updated_at then
      raise exception using errcode = 'TT409', message = 'tenant changed';
    end if;

    update public.tenants set
      full_name = p_payload->>'fullName',
      property_label = p_payload->>'propertyLabel',
      unit_label = nullif(p_payload->>'unitLabel', ''),
      email = nullif(p_payload->>'email', ''),
      phone_e164 = nullif(p_payload->>'phoneE164', ''),
      preferred_channels = coalesce(array(select jsonb_array_elements_text(p_payload->'preferredChannels')), '{}'::text[]),
      email_contact_status = coalesce(p_payload->>'emailContactStatus', 'unconfirmed'),
      sms_contact_status = coalesce(p_payload->>'smsContactStatus', 'unconfirmed'),
      email_contact_status_reason = nullif(p_payload->>'emailContactStatusReason', ''),
      sms_contact_status_reason = nullif(p_payload->>'smsContactStatusReason', ''),
      email_contact_status_source = nullif(p_payload->>'emailContactStatusSource', ''),
      sms_contact_status_source = nullif(p_payload->>'smsContactStatusSource', ''),
      contact_permission_note = nullif(p_payload->>'contactPermissionNote', ''),
      contact_permission_updated_at = nullif(p_payload->>'contactPermissionUpdatedAt', '')::timestamptz,
      timezone = coalesce(nullif(p_payload->>'timezone', ''), 'America/Vancouver'),
      internal_notes = nullif(p_payload->>'internalNotes', ''),
      is_active = coalesce((p_payload->>'isActive')::boolean, true),
      updated_by = p_actor_id,
      updated_at = now()
    where id = p_id
    returning * into v_tenant;
    v_action := 'tenant.updated';
  end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    v_action,
    'tenant',
    v_tenant.id::text,
    jsonb_build_object(
      'preferredChannels', v_tenant.preferred_channels,
      'emailContactStatus', v_tenant.email_contact_status,
      'smsContactStatus', v_tenant.sms_contact_status,
      'isActive', v_tenant.is_active
    )
  );
  return to_jsonb(v_tenant);
end;
$$;

create or replace function public.daily_reminder_reconciliation(p_now timestamptz)
returns jsonb
language sql
security definer
set search_path = public
as $$
with gaps as (
  select schedule.id as schedule_id,
    channel,
    (schedule.next_run_at at time zone schedule.timezone)::date as occurrence_local_date
  from public.reminder_schedules schedule
  cross join lateral unnest(schedule.channels) as channel
  where schedule.is_enabled
    and schedule.next_run_at is not null
    and schedule.next_run_at <= p_now
    and not exists (
      select 1
      from public.notification_events event
      where event.schedule_id = schedule.id
        and event.channel = channel
        and event.occurrence_local_date =
          (schedule.next_run_at at time zone schedule.timezone)::date
    )
)
select jsonb_build_object(
  'checkedAt', p_now,
  'gapCount', count(*),
  'gaps', coalesce(
    jsonb_agg(jsonb_build_object(
      'scheduleId', schedule_id,
      'channel', channel,
      'occurrenceLocalDate', occurrence_local_date
    )) filter (where schedule_id is not null),
    '[]'::jsonb
  )
)
from gaps;
$$;

create or replace function public.apply_data_retention(
  p_now timestamptz,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_redacted integer;
  v_events_deleted integer;
  v_batches_deleted integer;
  v_audits_deleted integer;
  v_contacts_deleted integer;
begin
  update public.notification_events event
  set destination_hash = coalesce(event.destination_hash, encode(digest(coalesce(event.destination, ''), 'sha256'), 'hex')),
      rendered_content_hash = coalesce(
        event.rendered_content_hash,
        encode(digest(coalesce(event.rendered_subject, '') || E'\n' || coalesce(event.rendered_body, ''), 'sha256'), 'hex')
      ),
      destination = null,
      rendered_subject = null,
      rendered_body = null,
      render_context = null,
      retention_redacted_at = p_now,
      updated_at = now()
  where event.created_at < p_now - interval '90 days'
    and event.retention_redacted_at is null
    and not exists (
      select 1 from public.retention_holds hold
      where hold.target_type = 'notification_event'
        and hold.target_id = event.id
        and (hold.expires_at is null or hold.expires_at > p_now)
    );
  get diagnostics v_redacted = row_count;

  update public.notification_events child
  set retry_of_event_id = null
  where child.retry_of_event_id in (
    select parent.id
    from public.notification_events parent
    where parent.created_at < p_now - interval '24 months'
      and not exists (
        select 1 from public.retention_holds hold
        where hold.target_type = 'notification_event'
          and hold.target_id = parent.id
          and (hold.expires_at is null or hold.expires_at > p_now)
      )
  );

  delete from public.notification_attempts attempt
  using public.notification_events event
  where attempt.event_id = event.id
    and event.created_at < p_now - interval '24 months'
    and not exists (
      select 1 from public.retention_holds hold
      where hold.target_type = 'notification_event'
        and hold.target_id = event.id
        and (hold.expires_at is null or hold.expires_at > p_now)
    );

  delete from public.notification_events event
  where event.created_at < p_now - interval '24 months'
    and not exists (
      select 1 from public.retention_holds hold
      where hold.target_type = 'notification_event'
        and hold.target_id = event.id
        and (hold.expires_at is null or hold.expires_at > p_now)
    );
  get diagnostics v_events_deleted = row_count;

  delete from public.notification_batches batch
  where batch.created_at < p_now - interval '24 months'
    and not exists (
      select 1 from public.notification_events event where event.batch_id = batch.id
    );
  get diagnostics v_batches_deleted = row_count;

  delete from public.provider_webhook_events
  where received_at < p_now - interval '24 months';
  delete from public.reminder_worker_runs
  where started_at < p_now - interval '24 months';
  delete from public.operational_alert_deliveries
  where created_at < p_now - interval '24 months';

  delete from public.audit_events audit
  where audit.created_at < p_now - interval '24 months'
    and not exists (
      select 1 from public.retention_holds hold
      where hold.target_type = 'audit_event'
        and hold.target_id = audit.id
        and (hold.expires_at is null or hold.expires_at > p_now)
    );
  get diagnostics v_audits_deleted = row_count;

  delete from public.contact_enquiries
  where created_at < p_now - interval '12 months';
  get diagnostics v_contacts_deleted = row_count;

  insert into public.audit_events(actor_user_id, action, target_type, metadata)
  values (
    p_actor_id,
    'retention.applied',
    'system',
    jsonb_build_object(
      'renderedEventsRedacted', v_redacted,
      'notificationEventsDeleted', v_events_deleted,
      'notificationBatchesDeleted', v_batches_deleted,
      'auditEventsDeleted', v_audits_deleted,
      'contactSubmissionsDeleted', v_contacts_deleted
    )
  );

  return jsonb_build_object(
    'renderedEventsRedacted', v_redacted,
    'notificationEventsDeleted', v_events_deleted,
    'notificationBatchesDeleted', v_batches_deleted,
    'auditEventsDeleted', v_audits_deleted,
    'contactSubmissionsDeleted', v_contacts_deleted
  );
end;
$$;

create or replace function public.run_daily_maintenance(p_now timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date := (p_now at time zone 'America/Vancouver')::date;
  v_retention jsonb;
  v_reconciliation jsonb;
  v_result jsonb;
begin
  insert into public.maintenance_runs(run_date, started_at, status)
  values (v_date, p_now, 'running')
  on conflict do nothing;
  if not found then
    return jsonb_build_object('status', 'already_completed', 'runDate', v_date);
  end if;

  begin
    v_retention := public.apply_data_retention(p_now, null);
    v_reconciliation := public.daily_reminder_reconciliation(p_now);
    v_result := jsonb_build_object(
      'status', 'completed',
      'runDate', v_date,
      'retention', v_retention,
      'reconciliation', v_reconciliation
    );
    update public.maintenance_runs
    set completed_at = now(), status = 'completed', result = v_result
    where run_date = v_date;
    return v_result;
  exception when others then
    update public.maintenance_runs
    set completed_at = now(), status = 'failed',
        result = jsonb_build_object('safeErrorCode', sqlstate)
    where run_date = v_date;
    raise;
  end;
end;
$$;

create or replace function public.admin_dashboard_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
with latest_run as (
  select started_at, status from public.reminder_worker_runs order by started_at desc limit 1
),
oldest_event as (
  select min(created_at) as created_at
  from public.notification_events
  where status = 'scheduled' and coalesce(next_attempt_at, now()) <= now()
),
reconciliation as (
  select public.daily_reminder_reconciliation(now()) as result
),
facts as (
  select
    (select count(*) from public.tenants where is_active and archived_at is null) as active_tenants,
    (select count(*) from public.reminder_schedules where is_enabled) as enabled_schedules,
    (select count(*) from public.reminder_schedules where is_enabled and next_run_at between now() and now() + interval '7 days') as due_next_seven_days,
    (select count(*) from public.notification_events where status in ('failed', 'undelivered') and created_at >= now() - interval '30 days') as failed_last_thirty_days,
    (select count(*) from public.notification_events where status = 'scheduled' and coalesce(next_attempt_at, now()) <= now()) as outbox_backlog,
    (select coalesce((value->>'paused')::boolean, true) from public.system_settings where key = 'reminders') as reminders_paused,
    (select started_at from latest_run) as last_worker_run_at,
    (select status from latest_run) as latest_worker_status,
    (select created_at from oldest_event) as oldest_eligible_event_at,
    ((select result from reconciliation)->>'gapCount')::integer as reconciliation_gap_count
)
select to_jsonb(facts) || jsonb_build_object(
  'warnings',
  array_remove(array[
    case when not reminders_paused and (last_worker_run_at is null or last_worker_run_at < now() - interval '15 minutes')
      then 'The reminder worker has not completed within the last 15 minutes.' end,
    case when oldest_eligible_event_at < now() - interval '24 hours'
      then 'The notification backlog contains work older than the 24-hour grace period.' end,
    case when failed_last_thirty_days >= 3
      then 'Several provider attempts have failed. Review delivery history before retrying.' end,
    case when reconciliation_gap_count > 0
      then 'Daily reminder reconciliation found missing schedule events.' end
  ], null)
)
from facts;
$$;

revoke all on function public.save_tenant(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.daily_reminder_reconciliation(timestamptz) from public, anon, authenticated;
revoke all on function public.apply_data_retention(timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.run_daily_maintenance(timestamptz) from public, anon, authenticated;
revoke all on function public.admin_dashboard_summary() from public, anon, authenticated;
grant execute on function public.save_tenant(uuid, jsonb, timestamptz, uuid) to service_role;
grant execute on function public.daily_reminder_reconciliation(timestamptz) to service_role;
grant execute on function public.apply_data_retention(timestamptz, uuid) to service_role;
grant execute on function public.run_daily_maintenance(timestamptz) to service_role;
grant execute on function public.admin_dashboard_summary() to service_role;

-- Make the server-only repository permissions explicit instead of relying on
-- project-specific default privileges. The service-role key never reaches the
-- browser and still remains subject to the application validation boundary.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
