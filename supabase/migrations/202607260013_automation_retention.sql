-- Automation evidence retention and automatic token cutover revocation.
-- Rollback note: retention can be disabled by revoking execute; never restore
-- expired raw PII or revoked credentials.

create or replace function public.apply_automation_retention(
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tokens integer := 0;
  v_idempotency integer := 0;
  v_confirmations integer := 0;
  v_rows integer := 0;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  update public.automation_service_account_tokens
  set is_active = false, revoked_at = p_now
  where is_active and revoked_at is null
    and revoke_after is not null and revoke_after <= p_now;
  get diagnostics v_tokens = row_count;

  delete from public.automation_idempotency_keys
  where expires_at <= p_now;
  get diagnostics v_idempotency = row_count;

  delete from public.automation_confirmation_intents
  where coalesce(consumed_at, expires_at) <= p_now - interval '30 days';
  get diagnostics v_confirmations = row_count;

  update public.tenant_import_rows r
  set normalized_payload = null
  from public.tenant_imports i
  join public.automation_jobs j on j.id = i.job_id
  where r.import_id = i.id
    and r.normalized_payload is not null
    and not i.legal_hold
    and coalesce(j.completed_at, i.created_at) <= p_now - interval '30 days';
  get diagnostics v_rows = row_count;

  return jsonb_build_object(
    'tokensRevoked', v_tokens,
    'idempotencyDeleted', v_idempotency,
    'confirmationsDeleted', v_confirmations,
    'normalizedRowsRedacted', v_rows,
    'rawImportObjectsPendingDeletion', (
      select count(*) from public.tenant_imports i
      join public.automation_jobs j on j.id = i.job_id
      where i.source_deleted_at is null
        and not i.legal_hold
        and coalesce(j.completed_at, i.created_at) <= p_now - interval '7 days'
    )
  );
end;
$$;

revoke all on function public.apply_automation_retention(timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_automation_retention(timestamptz)
  to service_role;
