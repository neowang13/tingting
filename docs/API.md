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
validation details. In production, `/api/admin/*` is an interactive,
browser-only API authenticated from the HttpOnly Supabase SSR Cookie Session.
Client JavaScript does not read, store, or attach an access token. These routes
also verify the active administrator profile, AAL2, the 30-minute idle limit,
the 12-hour absolute limit, and same-origin writes. Local memory mode supplies
a signed demo administrator session.

Bearer credentials are intentionally not accepted by `/api/admin/*`. External service-account clients are no longer supported;
the reminder worker uses its own `REMINDER_CRON_SECRET` boundary.

`/api/client/*` uses the independently authorized Client Login session. It
requires an active `client_profiles` record, applies a 15-minute idle and
1-hour absolute session limit, scopes every application operation to the
authenticated owner, and requires same-origin writes. It never accepts an
Admin cookie as client authorization or returns private object paths/URLs.

## Public

The separate private `/api/mcp` endpoint uses MCP JSON-RPC over Streamable HTTP,
not this HTTP envelope. It is disabled by default and accepts only independently
issued, scoped OAuth access tokens following the existing Admin login and consent.
No static connector keys, browser cookies, or old Automation API tokens are accepted
by the MCP endpoint. See [MCP setup and tool contracts](./admin-mcp.md).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Runtime and backend health |
| GET | `/api/public/site` | Published sections and rentals |
| GET | `/api/public/rentals` | Published rentals |
| POST | `/api/public/contact` | Validate and accept a contact enquiry |
| GET | `/api/public/showings?propertySlug=...` | List open dates for one published property; no time slots |
| POST | `/api/public/showings` | Register a viewing date; multiple groups may book the same day; agent arranges the time |

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

## Client applications

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/client/auth/login` | Local demo Client Login; production uses Supabase Auth plus session establishment |
| POST | `/api/client/auth/session` | Verify a Supabase Auth session and active client profile |
| POST | `/api/client/auth/logout` | End the client session |
| GET | `/client/auth/confirm` | Exchange a one-time Supabase email-confirmation code, clear the temporary session, and return to Client Login |
| POST | `/api/client/applications/start` | Create or reuse the authenticated Client's single application for a published rental |
| PATCH | `/api/client/applications/:id/draft` | Validate and save the authenticated owner's structured online application draft |
| GET | `/api/client/applications/:id/form` | Download the authenticated client's paper fallback form |
| POST | `/api/client/applications/:id/files` | Validate and store one supporting file privately |
| POST | `/api/client/applications/:id/submit` | Verify authorizations, freeze consent/version evidence, and queue a minimal Admin email notification |
| GET | `/api/client/applications/:id/receipt` | Download the authenticated client's submission receipt |
| GET/PATCH | `/api/admin/application-files/:id` | Download privately for approved screening / record a recent-AAL2 screening decision |
| PATCH | `/api/admin/applications/:id` | Perform a documented staff status transition |
| POST | `/api/admin/applications/:id/tenant` | Convert an approved application with a signed lease PDF and `signedAgreementConfirmed: true` to a linked tenant |

Application starts and draft writes are same-origin, rate-limited, owner-scoped, and
rejected after submission. Starting an application accepts only a published rental
slug, derives ownership from the authenticated session, and atomically reuses the
existing Client/rental application when one exists. The service refuses to create,
save, upload to, or submit an application unless both the canonical form and active
consent version have completed legal/privacy approval.
Form and receipt responses are `private, no-store`. Uploads allow only content-
sniffed PDF/JPEG/PNG files up to 10 MB, reject active PDF features, use random
private-bucket keys, and remain `manual_review_required` until the approved
malware-risk process clears them. See the
[client application runbook](./client-application-operations.md).

## Rentals

| Method | Path | Purpose |
|---|---|---|
| GET/POST | `/api/admin/rentals` | List or create |
| GET/PATCH | `/api/admin/rentals/:id` | Read or update |
| DELETE | `/api/admin/rentals/:id` | Permanently delete from admin and public website; requires recent admin authentication and `expectedVersion`; retains application/booking history |
| POST | `/api/admin/rentals/:id/publish` | Publish property and calendar together when `expectedViewingDraftVersion` and `expectedViewingPublishedVersion` accompany `expectedVersion`; returns `{ rental, viewingSchedule }` |
| POST | `/api/admin/rentals/:id/unpublish` | Unpublish |
| POST | `/api/admin/rentals/:id/archive` | Archive |
| GET/PATCH | `/api/admin/rentals/:id/viewing-draft` | Read/save private calendar; PATCH requires `expectedUpdatedAt` and `expectedPublishedUpdatedAt` (nullable version tokens), plus schedule fields |
| GET/PATCH | `/api/admin/rentals/:id/viewing-schedule` | Read/publish this property’s calendar using `openWeekdays`, date overrides, timezone, and `expectedUpdatedAt` |

## Users, tenancies, and schedules

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/users` | List all registered client users with verified tenancy status and minimal application summaries |
| GET | `/api/admin/clients` | Legacy registered-account and link projection |
| POST | `/api/admin/clients/:userId/link` | Returns `409 SIGNED_LEASE_REQUIRED`; use signed application conversion |
| POST | `/api/admin/clients/:userId/unlink` | End the current tenant link while preserving history |
| GET | `/api/admin/tenants` | List current and historical tenancy records |
| POST | `/api/admin/tenants` | Returns `409 SIGNED_LEASE_REQUIRED`; use signed application conversion |
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

## Retired external integration

`/api/automation/v1/*` and `/api/admin/automation/*` have been removed.
Old bearer tokens do not provide an application entry point. Staff operations
continue through authenticated Admin routes; reminder Cron authentication is separate.
