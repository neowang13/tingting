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
  if not found then raise exception using errcode = 'P0002', message = 'event not found'; end if;

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

  if p_provider = 'resend' and p_provider_status ilike '%complain%' then
    update public.tenants
    set email_contact_status = 'complained',
        email_contact_status_reason = 'Permanent complaint feedback from email provider',
        email_contact_status_source = 'resend_webhook',
        contact_permission_updated_at = now(),
        updated_at = now()
    where id = v_event.tenant_id;
  elsif p_provider = 'resend' and p_provider_status ilike '%bounce%' then
    update public.tenants
    set email_contact_status = 'bounced',
        email_contact_status_reason = 'Permanent bounce feedback from email provider',
        email_contact_status_source = 'resend_webhook',
        contact_permission_updated_at = now(),
        updated_at = now()
    where id = v_event.tenant_id;
  elsif p_provider = 'twilio' and (
    p_provider_status like '%:21610' or p_provider_status like '%:21611'
  ) then
    update public.tenants
    set sms_contact_status = 'opted_out',
        sms_contact_status_reason = 'Opt-out feedback from SMS provider',
        sms_contact_status_source = 'twilio_webhook',
        contact_permission_updated_at = now(),
        updated_at = now()
    where id = v_event.tenant_id;
  elsif p_provider = 'twilio' and (
    p_provider_status like '%:21211' or p_provider_status like '%:21614'
  ) then
    update public.tenants
    set sms_contact_status = 'invalid',
        sms_contact_status_reason = 'Invalid destination feedback from SMS provider',
        sms_contact_status_source = 'twilio_webhook',
        contact_permission_updated_at = now(),
        updated_at = now()
    where id = v_event.tenant_id;
  end if;
  return to_jsonb(v_event);
end;
$$;

revoke all on function public.apply_provider_status(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.apply_provider_status(text, text, text, text)
  to service_role;
