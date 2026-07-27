-- Durable notification batches, scheduler materialization, and outbox claims.

create or replace function public.render_notification_template(
  p_template text,
  p_context jsonb
)
returns text
language plpgsql
immutable
strict
as $$
declare
  v_result text := p_template;
  v_key text;
  v_allowed constant text[] := array[
    'tenant_name', 'property', 'unit', 'due_date',
    'business_name', 'business_phone', 'business_email'
  ];
begin
  foreach v_key in array v_allowed loop
    if position('{{' || v_key || '}}' in v_result) > 0 and not (p_context ? v_key) then
      raise exception using errcode = '22023', message = 'missing template variable';
    end if;
    v_result := replace(v_result, '{{' || v_key || '}}', coalesce(p_context->>v_key, ''));
  end loop;
  if v_result ~ '\{\{[^}]+\}\}' then
    raise exception using errcode = '22023', message = 'unknown template variable';
  end if;
  return v_result;
end;
$$;

create or replace function public.next_monthly_occurrence(
  p_day smallint,
  p_local_time time,
  p_timezone text,
  p_after timestamptz
)
returns timestamptz
language plpgsql
stable
strict
as $$
declare
  v_month date := date_trunc('month', p_after at time zone p_timezone)::date;
  v_last_day date;
  v_local timestamp;
  v_candidate timestamptz;
begin
  for v_index in 0..24 loop
    v_last_day := (v_month + interval '1 month - 1 day')::date;
    v_local := (
      v_month
      + (least(p_day::integer, extract(day from v_last_day)::integer) - 1)
    )::date + p_local_time;
    v_candidate := v_local at time zone p_timezone;

    -- PostgreSQL chooses the later offset for an ambiguous local time. The
    -- product contract requires the earlier occurrence during fall-back.
    if (v_candidate - interval '1 hour') at time zone p_timezone = v_local then
      v_candidate := v_candidate - interval '1 hour';
    end if;

    if v_candidate > p_after then
      return v_candidate;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  raise exception using errcode = '22023', message = 'could not calculate next occurrence';
end;
$$;

create or replace function public.reminder_due_date(
  p_occurrence_date date,
  p_due_day smallint
)
returns date
language plpgsql
immutable
strict
as $$
declare
  v_month date := date_trunc('month', p_occurrence_date)::date;
  v_last date;
  v_due date;
begin
  for v_index in 0..1 loop
    v_last := (v_month + interval '1 month - 1 day')::date;
    v_due := (
      v_month + (least(p_due_day::integer, extract(day from v_last)::integer) - 1)
    )::date;
    if v_due >= p_occurrence_date then return v_due; end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  return v_due;
end;
$$;

create or replace function public.preview_notification_batch(p_payload jsonb)
returns jsonb
language sql
security definer
set search_path = public
as $$
with selected as (
  select tenant.*
  from public.tenants tenant
  where (
    p_payload->>'selectionMode' = 'all_active'
    and tenant.is_active
    and tenant.archived_at is null
  ) or (
    p_payload->>'selectionMode' = 'tenant_ids'
    and tenant.id in (
      select value::uuid from jsonb_array_elements_text(p_payload->'tenantIds')
    )
  )
),
requested_channels as (
  select value as channel
  from jsonb_array_elements_text(p_payload->'channels')
),
recipient_rows as (
  select
    tenant.id as tenant_id,
    tenant.full_name as tenant_name,
    requested.channel,
    case when requested.channel = 'email' then tenant.email else tenant.phone_e164 end as destination,
    case
      when not tenant.is_active or tenant.archived_at is not null then 'Tenant is inactive'
      when not (requested.channel = any(tenant.preferred_channels)) then 'Channel is not preferred'
      when requested.channel = 'email' and tenant.email is null then 'Email address is missing'
      when requested.channel = 'sms' and tenant.phone_e164 is null then 'Phone number is missing'
      when requested.channel = 'email' and tenant.email_contact_status <> 'allowed' then 'Email is not permitted'
      when requested.channel = 'sms' and tenant.sms_contact_status <> 'allowed' then 'SMS is not permitted'
      else null
    end as skip_reason
  from selected tenant
  cross join requested_channels requested
)
select jsonb_build_object(
  'requestId', p_payload->>'requestId',
  'selectedCount', (select count(*) from selected),
  'eligibleCount', count(*) filter (where skip_reason is null),
  'eligibleByChannel', jsonb_build_object(
    'email', count(*) filter (where skip_reason is null and channel = 'email'),
    'sms', count(*) filter (where skip_reason is null and channel = 'sms')
  ),
  'skippedCount', count(*) filter (where skip_reason is not null),
  'rows', coalesce(jsonb_agg(jsonb_build_object(
    'tenantId', tenant_id,
    'tenantName', tenant_name,
    'channel', channel,
    'eligible', skip_reason is null,
    'reason', skip_reason,
    'destinationMasked', case
      when channel = 'email' then public.mask_email(destination)
      else public.mask_phone(destination)
    end
  ) order by tenant_name, channel), '[]'::jsonb),
  'smsSegmentEstimate', count(*) filter (where skip_reason is null and channel = 'sms')
)
from recipient_rows;
$$;

