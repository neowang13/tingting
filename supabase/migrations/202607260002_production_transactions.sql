-- Production completion migration. This migration is intentionally append-only:
-- it corrects the framework schema without rewriting the initial milestone.

create extension if not exists pgcrypto;

alter table public.notification_templates
  add column if not exists current_revision_id uuid null;

alter table public.notification_templates
  add constraint notification_templates_current_revision_fk
  foreign key (current_revision_id)
  references public.notification_template_revisions(id);

alter table public.notification_events
  add column if not exists due_date date null;

alter table public.notification_events
  add column if not exists batch_id uuid null
  references public.notification_batches(id);

alter table public.notification_events
  add column if not exists retention_redacted_at timestamptz null;

create table if not exists public.provider_webhook_events (
  provider text not null check (provider in ('resend', 'twilio')),
  provider_event_id text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz null,
  safe_event_type text null,
  primary key (provider, provider_event_id)
);

create table if not exists public.contact_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text null,
  phone text null,
  preferred_contact text not null check (preferred_contact in ('email', 'phone', 'sms')),
  message text not null,
  status text not null default 'new' check (status in ('new', 'handled', 'archived')),
  created_at timestamptz not null default now(),
  handled_at timestamptz null,
  check (email is not null or phone is not null)
);

create table if not exists public.contact_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null,
  request_count integer not null check (request_count >= 0),
  updated_at timestamptz not null default now()
);

alter table public.provider_webhook_events enable row level security;
alter table public.contact_enquiries enable row level security;
alter table public.contact_rate_limits enable row level security;

revoke all on public.provider_webhook_events from anon, authenticated;
revoke all on public.contact_enquiries from anon, authenticated;
revoke all on public.contact_rate_limits from anon, authenticated;

create or replace function public.mask_email(p_email text)
returns text
language sql
immutable
strict
as $$
  select left(split_part(p_email, '@', 1), 1) || '***@' || split_part(p_email, '@', 2);
$$;

create or replace function public.mask_phone(p_phone text)
returns text
language sql
immutable
strict
as $$
  select left(p_phone, 3) || '***' || right(p_phone, 2);
$$;

create or replace function public.is_active_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_profiles
    where user_id = p_user_id and is_active
  );
$$;

create policy "active admins can read provider webhook receipts"
  on public.provider_webhook_events for select
  to authenticated
  using (public.is_active_admin(auth.uid()));

create policy "active admins can read contact enquiries"
  on public.contact_enquiries for select
  to authenticated
  using (public.is_active_admin(auth.uid()));

create or replace view public.admin_rental_listings
with (security_barrier = true)
as
select
  rental.id,
  rental.slug,
  rental.title,
  rental.address_line,
  rental.neighbourhood,
  rental.city,
  rental.monthly_rent_cents,
  rental.bedrooms,
  rental.bathrooms,
  rental.square_feet,
  rental.available_on,
  rental.pet_policy,
  rental.description,
  rental.status,
  rental.sort_order,
  rental.created_at,
  rental.updated_at,
  rental.published_at,
  media.public_url as cover_image_url
from public.rental_listings rental
left join public.rental_listing_images image
  on image.rental_listing_id = rental.id and image.is_cover
left join public.media_assets media
  on media.id = image.media_asset_id;

drop view if exists public.public_rental_listings;
create view public.public_rental_listings
with (security_barrier = true)
as
select
  rental.id,
  rental.slug,
  rental.title,
  rental.address_line,
  rental.neighbourhood,
  rental.city,
  rental.monthly_rent_cents,
  rental.bedrooms,
  rental.bathrooms,
  rental.square_feet,
  rental.available_on,
  rental.pet_policy,
  rental.description,
  rental.status,
  rental.sort_order,
  rental.created_at,
  rental.updated_at,
  rental.published_at,
  media.public_url as cover_image_url
from public.rental_listings rental
join public.rental_listing_images image
  on image.rental_listing_id = rental.id and image.is_cover
join public.media_assets media
  on media.id = image.media_asset_id
where rental.status = 'published'
  and media.state = 'published'
  and media.public_url is not null;

revoke all on public.admin_rental_listings from anon, authenticated;
grant select on public.public_rental_listings to anon, authenticated;

