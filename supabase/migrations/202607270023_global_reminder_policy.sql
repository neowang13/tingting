-- Global reminder policy. Legacy schedule columns remain during the
-- Automation API v1 compatibility window, but Admin and the worker now derive
-- all timing/template values from this single setting.

alter table public.tenants
  add column if not exists rent_due_day smallint not null default 1
  check (rent_due_day between 1 and 31);

update public.tenants tenant
set rent_due_day = schedule.rent_due_day
from public.reminder_schedules schedule
where schedule.tenant_id = tenant.id;

update public.system_settings
set value = value || jsonb_build_object(
  'leadDays', coalesce((value->>'leadDays')::integer, 3),
  'localTime', coalesce(value->>'localTime', '09:00'),
  'timezone', coalesce(value->>'timezone', 'America/Vancouver'),
  'emailTemplateId', value->'emailTemplateId'
)
where key = 'reminders';

create or replace function public.next_reminder_occurrence_internal(
  p_rent_due_day smallint,
  p_lead_days smallint,
  p_local_time time,
  p_timezone text,
  p_after_instant timestamptz,
  p_catch_up_before_due boolean
)
returns table(next_run_at timestamptz, send_local_date date, due_date date)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_after_local timestamp;
  v_month date;
  v_due date;
  v_send date;
  v_local timestamp;
  v_candidate timestamptz;
  v_offset integer;
begin
  if p_rent_due_day not between 1 and 31
    or p_lead_days not between 0 and 31 then
    raise exception using errcode = '22023', message = 'invalid reminder date input';
  end if;

  v_after_local := p_after_instant at time zone p_timezone;
  v_month := date_trunc('month', v_after_local)::date;

  for v_offset in 0..35 loop
    v_due := (
      v_month
      + make_interval(months => v_offset)
      + (
        least(
          p_rent_due_day::integer,
          extract(day from (
            date_trunc('month', v_month + make_interval(months => v_offset))
            + interval '1 month - 1 day'
          ))::integer
        ) - 1
      ) * interval '1 day'
    )::date;
    v_send := v_due - p_lead_days::integer;
    v_local := v_send + p_local_time;
    v_candidate := v_local at time zone p_timezone;

    -- PostgreSQL chooses the later instant for an ambiguous fall-back local
    -- time. Product policy requires the earlier occurrence.
    if ((v_candidate - interval '1 hour') at time zone p_timezone) = v_local then
      v_candidate := v_candidate - interval '1 hour';
    end if;

    if v_candidate > p_after_instant then
      next_run_at := v_candidate;
      send_local_date := v_send;
      due_date := v_due;
      return next;
      return;
    end if;

    if p_catch_up_before_due and v_due >= v_after_local::date then
      next_run_at := p_after_instant;
      send_local_date := v_after_local::date;
      due_date := v_due;
      return next;
      return;
    end if;
  end loop;

  raise exception using errcode = '22023', message = 'unable to calculate reminder occurrence';
end;
$$;

create or replace function public.next_reminder_occurrence(
  p_rent_due_day smallint,
  p_lead_days smallint,
  p_local_time time,
  p_timezone text,
  p_after_instant timestamptz
)
returns table(next_run_at timestamptz, send_local_date date, due_date date)
language sql
immutable
set search_path = public
as $$
  select *
  from public.next_reminder_occurrence_internal(
    p_rent_due_day,
    p_lead_days,
    p_local_time,
    p_timezone,
    p_after_instant,
    false
  );
$$;

create or replace function public.sync_tenant_global_reminder()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_eligible boolean;
  v_was_eligible boolean := false;
  v_timing_changed boolean;
  v_occurrence record;
  v_template_id uuid;
  v_actor uuid;
