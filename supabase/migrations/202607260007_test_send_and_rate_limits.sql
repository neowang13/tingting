insert into public.system_settings(key, value)
values ('notification_test_contacts', '{"email": null, "phoneE164": null}'::jsonb)
on conflict (key) do nothing;

create table if not exists public.action_rate_limits (
  actor_key text not null,
  action_key text not null,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (actor_key, action_key)
);
alter table public.action_rate_limits enable row level security;
revoke all on public.action_rate_limits from anon, authenticated;

create or replace function public.consume_action_rate_limit(
  p_actor_key text,
  p_action_key text,
  p_limit integer,
  p_window interval
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  insert into public.action_rate_limits(actor_key, action_key, window_started_at, request_count)
  values (p_actor_key, p_action_key, now(), 1)
  on conflict (actor_key, action_key) do update
  set window_started_at = case
        when public.action_rate_limits.window_started_at <= now() - p_window then now()
        else public.action_rate_limits.window_started_at
      end,
      request_count = case
        when public.action_rate_limits.window_started_at <= now() - p_window then 1
        else public.action_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count <= p_limit into v_allowed;
  return v_allowed;
end;
$$;

create or replace function public.set_notification_test_contacts(
  p_email text,
  p_phone_e164 text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_at timestamptz;
begin
  update public.system_settings
  set value = jsonb_build_object('email', p_email, 'phoneE164', p_phone_e164),
      updated_by = p_actor_id,
      updated_at = now()
  where key = 'notification_test_contacts' and updated_at = p_expected_updated_at
  returning updated_at into v_updated_at;
  if not found then raise exception using errcode = 'TT409', message = 'stale test contacts'; end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'notification.test_contacts_changed', 'system_setting', 'notification_test_contacts');
  return jsonb_build_object('email', p_email, 'phoneE164', p_phone_e164, 'updated_at', v_updated_at);
end;
$$;

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
  v_template public.notification_templates;
  v_revision public.notification_template_revisions;
  v_settings jsonb;
  v_destination text;
  v_context jsonb;
  v_event public.notification_events;
begin
  select * into v_event
  from public.notification_events
  where occurrence_key = 'test:' || p_request_id || ':' || p_channel;
  if found then return to_jsonb(v_event); end if;

  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;
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

  v_context := jsonb_build_object(
    'tenant_name', v_tenant.full_name,
    'property', v_tenant.property_label,
    'unit', coalesce(v_tenant.unit_label, ''),
    'due_date', 'the first of the month',
    'business_name', 'Ting Ting Xu Real Estate',
    'business_phone', '604-872-6896',
    'business_email', 'info@tingtingxu.ca'
  );

  insert into public.notification_events(
    tenant_id, template_id, template_revision_id, source, channel, occurrence_key,
    occurrence_local_date, scheduled_for, status, rendered_subject, rendered_body,
    render_context, destination, destination_masked, provider, next_attempt_at, created_by
  )
  values (
    v_tenant.id,
    v_template.id,
    v_revision.id,
    'test',
    p_channel,
    'test:' || p_request_id || ':' || p_channel,
    (now() at time zone v_tenant.timezone)::date,
    now(),
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

revoke all on function public.consume_action_rate_limit(text, text, integer, interval)
  from public, anon, authenticated;
revoke all on function public.set_notification_test_contacts(text, text, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.create_test_notification_event(uuid, text, uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.consume_action_rate_limit(text, text, integer, interval)
  to service_role;
grant execute on function public.set_notification_test_contacts(text, text, timestamptz, uuid)
  to service_role;
grant execute on function public.create_test_notification_event(uuid, text, uuid, uuid, uuid)
  to service_role;