create or replace function public.save_section_draft(
  p_key text,
  p_content jsonb,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section public.site_sections;
begin
  update public.site_sections
  set draft_content = p_content,
      updated_by = p_actor_id,
      updated_at = now()
  where key = p_key
    and updated_at = p_expected_updated_at
  returning * into v_section;

  if not found then
    raise exception using errcode = 'TT409', message = 'stale section';
  end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'section.draft_saved', 'site_section', p_key);
  return to_jsonb(v_section);
end;
$$;

create or replace function public.publish_site_section(
  p_key text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section public.site_sections;
  v_revision_id uuid;
begin
  select * into v_section
  from public.site_sections
  where key = p_key and updated_at = p_expected_updated_at
  for update;

  if not found then
    raise exception using errcode = 'TT409', message = 'stale section';
  end if;

  insert into public.site_section_revisions(section_key, schema_version, content, created_by)
  values (v_section.key, v_section.schema_version, v_section.draft_content, p_actor_id)
  returning id into v_revision_id;

  update public.site_sections
  set published_content = draft_content,
      published_revision_id = v_revision_id,
      published_at = now(),
      updated_at = now(),
      updated_by = p_actor_id
  where key = p_key
  returning * into v_section;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'section.published',
    'site_section',
    p_key,
    jsonb_build_object('revisionId', v_revision_id)
  );

  return to_jsonb(v_section);
end;
$$;

create or replace function public.rollback_site_section(
  p_key text,
  p_revision_id uuid,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section public.site_sections;
  v_content jsonb;
  v_schema_version integer;
  v_new_revision uuid;
begin
  select content, schema_version
    into v_content, v_schema_version
  from public.site_section_revisions
  where id = p_revision_id and section_key = p_key;

  if not found then
    raise exception using errcode = 'P0002', message = 'revision not found';
  end if;

  select * into v_section
  from public.site_sections
  where key = p_key and updated_at = p_expected_updated_at
  for update;

  if not found then
    raise exception using errcode = 'TT409', message = 'stale section';
  end if;

  insert into public.site_section_revisions(section_key, schema_version, content, created_by)
  values (p_key, v_schema_version, v_content, p_actor_id)
  returning id into v_new_revision;

  update public.site_sections
  set draft_content = v_content,
      published_content = v_content,
      schema_version = v_schema_version,
      published_revision_id = v_new_revision,
      published_at = now(),
      updated_at = now(),
      updated_by = p_actor_id
  where key = p_key
  returning * into v_section;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'section.rolled_back',
    'site_section',
    p_key,
    jsonb_build_object('sourceRevisionId', p_revision_id, 'revisionId', v_new_revision)
  );
  return to_jsonb(v_section);
end;
$$;

create or replace function public.set_rental_status(
  p_id uuid,
  p_action text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rental public.rental_listings;
  v_cover_count integer;
  v_next_status text;
begin
  if p_action not in ('publish', 'unpublish', 'archive') then
    raise exception using errcode = '22023', message = 'invalid rental action';
  end if;

  select * into v_rental
  from public.rental_listings
  where id = p_id and updated_at = p_expected_updated_at
  for update;
  if not found then
    raise exception using errcode = 'TT409', message = 'stale rental';
  end if;

  if p_action = 'publish' then
    select count(*) into v_cover_count
    from public.rental_listing_images image
    join public.media_assets media on media.id = image.media_asset_id
    where image.rental_listing_id = p_id
      and image.is_cover
      and media.state in ('draft', 'published');
    if v_cover_count <> 1 then
      raise exception using errcode = '23514', message = 'rental requires exactly one cover image';
    end if;
  end if;

  v_next_status := case
    when p_action = 'publish' then 'published'
    when p_action = 'archive' then 'archived'
    else 'draft'
  end;

  insert into public.rental_listing_revisions(
    rental_listing_id, content_snapshot, action, created_by
  )
  values (p_id, to_jsonb(v_rental), p_action, p_actor_id);

  update public.rental_listings
  set status = v_next_status,
      published_at = case when p_action = 'publish' then now() else published_at end,
      updated_at = now(),
      updated_by = p_actor_id
  where id = p_id
  returning * into v_rental;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'rental.' || p_action, 'rental_listing', p_id::text);

  return to_jsonb(v_rental) || jsonb_build_object('cover_image_url', (
    select media.public_url
    from public.rental_listing_images image
    join public.media_assets media on media.id = image.media_asset_id
    where image.rental_listing_id = p_id and image.is_cover
    limit 1
  ));
