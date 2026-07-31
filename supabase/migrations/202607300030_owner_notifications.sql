-- Durable owner-email outbox for tenant uploads and weekly tenant summaries.

create table public.owner_notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_key text not null unique check (char_length(notification_key) between 1 and 220),
  kind text not null check (kind in ('tenant_upload', 'weekly_tenant_summary')),
  tenant_id uuid null references public.tenants(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'sent', 'failed')),
  scheduled_for timestamptz not null default now(),
  next_attempt_at timestamptz null default now(),
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  provider_message_id text null,
  safe_error_code text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz null
);

create index owner_notification_due_idx
  on public.owner_notification_deliveries(next_attempt_at, created_at)
  where status in ('scheduled', 'failed', 'processing') and attempt_count < 5;

alter table public.owner_notification_deliveries enable row level security;
revoke all on public.owner_notification_deliveries from anon, authenticated;

create or replace function public.claim_owner_notifications(
  p_now timestamptz,
  p_limit integer default 10
)
returns setof public.owner_notification_deliveries
language sql
security definer
set search_path = public
as $$
  with candidates as (
    select delivery.id
    from public.owner_notification_deliveries delivery
    where delivery.attempt_count < 5
      and (
        (
          delivery.status in ('scheduled', 'failed')
          and delivery.next_attempt_at is not null
          and delivery.next_attempt_at <= p_now
        )
        or (
          delivery.status = 'processing'
          and delivery.updated_at <= p_now - interval '10 minutes'
        )
      )
    order by delivery.next_attempt_at nulls last, delivery.created_at
    for update skip locked
    limit least(greatest(p_limit, 1), 25)
  )
  update public.owner_notification_deliveries delivery
  set
    status = 'processing',
    attempt_count = delivery.attempt_count + 1,
    updated_at = p_now
  from candidates
  where delivery.id = candidates.id
  returning delivery.*;
$$;

revoke all on function public.claim_owner_notifications(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.claim_owner_notifications(timestamptz, integer)
  to service_role;
