-- Structured, server-mediated online application drafts. The payload remains
-- client-owned private data under the existing client_applications RLS policies;
-- browser roles keep read-only grants and all writes continue through API routes.

alter table public.client_applications
  add column draft_payload jsonb not null default '{}'::jsonb,
  add column draft_updated_at timestamptz null;

alter table public.client_applications
  add constraint client_application_draft_object_check
  check (jsonb_typeof(draft_payload) = 'object');

comment on column public.client_applications.draft_payload is
  'Private structured online application draft; validated and written only by authenticated server routes.';

comment on column public.client_applications.draft_updated_at is
  'Last successful server-side draft save time.';

alter table public.showing_requests
  add column email text null check (email is null or char_length(email) between 3 and 254),
  add column desired_move_in_date date null,
  add column has_pets boolean not null default false,
  add column needs_parking boolean not null default false,
  add column representation_disclosure_acknowledged_at timestamptz null;

comment on column public.showing_requests.representation_disclosure_acknowledged_at is
  'Timestamp when the visitor acknowledged receiving the residential-tenancy representation disclosure before sharing rental needs.';
