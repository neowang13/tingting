-- Lease details, durable monthly rent periods, private receipt metadata, and
-- the Agent notification outbox. Existing tenants intentionally keep a null
-- lease_type until an administrator supplies verified lease details.

alter table public.tenants
  add column lease_type text null
    check (lease_type in ('month_to_month', 'fixed_term')),
  add column lease_end_date date null;

alter table public.tenants
  add constraint tenants_lease_details_check check (
    (
      lease_type is null
      and lease_end_date is null
    )
    or (
      lease_type = 'month_to_month'
      and move_in_date is not null
      and lease_end_date is null
    )
    or (
      lease_type = 'fixed_term'
      and move_in_date is not null
      and lease_end_date is not null
      and lease_end_date > move_in_date
    )
  ) not valid;

alter table public.tenants validate constraint tenants_lease_details_check;

create table public.tenant_rent_payment_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  payment_period date not null check (payment_period = date_trunc('month', payment_period)::date),
  storage_key text not null unique check (char_length(storage_key) between 10 and 500),
  original_filename text not null check (char_length(original_filename) between 1 and 180),
  mime_type text not null check (mime_type in (
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
  )),
  byte_size integer not null check (byte_size between 1 and 10485760),
  sha256_digest text not null check (sha256_digest ~ '^sha256:[a-f0-9]{64}$'),
  uploaded_by_type text not null check (uploaded_by_type in ('admin', 'automation')),
  uploaded_by_id uuid not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, payment_period, sha256_digest)
);

create table public.tenant_rent_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  payment_period date not null check (payment_period = date_trunc('month', payment_period)::date),
  due_date date not null,
  status text not null default 'due' check (status in ('due', 'collected')),
  receipt_id uuid null references public.tenant_rent_payment_receipts(id),
  collected_at timestamptz null,
  collected_by_type text null check (collected_by_type in ('admin', 'automation')),
  collected_by_id uuid null,
  note text null check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, payment_period),
  check (
    (
      status = 'due'
      and receipt_id is null
      and collected_at is null
      and collected_by_type is null
      and collected_by_id is null
    )
    or (
      status = 'collected'
      and receipt_id is not null
      and collected_at is not null
      and collected_by_type is not null
      and collected_by_id is not null
    )
  )
);

create index tenant_rent_payments_due_status_idx
  on public.tenant_rent_payments(due_date, status);
create index tenant_rent_payments_collected_idx
  on public.tenant_rent_payments(collected_at desc)
  where collected_at is not null;

alter table public.tenant_rent_payment_receipts enable row level security;
alter table public.tenant_rent_payments enable row level security;
revoke all on public.tenant_rent_payment_receipts from public, anon, authenticated;
revoke all on public.tenant_rent_payments from public, anon, authenticated;
grant all on public.tenant_rent_payment_receipts to service_role;
grant all on public.tenant_rent_payments to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'tenant-rent-payment-receipts',
  'tenant-rent-payment-receipts',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.rent_payment_due_date(
  p_payment_period date,
  p_rent_due_day smallint
)
returns date
language sql
immutable
strict
as $$
  select (
    date_trunc('month', p_payment_period)::date
    + (
      least(
        greatest(p_rent_due_day, 1),
        extract(day from (
          date_trunc('month', p_payment_period)
          + interval '1 month - 1 day'
        ))::integer
      ) - 1
    )
  )::date
$$;

