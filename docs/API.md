# HTTP API Contract

All responses use:

```json
{
  "success": true,
  "data": {},
  "requestId": "uuid"
}
```

Errors use `success: false` with `error.code`, `error.message`, and optional
validation details. Admin endpoints require a Supabase bearer token in
production. Local memory mode supplies a demo administrator.

## Public

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Runtime and backend health |
| GET | `/api/public/site` | Published sections and rentals |
| GET | `/api/public/rentals` | Published rentals |
| POST | `/api/public/contact` | Validate and accept a contact enquiry |

## Content

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/sections` | List fixed sections |
| GET | `/api/admin/sections/:key` | Read draft and published content |
| PATCH | `/api/admin/sections/:key` | Save validated draft |
| POST | `/api/admin/sections/:key/publish` | Publish draft |
| POST | `/api/admin/sections/:key/rollback` | Roll back to revision |
| GET/POST | `/api/admin/media` | List or upload validated draft images |
| PATCH/DELETE | `/api/admin/media/:id` | Update alt text or archive unused draft image |

## Rentals

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/rentals` | List or create |
| GET/PATCH | `/api/admin/rentals/:id` | Read or update |
| POST | `/api/admin/rentals/:id/publish` | Publish |
| POST | `/api/admin/rentals/:id/unpublish` | Unpublish |
| POST | `/api/admin/rentals/:id/archive` | Archive |

## Tenants and schedules

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/tenants` | List or create |
| GET/PATCH | `/api/admin/tenants/:id` | Read or update |
| POST | `/api/admin/tenants/:id/archive` | Archive |
| POST | `/api/admin/tenants/:id/schedule` | Create or update monthly schedule |

## Templates and notifications

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/templates` | List or create templates |
| PATCH | `/api/admin/templates/:id` | Update and version a template |
| GET | `/api/admin/notifications/events` | Delivery history |
| POST | `/api/admin/notifications/preview` | Preview recipient eligibility |
| POST | `/api/admin/notifications/batches` | Freeze a manual batch |
| POST | `/api/admin/notifications/batches/:id/confirm` | Confirm frozen batch |
| POST | `/api/admin/notifications/events/:id/retry` | Create retry event |
| POST | `/api/admin/notifications/test` | Send only to saved administrator test contacts |

## Settings and internal integrations

| Method | Path | Purpose |
|---|---|---|
| GET/PATCH | `/api/admin/settings/reminders` | Read or update global pause |
| GET/PATCH | `/api/admin/settings/test-contacts` | Read or update safe test destinations |
| POST | `/api/internal/reminders/run` | Cron worker, daily maintenance, reconciliation, and alert delivery |
| POST | `/api/webhooks/twilio` | Twilio delivery callback |
| POST | `/api/webhooks/resend` | Resend delivery callback |

Mutating admin endpoints require same-origin requests. Publishing, test sends,
batch confirmation, retry, pause changes, and test-contact changes are
rate-limited and/or require recent authentication. Provider callbacks require
valid provider signatures and are receipt-idempotent.

## OpenClaw Automation API

The server-to-server API is implemented at `/api/automation/v1`. It uses opaque
service-account bearer tokens, exact per-route scopes, UUID idempotency keys,
version-bound single-use confirmations, masked tenant reads, and feature flags
that default off. Its route/schema contract is documented in
[OpenClaw Automation API Specification](./openclaw-integration/03-automation-api.md)
and [openapi.yaml](./openclaw-integration/openapi.yaml).

High-impact actions—rental status changes, tenant-import commit, permission
grants, tenant archive, and schedule enable/disable—cannot be executed without
an unexpired confirmation intent owned by the same service account. Production
mutations fail closed unless `DATA_BACKEND=supabase`.

Admin control endpoints are available under `/api/admin/automation/*` and use
the existing interactive admin session plus recent AAL2 for credential changes.
Raw tokens are returned only by create/rotate responses and never by reads.
