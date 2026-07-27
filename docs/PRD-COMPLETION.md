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

The 2026-07-26 completion pass additionally closed the production Admin
authentication gap, added a fail-closed Supabase Cookie/MFA E2E suite, completed
tenant projections and filters, pre-save schedule calculation, UTC
`scheduledFor` filtering, recent dashboard sends, signed three-step test-send
confirmation, and authentication security audits. The Render blueprint now
includes an authenticated five-minute Cron whose paused path can claim only
administrator-destination test events.

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
  global pause, per-channel provider modes, and explicit logout.
- Authentication: owner-provisioned Supabase users, active profile check, TOTP
  enrollment/challenge, AAL2 enforcement, recent-auth checks for sensitive
  actions, 30-minute idle expiry, and 12-hour absolute expiry.

## Database evidence

Migrations `202607240001` through `202607260017` apply cleanly to PostgreSQL 17.
The behavioral SQL suite verifies content publishing/revisions/audit, immutable
template creation, tenant audit writes, forced pause, schedule materialization,
manual batch freezing/confirmation, outbox claim, retry and completion,
90-day redaction, and once-daily maintenance idempotency.

The latest local automated result is 93 unit/service tests passed. Sixteen
Supabase RLS tests passed against a dedicated local project. Two demo-mode
Playwright journeys and one independent production-mode Supabase journey pass
in Chrome. The production journey uses a real SSR Cookie Session and TOTP AAL2,
never a memory fallback or browser-managed Bearer token, and covers critical
writes, frozen batches, auth audit evidence, paused mock test dispatch, and
repeatable test data. Seven OpenClaw fake-server and policy tests also pass.

## External decisions and launch blockers

- Production Supabase, Render, Resend, sender domain, and production domain are
  not yet configured in this workspace. Twilio/SMS is Owner-deferred and is not
  part of the Email-only launch scope.
- OpenClaw has not been connected to a real account or production token.
- The owner must approve final images, sender identity, templates, test
  contacts, tenant import, and the archived-tenant retention period.
- Real callback/dry-run checks require the external credentials above; RLS and
  production-auth flows have passed against dedicated local Supabase.
- Email must remain `disabled` and reminders force-paused until the Email
  checks pass. SMS must remain `disabled` throughout this launch.

The implementation is code-complete, but it must not be described as live
production-ready until the external provisioning and credential-dependent
gates in `docs/OPERATIONS.md` are completed.

See `docs/QA-REPORT.md` for the browser evidence and its explicit visual
baseline limitation.
