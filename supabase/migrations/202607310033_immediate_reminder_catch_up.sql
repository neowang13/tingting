-- A newly eligible tenant may be added after the configured reminder time.
-- Keep that occurrence sendable through the local rent due date so the API
-- can process it immediately. Once the due date has passed, the normal
-- overdue-rent workflow is the correct owner-facing path.

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
    if v_occurrence.due_date
      < (p_now at time zone coalesce(v_settings->>'timezone', 'America/Vancouver'))::date then
      v_status := 'expired';
      v_reason := 'occurrence_due_date_passed';
    elsif not v_schedule.tenant_is_active or v_schedule.tenant_archived_at is not null then
      v_status := 'skipped';
      v_reason := 'tenant_inactive';
    elsif v_schedule.email_contact_status <> 'allowed' or v_schedule.email is null then
      v_status := 'skipped';
      v_reason := 'channel_not_allowed';
    elsif v_template.id is null
      or v_template.channel <> 'email'
      or not v_template.is_active
      or v_revision.id is null then
      v_status := 'skipped';
      v_reason := 'template_unavailable';
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

revoke all on function public.materialize_due_reminders(timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.materialize_due_reminders(timestamptz, boolean)
  to service_role;