begin
  if tg_op = 'UPDATE' then
    v_was_eligible :=
      old.is_active
      and old.archived_at is null
      and old.email is not null
      and old.email_contact_status = 'allowed';
    v_timing_changed := old.rent_due_day is distinct from new.rent_due_day;

    if not v_timing_changed
      and old.is_active is not distinct from new.is_active
      and old.archived_at is not distinct from new.archived_at
      and old.email is not distinct from new.email
      and old.email_contact_status is not distinct from new.email_contact_status then
      return new;
    end if;
  else
    v_timing_changed := true;
  end if;

  select value into v_settings
  from public.system_settings
  where key = 'reminders';

  v_template_id := nullif(v_settings->>'emailTemplateId', '')::uuid;
  v_actor := new.updated_by;
  v_eligible :=
    new.is_active
    and new.archived_at is null
    and new.email is not null
    and new.email_contact_status = 'allowed'
    and v_template_id is not null;

  if v_eligible and (v_timing_changed or not v_was_eligible) then
    select * into v_occurrence
    from public.next_reminder_occurrence_internal(
      new.rent_due_day,
      coalesce((v_settings->>'leadDays')::smallint, 3::smallint),
      coalesce((v_settings->>'localTime')::time, '09:00'::time),
      coalesce(v_settings->>'timezone', 'America/Vancouver'),
      now(),
      not v_was_eligible
    );
  else
    select
      null::timestamptz as next_run_at,
      null::date as send_local_date,
      null::date as due_date
    into v_occurrence;
  end if;

  insert into public.reminder_schedules(
    tenant_id, rent_due_day, day_of_month, local_time, timezone, channels,
    email_template_id, sms_template_id, is_enabled, next_run_at,
    created_by, updated_by
  )
  values (
    new.id,
    new.rent_due_day,
    coalesce(extract(day from v_occurrence.send_local_date)::smallint, 1),
    coalesce((v_settings->>'localTime')::time, '09:00'::time),
    coalesce(v_settings->>'timezone', 'America/Vancouver'),
    array['email']::text[],
    v_template_id,
    null,
    v_eligible,
    case when v_eligible then v_occurrence.next_run_at else null end,
    v_actor,
    v_actor
  )
  on conflict (tenant_id) do update set
    rent_due_day = excluded.rent_due_day,
    day_of_month = case
      when v_occurrence.send_local_date is not null
        then extract(day from v_occurrence.send_local_date)::smallint
      else public.reminder_schedules.day_of_month
    end,
    local_time = excluded.local_time,
    timezone = excluded.timezone,
    channels = array['email']::text[],
    email_template_id = excluded.email_template_id,
    sms_template_id = null,
    is_enabled = excluded.is_enabled,
    next_run_at = case
      when not excluded.is_enabled then null
      when v_occurrence.next_run_at is not null then v_occurrence.next_run_at
      else public.reminder_schedules.next_run_at
    end,
    updated_by = excluded.updated_by,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_tenant_global_reminder_trigger on public.tenants;
create trigger sync_tenant_global_reminder_trigger
after insert or update of rent_due_day, email, email_contact_status, is_active, archived_at
on public.tenants
for each row execute function public.sync_tenant_global_reminder();

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
      full_name, property_label, unit_label, move_in_date, rent_due_day,
      email, phone_e164, preferred_channels,
      email_contact_status, sms_contact_status, email_contact_status_reason,
      sms_contact_status_reason, email_contact_status_source, sms_contact_status_source,
      contact_permission_note, contact_permission_updated_at, timezone, internal_notes,
      is_active, created_by, updated_by
    ) values (
      p_payload->>'fullName',
      p_payload->>'propertyLabel',
      nullif(p_payload->>'unitLabel', ''),
      nullif(p_payload->>'moveInDate', '')::date,
      coalesce((p_payload->>'rentDueDay')::smallint, 1),
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
      move_in_date = nullif(p_payload->>'moveInDate', '')::date,
      rent_due_day = coalesce((p_payload->>'rentDueDay')::smallint, v_tenant.rent_due_day),
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
      'rentDueDay', v_tenant.rent_due_day,
      'emailContactStatus', v_tenant.email_contact_status,
      'isActive', v_tenant.is_active
    )
  );
  return to_jsonb(v_tenant);
end;
$$;

