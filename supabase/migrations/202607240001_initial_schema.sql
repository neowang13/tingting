create extension if not exists pgcrypto;

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.site_sections (
  key text primary key,
  display_name text not null,
  sort_order integer not null unique,
  schema_version integer not null default 1,
  draft_content jsonb not null,
  published_content jsonb not null,
  published_revision_id uuid null,
  updated_by uuid null references public.admin_profiles(user_id),
  updated_at timestamptz not null default now(),
  published_at timestamptz null
);

create table public.site_section_revisions (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references public.site_sections(key),
  schema_version integer not null,
  content jsonb not null,
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now()
);

alter table public.site_sections
  add constraint site_sections_published_revision_fk
  foreign key (published_revision_id) references public.site_section_revisions(id);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  draft_storage_path text not null unique,
  published_storage_path text null unique,
  public_url text null,
  state text not null default 'draft' check (state in ('draft', 'published', 'archived')),
  original_filename text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/avif')),
  byte_size bigint not null check (byte_size > 0),
  width integer null check (width is null or width > 0),
  height integer null check (height is null or height > 0),
  alt_text text not null check (char_length(alt_text) between 1 and 160),
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  archived_at timestamptz null
);

create table public.rental_listings (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  address_line text not null,
  neighbourhood text null,
  city text not null,
  monthly_rent_cents integer not null check (monthly_rent_cents > 0),
  bedrooms numeric(3,1) not null check (bedrooms >= 0),
  bathrooms numeric(3,1) not null check (bathrooms >= 0),
  square_feet integer null check (square_feet is null or square_feet > 0),
  available_on date null,
  pet_policy text null,
  description text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  sort_order integer not null default 0,
  created_by uuid not null references public.admin_profiles(user_id),
  updated_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz null
);

create table public.rental_listing_images (
  id uuid primary key default gen_random_uuid(),
  rental_listing_id uuid not null references public.rental_listings(id) on delete cascade,
  media_asset_id uuid not null references public.media_assets(id),
  sort_order integer not null,
  is_cover boolean not null default false,
  unique (rental_listing_id, sort_order)
);

create unique index rental_listing_one_cover_idx
  on public.rental_listing_images (rental_listing_id)
  where is_cover;

create table public.rental_listing_revisions (
  id uuid primary key default gen_random_uuid(),
  rental_listing_id uuid not null references public.rental_listings(id),
  content_snapshot jsonb not null,
  action text not null check (action in ('publish', 'unpublish', 'archive')),
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  property_label text not null,
  unit_label text null,
  email text null,
  phone_e164 text null,
  preferred_channels text[] not null default '{}'
    check (preferred_channels <@ array['email', 'sms']::text[]),
  email_contact_status text not null default 'unconfirmed'
    check (email_contact_status in ('unconfirmed', 'allowed', 'opted_out', 'invalid', 'bounced', 'complained', 'suppressed')),
  sms_contact_status text not null default 'unconfirmed'
    check (sms_contact_status in ('unconfirmed', 'allowed', 'opted_out', 'invalid', 'suppressed')),
  email_contact_status_reason text null,
  sms_contact_status_reason text null,
  email_contact_status_source text null,
  sms_contact_status_source text null,
  contact_permission_note text null,
  contact_permission_updated_at timestamptz null,
  timezone text not null default 'America/Vancouver',
  internal_notes text null,
  is_active boolean not null default true,
  archived_at timestamptz null,
  created_by uuid not null references public.admin_profiles(user_id),
  updated_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.notification_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  channel text not null check (channel in ('email', 'sms')),
  subject_template text null,
  body_template text not null,
  is_active boolean not null default true,
  created_by uuid not null references public.admin_profiles(user_id),
  updated_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (channel <> 'email' or subject_template is not null)
);

create table public.notification_template_revisions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.notification_templates(id),
  channel text not null check (channel in ('email', 'sms')),
  subject_template text null,
  body_template text not null,
  created_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now()
);

create table public.reminder_schedules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants(id),
  rent_due_day smallint not null default 1 check (rent_due_day between 1 and 31),
  day_of_month smallint not null check (day_of_month between 1 and 31),
  local_time time not null,
  timezone text not null default 'America/Vancouver',
  channels text[] not null check (
    channels <@ array['email', 'sms']::text[] and cardinality(channels) > 0
  ),
  email_template_id uuid null references public.notification_templates(id),
  sms_template_id uuid null references public.notification_templates(id),
  is_enabled boolean not null default false,
  next_run_at timestamptz null,
  last_processed_at timestamptz null,
  created_by uuid not null references public.admin_profiles(user_id),
  updated_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, tenant_id)
);

create index reminder_schedules_due_idx
  on public.reminder_schedules (next_run_at)
  where is_enabled and next_run_at is not null;

