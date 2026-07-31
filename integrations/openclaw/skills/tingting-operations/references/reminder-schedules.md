# Reminder policy

Reminder timing, template, channel, and enabled state are governed by one global
policy. Per-tenant schedule resources remain readable for compatibility, but
their save and status-preview endpoints return `GLOBAL_REMINDER_POLICY`.

`Automatic email off` is a derived eligibility result, not a separate tenant
toggle. It is expected when the tenant is inactive, has no email destination,
the email permission is not `allowed`, or the global email template is not
active. After an email is stored and an evidence-bound permission grant is
confirmed, the tenant schedule is recalculated and enabled automatically.

OpenClaw may:

- read a tenant's derived reminder status;
- set `rentDueDay` while creating or updating a tenant;
- report channel eligibility, next occurrence, provider mode, global pause, and
  force pause when returned by the API.

OpenClaw may not:

- call per-tenant schedule mutation commands;
- edit global Reminder settings because Automation API v1 has no such endpoint;
- send email or SMS;
- alter provider mode, environment flags, pause state, or Cron.

Direct the owner to Admin for global Reminder setting changes.
