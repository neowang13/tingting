-- Persist an automation tenant and its source identity in one transaction.
-- Admin saves omit sourceSystem/externalReference and therefore preserve them.

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
      is_active, source_system, external_reference, created_by, updated_by
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
      nullif(p_payload->>'sourceSystem', ''),
      nullif(p_payload->>'externalReference', ''),
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
      move_in_date = case
        when p_payload ? 'moveInDate' then nullif(p_payload->>'moveInDate', '')::date
        else v_tenant.move_in_date
      end,
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
      source_system = case
        when p_payload ? 'sourceSystem' then nullif(p_payload->>'sourceSystem', '')
        else v_tenant.source_system
      end,
      external_reference = case
        when p_payload ? 'externalReference' then nullif(p_payload->>'externalReference', '')
        else v_tenant.external_reference
      end,
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
      'isActive', v_tenant.is_active,
      'sourceSystem', v_tenant.source_system
    )
  );
  return to_jsonb(v_tenant);
end;
$$;
