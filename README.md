# Ting Ting Real Estate

Next.js full-stack application for the public real-estate website, fixed-schema
content administration, rentals, tenant management, and rent reminders.

## Run locally

```bash
cp .env.example .env.local
pnpm install
pnpm dev
```

The default local mode uses seeded in-memory data. Open `http://localhost:3000`
for the public website and `/admin` for the authenticated admin. Local admin
credentials are configured server-side with `LOCAL_ADMIN_EMAIL`, a scrypt
`LOCAL_ADMIN_PASSWORD_HASH`, and `LOCAL_ADMIN_SESSION_SECRET`.

No third-party account is required for local development. Supabase is replaced
by the seeded memory adapter and notification delivery defaults to
`EMAIL_PROVIDER_MODE=mock` and `SMS_PROVIDER_MODE=disabled`, which keep
outbound delivery network-free. The contact form is persisted locally and its
delivery adapter remains mocked.

Notification provider modes:

- `mock`: safe development/test responses; that channel sends nothing.
- `disabled`: every delivery attempt fails closed with a configuration error.
- `live`: uses Resend for email or Twilio for SMS and requires only that
  channel's server-side credentials.

Twilio SMS accepts `TWILIO_MESSAGING_SERVICE_SID` for production delivery or
`TWILIO_FROM_NUMBER` for a restricted trial dry run. Keep `SMS_PROVIDER_MODE`
disabled until the sender is approved and a callback-tested dry run succeeds.
The current Owner decision is an Email-only launch: Twilio/SMS is deferred, all
Twilio variables stay unset, and `SMS_PROVIDER_MODE=disabled` remains in
production.

## Verify

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
pnpm --dir integrations/openclaw test
```

The production-authentication suite is intentionally separate and fail-closed:
`pnpm test:e2e:supabase` requires a dedicated test project or local Supabase,
an explicit confirmation marker, and test-only administrator/MFA credentials.
It refuses to run against the declared production project.

Database migrations can additionally be syntax- and behavior-tested against
PostgreSQL 17 using [tests/sql/migration-behavior.sql](./tests/sql/migration-behavior.sql).

## Supabase provisioning

Apply every migration in `supabase/migrations`, create the first administrator
in Supabase Auth with public signup disabled, then run:

```bash
ADMIN_USER_ID=<auth-user-uuid> pnpm provision:supabase
```

The command creates the active admin profile, fixed validated site sections,
disabled email/SMS templates, private/public media buckets, and a globally
paused reminder configuration. It is idempotent and does not overwrite existing
content.

## Production readiness

The target production deployment is a paid Render Starter Web Service in Oregon
and a Supabase project in `West US (Oregon)`.

The durable Supabase repository, transactional publishing and rental writes,
manual batch confirmation, scheduled reminder materialization, outbox claims,
retry policy, verified provider callbacks, retention, reconciliation, and
operational alerts are implemented. Production health fails closed until the
required Supabase configuration is present.

The local memory adapter is intentionally non-durable and must not be used in
production. The Render blueprint keeps notification delivery `disabled` until
the provider accounts are provisioned. Changing it to `live`, importing real
tenant data, unpausing reminders, or deploying are explicit owner actions.

See [Operations and Launch Runbook](./docs/OPERATIONS.md) and
[PRD Completion Report](./docs/PRD-COMPLETION.md).

## OpenClaw operations integration

The repository includes a private, versioned Automation API, scoped show-once
service-account tokens, durable idempotency and confirmations, rental
draft/publication operations, values-only tenant import preview/atomic commit,
disabled reminder schedule preparation/confirmed enable, Admin controls, and
the restricted `tingting-operations` Skill/CLI.

All production automation flags default to `false`. OpenClaw never receives a
Supabase credential or admin session and never sends email/SMS directly. See
[OpenClaw Operations Integration Specs](./docs/openclaw-integration/README.md)
and [OpenClaw installation guide](./integrations/openclaw/README.md).