create or replace function public.save_global_reminder_settings(
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
  v_setting public.system_settings;
  v_tenant public.tenants;
  v_schedule public.reminder_schedules;
  v_occurrence record;
  v_template public.notification_templates;
  v_timing_changed boolean;
  v_recalculated integer := 0;
  v_preserved integer := 0;
  v_now timestamptz := now();
  v_template_id uuid := (p_payload->>'emailTemplateId')::uuid;
begin
  if not public.is_active_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'active admin required';
  end if;

  select * into v_setting
  from public.system_settings
  where key = 'reminders'
  for update;
  if v_setting.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'TT409', message = 'stale reminder settings';
  end if;

  select * into v_template
  from public.notification_templates
  where id = v_template_id
    and channel = 'email'
    and is_active
    and current_revision_id is not null;
  if not found then
    raise exception using errcode = '23514', message = 'active email template with revision required';
  end if;

  if (p_payload->>'leadDays')::integer not between 0 and 31
    or (p_payload->>'timezone') <> 'America/Vancouver' then
    raise exception using errcode = '22023', message = 'invalid global reminder settings';
  end if;

  v_timing_changed :=
    coalesce((v_setting.value->>'leadDays')::integer, 3) <> (p_payload->>'leadDays')::integer
    or coalesce(v_setting.value->>'localTime', '09:00') <> p_payload->>'localTime'
    or coalesce(v_setting.value->>'timezone', 'America/Vancouver') <> p_payload->>'timezone';

  update public.system_settings
  set value = jsonb_build_object(
        'paused', (p_payload->>'paused')::boolean,
        'leadDays', (p_payload->>'leadDays')::integer,
        'localTime', p_payload->>'localTime',
        'timezone', p_payload->>'timezone',
        'emailTemplateId', v_template_id,
        'pausedAt', case when (p_payload->>'paused')::boolean then v_now else null end,
        'pausedBy', case when (p_payload->>'paused')::boolean then p_actor_id else null end
      ),
      updated_at = v_now
  where key = 'reminders'
  returning * into v_setting;

  for v_tenant in
    select * from public.tenants order by id for update
  loop
    select * into v_schedule
    from public.reminder_schedules
    where tenant_id = v_tenant.id
    for update;

    if v_timing_changed
      and v_schedule.id is not null
      and v_schedule.next_run_at <= v_now then
      v_preserved := v_preserved + 1;
      update public.reminder_schedules
      set local_time = (p_payload->>'localTime')::time,
          timezone = p_payload->>'timezone',
          channels = array['email']::text[],
          email_template_id = v_template_id,
          sms_template_id = null,
          updated_by = p_actor_id,
          updated_at = v_now
      where id = v_schedule.id;
      continue;
    end if;

    if v_tenant.is_active
      and v_tenant.archived_at is null
      and v_tenant.email is not null
      and v_tenant.email_contact_status = 'allowed' then
      if not v_timing_changed and v_schedule.id is not null then
        update public.reminder_schedules
        set channels = array['email']::text[],
            email_template_id = v_template_id,
            sms_template_id = null,
            is_enabled = true,
            updated_by = p_actor_id,
            updated_at = v_now
        where id = v_schedule.id;
        continue;
      end if;

      select * into v_occurrence
      from public.next_reminder_occurrence(
        v_tenant.rent_due_day,
        (p_payload->>'leadDays')::smallint,
        (p_payload->>'localTime')::time,
        p_payload->>'timezone',
        v_now
      );
      v_recalculated := v_recalculated + 1;
      insert into public.reminder_schedules(
        tenant_id, rent_due_day, day_of_month, local_time, timezone, channels,
        email_template_id, sms_template_id, is_enabled, next_run_at,
        created_by, updated_by
      ) values (
        v_tenant.id,
        v_tenant.rent_due_day,
        coalesce(extract(day from v_occurrence.send_local_date)::smallint, 1),
        (p_payload->>'localTime')::time,
        p_payload->>'timezone',
        array['email']::text[],
        v_template_id,
        null,
        true,
        coalesce(v_occurrence.next_run_at, v_schedule.next_run_at),
        p_actor_id,
        p_actor_id
      )
      on conflict (tenant_id) do update set
        rent_due_day = excluded.rent_due_day,
        day_of_month = case
          when v_occurrence.send_local_date is not null
            then extract(day from v_occurrence.send_local_date)::smallint
          else public.reminder_schedules.day_of_month
        end,
        local_time = excluded.local_time,
        timezone = excluded.timezone,
        channels = excluded.channels,
        email_template_id = excluded.email_template_id,
        sms_template_id = null,
        is_enabled = true,
        next_run_at = coalesce(v_occurrence.next_run_at, public.reminder_schedules.next_run_at),
        updated_by = p_actor_id,
        updated_at = v_now;
    elsif v_schedule.id is not null then
      update public.reminder_schedules
      set is_enabled = false,
          next_run_at = null,
          channels = array['email']::text[],
          email_template_id = v_template_id,
          sms_template_id = null,
          local_time = (p_payload->>'localTime')::time,
          timezone = p_payload->>'timezone',
          updated_by = p_actor_id,
          updated_at = v_now
      where id = v_schedule.id;
    end if;
  end loop;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'reminder.settings_saved',
    'system_setting',
    'reminders',
    jsonb_build_object(
      'leadDays', (p_payload->>'leadDays')::integer,
      'localTime', p_payload->>'localTime',
      'emailTemplateId', v_template_id,
      'recalculatedTenants', v_recalculated,
      'preservedDueTenants', v_preserved
    )
  );

  return jsonb_build_object(
    'paused', (v_setting.value->>'paused')::boolean,
    'leadDays', (v_setting.value->>'leadDays')::integer,
    'localTime', v_setting.value->>'localTime',
    'timezone', v_setting.value->>'timezone',
    'emailTemplateId', v_setting.value->>'emailTemplateId',
    'recalculatedTenants', v_recalculated,
    'preservedDueTenants', v_preserved,
    'updatedAt', v_setting.updated_at
  );