end;
$$;

create or replace function public.archive_tenant(
  p_id uuid,
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
begin
  update public.tenants
  set is_active = false,
      archived_at = now(),
      updated_at = now(),
      updated_by = p_actor_id
  where id = p_id and updated_at = p_expected_updated_at
  returning * into v_tenant;
  if not found then
    raise exception using errcode = 'TT409', message = 'stale tenant';
  end if;

  update public.reminder_schedules
  set is_enabled = false, next_run_at = null, updated_at = now(), updated_by = p_actor_id
  where tenant_id = p_id;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'tenant.archived', 'tenant', p_id::text);
  return to_jsonb(v_tenant);
end;
$$;

create or replace function public.save_reminder_schedule(
  p_tenant_id uuid,
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
  v_schedule public.reminder_schedules;
  v_existing public.reminder_schedules;
  v_tenant public.tenants;
begin
  select * into v_tenant from public.tenants where id = p_tenant_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;

  if coalesce((p_payload->>'isEnabled')::boolean, false) and (not v_tenant.is_active or v_tenant.archived_at is not null) then
    raise exception using errcode = '23514', message = 'inactive tenant cannot have an enabled schedule';
  end if;

  if coalesce((p_payload->>'isEnabled')::boolean, false)
    and (p_payload->'channels') ? 'email'
    and (v_tenant.email is null or v_tenant.email_contact_status <> 'allowed') then
    raise exception using errcode = '23514', message = 'email channel is not eligible';
  end if;

  if coalesce((p_payload->>'isEnabled')::boolean, false)
    and (p_payload->'channels') ? 'sms'
    and (v_tenant.phone_e164 is null or v_tenant.sms_contact_status <> 'allowed') then
    raise exception using errcode = '23514', message = 'sms channel is not eligible';
  end if;

  select * into v_existing
  from public.reminder_schedules
  where tenant_id = p_tenant_id
  for update;

  if found then
    if v_existing.updated_at <> p_expected_updated_at then
      raise exception using errcode = 'TT409', message = 'stale schedule';
    end if;
    update public.reminder_schedules
    set rent_due_day = (p_payload->>'rentDueDay')::smallint,
        day_of_month = (p_payload->>'dayOfMonth')::smallint,
        local_time = (p_payload->>'localTime')::time,
        timezone = p_payload->>'timezone',
        channels = array(select jsonb_array_elements_text(p_payload->'channels')),
        email_template_id = nullif(p_payload->>'emailTemplateId', '')::uuid,
        sms_template_id = nullif(p_payload->>'smsTemplateId', '')::uuid,
        is_enabled = (p_payload->>'isEnabled')::boolean,
        next_run_at = nullif(p_payload->>'nextRunAt', '')::timestamptz,
        updated_by = p_actor_id,
        updated_at = now()
    where id = v_existing.id
    returning * into v_schedule;
  else
    if p_expected_updated_at is not null then
      raise exception using errcode = 'TT409', message = 'schedule does not exist';
    end if;
    insert into public.reminder_schedules(
      tenant_id, rent_due_day, day_of_month, local_time, timezone, channels,
      email_template_id, sms_template_id, is_enabled, next_run_at, created_by, updated_by
    )
    values (
      p_tenant_id,
      (p_payload->>'rentDueDay')::smallint,
      (p_payload->>'dayOfMonth')::smallint,
      (p_payload->>'localTime')::time,
      p_payload->>'timezone',
      array(select jsonb_array_elements_text(p_payload->'channels')),
      nullif(p_payload->>'emailTemplateId', '')::uuid,
      nullif(p_payload->>'smsTemplateId', '')::uuid,
      (p_payload->>'isEnabled')::boolean,
      nullif(p_payload->>'nextRunAt', '')::timestamptz,
      p_actor_id,
      p_actor_id
    )
    returning * into v_schedule;
  end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'schedule.saved', 'reminder_schedule', v_schedule.id::text);
  return to_jsonb(v_schedule);
end;
$$;

