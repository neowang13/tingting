-- Confirmation execution and atomic tenant import transaction.
-- Rollback note: disable confirmation/import flags. Applied confirmation and
-- audit evidence must remain intact.

create or replace function public.record_automation_permission_event(
  p_tenant_id uuid,
  p_channel text,
  p_previous_status text,
  p_new_status text,
  p_source text,
  p_reason text,
  p_evidence_reference text,
  p_permission_recorded_at timestamptz,
  p_actor_user_id uuid,
  p_actor_service_account_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_new_status = 'allowed' and (
    nullif(trim(p_source), '') is null or
    nullif(trim(p_evidence_reference), '') is null or
    p_permission_recorded_at is null
  ) then
    raise exception 'permission evidence required' using errcode = '22023';
  end if;
  insert into public.tenant_contact_permission_events(
    tenant_id, channel, previous_status, new_status, source, reason,
    evidence_reference, permission_recorded_at, actor_user_id,
    actor_service_account_id
  ) values (
    p_tenant_id, p_channel, p_previous_status, p_new_status, p_source,
    p_reason, p_evidence_reference, p_permission_recorded_at,
    p_actor_user_id, p_actor_service_account_id
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.commit_tenant_import(
  p_import_id uuid,
  p_service_account_id uuid,
  p_actor_user_id uuid,
  p_confirmation_id uuid,
  p_idempotency_key uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_import public.tenant_imports;
  v_job public.automation_jobs;
  v_confirmation public.automation_confirmation_intents;
  v_row public.tenant_import_rows;
  v_tenant public.tenants;
  v_payload jsonb;
  v_tenant_id uuid;
  v_previous_email text;
  v_previous_sms text;
  v_created integer := 0;
  v_updated integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_import from public.tenant_imports
  where id = p_import_id for update;
  if not found or v_import.service_account_id <> p_service_account_id then
    raise exception 'import unavailable' using errcode = 'TT409';
  end if;
  select * into v_job from public.automation_jobs
  where id = v_import.job_id for update;
  select * into v_confirmation from public.automation_confirmation_intents
  where id = p_confirmation_id for update;
  if not found
    or v_confirmation.service_account_id <> p_service_account_id
    or v_confirmation.action <> 'tenant_import.commit'
    or v_confirmation.target_id <> p_import_id::text
    or v_confirmation.consumed_at is not null
    or v_confirmation.expires_at <= now()
    or v_confirmation.target_version is distinct from v_import.preview_version
    or v_confirmation.payload->>'sourceDigest' is distinct from v_import.source_digest
  then
    raise exception 'preview stale' using errcode = 'TT409';
  end if;
  if v_import.invalid_count > 0 or v_import.conflict_count > 0 then
    raise exception 'import has errors' using errcode = 'TT409';
  end if;
  for v_row in
    select * from public.tenant_import_rows
    where import_id = p_import_id
    order by row_number
    for update
  loop
    if v_row.outcome = 'update' then
      select * into v_tenant from public.tenants
      where id = v_row.matched_tenant_id for update;
      if not found or v_tenant.updated_at is distinct from v_row.expected_tenant_version then
        raise exception 'tenant preview stale' using errcode = 'TT409';
      end if;
    end if;
  end loop;

  update public.automation_jobs
  set status = 'committing', updated_at = now()
  where id = v_import.job_id;

  for v_row in
    select * from public.tenant_import_rows
    where import_id = p_import_id and outcome in ('new','update')
    order by row_number
  loop
    v_payload := v_row.normalized_payload;
    if v_row.outcome = 'new' then
      v_previous_email := 'unconfirmed';
      v_previous_sms := 'unconfirmed';
      insert into public.tenants(
        full_name, property_label, unit_label, email, phone_e164,
        preferred_channels, email_contact_status, sms_contact_status,
        email_contact_status_source, sms_contact_status_source,
        contact_permission_updated_at, timezone, internal_notes, is_active,
        source_system, external_reference, created_by, updated_by
      ) values (
        v_payload->>'fullName', v_payload->>'propertyLabel',
        nullif(v_payload->>'unitLabel', ''),
        nullif(v_payload->>'email', ''), nullif(v_payload->>'phoneE164', ''),
        coalesce(array(select jsonb_array_elements_text(v_payload->'preferredChannels')), '{}'),
        v_payload->>'emailContactStatus', v_payload->>'smsContactStatus',
        nullif(v_payload->>'emailPermissionSource', ''),
        nullif(v_payload->>'smsPermissionSource', ''),
        coalesce(
          nullif(v_payload->>'emailPermissionRecordedAt', '')::timestamptz,
          nullif(v_payload->>'smsPermissionRecordedAt', '')::timestamptz
        ),
        v_payload->>'timezone', nullif(v_payload->>'internalNotes', ''),
        coalesce((v_payload->>'isActive')::boolean, true),
        v_import.source_system, nullif(v_payload->>'externalReference', ''),
        p_actor_user_id, p_actor_user_id
      ) returning id into v_tenant_id;
      v_created := v_created + 1;
    else
      v_tenant_id := v_row.matched_tenant_id;
      select email_contact_status, sms_contact_status
      into v_previous_email, v_previous_sms
      from public.tenants
      where id = v_tenant_id
      for update;
      update public.tenants
      set full_name = coalesce(nullif(v_payload->>'fullName', ''), full_name),
          property_label = coalesce(nullif(v_payload->>'propertyLabel', ''), property_label),
          unit_label = coalesce(nullif(v_payload->>'unitLabel', ''), unit_label),
          email = coalesce(nullif(v_payload->>'email', ''), email),
          phone_e164 = coalesce(nullif(v_payload->>'phoneE164', ''), phone_e164),
          preferred_channels = case
            when jsonb_array_length(coalesce(v_payload->'preferredChannels', '[]')) > 0
              then array(select jsonb_array_elements_text(v_payload->'preferredChannels'))
            else preferred_channels
          end,
          timezone = coalesce(nullif(v_payload->>'timezone', ''), timezone),
          internal_notes = coalesce(nullif(v_payload->>'internalNotes', ''), internal_notes),
          external_reference = coalesce(
            nullif(v_payload->>'externalReference', ''), external_reference
          ),
          source_system = coalesce(source_system, v_import.source_system),
          email_contact_status = case
            when v_payload->>'emailContactStatus' <> 'unconfirmed'
              then v_payload->>'emailContactStatus'
            else email_contact_status
          end,
          sms_contact_status = case
            when v_payload->>'smsContactStatus' <> 'unconfirmed'
              then v_payload->>'smsContactStatus'
            else sms_contact_status
          end,
          email_contact_status_source = case
            when v_payload->>'emailContactStatus' <> 'unconfirmed'
              then nullif(v_payload->>'emailPermissionSource', '')
            else email_contact_status_source
          end,
          sms_contact_status_source = case
            when v_payload->>'smsContactStatus' <> 'unconfirmed'
              then nullif(v_payload->>'smsPermissionSource', '')
            else sms_contact_status_source
          end,
          contact_permission_updated_at = case
            when v_payload->>'emailContactStatus' <> 'unconfirmed'
              or v_payload->>'smsContactStatus' <> 'unconfirmed'
            then coalesce(
              nullif(v_payload->>'emailPermissionRecordedAt', '')::timestamptz,
              nullif(v_payload->>'smsPermissionRecordedAt', '')::timestamptz,
              contact_permission_updated_at
            )
            else contact_permission_updated_at
          end,
          is_active = coalesce((v_payload->>'isActive')::boolean, is_active),
          updated_by = p_actor_user_id,
          updated_at = now()
      where id = v_tenant_id;
      v_updated := v_updated + 1;
    end if;

    if v_payload->>'emailContactStatus' <> 'unconfirmed'
      and v_payload->>'emailContactStatus' is distinct from v_previous_email
    then
      perform public.record_automation_permission_event(
        v_tenant_id, 'email', v_previous_email,
        v_payload->>'emailContactStatus',
        nullif(v_payload->>'emailPermissionSource', ''),
        'tenant_import',
        nullif(v_payload->>'emailEvidenceReference', ''),
        nullif(v_payload->>'emailPermissionRecordedAt', '')::timestamptz,
        p_actor_user_id, p_service_account_id
      );
      insert into public.audit_events(
        actor_user_id, actor_service_account_id, action, target_type,
        target_id, metadata
      ) values (
        p_actor_user_id, p_service_account_id,
        'automation.permission.changed', 'tenant', v_tenant_id::text,
        jsonb_build_object(
          'importId', p_import_id, 'rowNumber', v_row.row_number,
          'channel', 'email', 'previousStatus', v_previous_email,
          'newStatus', v_payload->>'emailContactStatus'
        )
      );
    end if;
    if v_payload->>'smsContactStatus' <> 'unconfirmed'
      and v_payload->>'smsContactStatus' is distinct from v_previous_sms
    then
      perform public.record_automation_permission_event(
        v_tenant_id, 'sms', v_previous_sms,
        v_payload->>'smsContactStatus',
        nullif(v_payload->>'smsPermissionSource', ''),
        'tenant_import',
        nullif(v_payload->>'smsEvidenceReference', ''),
        nullif(v_payload->>'smsPermissionRecordedAt', '')::timestamptz,
        p_actor_user_id, p_service_account_id
      );
      insert into public.audit_events(
        actor_user_id, actor_service_account_id, action, target_type,
        target_id, metadata
      ) values (
        p_actor_user_id, p_service_account_id,
        'automation.permission.changed', 'tenant', v_tenant_id::text,
        jsonb_build_object(
          'importId', p_import_id, 'rowNumber', v_row.row_number,
          'channel', 'sms', 'previousStatus', v_previous_sms,
          'newStatus', v_payload->>'smsContactStatus'
        )
      );
    end if;

    if v_payload->'schedule' is not null and v_payload->'schedule' <> 'null'::jsonb then
      insert into public.reminder_schedules(
        tenant_id, rent_due_day, day_of_month, local_time, timezone,
        channels, email_template_id, sms_template_id, is_enabled,
        next_run_at, created_by, updated_by
      ) values (
        v_tenant_id,
        (v_payload->'schedule'->>'rentDueDay')::smallint,
        (v_payload->'schedule'->>'dayOfMonth')::smallint,
        (v_payload->'schedule'->>'localTime')::time,
        v_payload->'schedule'->>'timezone',
        array(select jsonb_array_elements_text(v_payload->'schedule'->'channels')),
        nullif(v_payload->'schedule'->>'emailTemplateId', '')::uuid,
        nullif(v_payload->'schedule'->>'smsTemplateId', '')::uuid,
        false, null, p_actor_user_id, p_actor_user_id
      )
      on conflict (tenant_id) do update
      set rent_due_day = excluded.rent_due_day,
          day_of_month = excluded.day_of_month,
          local_time = excluded.local_time,
          timezone = excluded.timezone,
          channels = excluded.channels,
          email_template_id = excluded.email_template_id,
          sms_template_id = excluded.sms_template_id,
          is_enabled = false,
          next_run_at = null,
          updated_by = excluded.updated_by,
          updated_at = now();
    end if;

    insert into public.audit_events(
      actor_user_id, actor_service_account_id, action, target_type,
      target_id, request_id, metadata
    ) values (
      p_actor_user_id, p_service_account_id,
      case when v_row.outcome = 'new'
        then 'automation.tenant.created'
        else 'automation.tenant.updated' end,
      'tenant', v_tenant_id::text, null,
      jsonb_build_object(
        'importId', p_import_id,
        'rowNumber', v_row.row_number,
        'changedFields', v_row.changed_fields
      )
    );
  end loop;

  update public.tenant_imports
  set committed_at = now(),
      committed_by_service_account_id = p_service_account_id,
      updated_at = now()
  where id = p_import_id;
  update public.automation_jobs
  set status = 'completed', completed_at = now(), updated_at = now()
  where id = v_import.job_id;
  update public.automation_confirmation_intents
  set consumed_at = now(), consumed_by_idempotency_key = p_idempotency_key
  where id = p_confirmation_id;
  insert into public.audit_events(
    actor_user_id, actor_service_account_id, action, target_type,
    target_id, metadata
  ) values (
    p_actor_user_id, p_service_account_id,
    'automation.tenant_import.committed', 'tenant_import', p_import_id::text,
    jsonb_build_object('created', v_created, 'updated', v_updated)
  );
  return jsonb_build_object(
    'importId', p_import_id,
    'jobId', v_import.job_id,
    'status', 'completed',
    'created', v_created,
    'updated', v_updated,
    'unchanged', v_import.unchanged_count,
    'duplicatesSkipped', v_import.duplicate_count
  );
end;
$$;

create or replace function public.execute_automation_confirmation(
  p_confirmation_id uuid,
  p_service_account_id uuid,
  p_idempotency_key uuid,
  p_now timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.automation_confirmation_intents;
  v_account public.automation_service_accounts;
  v_tenant public.tenants;
  v_channel text;
  v_previous text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_account from public.automation_service_accounts
  where id = p_service_account_id and is_active for update;
  if not found then raise exception 'service account inactive' using errcode = '42501'; end if;
  select * into v_intent from public.automation_confirmation_intents
  where id = p_confirmation_id for update;
  if not found
    or v_intent.service_account_id <> p_service_account_id
    or v_intent.consumed_at is not null
    or v_intent.expires_at <= p_now
  then raise exception 'confirmation unavailable' using errcode = 'TT409';
  end if;

  if v_intent.action = 'tenant_import.commit' then
    return public.commit_tenant_import(
      v_intent.target_id::uuid, p_service_account_id,
      v_account.delegated_admin_user_id, p_confirmation_id, p_idempotency_key
    );
  elsif v_intent.action = 'tenant.permission.grant' then
    select * into v_tenant from public.tenants
    where id = v_intent.target_id::uuid for update;
    if not found or v_tenant.updated_at is distinct from v_intent.target_version then
      raise exception 'tenant preview stale' using errcode = 'TT409';
    end if;
    v_channel := v_intent.payload->>'channel';
    v_previous := case when v_channel = 'email'
      then v_tenant.email_contact_status else v_tenant.sms_contact_status end;
    if v_channel = 'email' then
      update public.tenants
      set email_contact_status = 'allowed',
          email_contact_status_source = v_intent.payload->>'source',
          email_contact_status_reason = v_intent.payload->>'reason',
          contact_permission_updated_at =
            (v_intent.payload->>'permissionRecordedAt')::timestamptz,
          updated_by = v_account.delegated_admin_user_id,
          updated_at = now()
      where id = v_tenant.id;
    elsif v_channel = 'sms' then
      update public.tenants
      set sms_contact_status = 'allowed',
          sms_contact_status_source = v_intent.payload->>'source',
          sms_contact_status_reason = v_intent.payload->>'reason',
          contact_permission_updated_at =
            (v_intent.payload->>'permissionRecordedAt')::timestamptz,
          updated_by = v_account.delegated_admin_user_id,
          updated_at = now()
      where id = v_tenant.id;
    else
      raise exception 'invalid channel' using errcode = '22023';
    end if;
    perform public.record_automation_permission_event(
      v_tenant.id, v_channel, v_previous, 'allowed',
      v_intent.payload->>'source', v_intent.payload->>'reason',
      v_intent.payload->>'evidenceReference',
      (v_intent.payload->>'permissionRecordedAt')::timestamptz,
      v_account.delegated_admin_user_id, p_service_account_id
    );
    update public.automation_confirmation_intents
    set consumed_at = now(), consumed_by_idempotency_key = p_idempotency_key
    where id = p_confirmation_id;
    return jsonb_build_object('tenantId', v_tenant.id, 'channel', v_channel, 'status', 'allowed');
  else
    raise exception 'action is executed by a version-checking resource transaction'
      using errcode = '0A000';
  end if;
end;
$$;

create or replace function public.execute_automation_resource_confirmation(
  p_confirmation_id uuid,
  p_service_account_id uuid,
  p_idempotency_key uuid,
  p_now timestamptz,
  p_media jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_intent public.automation_confirmation_intents;
  v_account public.automation_service_accounts;
  v_schedule public.reminder_schedules;
  v_result jsonb;
  v_action text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  select * into v_account from public.automation_service_accounts
  where id = p_service_account_id and is_active for update;
  if not found then
    raise exception 'service account inactive' using errcode = '42501';
  end if;
  select * into v_intent from public.automation_confirmation_intents
  where id = p_confirmation_id for update;
  if not found
    or v_intent.service_account_id <> p_service_account_id
    or v_intent.consumed_at is not null
    or v_intent.expires_at <= p_now
  then
    raise exception 'confirmation unavailable' using errcode = 'TT409';
  end if;

  if v_intent.action in ('rental.publish', 'rental.unpublish', 'rental.archive') then
    v_action := split_part(v_intent.action, '.', 2);
    v_result := public.set_rental_status_with_media(
      v_intent.target_id::uuid,
      v_action,
      v_intent.target_version,
      v_account.delegated_admin_user_id,
      coalesce(p_media, '[]'::jsonb)
    );
  elsif v_intent.action in ('schedule.enable', 'schedule.disable') then
    select * into v_schedule from public.reminder_schedules
    where tenant_id = v_intent.target_id::uuid for update;
    if not found or v_schedule.updated_at is distinct from v_intent.target_version then
      raise exception 'schedule preview stale' using errcode = 'TT409';
    end if;
    v_result := public.save_reminder_schedule(
      v_intent.target_id::uuid,
      jsonb_build_object(
        'rentDueDay', v_schedule.rent_due_day,
        'dayOfMonth', v_schedule.day_of_month,
        'localTime', to_char(v_schedule.local_time, 'HH24:MI'),
        'timezone', v_schedule.timezone,
        'channels', to_jsonb(v_schedule.channels),
        'emailTemplateId', v_schedule.email_template_id,
        'smsTemplateId', v_schedule.sms_template_id,
        'isEnabled', v_intent.action = 'schedule.enable',
        'nextRunAt', case
          when v_intent.action = 'schedule.enable'
            then v_intent.payload->>'nextRunAt'
          else null
        end
      ),
      v_intent.target_version,
      v_account.delegated_admin_user_id
    );
  else
    raise exception 'unsupported resource confirmation action'
      using errcode = '0A000';
  end if;

  update public.automation_confirmation_intents
  set consumed_at = now(), consumed_by_idempotency_key = p_idempotency_key
  where id = p_confirmation_id;
  insert into public.audit_events(
    actor_user_id, actor_service_account_id, action, target_type,
    target_id, metadata
  ) values (
    v_account.delegated_admin_user_id, p_service_account_id,
    'automation.confirmation.executed', v_intent.target_type,
    v_intent.target_id,
    jsonb_build_object(
      'confirmationId', p_confirmation_id,
      'confirmationAction', v_intent.action
    )
  );
  return v_result;
end;
$$;

create or replace function public.consume_automation_confirmation(
  p_confirmation_id uuid,
  p_service_account_id uuid,
  p_idempotency_key uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.automation_confirmation_intents
  set consumed_at = now(), consumed_by_idempotency_key = p_idempotency_key
  where id = p_confirmation_id
    and service_account_id = p_service_account_id
    and consumed_at is null
    and expires_at > now();
  if not found then
    raise exception 'confirmation unavailable' using errcode = 'TT409';
  end if;
end;
$$;

create or replace function public.automation_admin_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'activeServiceAccounts', (
      select count(*) from public.automation_service_accounts
      where is_active and (expires_at is null or expires_at > now())
    ),
    'lastSuccessfulRequest', (
      select max(created_at) from public.audit_events
      where actor_service_account_id is not null
    ),
    'requestsLast24Hours', (
      select count(*) from public.audit_events
      where actor_service_account_id is not null
        and created_at >= now() - interval '24 hours'
    ),
    'failuresLast24Hours', (
      select count(*) from public.automation_idempotency_keys
      where status = 'failed' and created_at >= now() - interval '24 hours'
    ),
    'activeConfirmations', (
      select count(*) from public.automation_confirmation_intents
      where consumed_at is null and expires_at > now()
    ),
    'expiredConfirmations', (
      select count(*) from public.automation_confirmation_intents
      where consumed_at is null and expires_at <= now()
    ),
    'unresolvedImports', (
      select count(*) from public.tenant_imports
      where committed_at is null and (conflict_count > 0 or invalid_count > 0)
    )
  );
$$;

revoke all on function public.record_automation_permission_event(
  uuid, text, text, text, text, text, text, timestamptz, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.commit_tenant_import(
  uuid, uuid, uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.execute_automation_confirmation(
  uuid, uuid, uuid, timestamptz
) from public, anon, authenticated;
revoke all on function public.execute_automation_resource_confirmation(
  uuid, uuid, uuid, timestamptz, jsonb
) from public, anon, authenticated;
revoke all on function public.consume_automation_confirmation(
  uuid, uuid, uuid
) from public, anon, authenticated;
revoke all on function public.automation_admin_summary()
  from public, anon, authenticated;
grant execute on function public.record_automation_permission_event(
  uuid, text, text, text, text, text, text, timestamptz, uuid, uuid
) to service_role;
grant execute on function public.commit_tenant_import(
  uuid, uuid, uuid, uuid, uuid
) to service_role;
grant execute on function public.execute_automation_confirmation(
  uuid, uuid, uuid, timestamptz
) to service_role;
grant execute on function public.execute_automation_resource_confirmation(
  uuid, uuid, uuid, timestamptz, jsonb
) to service_role;
grant execute on function public.consume_automation_confirmation(
  uuid, uuid, uuid
) to service_role;
grant execute on function public.automation_admin_summary() to service_role;
