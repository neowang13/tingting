-- OpenClaw automation identity, token, idempotency, confirmation, and attribution.
-- Rollback note: production rollback is forward repair; disable feature flags and
-- revoke tokens. Do not drop these evidence tables after use.

create table public.automation_service_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 3 and 120),
  delegated_admin_user_id uuid not null
    references public.admin_profiles(user_id),
  scopes text[] not null,
  is_active boolean not null default true,
  expires_at timestamptz null,
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(scopes) > 0),
  check (scopes <@ array[
    'rentals:read','rentals:write','rentals:publish','media:write',
    'tenants:read','tenants:write','tenants:import','permissions:grant',
    'schedules:read','schedules:write','schedules:enable','jobs:read'
  ]::text[])
);

create table public.automation_service_account_tokens (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  token_prefix text not null unique,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  is_active boolean not null default true,
  expires_at timestamptz null,
  last_used_at timestamptz null,
  last_used_ip_hash text null,
  rotated_from_token_id uuid null
    references public.automation_service_account_tokens(id),
  revoke_after timestamptz null,
  revoked_at timestamptz null,
  revoked_by uuid null references public.admin_profiles(user_id),
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now()
);

create index automation_tokens_active_prefix_idx
  on public.automation_service_account_tokens(token_prefix)
  where is_active and revoked_at is null;

create table public.automation_idempotency_keys (
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  idempotency_key uuid not null,
  request_hash text not null check (request_hash ~ '^sha256:[a-f0-9]{64}$'),
  method text not null,
  normalized_path text not null,
  status text not null check (status in ('in_progress', 'completed', 'failed')),
  response_status integer null,
  result_resource_type text null,
  result_resource_id text null,
  result_resource_version timestamptz null,
  response_redacted jsonb null,
  failure_code text null,
  locked_until timestamptz null,
  created_at timestamptz not null default now(),
  completed_at timestamptz null,
  expires_at timestamptz not null,
  primary key (service_account_id, idempotency_key)
);

create table public.automation_confirmation_intents (
  id uuid primary key default gen_random_uuid(),
  service_account_id uuid not null
    references public.automation_service_accounts(id),
  action text not null check (action in (
    'rental.publish','rental.unpublish','rental.archive',
    'tenant_import.commit','tenant.permission.grant','tenant.archive',
    'schedule.enable','schedule.disable'
  )),
  target_type text not null,
  target_id text not null,
  target_version timestamptz null,
  request_digest text not null check (request_digest ~ '^sha256:[a-f0-9]{64}$'),
  payload jsonb not null,
  summary jsonb not null,
  required_acknowledgements text[] not null default '{}',
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  consumed_by_idempotency_key uuid null,
  created_at timestamptz not null default now()
);

create index automation_confirmations_active_idx
  on public.automation_confirmation_intents(service_account_id, expires_at)
  where consumed_at is null;

alter table public.rental_listings
  add column source_system text null,
  add column external_reference text null;

create unique index rental_external_reference_idx
  on public.rental_listings(source_system, external_reference)
  where source_system is not null and external_reference is not null;

alter table public.tenants
  add column source_system text null,
  add column external_reference text null;

create unique index tenant_external_reference_idx
  on public.tenants(source_system, external_reference)
  where source_system is not null and external_reference is not null;

alter table public.audit_events
  add column actor_service_account_id uuid null
    references public.automation_service_accounts(id),
  add column request_id uuid null;

create index audit_events_service_actor_idx
  on public.audit_events(actor_service_account_id, created_at desc)
  where actor_service_account_id is not null;

alter table public.automation_service_accounts enable row level security;
alter table public.automation_service_account_tokens enable row level security;
alter table public.automation_idempotency_keys enable row level security;
alter table public.automation_confirmation_intents enable row level security;

revoke all on public.automation_service_accounts from anon, authenticated;
revoke all on public.automation_service_account_tokens from anon, authenticated;
revoke all on public.automation_idempotency_keys from anon, authenticated;
revoke all on public.automation_confirmation_intents from anon, authenticated;
grant all on public.automation_service_accounts to service_role;
grant all on public.automation_service_account_tokens to service_role;
grant all on public.automation_idempotency_keys to service_role;
grant all on public.automation_confirmation_intents to service_role;

create or replace function public.create_automation_service_account(
  p_name text,
  p_delegated_admin_user_id uuid,
  p_scopes text[],
  p_expires_at timestamptz,
  p_token_prefix text,
  p_token_hash text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.automation_service_accounts;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.admin_profiles
    where user_id = p_delegated_admin_user_id and is_active
  ) then
    raise exception 'delegated admin inactive' using errcode = 'TT409';
  end if;
  insert into public.automation_service_accounts(
    name, delegated_admin_user_id, scopes, expires_at, created_by
  ) values (
    p_name, p_delegated_admin_user_id, p_scopes, p_expires_at, p_actor_id
  ) returning * into v_account;
  insert into public.automation_service_account_tokens(
    service_account_id, token_prefix, token_hash, expires_at, created_by
  ) values (
    v_account.id, p_token_prefix, p_token_hash, p_expires_at, p_actor_id
  );
  insert into public.audit_events(
    actor_user_id, action, target_type, target_id, metadata
  ) values (
    p_actor_id, 'admin.automation.service_account.created',
    'automation_service_account', v_account.id::text,
    jsonb_build_object('scopes', p_scopes)
  );
  return to_jsonb(v_account);