create or replace function public.create_notification_batch(
  p_payload jsonb,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.notification_batches;
  v_email_revision uuid;
  v_sms_revision uuid;
  v_selected_count integer;
  v_eligible_count integer;
  v_digest text;
begin
  select * into v_batch
  from public.notification_batches
  where request_id = (p_payload->>'requestId')::uuid;
  if found then return to_jsonb(v_batch); end if;

  if (p_payload->'channels') ? 'email' then
    select current_revision_id into v_email_revision
    from public.notification_templates
    where id = nullif(p_payload->>'emailTemplateId', '')::uuid
      and channel = 'email' and is_active;
    if v_email_revision is null then
      raise exception using errcode = '23514', message = 'active email template revision is required';
    end if;
  end if;

  if (p_payload->'channels') ? 'sms' then
    select current_revision_id into v_sms_revision
    from public.notification_templates
    where id = nullif(p_payload->>'smsTemplateId', '')::uuid
      and channel = 'sms' and is_active;
    if v_sms_revision is null then
      raise exception using errcode = '23514', message = 'active SMS template revision is required';
    end if;
  end if;

  with selected as (
    select tenant.*
    from public.tenants tenant
    where (
      p_payload->>'selectionMode' = 'all_active'
      and tenant.is_active and tenant.archived_at is null
    ) or (
      p_payload->>'selectionMode' = 'tenant_ids'
      and tenant.id in (
        select value::uuid from jsonb_array_elements_text(p_payload->'tenantIds')
      )
    )
  ),
  rows as (
    select tenant.id, requested.channel
    from selected tenant
    cross join lateral jsonb_array_elements_text(p_payload->'channels') requested(channel)
  )
  select
    (select count(*) from selected),
    encode(extensions.digest(
      coalesce(string_agg(id::text || ':' || channel, ',' order by id, channel), ''),
      'sha256'
    ), 'hex')
  into v_selected_count, v_digest
  from rows;

  insert into public.notification_batches(
    request_id, selection_digest, created_by, template_email_revision_id,
    template_sms_revision_id, requested_channels, selected_count, eligible_count,
    status, expires_at
  )
  values (
    (p_payload->>'requestId')::uuid,
    v_digest,
    p_actor_id,
    v_email_revision,
    v_sms_revision,
    array(select jsonb_array_elements_text(p_payload->'channels')),
    v_selected_count,
    0,
    'draft',
    now() + interval '30 minutes'
  )
  returning * into v_batch;

  with selected as (
    select tenant.*
    from public.tenants tenant
    where (
      p_payload->>'selectionMode' = 'all_active'
      and tenant.is_active and tenant.archived_at is null
    ) or (
      p_payload->>'selectionMode' = 'tenant_ids'
      and tenant.id in (
        select value::uuid from jsonb_array_elements_text(p_payload->'tenantIds')
      )
    )
  ),
  rows as (
    select
      tenant.*,
      requested.channel,
      case when requested.channel = 'email' then tenant.email else tenant.phone_e164 end as destination,
      case
        when not tenant.is_active or tenant.archived_at is not null then 'tenant_inactive'
        when not (requested.channel = any(tenant.preferred_channels)) then 'channel_not_preferred'
        when requested.channel = 'email' and tenant.email is null then 'email_missing'
        when requested.channel = 'sms' and tenant.phone_e164 is null then 'phone_missing'
        when requested.channel = 'email' and tenant.email_contact_status <> 'allowed' then 'email_not_allowed'
        when requested.channel = 'sms' and tenant.sms_contact_status <> 'allowed' then 'sms_not_allowed'
        else null
      end as skip_reason
    from selected tenant
    cross join lateral jsonb_array_elements_text(p_payload->'channels') requested(channel)
  )
  insert into public.notification_batch_recipients(
    batch_id, tenant_id, channel, eligibility_status, skip_reason,
    destination_snapshot, destination_masked, template_revision_id,
    tenant_version_snapshot, contact_permission_updated_at_snapshot
  )
  select
    v_batch.id,
    id,
    channel,
    case when skip_reason is null then 'eligible' else 'skipped' end,
    skip_reason,
    destination,
    case when channel = 'email' then public.mask_email(destination) else public.mask_phone(destination) end,
    case when channel = 'email' then v_email_revision else v_sms_revision end,
    updated_at,
    contact_permission_updated_at
  from rows;

  select count(*) into v_eligible_count
  from public.notification_batch_recipients
  where batch_id = v_batch.id and eligibility_status = 'eligible';

  update public.notification_batches
  set eligible_count = v_eligible_count
  where id = v_batch.id
  returning * into v_batch;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'notification.batch_created',
    'notification_batch',
    v_batch.id::text,
    jsonb_build_object('selectedCount', v_selected_count, 'eligibleCount', v_eligible_count)
  );
  return to_jsonb(v_batch);
