-- One-row-per-tenant projection for the Admin list. Lateral latest-event
-- lookup avoids application-side N+1 queries and is supported by the indexes
-- below for 500+ tenant records.

create index if not exists notification_events_tenant_scheduled_idx
  on public.notification_events(tenant_id, scheduled_for desc);

create or replace view public.admin_tenant_list
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
  latest.scheduled_for as last_delivery_at
from public.tenants tenant
left join public.reminder_schedules schedule on schedule.tenant_id = tenant.id
left join lateral (
  select event.status, event.scheduled_for
  from public.notification_events event
  where event.tenant_id = tenant.id
  order by event.scheduled_for desc
  limit 1
) latest on true;

revoke all on public.admin_tenant_list from public, anon, authenticated;
grant select on public.admin_tenant_list to service_role;