create or replace function public.save_notification_template(
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
  v_template public.notification_templates;
  v_revision_id uuid;
begin
  if p_id is null then
    insert into public.notification_templates(
      name, channel, subject_template, body_template, is_active, created_by, updated_by
    )
    values (
      p_payload->>'name',
      p_payload->>'channel',
      nullif(p_payload->>'subjectTemplate', ''),
      p_payload->>'bodyTemplate',
      (p_payload->>'isActive')::boolean,
      p_actor_id,
      p_actor_id
    )
    returning * into v_template;
  else
    update public.notification_templates
    set name = p_payload->>'name',
        channel = p_payload->>'channel',
        subject_template = nullif(p_payload->>'subjectTemplate', ''),
        body_template = p_payload->>'bodyTemplate',
        is_active = (p_payload->>'isActive')::boolean,
        updated_by = p_actor_id,
        updated_at = now()
    where id = p_id and updated_at = p_expected_updated_at
    returning * into v_template;
    if not found then
      raise exception using errcode = 'TT409', message = 'stale template';
    end if;
  end if;

  insert into public.notification_template_revisions(
    template_id, channel, subject_template, body_template, created_by
  )
  values (
    v_template.id,
    v_template.channel,
    v_template.subject_template,
    v_template.body_template,
    p_actor_id
  )
  returning id into v_revision_id;

  update public.notification_templates
  set current_revision_id = v_revision_id
  where id = v_template.id
  returning * into v_template;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'template.saved',
    'notification_template',
    v_template.id::text,
    jsonb_build_object('revisionId', v_revision_id)
  );
  return to_jsonb(v_template);
end;
$$;

create or replace function public.set_reminder_pause(
  p_paused boolean,
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
  set value = jsonb_build_object(
        'paused', p_paused,
        'pausedAt', case when p_paused then now() else null end,
        'pausedBy', p_actor_id
      ),
      updated_by = p_actor_id,
      updated_at = now()
  where key = 'reminders' and updated_at = p_expected_updated_at
  returning updated_at into v_updated_at;
  if not found then
    raise exception using errcode = 'TT409', message = 'stale settings';
  end if;
  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'reminders.pause_changed', 'system_setting', 'reminders', jsonb_build_object('paused', p_paused));
  return jsonb_build_object('paused', p_paused, 'updated_at', v_updated_at);
end;
$$;

create or replace function public.admin_dashboard_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active_tenants', (select count(*) from public.tenants where is_active and archived_at is null),
    'enabled_schedules', (select count(*) from public.reminder_schedules where is_enabled),
    'due_next_seven_days', (
      select count(*) from public.reminder_schedules
      where is_enabled and next_run_at between now() and now() + interval '7 days'
    ),
    'failed_last_thirty_days', (
      select count(*) from public.notification_events
      where status in ('failed', 'undelivered') and created_at >= now() - interval '30 days'
    ),
    'outbox_backlog', (
      select count(*) from public.notification_events
      where status = 'scheduled' and coalesce(next_attempt_at, now()) <= now()
    ),
    'reminders_paused', (
      select coalesce((value->>'paused')::boolean, true)
      from public.system_settings where key = 'reminders'
    ),
    'last_worker_run_at', (
      select max(started_at) from public.reminder_worker_runs
    )
  );
$$;

