-- Public showing requests are persisted separately from general contact enquiries.
-- A request remains unconfirmed until an administrator explicitly accepts it.

create table public.showing_requests (
  id uuid primary key default gen_random_uuid(),
  rental_listing_id uuid null references public.rental_listings(id) on delete set null,
  property_slug text not null,
  property_title text not null,
  property_address text not null,
  name text not null check (char_length(name) between 1 and 120),
  phone text not null check (char_length(phone) between 7 and 30),
  requested_start_at timestamptz not null,
  requested_local_date date not null,
  requested_local_time time not null,
  requested_timezone text not null default 'America/Vancouver'
    check (requested_timezone = 'America/Vancouver'),
  notes text not null default '' check (char_length(notes) <= 1000),
  status text not null default 'requested'
    check (status in ('requested', 'accepted', 'declined', 'reschedule_requested', 'cancelled')),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz null,
  check (requested_start_at > created_at),
  check ((status = 'accepted' and accepted_at is not null) or (status <> 'accepted' and accepted_at is null))
);

create index showing_requests_status_start_idx
  on public.showing_requests(status, requested_start_at, created_at);

alter table public.showing_requests enable row level security;
revoke all on public.showing_requests from anon, authenticated;

create policy "active admins can read showing requests"
  on public.showing_requests for select
  to authenticated
  using (public.is_active_admin(auth.uid()));

comment on table public.showing_requests is
  'Preferred showing times submitted by visitors; requested does not mean confirmed.';
