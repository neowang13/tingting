# System Architecture

Status: Proposed  
Last updated: 2026-07-26

## 1. Architecture decision

OpenClaw integrates through a dedicated HTTPS Automation API. It does not use
browser automation or direct Supabase access in production.

```text
Owner chat
   |
   v
OpenClaw Gateway
   |
   +-- tingting-operations Skill
   |      |
   |      +-- local input parser / file reader
   |      +-- restricted HTTPS tool
   |
   v
Next.js /api/automation/v1
   |
   +-- service-account authentication
   +-- scope authorization
   +-- request validation
   +-- idempotency and confirmation
   +-- audit context
   |
   v
Existing application services and DataRepository
   |
   +-- Supabase PostgreSQL
   +-- Supabase Storage
   +-- durable notification outbox
   |
   v
Existing reminder worker
   |
   +-- Resend adapter
   +-- Twilio adapter
```

## 2. Component responsibilities

### OpenClaw Skill

- Interpret owner intent.
- Read only the input files explicitly provided for the current task.
- Ask for missing fields.
- Call preview endpoints before sensitive changes.
- Render concise summaries and confirmation prompts.
- Never invent tenant permission evidence.
- Never retry a non-idempotent call without reusing its idempotency key.

### Automation API

- Authenticate the service account.
- Enforce a least-privilege scope for every route.
- Reject use in `DATA_BACKEND=memory` for real import/enable operations.
- Validate all data with Zod.
- Resolve owner-visible identifiers into canonical resource IDs.
- Acquire and persist idempotency state.
- Create and consume short-lived confirmation intents.
- Start atomic database operations.
- Return stable machine-readable errors.
- Write audit events without full PII or message bodies.

### Existing repository and Supabase RPCs

- Remain the single implementation path for resource rules.
- Enforce optimistic concurrency using `updatedAt`.
- Perform multi-table operations transactionally.
- Maintain published revisions and durable schedules.
- Prevent duplicate reminder occurrences with database constraints.

### Reminder worker

- Own all recurring time evaluation and provider submission.
- Recheck pause, tenant, permission, template, and schedule state immediately
  before sending.
- Continue to use the existing five-minute invocation model.

## 3. Trust boundaries

```text
UNTRUSTED / SEMI-TRUSTED                 TRUSTED APPLICATION BOUNDARY

Owner input files  ----+
Chat instructions -----+--> OpenClaw --> HTTPS --> Automation API
Third-party text  ------+                  |            |
                                            |            +--> validation
                                            |            +--> authorization
                                            |            +--> audit
                                            |
                                            +-- no database credentials

                                      PRIVATE DATA BOUNDARY

                                      Supabase DB + Storage
                                             |
                                      Reminder Worker
                                             |
                                      Resend / Twilio
```

Owner input is authoritative only for business intent. It is not trusted as
valid JSON, contact permission, a database ID, or permission to perform a
sensitive action.

## 4. Runtime flows

### Read flow

1. OpenClaw sends a scoped `GET`.
2. The API authenticates the token and checks the read scope.
3. The response returns only fields needed for the operation.
4. Tenant list responses use masked destinations.

### Low-risk mutation flow

Used for creating a rental draft and saving a disabled schedule:

1. OpenClaw generates one UUID idempotency key.
2. The API validates the body and records an in-progress idempotency row.
3. The service performs the mutation.
4. The API stores the stable result reference and marks the key completed.
5. A replay returns the original result.

### High-risk mutation flow

Used for publish, unpublish, archive, import commit, permission grant, and
schedule enable:

1. OpenClaw calls a preview endpoint.
2. The API returns a confirmation intent containing an immutable digest,
   human-readable summary, warnings, resource versions, and expiration.
3. OpenClaw presents the summary and waits for a new explicit owner message.
4. OpenClaw submits the confirmation ID, digest, and a new idempotency key.
5. The API locks the confirmation intent and affected resources.
6. If anything material changed, it returns `409 PREVIEW_STALE`.
7. Otherwise the API performs the mutation and consumes the intent once.

### Async import flow

1. Upload creates an import job.
2. The job validates and normalizes every row.
3. The preview persists row outcomes and a source digest.
4. Commit runs in one database transaction.
5. The API returns the committed job and row counts.

For the MVP, parsing can run in the Next.js request when it completes within the
45-second request budget. The persisted job model is still required so retries,
status inspection, and future background execution do not change the API.

## 5. Availability and failure behavior

- OpenClaw downtime does not affect the public site or scheduled reminders.
- Automation API downtime prevents configuration changes but does not lose
  durable data.
- A timeout after a completed idempotent operation is recovered by replaying the
  same key.
- A timeout before completion returns the stored `in_progress` state or a safe
  retry result.
- Import failure never leaves partially committed tenants.
- Publication failure never exposes a partial rental/media state.
- Provider downtime is handled by the existing durable outbox, not OpenClaw.

## 6. Alternatives rejected

### Browser automation

Rejected because selectors and sessions are brittle, confirmation is difficult
to verify, and it gives the agent broader UI authority than required.

### Direct Supabase service-role access

Rejected because it bypasses Zod validation, repository rules, optimistic
concurrency, confirmation, and safe audit context.

### OpenClaw Cron per tenant

Rejected because it creates two scheduling systems and weakens the existing
database-level duplicate boundary. OpenClaw Cron may run one daily health check,
but it must not send tenant reminders.

### Reusing the admin bearer token

Rejected because an admin session is designed for an interactive human with MFA
and broad permissions. A service account needs non-interactive authentication,
scopes, rotation, revocation, and separate audit identity.

## 7. Capacity assumptions

- Approximately 100 active tenants at launch.
- Import batches up to 1,000 rows and 10 MB.
- Rental listings use at most 20 images, each at most 8 MB.
- One monthly schedule per tenant.
- Automation API target rate: 60 read requests and 30 write requests per minute
  per service account, with stricter limits for confirmations and imports.