create or replace function public.materialize_tenant_rent_periods(
  p_business_date date
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period date := date_trunc('month', p_business_date)::date;
  v_inserted integer;
begin
  insert into public.tenant_rent_payments(
    tenant_id, payment_period, due_date, status
  )
  select
    tenant.id,
    v_period,
    public.rent_payment_due_date(v_period, tenant.rent_due_day),
    'due'
  from public.tenants tenant
  where tenant.is_active
    and tenant.archived_at is null
    and tenant.lease_type is not null
    and tenant.move_in_date is not null
    and tenant.move_in_date < (v_period + interval '1 month')::date
    and (
      tenant.lease_type = 'month_to_month'
      or date_trunc('month', tenant.lease_end_date)::date >= v_period
    )
  on conflict (tenant_id, payment_period) do nothing;
  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.rent_payment_actor_admin_id(
  p_actor_type text,
  p_actor_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin_id uuid;
begin
  if p_actor_type = 'admin' then
    if not public.is_active_admin(p_actor_id) then
      raise exception using errcode = '42501', message = 'active admin required';
    end if;
    return p_actor_id;
  end if;
  if p_actor_type = 'automation' then
    select delegated_admin_user_id into v_admin_id
    from public.automation_service_accounts
    where id = p_actor_id
      and is_active
      and (expires_at is null or expires_at > now())
      and 'payments:write' = any(scopes);
    if v_admin_id is null then
      raise exception using errcode = '42501', message = 'active payment automation account required';
    end if;
    return v_admin_id;
  end if;
  raise exception using errcode = '22023', message = 'invalid rent payment actor';
end;
$$;

create or replace function public.register_tenant_rent_receipt(
  p_tenant_id uuid,
  p_payment_period date,
  p_storage_key text,
  p_original_filename text,
  p_mime_type text,
  p_byte_size integer,
  p_sha256_digest text,
  p_actor_type text,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_receipt public.tenant_rent_payment_receipts;
  v_admin_id uuid;
begin
  v_admin_id := public.rent_payment_actor_admin_id(p_actor_type, p_actor_id);
  if p_payment_period <> date_trunc('month', p_payment_period)::date then
    raise exception using errcode = '23514', message = 'payment period must be first of month';
  end if;
  if not exists(select 1 from public.tenants where id = p_tenant_id) then
    raise exception using errcode = 'P0002', message = 'tenant not found';
  end if;

  insert into public.tenant_rent_payment_receipts(
    tenant_id, payment_period, storage_key, original_filename, mime_type,
    byte_size, sha256_digest, uploaded_by_type, uploaded_by_id
  ) values (
    p_tenant_id, p_payment_period, p_storage_key, p_original_filename,
    p_mime_type, p_byte_size, p_sha256_digest, p_actor_type, p_actor_id
  )
  on conflict (tenant_id, payment_period, sha256_digest) do update
    set original_filename = excluded.original_filename
  returning * into v_receipt;

  insert into public.audit_events(
    actor_user_id, actor_service_account_id, action, target_type, target_id, metadata
  ) values (
    v_admin_id,
    case when p_actor_type = 'automation' then p_actor_id else null end,
    'rent.receipt.registered',
    'tenant_rent_payment_receipt',
    v_receipt.id::text,
    jsonb_build_object(
      'tenantId', p_tenant_id,
      'paymentPeriod', p_payment_period,
      'sha256Digest', p_sha256_digest
    )
  );
  return to_jsonb(v_receipt);
end;
$$;

create or replace function public.mark_tenant_rent_collected(
  p_tenant_id uuid,
  p_payment_period date,
  p_receipt_id uuid,
  p_actor_type text,
  p_actor_id uuid,
  p_collected_at timestamptz default now(),
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_receipt public.tenant_rent_payment_receipts;
  v_payment public.tenant_rent_payments;
  v_admin_id uuid;
  v_previous_status text;
begin
  v_admin_id := public.rent_payment_actor_admin_id(p_actor_type, p_actor_id);
  select * into v_tenant from public.tenants where id = p_tenant_id;
  if not found then raise exception using errcode = 'P0002', message = 'tenant not found'; end if;
  select * into v_receipt
  from public.tenant_rent_payment_receipts
  where id = p_receipt_id
    and tenant_id = p_tenant_id
    and payment_period = p_payment_period;
  if not found then
    raise exception using errcode = '23514', message = 'receipt does not match tenant and payment period';
  end if;

  select * into v_payment
  from public.tenant_rent_payments
  where tenant_id = p_tenant_id and payment_period = p_payment_period
  for update;
  v_previous_status := coalesce(v_payment.status, 'due');
  if v_payment.status = 'collected' then
    return to_jsonb(v_payment) || jsonb_build_object('alreadyCollected', true);
  end if;

  insert into public.tenant_rent_payments(
    tenant_id, payment_period, due_date, status, receipt_id, collected_at,
    collected_by_type, collected_by_id, note
  ) values (
    p_tenant_id,
    p_payment_period,
    public.rent_payment_due_date(p_payment_period, v_tenant.rent_due_day),
    'collected',
    p_receipt_id,
    coalesce(p_collected_at, now()),
    p_actor_type,
    p_actor_id,
    nullif(p_note, '')
  )
  on conflict (tenant_id, payment_period) do update set
    status = 'collected',
    receipt_id = excluded.receipt_id,
    collected_at = excluded.collected_at,
    collected_by_type = excluded.collected_by_type,
    collected_by_id = excluded.collected_by_id,
    note = excluded.note,
    updated_at = now()
  returning * into v_payment;

  insert into public.audit_events(
    actor_user_id, actor_service_account_id, action, target_type, target_id, metadata
  ) values (
    v_admin_id,
    case when p_actor_type = 'automation' then p_actor_id else null end,
    'rent.payment.collected',
    'tenant_rent_payment',
    v_payment.id::text,
    jsonb_build_object(
      'tenantId', p_tenant_id,
      'paymentPeriod', p_payment_period,
      'receiptId', p_receipt_id,
      'beforeStatus', v_previous_status,
      'afterStatus', 'collected'
    )
  );
  return to_jsonb(v_payment) || jsonb_build_object('alreadyCollected', false);
end;
$$;

create or replace function public.reopen_tenant_rent_payment(
  p_tenant_id uuid,
  p_payment_period date,
  p_expected_updated_at timestamptz,
  p_actor_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.tenant_rent_payments;
  v_receipt_id uuid;
begin
  if not public.is_active_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'active admin required';
  end if;
  select * into v_payment
  from public.tenant_rent_payments
  where tenant_id = p_tenant_id and payment_period = p_payment_period
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'rent payment not found'; end if;
  if v_payment.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'TT409', message = 'rent payment changed';
  end if;
  v_receipt_id := v_payment.receipt_id;
  update public.tenant_rent_payments set
    status = 'due',
    receipt_id = null,
    collected_at = null,
    collected_by_type = null,
    collected_by_id = null,
    note = nullif(p_reason, ''),
    updated_at = now()
  where id = v_payment.id
  returning * into v_payment;
  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'rent.payment.reopened',
    'tenant_rent_payment',
    v_payment.id::text,
    jsonb_build_object(
      'tenantId', p_tenant_id,
      'paymentPeriod', p_payment_period,
      'receiptId', v_receipt_id,
      'beforeStatus', 'collected',
      'afterStatus', 'due',
      'reason', nullif(p_reason, '')
    )
  );
  return to_jsonb(v_payment);
end;
$$;

revoke all on function public.materialize_tenant_rent_periods(date) from public, anon, authenticated;
revoke all on function public.rent_payment_actor_admin_id(text, uuid) from public, anon, authenticated;
revoke all on function public.register_tenant_rent_receipt(
  uuid, date, text, text, text, integer, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.mark_tenant_rent_collected(
  uuid, date, uuid, text, uuid, timestamptz, text
) from public, anon, authenticated;
revoke all on function public.reopen_tenant_rent_payment(
  uuid, date, timestamptz, uuid, text
) from public, anon, authenticated;
grant execute on function public.materialize_tenant_rent_periods(date) to service_role;
grant execute on function public.register_tenant_rent_receipt(
  uuid, date, text, text, text, integer, text, text, uuid
) to service_role;
grant execute on function public.mark_tenant_rent_collected(
  uuid, date, uuid, text, uuid, timestamptz, text
) to service_role;
grant execute on function public.reopen_tenant_rent_payment(
  uuid, date, timestamptz, uuid, text
) to service_role;

alter table public.automation_service_accounts
  drop constraint if exists automation_service_accounts_scopes_check;
alter table public.automation_service_accounts
  drop constraint if exists automation_service_accounts_scopes_check1;
alter table public.automation_service_accounts
  add constraint automation_service_accounts_scopes_check check (
    cardinality(scopes) > 0
    and scopes <@ array[
      'rentals:read','rentals:write','rentals:publish','media:write',
      'tenants:read','tenants:write','tenants:import','permissions:grant',
      'schedules:read','schedules:write','schedules:enable','jobs:read',
      'payments:read','payments:write'
    ]::text[]
  );

create table public.agent_notification_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique check (char_length(event_key) between 1 and 220),
  kind text not null check (kind in ('weekly_report_sent', 'daily_overdue_rent_summary')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'acknowledged')),
  available_at timestamptz not null default now(),
  claimed_at timestamptz null,
  acknowledged_at timestamptz null,
  claimed_by_service_account_id uuid null
    references public.automation_service_accounts(id),
  created_at timestamptz not null default now()
);

create index agent_notification_events_due_idx
  on public.agent_notification_events(available_at, created_at)
  where status in ('pending', 'claimed');

alter table public.agent_notification_events enable row level security;
revoke all on public.agent_notification_events from public, anon, authenticated;
grant all on public.agent_notification_events to service_role;

create or replace function public.claim_agent_notification(
  p_service_account_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.agent_notification_events;
begin
  if not exists(
    select 1 from public.automation_service_accounts
    where id = p_service_account_id
      and is_active
      and (expires_at is null or expires_at > p_now)
      and 'payments:read' = any(scopes)
  ) then
    raise exception using errcode = '42501', message = 'active notification automation account required';
  end if;
  select * into v_event
  from public.agent_notification_events
  where (
      status = 'pending'
      or (status = 'claimed' and claimed_at <= p_now - interval '10 minutes')
    )
    and available_at <= p_now
  order by available_at, created_at
  for update skip locked
  limit 1;
  if not found then return null; end if;
  update public.agent_notification_events set
    status = 'claimed',
    claimed_at = p_now,
    claimed_by_service_account_id = p_service_account_id
  where id = v_event.id
  returning * into v_event;
  return to_jsonb(v_event);
end;
$$;

create or replace function public.ack_agent_notification(
  p_event_id uuid,
  p_service_account_id uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.agent_notification_events;
begin
  update public.agent_notification_events set
    status = 'acknowledged',
    acknowledged_at = p_now
  where id = p_event_id
    and status = 'claimed'
    and claimed_by_service_account_id = p_service_account_id
  returning * into v_event;
  if not found then
    raise exception using errcode = 'P0002', message = 'claimed agent notification not found';
  end if;
  return to_jsonb(v_event);
end;
$$;

revoke all on function public.claim_agent_notification(uuid, timestamptz)
  from public, anon, authenticated;
revoke all on function public.ack_agent_notification(uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_agent_notification(uuid, timestamptz)
  to service_role;
grant execute on function public.ack_agent_notification(uuid, uuid, timestamptz)
  to service_role;

alter table public.owner_notification_deliveries
  drop constraint if exists owner_notification_deliveries_kind_check;
alter table public.owner_notification_deliveries
  add constraint owner_notification_deliveries_kind_check check (
    kind in ('tenant_upload', 'weekly_tenant_summary', 'daily_overdue_rent_summary')
  );

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
      full_name, property_label, unit_label, move_in_date, lease_type,
      lease_end_date, rent_due_day, email, phone_e164, preferred_channels,
      email_contact_status, sms_contact_status, email_contact_status_reason,
      sms_contact_status_reason, email_contact_status_source, sms_contact_status_source,
      contact_permission_note, contact_permission_updated_at, timezone, internal_notes,
      is_active, source_system, external_reference, created_by, updated_by
    ) values (
      p_payload->>'fullName',
      p_payload->>'propertyLabel',
      nullif(p_payload->>'unitLabel', ''),
      coalesce(
        nullif(p_payload->>'leaseStartDate', '')::date,
        nullif(p_payload->>'moveInDate', '')::date
      ),
      nullif(p_payload->>'leaseType', ''),
      nullif(p_payload->>'leaseEndDate', '')::date,
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
        when p_payload ? 'leaseStartDate'
          then nullif(p_payload->>'leaseStartDate', '')::date
        when p_payload ? 'moveInDate'
          then nullif(p_payload->>'moveInDate', '')::date
        else v_tenant.move_in_date
      end,
      lease_type = case
        when p_payload ? 'leaseType' then nullif(p_payload->>'leaseType', '')
        else v_tenant.lease_type
      end,
      lease_end_date = case
        when p_payload ? 'leaseEndDate' then nullif(p_payload->>'leaseEndDate', '')::date
        else v_tenant.lease_end_date
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
      'leaseType', v_tenant.lease_type,
      'leaseEndDate', v_tenant.lease_end_date,
      'emailContactStatus', v_tenant.email_contact_status,
      'isActive', v_tenant.is_active,
      'sourceSystem', v_tenant.source_system
    )
  );
  return to_jsonb(v_tenant);
end;
$$;

drop view public.admin_tenant_list;
create view public.admin_tenant_list
with (security_barrier = true)
as
select
  tenant.*,
  case
    when schedule.id is null then 'missing'
    when schedule.is_enabled then 'enabled'
    else 'disabled'
  end as schedule_status,
  schedule.next_run_at,
  latest.status as last_delivery_status,
  latest.scheduled_for as last_delivery_at,
  current_payment.id as current_rent_payment_id,
  current_payment.payment_period as current_rent_payment_period,
  current_payment.due_date as current_rent_due_date,
  current_payment.status as current_rent_status,
  current_payment.receipt_id as current_rent_receipt_id,
  current_payment.collected_at as current_rent_collected_at,
  current_payment.collected_by_type as current_rent_collected_by_type,
  current_payment.collected_by_id as current_rent_collected_by_id,
  current_payment.note as current_rent_note,
  current_payment.created_at as current_rent_created_at,
  current_payment.updated_at as current_rent_updated_at
from public.tenants tenant
left join public.reminder_schedules schedule on schedule.tenant_id = tenant.id
left join lateral (
  select event.status, event.scheduled_for
  from public.notification_events event
  where event.tenant_id = tenant.id
  order by event.scheduled_for desc
  limit 1
) latest on true
left join public.tenant_rent_payments current_payment
  on current_payment.tenant_id = tenant.id
  and current_payment.payment_period = date_trunc(
    'month',
    now() at time zone 'America/Vancouver'
  )::date;

revoke all on public.admin_tenant_list from public, anon, authenticated;
grant select on public.admin_tenant_list to service_role;

select public.materialize_tenant_rent_periods(
  (now() at time zone 'America/Vancouver')::date
);
