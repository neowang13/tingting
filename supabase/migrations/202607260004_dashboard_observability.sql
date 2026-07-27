create or replace function public.admin_dashboard_summary()
returns jsonb
language sql
security definer
set search_path = public
as $$
with latest_run as (
  select started_at, status
  from public.reminder_worker_runs
  order by started_at desc
  limit 1
),
oldest_event as (
  select min(created_at) as created_at
  from public.notification_events
  where status = 'scheduled' and coalesce(next_attempt_at, now()) <= now()
),
facts as (
  select
    (select count(*) from public.tenants where is_active and archived_at is null) as active_tenants,
    (select count(*) from public.reminder_schedules where is_enabled) as enabled_schedules,
    (select count(*) from public.reminder_schedules where is_enabled and next_run_at between now() and now() + interval '7 days') as due_next_seven_days,
    (select count(*) from public.notification_events where status in ('failed', 'undelivered') and created_at >= now() - interval '30 days') as failed_last_thirty_days,
    (select count(*) from public.notification_events where status = 'scheduled' and coalesce(next_attempt_at, now()) <= now()) as outbox_backlog,
    (select coalesce((value->>'paused')::boolean, true) from public.system_settings where key = 'reminders') as reminders_paused,
    (select started_at from latest_run) as last_worker_run_at,
    (select status from latest_run) as latest_worker_status,
    (select created_at from oldest_event) as oldest_eligible_event_at
)
select to_jsonb(facts) || jsonb_build_object(
  'warnings',
  array_remove(array[
    case when not reminders_paused and (last_worker_run_at is null or last_worker_run_at < now() - interval '15 minutes')
      then 'The reminder worker has not completed within the last 15 minutes.' end,
    case when oldest_eligible_event_at < now() - interval '24 hours'
      then 'The notification backlog contains work older than the 24-hour grace period.' end,
    case when failed_last_thirty_days >= 3
      then 'Several provider attempts have failed. Review delivery history before retrying.' end
  ], null)
)
from facts;
$$;

revoke all on function public.admin_dashboard_summary() from public, anon, authenticated;
grant execute on function public.admin_dashboard_summary() to service_role;
