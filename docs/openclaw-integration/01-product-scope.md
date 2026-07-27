# Product Scope

Status: Proposed  
Last updated: 2026-07-26

> Compatibility amendment (2026-07-27): reminder schedule resources remain
> readable for v1 clients, but per-tenant timing/template/channel/status writes
> are retired and return `409 GLOBAL_REMINDER_POLICY`. OpenClaw may update the
> tenant payment due day or the global Reminder settings instead.

## 1. Objective

The owner must be able to give OpenClaw natural-language instructions to:

1. create and publish rental listings;
2. import and update tenant records;
3. configure the monthly email and SMS reminder schedule for a tenant.

OpenClaw must reduce data-entry work without weakening the existing admin
application's validation, privacy, audit, and duplicate-delivery protections.

## 2. Actors

### Owner

The authenticated business owner who provides source files and instructions,
reviews previews, and confirms sensitive operations.

### OpenClaw operator

A dedicated OpenClaw agent with the `tingting-operations` Skill. It converts an
owner instruction into validated Automation API calls. It is not an
administrator account and does not have general shell, database, or hosting
access.

### Automation API

A server-to-server API in the Next.js application. It authenticates the
OpenClaw service account, enforces scopes, validates payloads, manages
idempotency and confirmations, and calls the existing repository/service layer.

### Website reminder worker

The existing durable worker invoked every five minutes. It materializes due
occurrences, prevents duplicates, rechecks eligibility, and calls the email or
SMS provider. OpenClaw does not replace it.

## 3. Primary user stories

### P1: Prepare a rental listing

As the owner, I can send property information and images to OpenClaw and receive
a saved draft plus a preview link without exposing the listing publicly.

### P2: Publish a reviewed rental

As the owner, I can explicitly confirm a prepared draft and have OpenClaw
publish the exact reviewed version.

### P3: Preview a tenant import

As the owner, I can provide a CSV or XLSX file and receive row-level results
showing new, updated, unchanged, duplicate, and invalid records before any
tenant data changes.

### P4: Commit a tenant import

As the owner, I can confirm a preview and atomically commit the same validated
rows. The system must reject the commit if the source file, preview, or relevant
database state changed.

### P5: Configure a monthly reminder

As the owner, I can ask OpenClaw to configure the rent due day, reminder day,
local time, timezone, channel, and template. I must see the next computed
occurrence before enabling it.

### P6: Keep unsafe contact channels disabled

As the owner, I can import contact information without accidentally granting
email or SMS permission. Missing or ambiguous permission always becomes
`unconfirmed`.

## 4. Natural-language examples

```text
Create a draft for 1208-123 Main Street, Burnaby. Two bedrooms, two bathrooms,
$3,200 per month, available August 1. Use these five photos. Do not publish.
```

```text
Import tenants-july.xlsx. Treat rows without written permission as unconfirmed.
Show me all conflicts before saving anything.
```

```text
Set Jane Chen's rent due day to the 1st. Remind her on the 28th at 9:00 AM
Vancouver time by email and SMS. Keep it disabled until I confirm.
```

## 5. Scope

### In scope

- A versioned, server-to-server Automation API.
- Hashed service-account tokens and per-action scopes.
- Idempotent rental, media, import, and schedule operations.
- Two-step preview/confirmation for high-impact actions.
- Rental draft creation, update, publish, unpublish, and archive.
- Validated media upload using the existing file-signature checks.
- CSV and XLSX tenant import up to 1,000 rows per batch.
- Tenant normalization, deterministic matching, conflict reporting, and atomic
  commit.
- One monthly reminder schedule per tenant, matching the current MVP PRD.
- OpenClaw Skill, tool wrapper, and structured response contracts.
- Audit logs that distinguish human admins, service accounts, and system work.
- Mock-mode and production-mode verification.

### Out of scope

- Multiple reminder schedules per tenant.
- Different email and SMS send times for the same tenant.
- Payment-status tracking or overdue follow-up automation.
- OpenClaw sending email or SMS directly.
- OpenClaw owning one Cron job per tenant.
- Browser-click automation as the production integration.
- Autonomous contact-permission approval.
- Automatic publication or real delivery without an explicit owner decision.
- Creating third-party provider accounts.
- Replacing Supabase, Render, Resend, or Twilio.

## 6. Product rules

1. A rental begins as `draft`.
2. Publication applies to an immutable reviewed resource version.
3. Tenant imports are previewed before commit.
4. An import row cannot set a permission to `allowed` unless it includes an
   approved permission source and timestamp.
5. New schedules default to `isEnabled=false`.
6. A schedule can be enabled only when every selected channel is eligible and
   has an active matching template.
7. `REMINDERS_FORCE_PAUSED=true` always wins over schedule configuration.
8. Provider mode `mock` or `disabled` never produces a real message.
9. Every mutation includes a service-account actor, request ID, idempotency key,
   and safe audit record.
10. Responses and logs mask tenant destinations unless the operation strictly
    requires the full value.

## 7. Success metrics

- At least 95% of complete rental instructions produce a valid draft without
  manual field re-entry.
- A 100-row tenant file previews in under 10 seconds and commits in under 30
  seconds under normal production load.
- Replaying any completed mutation with the same idempotency key produces no
  duplicate resource or side effect.
- Zero rentals publish without a valid confirmation intent.
- Zero tenant rows commit from an unconfirmed or expired import preview.
- Zero schedules enable with an ineligible selected channel.
- Zero real provider sends occur during mock or force-paused rollout.
- Every automation mutation is traceable to one service account and request.

## 8. Acceptance boundary

The feature is complete only when all workflows pass the tests and launch gates
in [11-testing-rollout-operations.md](./11-testing-rollout-operations.md).
