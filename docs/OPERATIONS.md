# Operations and Launch Runbook

## Current safe state

The application is complete for local/demo use and is prepared for a durable
Supabase deployment. No Supabase, Resend, Twilio, domain, or Render resource has
been created by this repository. The Render blueprint keeps
`NOTIFICATION_PROVIDER_MODE=disabled` and `REMINDERS_FORCE_PAUSED=true`.

Do not import real tenants or unpause reminders until the owner has approved the
retention period, templates, recipients, and provider dry-run results.

## Production provisioning

1. Create Supabase in West US (Oregon). Disable public signup.
2. Apply migrations in filename order from `supabase/migrations`.
3. Owner-create the administrator in Supabase Auth and enable TOTP MFA.
4. Load `.env.local` with the Supabase URL, anon key, service-role key, bucket
   names, and the Auth user UUID as `ADMIN_USER_ID`.
5. Run `pnpm provision:supabase`. Confirm that templates and reminders remain
   disabled.
6. Create the Render web service from `render.yaml`, enter all `sync: false`
   values, and verify `/api/health`.
7. Configure an authenticated scheduled HTTP request every five minutes:

   ```text
   POST https://<production-host>/api/internal/reminders/run
   Authorization: Bearer <REMINDER_CRON_SECRET>
   ```

   Each invocation materializes due occurrences, drains at most 200 durable
   events with concurrency 10 and a 45-second work budget, performs once-daily
   retention/reconciliation, and sends deduplicated operational alerts.
8. Keep provider mode disabled until both provider accounts and callbacks are
   configured. Then use saved administrator test contacts and `mock`, provider
   test credentials, and finally `live` in that order.

## Third-party values still required

- Supabase URL, anon key, service-role key, and first Auth administrator UUID.
- Render production hostname and a random Cron secret of at least 24 characters.
- Resend API key, verified `EMAIL_FROM`, contact/alert recipient addresses, and
  webhook signing secret.
- Twilio Account SID, Auth Token, Messaging Service SID, and the exact public
  status callback URL.
- Approved production domain and final approved website images.

Provider secrets are server-only. Never expose the service-role key, Resend key,
Twilio token, full destinations, message bodies, or webhook payloads in logs.

## OpenClaw operations integration

The integration code and append-only migrations `202607260010` through
`202607260013` are implemented. Keep these production flags off until each
staged gate in the [specification index](./openclaw-integration/README.md)
passes:

```text
AUTOMATION_API_ENABLED=false
AUTOMATION_MUTATIONS_ENABLED=false
AUTOMATION_CONFIRMATIONS_ENABLED=false
AUTOMATION_TENANT_IMPORT_ENABLED=false
```

Provision `AUTOMATION_TOKEN_PEPPER` as a separate server-only random secret of
at least 32 characters. It is used for HMAC-SHA-256 token digests and must not
be given to OpenClaw.

Create the first account in Admin → Automation → Service Accounts while signed
in with recent AAL2. Save the raw token immediately in OpenClaw secret
configuration; it cannot be retrieved again. Start with read-only scopes.
Rotate through the same Admin screen. Emergency response is: revoke/deactivate
the token/account, set `AUTOMATION_MUTATIONS_ENABLED=false`, review Automation
Audit, and leave reminder force/global pause active.

Install the Skill using
[integrations/openclaw/README.md](../integrations/openclaw/README.md). The
dedicated agent must deny browser, general network, general shell, database,
provider, hosting, and arbitrary Cron tools.

Import troubleshooting:

- `IMPORT_HAS_ERRORS`: correct invalid/conflict rows in the source and upload a
  new file;
- `PREVIEW_STALE`: regenerate preview because a matched tenant changed;
- `DURABLE_BACKEND_REQUIRED`: configure Supabase before commit;
- raw import files are private and due for deletion after seven days;
- normalized PII is redacted after 30 days unless held.

Do not:

- Give OpenClaw the Supabase service-role key or an admin session token.
- Use browser automation as a production integration.
- Import real tenant data through OpenClaw before the launch gates pass.
- Create per-tenant OpenClaw Cron jobs.
- Enable provider delivery or unpause reminders before the launch gates pass.

