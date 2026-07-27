-- Keep the confirmed test email identical to its server preview by rendering
-- the tenant's saved monthly rent due day instead of a hard-coded first.
create or replace function public.create_test_notification_event(
  p_tenant_id uuid,
  p_channel text,
  p_template_id uuid,
  p_request_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_schedule public.reminder_schedules;
  v_template public.notification_templates;
  v_revision public.notification_template_revisions;
  v_settings jsonb;
  v_destination text;
  v_context jsonb;
  v_event public.notification_events;
  v_occurrence_date date;
  v_due_date date;
begin
  select * into v_event
  from public.notification_events
  where occurrence_key = 'test:' || p_request_id || ':' || p_channel;
  if found then return to_jsonb(v_event); end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;
  select * into v_schedule
  from public.reminder_schedules
  where tenant_id = p_tenant_id;
  select * into v_template
  from public.notification_templates
  where id = p_template_id and channel = p_channel and is_active;
  if not found then raise exception using errcode = '23514', message = 'active template required'; end if;
  select * into v_revision
  from public.notification_template_revisions
  where id = v_template.current_revision_id;
  select value into v_settings from public.system_settings where key = 'notification_test_contacts';
  v_destination := case when p_channel = 'email' then v_settings->>'email' else v_settings->>'phoneE164' end;
  if v_destination is null or v_destination = '' then
    raise exception using errcode = '23514', message = 'admin test destination is not configured';
  end if;

  v_occurrence_date := (now() at time zone v_tenant.timezone)::date;
  v_due_date := public.reminder_due_date(
    v_occurrence_date,
    coalesce(v_schedule.rent_due_day, 1)::smallint
  );
  v_context := jsonb_build_object(
    'tenant_name', v_tenant.full_name,
    'property', v_tenant.property_label,
    'unit', coalesce(v_tenant.unit_label, ''),
    'due_date', to_char(v_due_date, 'FMMonth FMDD, YYYY'),
    'business_name', 'Ting Ting Xu Real Estate',
    'business_phone', '604-872-6896',
    'business_email', 'info@tingtingxu.ca'
  );

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
    p_channel,
    'test:' || p_request_id || ':' || p_channel,
    v_occurrence_date,
    now(),
    v_due_date,
    'scheduled',
    case when p_channel = 'email' then public.render_notification_template(v_revision.subject_template, v_context) else null end,
    public.render_notification_template(v_revision.body_template, v_context),
    v_context,
    v_destination,
    case when p_channel = 'email' then public.mask_email(v_destination) else public.mask_phone(v_destination) end,
    case when p_channel = 'email' then 'resend' else 'twilio' end,
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
    jsonb_build_object('channel', p_channel)
  );
  return to_jsonb(v_event);
end;
$$;

revoke all on function public.create_test_notification_event(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.create_test_notification_event(uuid, text, uuid, uuid, uuid)
  to service_role;