create or replace function public.apply_provider_status(
  p_provider text,
  p_provider_message_id text,
  p_next_status text,
  p_provider_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_events;
begin
  select * into v_event
  from public.notification_events
  where provider = p_provider and provider_message_id = p_provider_message_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'event not found';
  end if;

  if v_event.status in ('delivered', 'undelivered', 'failed', 'skipped', 'unknown', 'expired', 'cancelled') then
    return to_jsonb(v_event);
  end if;

  if p_next_status not in ('queued', 'sent', 'delivered', 'undelivered', 'failed') then
    raise exception using errcode = '22023', message = 'invalid provider status transition';
  end if;

  update public.notification_events
  set status = p_next_status,
      provider_status = p_provider_status,
      sent_at = case when p_next_status in ('sent', 'delivered', 'undelivered') then coalesce(sent_at, now()) else sent_at end,
      delivered_at = case when p_next_status = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
      updated_at = now()
  where id = v_event.id
  returning * into v_event;
  return to_jsonb(v_event);
end;
$$;

create or replace function public.retry_notification_event(
  p_event_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_original public.notification_events;
  v_retry public.notification_events;
begin
  select * into v_original
  from public.notification_events
  where id = p_event_id and status in ('failed', 'undelivered', 'unknown')
  for update;
  if not found then
    raise exception using errcode = '23514', message = 'event is not retryable';
  end if;

  insert into public.notification_events(
    tenant_id, schedule_id, template_id, template_revision_id, retry_of_event_id,
    source, channel, occurrence_key, occurrence_local_date, scheduled_for, due_date,
    status, rendered_subject, rendered_body, render_context, destination,
    destination_masked, provider, next_attempt_at, created_by
  )
  values (
    v_original.tenant_id,
    v_original.schedule_id,
    v_original.template_id,
    v_original.template_revision_id,
    v_original.id,
    'retry',
    v_original.channel,
    'retry:' || v_original.id || ':' || (v_original.attempt_count + 1),
    v_original.occurrence_local_date,
    now(),
    v_original.due_date,
    'scheduled',
    v_original.rendered_subject,
    v_original.rendered_body,
    v_original.render_context,
    v_original.destination,
    v_original.destination_masked,
    v_original.provider,
    now(),
    p_actor_id
  )
  returning * into v_retry;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'notification.retry_created',
    'notification_event',
    v_retry.id::text,
    jsonb_build_object('originalEventId', v_original.id)
  );
  return to_jsonb(v_retry);
end;
$$;

create or replace function public.consume_contact_rate_limit(
  p_key_hash text,
  p_limit integer default 5,
  p_window interval default interval '15 minutes'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean;
begin
  insert into public.contact_rate_limits(key_hash, window_started_at, request_count)
  values (p_key_hash, now(), 1)
  on conflict (key_hash) do update
  set window_started_at = case
        when public.contact_rate_limits.window_started_at <= now() - p_window then now()
        else public.contact_rate_limits.window_started_at
      end,
      request_count = case
        when public.contact_rate_limits.window_started_at <= now() - p_window then 1
        else public.contact_rate_limits.request_count + 1
      end,
      updated_at = now()
  returning request_count <= p_limit into v_allowed;
  return v_allowed;
end;
$$;

create or replace function public.record_provider_webhook_once(
  p_provider text,
  p_provider_event_id text,
  p_safe_event_type text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.provider_webhook_events(provider, provider_event_id, safe_event_type)
  values (p_provider, p_provider_event_id, p_safe_event_type)
  on conflict do nothing;
  return found;
end;
$$;

-- Private RPCs are callable only with the service role. Public views remain the
-- sole anonymous database surface.
revoke all on function public.save_section_draft(text, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.publish_site_section(text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.rollback_site_section(text, uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.set_rental_status(uuid, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.archive_tenant(uuid, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.save_reminder_schedule(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.save_notification_template(uuid, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.set_reminder_pause(boolean, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.admin_dashboard_summary() from public, anon, authenticated;
revoke all on function public.apply_provider_status(text, text, text, text) from public, anon, authenticated;
revoke all on function public.retry_notification_event(uuid, uuid) from public, anon, authenticated;
revoke all on function public.consume_contact_rate_limit(text, integer, interval) from public, anon, authenticated;
revoke all on function public.record_provider_webhook_once(text, text, text) from public, anon, authenticated;

grant execute on function public.save_section_draft(text, jsonb, timestamptz, uuid) to service_role;
grant execute on function public.publish_site_section(text, timestamptz, uuid) to service_role;
grant execute on function public.rollback_site_section(text, uuid, timestamptz, uuid) to service_role;
grant execute on function public.set_rental_status(uuid, text, timestamptz, uuid) to service_role;
grant execute on function public.archive_tenant(uuid, timestamptz, uuid) to service_role;
grant execute on function public.save_reminder_schedule(uuid, jsonb, timestamptz, uuid) to service_role;
grant execute on function public.save_notification_template(uuid, jsonb, timestamptz, uuid) to service_role;
grant execute on function public.set_reminder_pause(boolean, timestamptz, uuid) to service_role;
grant execute on function public.admin_dashboard_summary() to service_role;
grant execute on function public.apply_provider_status(text, text, text, text) to service_role;
grant execute on function public.retry_notification_event(uuid, uuid) to service_role;
grant execute on function public.consume_contact_rate_limit(text, integer, interval) to service_role;
grant execute on function public.record_provider_webhook_once(text, text, text) to service_role;