end;
$$;

create or replace function public.confirm_notification_batch(
  p_batch_id uuid,
  p_confirmation_key text,
  p_acknowledged_count integer,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.notification_batches;
  v_changed integer;
begin
  select * into v_batch
  from public.notification_batches
  where id = p_batch_id
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'batch not found'; end if;

  if v_batch.confirmation_idempotency_key = p_confirmation_key then
    return to_jsonb(v_batch);
  end if;
  if v_batch.status <> 'draft' then
    raise exception using errcode = '23505', message = 'batch already confirmed';
  end if;
  if v_batch.expires_at <= now() then
    update public.notification_batches set status = 'expired' where id = p_batch_id;
    raise exception using errcode = 'TT409', message = 'batch expired';
  end if;
  if v_batch.eligible_count <> p_acknowledged_count then
    raise exception using errcode = 'TT409', message = 'recipient count changed';
  end if;

  select count(*) into v_changed
  from public.notification_batch_recipients recipient
  join public.tenants tenant on tenant.id = recipient.tenant_id
  where recipient.batch_id = p_batch_id
    and recipient.eligibility_status = 'eligible'
    and (
      tenant.updated_at <> recipient.tenant_version_snapshot
      or tenant.contact_permission_updated_at is distinct from recipient.contact_permission_updated_at_snapshot
      or (recipient.channel = 'email' and (
        tenant.email is distinct from recipient.destination_snapshot
        or tenant.email_contact_status <> 'allowed'
      ))
      or (recipient.channel = 'sms' and (
        tenant.phone_e164 is distinct from recipient.destination_snapshot
        or tenant.sms_contact_status <> 'allowed'
      ))
      or not tenant.is_active
      or tenant.archived_at is not null
      or not (recipient.channel = any(tenant.preferred_channels))
    );
  if v_changed > 0 then
    raise exception using errcode = 'TT409', message = 'frozen recipient eligibility changed';
  end if;

  insert into public.notification_events(
    tenant_id, schedule_id, template_id, template_revision_id, batch_id,
    source, channel, occurrence_key, occurrence_local_date, scheduled_for,
    due_date, status, rendered_subject, rendered_body, render_context,
    destination, destination_masked, provider, next_attempt_at, created_by
  )
  select
    tenant.id,
    schedule.id,
    template.id,
    revision.id,
    v_batch.id,
    'manual',
    recipient.channel,
    'manual:' || v_batch.id || ':' || tenant.id || ':' || recipient.channel,
    (now() at time zone tenant.timezone)::date,
    now(),
    public.reminder_due_date(
      (now() at time zone tenant.timezone)::date,
      coalesce(schedule.rent_due_day, 1)::smallint
    ),
    'scheduled',
    case when recipient.channel = 'email'
      then public.render_notification_template(revision.subject_template, context.value)
      else null
    end,
    public.render_notification_template(revision.body_template, context.value),
    context.value,
    recipient.destination_snapshot,
    recipient.destination_masked,
    case when recipient.channel = 'email' then 'resend' else 'twilio' end,
    now(),
    p_actor_id
  from public.notification_batch_recipients recipient
  join public.tenants tenant on tenant.id = recipient.tenant_id
  left join public.reminder_schedules schedule on schedule.tenant_id = tenant.id
  join public.notification_template_revisions revision on revision.id = recipient.template_revision_id
  join public.notification_templates template on template.id = revision.template_id
  cross join lateral (
    select jsonb_build_object(
      'tenant_name', tenant.full_name,
      'property', tenant.property_label,
      'unit', coalesce(tenant.unit_label, ''),
      'due_date', to_char(public.reminder_due_date(
        (now() at time zone tenant.timezone)::date,
        coalesce(schedule.rent_due_day, 1)::smallint
      ), 'FMMonth FMDD, YYYY'),
      'business_name', 'Ting Ting Xu Real Estate',
      'business_phone', '604-872-6896',
      'business_email', 'info@tingtingxu.ca'
    ) as value
  ) context
  where recipient.batch_id = p_batch_id
    and recipient.eligibility_status = 'eligible'
  on conflict (occurrence_key) do nothing;

  update public.notification_batches
  set status = 'confirmed',
      confirmation_idempotency_key = p_confirmation_key,
      confirmed_at = now()
  where id = p_batch_id
  returning * into v_batch;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'notification.batch_confirmed',
    'notification_batch',
    v_batch.id::text,
    jsonb_build_object('eligibleCount', v_batch.eligible_count)
  );
  return to_jsonb(v_batch);
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
  v_paused boolean;
  v_schedule record;
  v_channel text;
  v_template public.notification_templates;
  v_revision public.notification_template_revisions;
  v_occurrence_date date;
  v_due_date date;
  v_context jsonb;
  v_destination text;
  v_contact_allowed boolean;
  v_status text;
  v_reason text;
  v_created integer := 0;