end;
$$;

create or replace function public.create_global_test_notification_event(
  p_tenant_id uuid,
  p_template_id uuid,
  p_request_id uuid,
  p_actor_id uuid,
  p_due_date date,
  p_rendered_subject text,
  p_rendered_body text,
  p_destination text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_template public.notification_templates;
  v_revision public.notification_template_revisions;
  v_event public.notification_events;
begin
  select * into v_event
  from public.notification_events
  where occurrence_key = 'test:' || p_request_id || ':email';
  if found then return to_jsonb(v_event); end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;
  select * into v_template
  from public.notification_templates
  where id = p_template_id and channel = 'email' and is_active;
  if not found then raise exception using errcode = '23514', message = 'active email template required'; end if;
  select * into v_revision
  from public.notification_template_revisions
  where id = v_template.current_revision_id;
  if not found then raise exception using errcode = '23514', message = 'template revision required'; end if;

  insert into public.notification_events(
    tenant_id, template_id, template_revision_id, source, channel, occurrence_key,
    occurrence_local_date, scheduled_for, due_date, status, rendered_subject, rendered_body,
    render_context, destination, destination_masked, provider, next_attempt_at, created_by
  )
  values (
    v_tenant.id,
    v_template.id,
    v_revision.id,
    'test',
    'email',
    'test:' || p_request_id || ':email',
    (now() at time zone 'America/Vancouver')::date,
    now(),
    p_due_date,
    'scheduled',
    p_rendered_subject,
    p_rendered_body,
    jsonb_build_object(
      'tenant_name', v_tenant.full_name,
      'property', v_tenant.property_label,
      'unit', coalesce(v_tenant.unit_label, ''),
      'due_date', to_char(p_due_date, 'FMMonth FMDD, YYYY')
    ),
    p_destination,
    public.mask_email(p_destination),
    'resend',
    now(),
    p_actor_id
  )
  returning * into v_event;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'notification.test_queued',
    'notification_event',
    v_event.id::text,
    jsonb_build_object('channel', 'email', 'dueDate', p_due_date)
  );
  return to_jsonb(v_event);
end;
$$;

