# Reminder Schedule Workflow Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Goal

OpenClaw can prepare and enable the existing MVP monthly rent-reminder schedule
without becoming a second scheduler or bypassing contact eligibility.

## 2. MVP boundary

Each tenant has at most one monthly schedule:

```text
one rent due day
one reminder day
one local time and timezone
one or both channels
one template per selected channel
one enabled state
```

Email and SMS share the same reminder day and time. Requests for different
channel times or multiple reminders require a future schema version and must not
be approximated.

## 3. Field contract

| Field | Constraint |
|---|---|
| `rentDueDay` | Integer 1–31 |
| `dayOfMonth` | Integer 1–31 |
| `localTime` | `HH:mm`, 24-hour time |
| `timezone` | Valid IANA timezone |
| `channels` | One or both of `email`, `sms` |
| `emailTemplateId` | Required when email selected |
| `smsTemplateId` | Required when SMS selected |
| `isEnabled` | Must be `false` on ordinary save |

Default timezone is the tenant timezone, normally `America/Vancouver`.

## 4. Preparation flow

1. Resolve one tenant.
2. Read the tenant, current schedule, active templates, global pause, provider
   mode, and force-pause state.
3. Extract due day, reminder day, local time, timezone, and channels.
4. Ask for missing values.
5. Validate selected templates by channel and active state.
6. Save the schedule with `isEnabled=false`.
7. Calculate and display the next candidate occurrence even though the saved
   schedule is disabled.
8. Return channel eligibility and blocking reasons.

Saving a disabled schedule does not require confirmation.

## 5. Next occurrence

Reuse `nextOccurrence` from `src/features/reminders/scheduler.ts`.

Algorithm:

1. Convert the reference instant to the schedule timezone.
2. Clamp `dayOfMonth` to the month's final calendar day.
3. Combine the local date and time.
4. Resolve timezone transitions using Temporal-compatible behavior.
5. If the instant is not strictly after the reference, move to the next month.
6. Persist enabled `nextRunAt` in UTC.

Rules:

- day 31 becomes February 28 or 29 as applicable;
- a nonexistent spring-forward time moves to the next valid instant;
- a repeated fall-back time uses the earlier occurrence;
- the preview shows both UTC and tenant-local values;
- the due date is computed independently from `rentDueDay`.

## 6. Channel eligibility

### Email

Eligible only when:

- tenant is active and not archived;
- email exists and is valid;
- email status is `allowed`;
- email is in preferred channels;
- selected email template exists, is active, and is an email template.

### SMS

Eligible only when:

- tenant is active and not archived;
- phone exists in E.164 format;
- SMS status is `allowed`;
- SMS is in preferred channels;
- selected SMS template exists, is active, and is an SMS template.

An ineligible channel blocks enabling the whole v1 schedule. The owner must fix
the channel or remove it and generate a new preview.

## 7. Enable preview

The preview must show:

```text
Tenant: Jane Chen
Property: Main Street, Unit 12
Rent due: day 1
Reminder: day 28 at 09:00 America/Vancouver
Next local occurrence: 2026-08-28 09:00
Next UTC occurrence: 2026-08-28T16:00:00Z
Channels:
  Email: eligible, template "Monthly Rent Reminder"
  SMS: eligible, template "Monthly Rent Reminder SMS"
System:
  Schedule state after confirmation: enabled
  Global pause: paused
  Deployment force pause: active
  Email provider mode: mock
  SMS provider mode: disabled
Effect:
  No real message can send while force pause remains active.
```

Required acknowledgements:

- `schedule_configuration_reviewed`;
- `selected_recipients_and_channels_reviewed`;
- `real_delivery_warning` when either provider mode is `live` and force pause
  is off.

## 8. Enable flow

1. Create `schedule.enable` confirmation intent with schedule and tenant
   versions.
2. Wait for a new owner confirmation.
3. Lock tenant, schedule, selected templates, and confirmation.
4. Recheck eligibility and global state.
5. Recompute `nextRunAt` using current time.
6. Set `is_enabled=true`.
7. Consume the confirmation.
8. Return effective pause and next occurrence.

Enabling while globally paused is allowed because it prepares future work.
Enabling while `REMINDERS_FORCE_PAUSED=true` is also allowed only after the
preview explicitly states that delivery remains blocked.

## 9. Disable flow

Disabling requires confirmation because it changes future tenant
communication.

The transaction:

- sets `is_enabled=false`;
- sets `next_run_at=null`;
- preserves `last_processed_at`;
- does not delete notification history;
- causes a claimed event to fail the eligibility recheck before provider
  submission.

Opt-out, invalid, suppression, tenant archive, or global incident response may
disable/cancel delivery immediately without waiting for OpenClaw confirmation.

## 10. Runtime ownership

After enable:

```text
Supabase Cron every five minutes
        |
        v
POST /api/internal/reminders/run
        |
        v
materialize due schedule occurrences
        |
        v
durable notification outbox
        |
        v
eligibility recheck
        |
        v
mock / Resend / Twilio provider
```

OpenClaw does not wake at the tenant's reminder time and does not submit the
provider message.

## 11. Provider-not-configured behavior

Current rollout:

```text
EMAIL_PROVIDER_MODE=mock or disabled
SMS_PROVIDER_MODE=mock or disabled
REMINDERS_FORCE_PAUSED=true
```

OpenClaw may create and preview schedules. It must clearly state that real
delivery is unavailable.

Provider accounts and callbacks are external launch prerequisites. The Skill
cannot change provider modes, force-pause environment variables, global pause,
test contacts, or provider credentials.

## 12. Audit events

```text
automation.schedule.saved_disabled
automation.schedule.enable_previewed
automation.schedule.enabled
automation.schedule.disable_previewed
automation.schedule.disabled
```

Metadata includes tenant ID, selected channels, local schedule fields,
templates, effective pause, request ID, and confirmation ID. It excludes full
destinations and rendered message bodies.

## 13. Acceptance tests

- An ordinary save cannot set `isEnabled=true`.
- An ineligible selected channel blocks an enable preview.
- Email and SMS templates must match their channels.
- Day 31 clamps correctly in short months.
- Spring-forward and fall-back tests match existing scheduler behavior.
- Preview and execution recalculate if time passes into a new occurrence.
- A stale tenant, permission, schedule, or template invalidates the preview.
- Enable requires a new owner confirmation message.
- Replay produces one enabled transition and one audit result.
- Disable stops future materialization without deleting history.
- Global and force pause remain authoritative.
- OpenClaw never creates a per-tenant Cron task or sends through providers.