begin
  insert into public.reminder_worker_runs(started_at, status)
  values (p_now, 'running')
  returning * into v_run;

  select coalesce((value->>'paused')::boolean, true)
  into v_paused
  from public.system_settings
  where key = 'reminders';

  if p_force_paused or v_paused then
    update public.reminder_worker_runs
    set completed_at = now(), status = 'paused'
    where id = v_run.id
    returning * into v_run;
    return to_jsonb(v_run);
  end if;

  for v_schedule in
    select schedule.*, tenant.full_name, tenant.property_label, tenant.unit_label,
      tenant.email, tenant.phone_e164, tenant.preferred_channels,
      tenant.email_contact_status, tenant.sms_contact_status,
      tenant.is_active as tenant_is_active, tenant.archived_at as tenant_archived_at
    from public.reminder_schedules schedule
    join public.tenants tenant on tenant.id = schedule.tenant_id
    where schedule.is_enabled and schedule.next_run_at <= p_now
    order by schedule.next_run_at
    for update of schedule skip locked
    limit 200
  loop
    v_occurrence_date := (v_schedule.next_run_at at time zone v_schedule.timezone)::date;
    v_due_date := public.reminder_due_date(v_occurrence_date, v_schedule.rent_due_day);
    v_context := jsonb_build_object(
      'tenant_name', v_schedule.full_name,
      'property', v_schedule.property_label,
      'unit', coalesce(v_schedule.unit_label, ''),
      'due_date', to_char(v_due_date, 'FMMonth FMDD, YYYY'),
      'business_name', 'Ting Ting Xu Real Estate',
      'business_phone', '604-872-6896',
      'business_email', 'info@tingtingxu.ca'
    );

    foreach v_channel in array v_schedule.channels loop
      if v_channel = 'email' then
        select * into v_template from public.notification_templates where id = v_schedule.email_template_id;
        v_destination := v_schedule.email;
        v_contact_allowed := v_schedule.email_contact_status = 'allowed';
      else
        select * into v_template from public.notification_templates where id = v_schedule.sms_template_id;
        v_destination := v_schedule.phone_e164;
        v_contact_allowed := v_schedule.sms_contact_status = 'allowed';
      end if;
      select * into v_revision
      from public.notification_template_revisions
      where id = v_template.current_revision_id;

      v_status := 'scheduled';
      v_reason := null;
      if p_now - v_schedule.next_run_at > interval '24 hours' then
        v_status := 'expired'; v_reason := 'occurrence_outside_grace_period';
      elsif not v_schedule.tenant_is_active or v_schedule.tenant_archived_at is not null then
        v_status := 'skipped'; v_reason := 'tenant_inactive';
      elsif not (v_channel = any(v_schedule.preferred_channels)) then
        v_status := 'skipped'; v_reason := 'channel_not_preferred';
      elsif not v_contact_allowed or v_destination is null then
        v_status := 'skipped'; v_reason := 'channel_not_allowed';
      elsif v_template.id is null or not v_template.is_active or v_revision.id is null then
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
          v_channel,
          'scheduled:' || v_schedule.id || ':' || v_occurrence_date || ':' || v_channel,
          v_occurrence_date,
          v_schedule.next_run_at,
          v_due_date,
          v_status,
          case when v_status = 'scheduled' and v_channel = 'email'
            then public.render_notification_template(v_revision.subject_template, v_context)
            else null
          end,
          case when v_status = 'scheduled'
            then public.render_notification_template(v_revision.body_template, v_context)
            else null
          end,
          v_context,
          v_reason,
          case when v_status = 'scheduled' then v_destination else null end,
          case
            when v_status <> 'scheduled' then null
            when v_channel = 'email' then public.mask_email(v_destination)
            else public.mask_phone(v_destination)
          end,
          case when v_channel = 'email' then 'resend' else 'twilio' end,
          case when v_status = 'scheduled' then p_now else null end
        )
        on conflict do nothing;
        if found then v_created := v_created + 1; end if;
      end if;
    end loop;

    update public.reminder_schedules
    set last_processed_at = p_now,
        next_run_at = public.next_monthly_occurrence(
          v_schedule.day_of_month,
          v_schedule.local_time,
          v_schedule.timezone,
          greatest(p_now, v_schedule.next_run_at)
        ),
        updated_at = now()
    where id = v_schedule.id;
  end loop;

  update public.reminder_worker_runs
  set occurrences_created = v_created,
      backlog_remaining = (
        select count(*) from public.notification_events
        where status = 'scheduled' and coalesce(next_attempt_at, p_now) <= p_now
      )
  where id = v_run.id
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

