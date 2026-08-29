-- Allow durable, retryable Admin emails for submitted rental applications.
-- The payload stores only application/file identifiers and delivery routing;
-- sensitive form details and attachment bytes remain in their source records.

alter table public.owner_notification_deliveries
  drop constraint if exists owner_notification_deliveries_kind_check;

alter table public.owner_notification_deliveries
  add constraint owner_notification_deliveries_kind_check check (
    kind in (
      'tenant_upload',
      'weekly_tenant_summary',
      'daily_overdue_rent_summary',
      'showing_confirmation',
      'application_submission'
    )
  );

alter table public.owner_notification_deliveries
  drop constraint if exists owner_notification_deliveries_status_check;

alter table public.owner_notification_deliveries
  add constraint owner_notification_deliveries_status_check check (
    status in ('scheduled', 'processing', 'sent', 'delivered', 'failed')
  ),
  add column if not exists provider_status text null,
  add column if not exists delivered_at timestamptz null;

create unique index if not exists owner_notification_provider_message_idx
  on public.owner_notification_deliveries(provider_message_id)
  where provider_message_id is not null;
