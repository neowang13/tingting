# PRD Completion Report

## Outcome

The repository now implements the full in-scope public site and administration
system: validated fixed-schema content, media, rentals, tenants, contact
permission records, reminder schedules, immutable templates, manual recipient
preview/freeze/confirmation, a durable scheduled outbox, provider adapters and
verified callbacks, delivery history/retry, global pause, monitoring,
reconciliation, retention, and backup/restore procedures.

It also implements the full local OpenClaw integration scope: a versioned,
scoped Automation API, show-once service credentials, idempotency, expiring
confirmation intents, source attribution, atomic high-impact execution, private
tenant-import previews and commits, disabled-first reminder schedules, Admin
Automation oversight, retention, and a packaged deterministic OpenClaw Skill
and CLI.

Third-party accounts are intentionally not provisioned. Local delivery is
mocked; the production blueprint is disabled and force-paused. No deployment,
real email, or real SMS was performed.

## Architecture and safety boundaries

- Next.js App Router serves public pages, Admin, and server-only API routes.
- `DataRepository` provides an in-memory demo adapter and a complete Supabase
  service-role adapter. Production rejects the memory backend.
- Anonymous access is limited to `public_site_sections` and
  `public_rental_listings`; drafts, tenants, schedules, messages, audit history,
  and provider receipts have RLS enabled with no anonymous grants.
- Fixed section keys and strict Zod schemas prevent structural page changes.
- PostgreSQL RPCs enforce optimistic concurrency and transactions around
  content publishing, rental media/status changes, tenant audit writes,
  template revisions, schedules, manual batches, outbox claims, attempts,
  retries, pause changes, test destinations, retention, and maintenance.
- Provider callbacks verify Resend Svix or Twilio signatures before
  receipt-idempotent status updates. Ambiguous SMS submissions become
  `unknown`; only safe failures are retryable.

## User-facing completion

- Public: homepage, rental search/list, rental detail, published media,
  canonical metadata, sitemap, robots, contact enquiry validation, honeypot,
  rate limiting, persistence, and safe provider fallback.
- Admin: dashboard, fixed content field editors, saved-draft preview,
  revision/rollback, media library, rental editor, tenant/contact permission
  editor, schedules, template revisions/previews, safe test destinations,
  manual batch preview and exact-count confirmation, delivery history, retry,
  global pause, provider mode, and explicit logout.
- Authentication: owner-provisioned Supabase users, active profile check, TOTP
  enrollment/challenge, AAL2 enforcement, recent-auth checks for sensitive
  actions, 30-minute idle expiry, and 12-hour absolute expiry.

## Database evidence

Migrations `202607240001` through `202607260013` apply cleanly to PostgreSQL 17.
The behavioral SQL suite verifies content publishing/revisions/audit, immutable
template creation, tenant audit writes, forced pause, schedule materialization,
manual batch freezing/confirmation, outbox claim, retry and completion,
90-day redaction, and once-daily maintenance idempotency.

The latest local automated result is 63 unit/service tests passed. Sixteen
live-Supabase RLS tests are included and skip when `TEST_SUPABASE_URL` and
`TEST_SUPABASE_ANON_KEY` are unavailable. They must pass against the provisioned
project before real tenant import. Two production-build Playwright journeys also
pass in system Chrome, including axe WCAG 2.2 AA checks, responsive breakpoints,
search/detail/form behavior, every required Admin module, the content editor,
Automation service-account token flow, and logout. Seven OpenClaw fake-server
and policy tests also pass.

## External decisions and launch blockers

- Supabase, Render, Resend, Twilio, sender domain, and production domain are not
  yet created.
- OpenClaw has not been connected to a real account or production token.
- The owner must approve final images, sender identity, templates, test
  contacts, tenant import, and the archived-tenant retention period.
- RLS integration tests and live callback/dry-run checks require the external
  credentials above.
- Provider mode must remain `disabled` and reminders force-paused until those
  checks pass.

The implementation is code-complete, but it must not be described as live
production-ready until the external provisioning and credential-dependent
gates in `docs/OPERATIONS.md` are completed.

See `docs/QA-REPORT.md` for the browser evidence and its explicit visual
baseline limitation.