create or replace function public.claim_notification_events(
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
  -- Recover claims that expired before a provider request and make ambiguous
  -- post-request claims terminal before selecting new work.
  update public.notification_events
  set status = 'scheduled', claim_token = null, claim_expires_at = null, claimed_at = null, updated_at = now()
  where status = 'processing'
    and claim_expires_at <= p_now
    and provider_request_started_at is null;

  update public.notification_events
  set status = 'unknown', claim_token = null, claim_expires_at = null,
      last_error_code = 'AMBIGUOUS_PROVIDER_OUTCOME', updated_at = now()
  where status = 'processing'
    and claim_expires_at <= p_now
    and provider_request_started_at is not null
    and provider_message_id is null;

  return query
  with candidates as (
    select id
    from public.notification_events
    where status = 'scheduled'
      and coalesce(next_attempt_at, p_now) <= p_now
      and (claim_expires_at is null or claim_expires_at <= p_now)
    order by created_at
    for update skip locked
    limit least(p_limit, 200)
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

create or replace function public.begin_notification_attempt(
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
  v_schedule public.reminder_schedules;
  v_paused boolean;
begin
  select * into v_event
  from public.notification_events
  where id = p_event_id and status = 'scheduled' and claim_token = p_claim_token
  for update;
  if not found then raise exception using errcode = 'TT409', message = 'event claim changed'; end if;

  select coalesce((value->>'paused')::boolean, true) into v_paused
  from public.system_settings where key = 'reminders';
  select * into v_tenant from public.tenants where id = v_event.tenant_id;
  if v_event.schedule_id is not null then
    select * into v_schedule from public.reminder_schedules where id = v_event.schedule_id;
  end if;

  if v_paused and v_event.source = 'scheduled' then
    update public.notification_events
    set status = 'cancelled', last_error_code = 'REMINDERS_PAUSED', updated_at = now()
    where id = v_event.id returning * into v_event;
    return to_jsonb(v_event);
  end if;
  if not v_tenant.is_active or v_tenant.archived_at is not null then
    update public.notification_events
    set status = 'cancelled', last_error_code = 'TENANT_INACTIVE', updated_at = now()
    where id = v_event.id returning * into v_event;
    return to_jsonb(v_event);
  end if;
  if v_event.source = 'scheduled' and (v_schedule.id is null or not v_schedule.is_enabled) then
    update public.notification_events
    set status = 'cancelled', last_error_code = 'SCHEDULE_DISABLED', updated_at = now()
    where id = v_event.id returning * into v_event;
    return to_jsonb(v_event);
  end if;
  if (
    v_event.channel = 'email'
    and (v_tenant.email_contact_status <> 'allowed' or v_tenant.email is distinct from v_event.destination)
  ) or (
    v_event.channel = 'sms'
    and (v_tenant.sms_contact_status <> 'allowed' or v_tenant.phone_e164 is distinct from v_event.destination)
  ) then
    update public.notification_events
    set status = 'cancelled', last_error_code = 'CHANNEL_NO_LONGER_ELIGIBLE', updated_at = now()
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

create or replace function public.mark_provider_request_started(
  p_event_id uuid,
  p_claim_token uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_events
  set provider_request_started_at = now(), updated_at = now()
  where id = p_event_id and status = 'processing' and claim_token = p_claim_token;
  if not found then raise exception using errcode = 'TT409', message = 'event claim changed'; end if;
end;
$$;

create or replace function public.complete_notification_attempt(
  p_event_id uuid,
  p_claim_token uuid,
  p_provider_message_id text,
  p_status text,
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
  update public.notification_events
  set provider_message_id = p_provider_message_id,
      provider_status = p_provider_status,
      status = p_status,
      sent_at = case when p_status = 'sent' then now() else sent_at end,
      claim_token = null,
      claim_expires_at = null,
      next_attempt_at = null,
      updated_at = now()
  where id = p_event_id and status = 'processing' and claim_token = p_claim_token
  returning * into v_event;
  if not found then raise exception using errcode = 'TT409', message = 'event claim changed'; end if;

  update public.notification_attempts
  set completed_at = now(), outcome = p_status, provider_message_id = p_provider_message_id
  where event_id = p_event_id and attempt_number = v_event.attempt_count;
  return to_jsonb(v_event);
end;
$$;

create or replace function public.fail_notification_attempt(
  p_event_id uuid,
  p_claim_token uuid,
  p_error_code text,
  p_retryable boolean,
  p_ambiguous boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.notification_events;
  v_next_status text;
  v_next_attempt timestamptz;
begin
  select * into v_event
  from public.notification_events
  where id = p_event_id and status = 'processing' and claim_token = p_claim_token
  for update;
  if not found then raise exception using errcode = 'TT409', message = 'event claim changed'; end if;

  if p_ambiguous then
    v_next_status := 'unknown';
    v_next_attempt := null;
  elsif p_retryable and v_event.attempt_count < 3 then
    v_next_status := 'scheduled';
    v_next_attempt := now() + (interval '1 minute' * power(2, v_event.attempt_count - 1));
  else
    v_next_status := 'failed';
    v_next_attempt := null;
  end if;

  update public.notification_events
  set status = v_next_status,
      next_attempt_at = v_next_attempt,
      last_error_code = p_error_code,
      claim_token = null,
      claim_expires_at = null,
      updated_at = now()
  where id = p_event_id
  returning * into v_event;

  update public.notification_attempts
  set completed_at = now(), outcome = v_next_status, safe_error_code = p_error_code
  where event_id = p_event_id and attempt_number = v_event.attempt_count;
  return to_jsonb(v_event);
end;
$$;

create or replace function public.finish_reminder_worker_run(
  p_run_id uuid,
  p_dispatched integer,
  p_failed integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.reminder_worker_runs;
begin
  update public.reminder_worker_runs
  set completed_at = now(),
      status = case when p_failed > 0 then 'partial' else 'completed' end,
      events_dispatched = p_dispatched,
      events_failed = p_failed,
      backlog_remaining = (
        select count(*) from public.notification_events
        where status = 'scheduled' and coalesce(next_attempt_at, now()) <= now()
      )
  where id = p_run_id
  returning * into v_run;
  return to_jsonb(v_run);
end;
$$;

revoke all on function public.render_notification_template(text, jsonb) from public, anon, authenticated;
revoke all on function public.next_monthly_occurrence(smallint, time, text, timestamptz) from public, anon, authenticated;
revoke all on function public.reminder_due_date(date, smallint) from public, anon, authenticated;
revoke all on function public.preview_notification_batch(jsonb) from public, anon, authenticated;
revoke all on function public.create_notification_batch(jsonb, uuid) from public, anon, authenticated;
revoke all on function public.confirm_notification_batch(uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.materialize_due_reminders(timestamptz, boolean) from public, anon, authenticated;
revoke all on function public.claim_notification_events(timestamptz, integer, uuid) from public, anon, authenticated;
revoke all on function public.begin_notification_attempt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_provider_request_started(uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_notification_attempt(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.fail_notification_attempt(uuid, uuid, text, boolean, boolean) from public, anon, authenticated;
revoke all on function public.finish_reminder_worker_run(uuid, integer, integer) from public, anon, authenticated;

grant execute on function public.render_notification_template(text, jsonb) to service_role;
grant execute on function public.next_monthly_occurrence(smallint, time, text, timestamptz) to service_role;
grant execute on function public.reminder_due_date(date, smallint) to service_role;
grant execute on function public.preview_notification_batch(jsonb) to service_role;
grant execute on function public.create_notification_batch(jsonb, uuid) to service_role;
grant execute on function public.confirm_notification_batch(uuid, text, integer, uuid) to service_role;
grant execute on function public.materialize_due_reminders(timestamptz, boolean) to service_role;
grant execute on function public.claim_notification_events(timestamptz, integer, uuid) to service_role;
grant execute on function public.begin_notification_attempt(uuid, uuid) to service_role;
grant execute on function public.mark_provider_request_started(uuid, uuid) to service_role;
grant execute on function public.complete_notification_attempt(uuid, uuid, text, text, text) to service_role;
grant execute on function public.fail_notification_attempt(uuid, uuid, text, boolean, boolean) to service_role;
grant execute on function public.finish_reminder_worker_run(uuid, integer, integer) to service_role;