end;
$$;

create or replace function public.rotate_automation_service_account_token(
  p_service_account_id uuid,
  p_token_prefix text,
  p_token_hash text,
  p_expires_at timestamptz,
  p_revoke_previous_after_hours integer,
  p_actor_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token_id uuid;
  v_previous_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_revoke_previous_after_hours not in (0, 1, 24) then
    raise exception 'invalid rotation overlap' using errcode = '22023';
  end if;
  select id into v_previous_id
  from public.automation_service_account_tokens
  where service_account_id = p_service_account_id
    and is_active and revoked_at is null
  order by created_at desc
  limit 1
  for update;

  if p_revoke_previous_after_hours = 0 then
    update public.automation_service_account_tokens
    set is_active = false, revoked_at = now(), revoked_by = p_actor_id
    where service_account_id = p_service_account_id
      and is_active and revoked_at is null;
  else
    update public.automation_service_account_tokens
    set revoke_after = now() + make_interval(hours => p_revoke_previous_after_hours)
    where service_account_id = p_service_account_id
      and is_active and revoked_at is null;
  end if;

  insert into public.automation_service_account_tokens(
    service_account_id, token_prefix, token_hash, expires_at,
    rotated_from_token_id, created_by
  ) values (
    p_service_account_id, p_token_prefix, p_token_hash, p_expires_at,
    v_previous_id, p_actor_id
  ) returning id into v_token_id;

  insert into public.audit_events(
    actor_user_id, action, target_type, target_id, metadata
  ) values (
    p_actor_id, 'admin.automation.token.rotated',
    'automation_service_account', p_service_account_id::text,
    jsonb_build_object('newTokenId', v_token_id, 'overlapHours', p_revoke_previous_after_hours)
  );
  return v_token_id;
end;
$$;

create or replace function public.claim_automation_idempotency_key(
  p_service_account_id uuid,
  p_idempotency_key uuid,
  p_request_hash text,
  p_method text,
  p_normalized_path text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.automation_idempotency_keys;
  v_inserted integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  insert into public.automation_idempotency_keys(
    service_account_id, idempotency_key, request_hash, method,
    normalized_path, status, locked_until, expires_at
  ) values (
    p_service_account_id, p_idempotency_key, p_request_hash, upper(p_method),
    p_normalized_path, 'in_progress', now() + interval '5 minutes',
    now() + interval '30 days'
  )
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  select * into v_row
  from public.automation_idempotency_keys
  where service_account_id = p_service_account_id
    and idempotency_key = p_idempotency_key
  for update;
  return jsonb_build_object(
    'claimed', v_inserted > 0,
    'request_hash', v_row.request_hash,
    'status', v_row.status,
    'response_status', v_row.response_status,
    'response_redacted', v_row.response_redacted,
    'failure_code', v_row.failure_code
  );
end;
$$;

create or replace function public.complete_automation_idempotency_key(
  p_service_account_id uuid,
  p_idempotency_key uuid,
  p_response_status integer,
  p_response_redacted jsonb,
  p_resource_type text,
  p_resource_id text,
  p_resource_version timestamptz
) returns void
language sql
security definer
set search_path = public
as $$
  update public.automation_idempotency_keys
  set status = 'completed',
      response_status = p_response_status,
      response_redacted = p_response_redacted,
      result_resource_type = p_resource_type,
      result_resource_id = p_resource_id,
      result_resource_version = p_resource_version,
      completed_at = now(),
      locked_until = null,
      expires_at = now() + interval '30 days'
  where service_account_id = p_service_account_id
    and idempotency_key = p_idempotency_key
    and status = 'in_progress';
$$;

create or replace function public.fail_automation_idempotency_key(
  p_service_account_id uuid,
  p_idempotency_key uuid,
  p_failure_code text
) returns void
language sql
security definer
set search_path = public
as $$
  update public.automation_idempotency_keys
  set status = 'failed',
      failure_code = p_failure_code,
      completed_at = now(),
      locked_until = null,
      expires_at = now() + interval '7 days'
  where service_account_id = p_service_account_id
    and idempotency_key = p_idempotency_key
    and status = 'in_progress';
$$;

revoke all on function public.create_automation_service_account(
  text, uuid, text[], timestamptz, text, text, uuid
) from public, anon, authenticated;
revoke all on function public.rotate_automation_service_account_token(
  uuid, text, text, timestamptz, integer, uuid
) from public, anon, authenticated;
revoke all on function public.claim_automation_idempotency_key(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke all on function public.complete_automation_idempotency_key(
  uuid, uuid, integer, jsonb, text, text, timestamptz
) from public, anon, authenticated;
revoke all on function public.fail_automation_idempotency_key(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.create_automation_service_account(
  text, uuid, text[], timestamptz, text, text, uuid
) to service_role;
grant execute on function public.rotate_automation_service_account_token(
  uuid, text, text, timestamptz, integer, uuid
) to service_role;
grant execute on function public.claim_automation_idempotency_key(
  uuid, uuid, text, text, text
) to service_role;
grant execute on function public.complete_automation_idempotency_key(
  uuid, uuid, integer, jsonb, text, text, timestamptz
) to service_role;
grant execute on function public.fail_automation_idempotency_key(
  uuid, uuid, text
) to service_role;