create or replace function public.materialize_due_reminders(
  p_now timestamptz,
  p_force_paused boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.reminder_worker_runs;
  v_settings jsonb;
  v_schedule record;
  v_template public.notification_templates;
  v_revision public.notification_template_revisions;
  v_occurrence record;
  v_context jsonb;
  v_status text;
  v_reason text;
  v_created integer := 0;
begin
  insert into public.reminder_worker_runs(started_at, status)
  values (p_now, 'running')
  returning * into v_run;

  select value into v_settings
  from public.system_settings
  where key = 'reminders';

  if p_force_paused or coalesce((v_settings->>'paused')::boolean, true) then
    update public.reminder_worker_runs
    set completed_at = now(), status = 'paused'
    where id = v_run.id
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  select * into v_template
  from public.notification_templates
  where id = nullif(v_settings->>'emailTemplateId', '')::uuid;
  if v_template.id is not null then
    select * into v_revision
    from public.notification_template_revisions
    where id = v_template.current_revision_id;
  end if;

  for v_schedule in
    select schedule.*, tenant.full_name, tenant.property_label, tenant.unit_label,
      tenant.email, tenant.email_contact_status, tenant.rent_due_day,
      tenant.is_active as tenant_is_active, tenant.archived_at as tenant_archived_at
    from public.reminder_schedules schedule
    join public.tenants tenant on tenant.id = schedule.tenant_id
    where schedule.is_enabled and schedule.next_run_at <= p_now
    order by schedule.next_run_at
    for update of schedule skip locked
    limit 200
  loop
    select * into v_occurrence
    from public.next_reminder_occurrence(
      v_schedule.rent_due_day,
      coalesce((v_settings->>'leadDays')::smallint, 3::smallint),
      coalesce((v_settings->>'localTime')::time, '09:00'::time),
      coalesce(v_settings->>'timezone', 'America/Vancouver'),
      v_schedule.next_run_at - interval '1 millisecond'
    );

    v_context := jsonb_build_object(
      'tenant_name', v_schedule.full_name,
      'property', v_schedule.property_label,
      'unit', coalesce(v_schedule.unit_label, ''),
      'due_date', to_char(v_occurrence.due_date, 'FMMonth FMDD, YYYY'),
      'business_name', 'Ting Ting Xu Real Estate',
      'business_phone', '604-872-6896',
      'business_email', 'info@tingtingxu.ca',
      'lead_days', coalesce((v_settings->>'leadDays')::integer, 3),
      'local_time', coalesce(v_settings->>'localTime', '09:00')
    );

    v_status := 'scheduled';
    v_reason := null;
    if p_now - v_schedule.next_run_at > interval '24 hours' then
      v_status := 'expired'; v_reason := 'occurrence_outside_grace_period';
    elsif not v_schedule.tenant_is_active or v_schedule.tenant_archived_at is not null then
      v_status := 'skipped'; v_reason := 'tenant_inactive';
    elsif v_schedule.email_contact_status <> 'allowed' or v_schedule.email is null then
      v_status := 'skipped'; v_reason := 'channel_not_allowed';
    elsif v_template.id is null
      or v_template.channel <> 'email'
      or not v_template.is_active
      or v_revision.id is null then
      v_status := 'skipped'; v_reason := 'template_unavailable';
    end if;

    if v_template.id is not null and v_revision.id is not null then
      insert into public.notification_events(
        tenant_id, schedule_id, template_id, template_revision_id, source,
        channel, occurrence_key, occurrence_local_date, scheduled_for, due_date,
        status, rendered_subject, rendered_body, render_context, render_error_code,
        destination, destination_masked, provider, next_attempt_at
      )
      values (
        v_schedule.tenant_id,
        v_schedule.id,
        v_template.id,
        v_revision.id,
        'scheduled',
        'email',
        'scheduled:' || v_schedule.id || ':' || v_occurrence.send_local_date || ':email',
        v_occurrence.send_local_date,
        v_schedule.next_run_at,
        v_occurrence.due_date,
        v_status,
        case when v_status = 'scheduled'
          then public.render_notification_template(v_revision.subject_template, v_context)
          else null
        end,
        case when v_status = 'scheduled'
          then public.render_notification_template(v_revision.body_template, v_context)
          else null
        end,
        v_context,
        v_reason,
        case when v_status = 'scheduled' then v_schedule.email else null end,
        case when v_status = 'scheduled' then public.mask_email(v_schedule.email) else null end,
        'resend',
        case when v_status = 'scheduled' then p_now else null end
      )
      on conflict do nothing;
      if found then v_created := v_created + 1; end if;
    end if;

    select * into v_occurrence
    from public.next_reminder_occurrence(
      v_schedule.rent_due_day,
      coalesce((v_settings->>'leadDays')::smallint, 3::smallint),
      coalesce((v_settings->>'localTime')::time, '09:00'::time),
      coalesce(v_settings->>'timezone', 'America/Vancouver'),
      greatest(p_now, v_schedule.next_run_at)
    );
    update public.reminder_schedules
    set last_processed_at = p_now,
        next_run_at = v_occurrence.next_run_at,
        day_of_month = extract(day from v_occurrence.send_local_date)::smallint,
        local_time = coalesce((v_settings->>'localTime')::time, '09:00'::time),
        timezone = coalesce(v_settings->>'timezone', 'America/Vancouver'),
        email_template_id = v_template.id,
        channels = array['email']::text[],
        updated_at = now()
    where id = v_schedule.id;
  end loop;

  update public.reminder_worker_runs
  set completed_at = now(),
      status = 'completed',
      occurrences_created = v_created,
      backlog_remaining = (
        select count(*) from public.notification_events
        where status = 'scheduled' and coalesce(next_attempt_at, p_now) <= p_now
      )
  where id = v_run.id
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.next_reminder_occurrence_internal(smallint, smallint, time, text, timestamptz, boolean)
  from public, anon, authenticated;
revoke all on function public.next_reminder_occurrence(smallint, smallint, time, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.save_global_reminder_settings(jsonb, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.create_global_test_notification_event(uuid, uuid, uuid, uuid, date, text, text, text)
  from public, anon, authenticated;
revoke all on function public.sync_tenant_global_reminder()
  from public, anon, authenticated;
revoke all on function public.materialize_due_reminders(timestamptz, boolean)
  from public, anon, authenticated;

grant execute on function public.next_reminder_occurrence(smallint, smallint, time, text, timestamptz)
  to service_role;
grant execute on function public.save_global_reminder_settings(jsonb, timestamptz, uuid)
  to service_role;
grant execute on function public.create_global_test_notification_event(uuid, uuid, uuid, uuid, date, text, text, text)
  to service_role;
grant execute on function public.materialize_due_reminders(timestamptz, boolean)
  to service_role;