The final two bullets remain launch gates: real tenant import needs retention
approval and a tested encrypted backup/restore; real reminder delivery needs
provider dry-run/callback approval and the existing unpause sequence.

## Launch gates

- `/api/health` reports Supabase persistence ready.
- Public pages show only published content and rentals.
- Admin login, TOTP challenge, explicit logout, idle expiry, and absolute expiry
  are verified.
- Test email and SMS go only to saved administrator test contacts.
- Resend and Twilio callback signatures and status transitions are verified.
- Cron is observed while global pause remains active.
- The first encrypted backup is downloaded and restored outside production.
- Owner approves templates, tenant eligibility, retention, and the manual batch
  preview.
- Only then set `REMINDERS_FORCE_PAUSED=false`, explicitly unpause in Admin, and
  set provider mode to `live`.

## Backup and restore

Accepted MVP recovery point: up to seven days. Target recovery time: four hours
after credentials and a clean Supabase project are available. Create an
encrypted logical export weekly and before material imports or migrations.

Example export from a trusted workstation:

```bash
pg_dump "$DATABASE_URL" --format=custom --no-owner --file=tingting-YYYY-MM-DD.dump
openssl enc -aes-256-cbc -salt -pbkdf2 -iter 200000 \
  -in tingting-YYYY-MM-DD.dump -out tingting-YYYY-MM-DD.dump.enc
```

Store only the encrypted file off-platform. Keep its passphrase in the owner's
password manager, separate from the backup. Test integrity by decrypting and
restoring into a non-production database:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
  -in tingting-YYYY-MM-DD.dump.enc -out restore-test.dump
pg_restore "$RESTORE_TEST_DATABASE_URL" --clean --if-exists \
  --no-owner --exit-on-error restore-test.dump
```

Validate table counts, public views, active admin profiles, required functions,
and a paused mock worker run. During any restore, set
`REMINDERS_FORCE_PAUSED=true` and provider mode to `disabled`. Rotate database
credentials if a decrypted export is exposed, and securely remove local
decrypted copies after verification.

On 2026-07-26, the final migration set was exported in PostgreSQL custom format,
encrypted with AES-256/PBKDF2, decrypted, restored into a new PostgreSQL 17
database, and validated. Restored evidence: 1 admin, 3 notification events,
7 audit entries, 1 maintenance run, and the daily maintenance function present.

## Retention and privacy operations

The daily maintenance transaction applies the initial proposal:

- content revisions: retained indefinitely;
- notification destination/rendered content: SHA-256 hashed and redacted after
  90 days;
- notification metadata and audit entries: removed after 24 months;
- stored public enquiries: removed after 12 months;
- archived tenant records: no automatic deletion until the owner approves the
  legal/operational period.

`retention_holds` prevents notification, audit, or tenant targets from being
removed while a documented legal hold is active. Holds must include a reason
and an owner-provisioned admin actor.

For access/export, use a service-role query in a controlled environment and
include the tenant, schedule, notification metadata, and audit rows associated
with that tenant. For correction, use Admin so optimistic locking and audit
events are preserved. For deletion, first disable the schedule and archive the
tenant; after owner/legal approval, export required records, remove dependent
events, and delete or anonymize the tenant in a transaction. Never delete a
record under an active hold.

## Monitoring and incident response

The dashboard and Cron response expose worker recency, pause state, backlog,
oldest eligible event, 30-day failures, and daily reconciliation gaps. Alerts
are sent through the email provider and deduplicated hourly, except
reconciliation alerts, which are deduplicated daily.

If a scheduler is stale, keep reminders paused, verify the scheduled request and
Cron secret, then invoke one authenticated run. For a backlog over 24 hours,
do not bulk retry expired occurrences; review terminal outcomes. SMS network
errors after a provider request starts become `unknown` and require provider
reconciliation, never an automatic retry. Permanent bounce, complaint,
opt-out, and invalid-number feedback suppresses the affected channel.

Upgrade Supabase or Render when database/storage exceeds 70%, automatic backups
or a recovery point under seven days is needed, two consecutive scheduler
windows are missed, or resource pressure repeatedly affects health checks.