create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  schedule_id uuid null,
  template_id uuid not null references public.notification_templates(id),
  template_revision_id uuid not null references public.notification_template_revisions(id),
  retry_of_event_id uuid null references public.notification_events(id),
  source text not null check (source in ('scheduled', 'manual', 'test', 'retry')),
  channel text not null check (channel in ('email', 'sms')),
  occurrence_key text not null unique,
  occurrence_local_date date not null,
  scheduled_for timestamptz not null,
  status text not null check (status in (
    'scheduled', 'processing', 'queued', 'sent', 'delivered', 'failed',
    'undelivered', 'skipped', 'unknown', 'expired', 'cancelled'
  )),
  rendered_subject text null,
  rendered_body text null,
  render_error_code text null,
  render_context jsonb null,
  destination text null,
  destination_masked text null,
  provider text null,
  provider_message_id text null,
  provider_status text null,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  provider_request_started_at timestamptz null,
  next_attempt_at timestamptz null,
  claim_token uuid null,
  claim_expires_at timestamptz null,
  last_error_code text null,
  last_error_message text null,
  claimed_at timestamptz null,
  sent_at timestamptz null,
  delivered_at timestamptz null,
  created_by uuid null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_event_schedule_tenant_fk
    foreign key (schedule_id, tenant_id)
    references public.reminder_schedules(id, tenant_id)
);

create unique index notification_scheduled_occurrence_idx
  on public.notification_events (schedule_id, channel, occurrence_local_date)
  where source = 'scheduled' and schedule_id is not null;

create unique index notification_provider_message_idx
  on public.notification_events (provider, provider_message_id)
  where provider_message_id is not null;

create index notification_outbox_idx
  on public.notification_events (next_attempt_at, created_at)
  where status = 'scheduled';

create table public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.notification_events(id),
  attempt_number integer not null check (attempt_number > 0),
  started_at timestamptz not null,
  completed_at timestamptz null,
  outcome text null,
  provider text null,
  provider_message_id text null,
  safe_error_code text null,
  unique (event_id, attempt_number)
);

create table public.notification_batches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  selection_digest text not null,
  created_by uuid not null references public.admin_profiles(user_id),
  template_email_revision_id uuid null references public.notification_template_revisions(id),
  template_sms_revision_id uuid null references public.notification_template_revisions(id),
  requested_channels text[] not null,
  selected_count integer not null check (selected_count >= 0),
  eligible_count integer not null check (eligible_count >= 0),
  status text not null check (status in ('draft', 'confirmed', 'processing', 'completed', 'partial', 'failed', 'expired')),
  confirmation_idempotency_key text null unique,
  expires_at timestamptz not null,
  confirmed_at timestamptz null,
  completed_at timestamptz null,
  created_at timestamptz not null default now()
);

create table public.notification_batch_recipients (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.notification_batches(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id),
  channel text not null check (channel in ('email', 'sms')),
  eligibility_status text not null check (eligibility_status in ('eligible', 'skipped')),
  skip_reason text null,
  destination_snapshot text null,
  destination_masked text null,
  template_revision_id uuid not null references public.notification_template_revisions(id),
  tenant_version_snapshot timestamptz not null,
  contact_permission_updated_at_snapshot timestamptz null,
  created_at timestamptz not null default now(),
  unique (batch_id, tenant_id, channel)
);

create table public.system_settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid null references public.admin_profiles(user_id),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid null references public.admin_profiles(user_id),
  action text not null,
  target_type text not null,
  target_id text null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table public.reminder_worker_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  completed_at timestamptz null,
  status text not null check (status in ('running', 'completed', 'partial', 'failed', 'paused')),
  occurrences_created integer not null default 0,
  events_dispatched integer not null default 0,
  events_failed integer not null default 0,
  backlog_remaining integer not null default 0,
  safe_error_code text null
);

create view public.public_site_sections as
  select key, schema_version, published_content, published_at
  from public.site_sections;

create view public.public_rental_listings as
  select
    id, slug, title, address_line, neighbourhood, city, monthly_rent_cents,
    bedrooms, bathrooms, square_feet, available_on, pet_policy, description,
    sort_order, published_at
  from public.rental_listings
  where status = 'published';

insert into public.system_settings (key, value)
values ('reminders', '{"paused": true, "pausedAt": null, "pausedBy": null}'::jsonb);

alter table public.admin_profiles enable row level security;
alter table public.site_sections enable row level security;
alter table public.site_section_revisions enable row level security;
alter table public.media_assets enable row level security;
alter table public.rental_listings enable row level security;
alter table public.rental_listing_images enable row level security;
alter table public.rental_listing_revisions enable row level security;
alter table public.tenants enable row level security;
alter table public.notification_templates enable row level security;
alter table public.notification_template_revisions enable row level security;
alter table public.reminder_schedules enable row level security;
alter table public.notification_events enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.notification_batches enable row level security;
alter table public.notification_batch_recipients enable row level security;
alter table public.system_settings enable row level security;
alter table public.audit_events enable row level security;
alter table public.reminder_worker_runs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select on public.public_site_sections, public.public_rental_listings to anon, authenticated;

create policy "admins can read own active profile"
  on public.admin_profiles for select
  to authenticated
  using (user_id = auth.uid() and is_active);

-- All private writes are performed by validated server routes using the
-- service-role key. The browser never receives direct private-table grants.
