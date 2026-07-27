# Product Requirements Document

## Ting Ting Website Admin and Rent Reminder System

**Status:** Reviewed draft; assumptions in Section 14 require client confirmation  
**Last updated:** 2026-07-24  
**Product type:** Private admin web application supporting a public real-estate website  
**Primary user:** Ting Ting / authorized staff  
**Scale assumption:** Low public traffic, approximately 100 tenants, one to a few admin users  
**Audience location:** Greater Vancouver, British Columbia  
**Production hosting:** Render paid Web Service + Supabase  
**Production region:** Oregon for both Render and Supabase  
**Default timezone:** America/Vancouver

## 1. Product Summary

The product is a private admin application connected to Ting Ting's public website. It gives the business owner direct control over approved website content and provides a small tenant reminder system for recurring rent notifications.

The product is deliberately not a general website builder, CRM, accounting system, or rent-payment platform.

## 2. Problem Statement

### Website content

Routine website changes currently require design or development assistance. The owner needs to update banners, text, images, calls to action, service descriptions, profile content, contact information, footer content, and rental listings without risking the approved layout.

### Tenant reminders

Rent reminders sent manually each month are repetitive and easy to forget. The owner needs a reliable way to maintain tenant contact details, configure a monthly reminder time for each tenant, send reminders automatically by SMS and/or email, and send an immediate reminder to one or more tenants when required.

## 3. Goals

1. Allow authorized admins to update all approved website content without code changes.
2. Preserve the public website's fixed section structure and visual design.
3. Allow an admin to manage approximately 100 tenants from a simple directory.
4. Allow each active tenant to have a monthly reminder schedule.
5. Send reminders automatically by SMS, email, or both.
6. Allow safe one-time sends to one, selected, or all eligible tenants.
7. Make every send visible and auditable, including failures and skipped recipients.
8. Prevent duplicate reminders even if a scheduled job runs more than once.

## 4. Non-Goals

- Adding, deleting, reordering, or freely designing public website sections.
- Arbitrary drag-and-drop page building.
- Tenant login accounts or a tenant portal.
- Online rent collection.
- Rent ledger, balance calculation, late fees, receipts, or accounting.
- Maintenance ticket management.
- Lease document management or electronic signatures.
- Two-way SMS inbox or customer support chat.
- Multi-company or multi-landlord SaaS support.
- High-volume campaign marketing.
- Custom workflow engine.

## 5. Users and Roles

### Admin

At launch, one role is sufficient:

- Sign in securely.
- View and edit website content.
- Preview and publish content.
- Manage rentals displayed on the website.
- Manage tenants and reminder schedules.
- Send test, individual, selected, or bulk reminders.
- View delivery history and failures.
- Pause automated reminders.

The data model may support additional admins later, but granular role permissions are not required for MVP.

### Public visitor

- Sees only published website content and active rental listings.
- Has no access to admin or tenant data.

### Tenant

- Receives a reminder using the configured channel.
- Has no application account in the MVP.

## 6. Core User Journeys

### Journey A — Edit and publish a website section

1. Admin signs in.
2. Admin opens **Website Content**.
3. Admin chooses an existing section such as Hero, Property Services, Featured Rentals, About, Contact, or Footer.
4. Admin edits fields allowed by that section's schema.
5. Admin saves a draft.
6. Admin previews the website with the draft.
7. Admin publishes the section.
8. The public website displays the new content.
9. Admin may roll back to the immediately preceding published version.

### Journey B — Add a tenant and monthly reminder

1. Admin opens **Tenants** and selects **Add Tenant**.
2. Admin enters tenant name, property/unit, contact details, and preferred channels.
3. Admin configures the day of month and local time.
4. The system shows the next calculated send time.
5. Admin selects an approved message template.
6. Admin enables the schedule.
7. The tenant appears in the upcoming-reminders list.

### Journey C — Automatic monthly reminder

1. The scheduler checks for due reminders every five minutes.
2. The system atomically claims each due reminder.
3. The system creates one delivery event per tenant and channel.
4. The system sends through the configured provider.
5. Provider results and callbacks update the delivery event.
6. The next monthly occurrence is calculated.
7. Failures appear on the dashboard for review.

### Journey D — Send an immediate reminder

1. Admin opens the tenant list or notification center.
2. Admin chooses one tenant, selected tenants, or all eligible active tenants.
3. Admin selects channels and a message template.
4. The system previews the rendered message and recipient counts.
5. The admin confirms the send.
6. The system creates per-recipient delivery events and sends them.
7. A result summary shows sent, failed, and skipped recipients.

## 7. Functional Requirements

### 7.1 Authentication and access

- **AUTH-01:** Admin pages, private page loads, queries, routes, and mutations require authentication and an active admin profile.
- **AUTH-02:** Tenant and reminder data must never be available to unauthenticated users.
- **AUTH-03:** All admin mutations must verify the admin session on the server.
- **AUTH-04:** Public signup is disabled; an authorized owner provisions and revokes admin accounts.
- **AUTH-05:** Production admin accounts must use MFA before launch.
- **AUTH-06:** Sessions must have idle and absolute expiry, support explicit logout, and require recent reauthentication for bulk sends and security changes.

### 7.2 Fixed-structure content management

- **CMS-01:** The system must expose a fixed list of website section keys defined in code.
- **CMS-02:** Admins may not add, remove, rename, reorder, hide, or duplicate sections unless a future approved schema explicitly allows it.
- **CMS-03:** Each section must have a dedicated field schema.
- **CMS-04:** The system must validate all content before draft save and publish.
- **CMS-05:** Rich content must be limited to safe formatting; arbitrary HTML and scripts are prohibited.
- **CMS-06:** Images must support upload, selection, replacement, removal where optional, and required alt text.
- **CMS-07:** Draft content must not appear publicly before publish.
- **CMS-08:** Admins must be able to preview drafts.
- **CMS-09:** Publishing must create a revision and audit entry.
- **CMS-10:** Admins must be able to restore the previous published revision.
- **CMS-11:** Public rendering must fall back to the last valid published revision.
- **CMS-12:** Anonymous public data access must use a projection that cannot return draft content, revisions, admin metadata, or unpublished media.

### 7.3 Public section coverage

The initial fixed registry is expected to cover:

- Header and navigation labels
- Hero/banner
- Rental search labels
- Property Services introduction
- Renovation card and detail content
- Handyman Services card and detail content
- Property Maintenance card and detail content
- Strata Services card and detail content
- Featured Rentals heading and listing collection
- About section
- Contact section
- Footer and legal text

The exact fixed registry is defined in Appendix A of the engineering spec and must be approved before content-management implementation begins. The four service details are fixed nested items inside the Property Services section, not independently addable sections.

### 7.4 Rental listing management

- **LIST-01:** Admins may create, edit, publish/unpublish, archive, and reorder rental listing records within the Featured Rentals section.
- **LIST-02:** Public pages display only active and published listings.
- **LIST-03:** A listing includes photos, monthly rent, address display, city/neighbourhood, bedroom count, bathroom count, size, availability, description, and optional pet policy.
- **LIST-04:** Listing images require alt text.
- **LIST-05:** Archiving a listing removes it from public display without deleting its history.

Adding or removing listing records does not count as adding or removing website sections.

### 7.5 Tenant management

- **TEN-01:** Admins may add, edit, search, filter, and archive tenants.
- **TEN-02:** A tenant record contains name, property/unit, email, phone, preferred channels, per-channel contact permission, timezone, active state, and internal notes.
- **TEN-03:** The system validates email and normalizes phone numbers to E.164.
- **TEN-04:** Archived or inactive tenants must not receive scheduled or bulk reminders.
- **TEN-05:** The tenant list must show schedule status, next reminder, and last delivery result.
- **TEN-06:** Permanent deletion is not available in the normal UI.
- **TEN-07:** A channel marked unconfirmed, opted out, invalid, bounced, complained, or suppressed must be excluded from automatic and bulk sends.
- **TEN-08:** Permanent provider feedback such as opt-out, complaint, hard bounce, or invalid destination must suppress that channel for future automatic and bulk sends.

### 7.6 Reminder schedules

- **SCH-01:** Each tenant may have one monthly rent reminder schedule in the MVP.
- **SCH-02:** A schedule contains rent due day, reminder day of month, local time, timezone, channels, template, and enabled state.
- **SCH-03:** The default timezone is America/Vancouver.
- **SCH-04:** The UI must display the next computed reminder time before save.
- **SCH-05:** A day of month that does not exist must resolve to that month's final day.
- **SCH-06:** Time conversion must handle daylight-saving changes.
- **SCH-07:** Disabling a schedule must prevent future automatic sends without deleting its history.
- **SCH-08:** A global pause control must suspend all automatic reminders.
- **SCH-09:** Automatic processing may begin within five minutes of the configured time.
- **SCH-10:** A reminder delayed by no more than 24 hours may still send once. An older occurrence must be recorded as expired and skipped without sending missed-month catch-up messages.
- **SCH-11:** Global pause, tenant active state, channel permission, and schedule enabled state must be rechecked immediately before provider submission.

### 7.7 Templates

- **TPL-01:** SMS and email use channel-specific templates.
- **TPL-02:** Templates support approved variables such as tenant name, property/unit, due date, and business contact details.
- **TPL-03:** A missing required variable must block the send and show a specific error.
- **TPL-04:** Admins must preview rendered templates before test or bulk sends.
- **TPL-05:** SMS previews should show estimated message segment count.

### 7.8 Manual and bulk send

- **SEND-01:** Admins may send to one, selected, or all eligible active tenants.
- **SEND-02:** Bulk send requires a preview and explicit confirmation.
- **SEND-03:** The confirmation must show total selected, eligible, skipped, SMS, and email counts.
- **SEND-04:** Every recipient and channel creates an independent delivery event.
- **SEND-05:** A missing contact method results in a skipped event, not a silent omission.
- **SEND-06:** The UI must prevent repeated submission while a send request is processing.
- **SEND-07:** A test send must use designated admin test contacts and must never accidentally send to the tenant.
- **SEND-08:** Bulk preview must freeze the exact tenant, channel, destination snapshot, and template revision set.
- **SEND-09:** Confirmation must operate on that frozen set or reject and require a new preview if relevant eligibility data changed.
- **SEND-10:** Batch creation and confirmation must be idempotent, including browser or network retries.
- **SEND-11:** Bulk confirmation must require a deliberate recipient-count acknowledgement.

### 7.9 Delivery tracking and retries

- **DEL-01:** Delivery events include scheduled, processing, queued, sent, delivered, failed, undelivered, and skipped states as applicable.
- **DEL-02:** Provider message IDs and timestamps must be stored.
- **DEL-03:** Provider callbacks must be signature-verified.
- **DEL-04:** Temporary provider failures may be retried a bounded number of times.
- **DEL-05:** Permanent validation or opt-out failures must not be retried automatically.
- **DEL-06:** Admins must be able to filter delivery history by tenant, channel, date, and status.
- **DEL-07:** Admins must be able to retry an eligible failed event manually.
- **DEL-08:** Automatic and manual sends must have separate source labels.
- **DEL-09:** If the application cannot determine whether a provider accepted a timed-out request, the event must enter an `unknown` state and must not be retried automatically.
- **DEL-10:** Events interrupted before a provider request may be safely recovered; events interrupted after a provider request begins require provider reconciliation or explicit admin action.
- **DEL-11:** Every cron run must independently drain durable eligible events, including events created by previous runs.
- **DEL-12:** Retry timing, claims, and attempts must survive process termination.

### 7.10 Duplicate prevention

- **IDEM-01:** A unique occurrence key must identify each scheduled tenant/channel/month occurrence.
- **IDEM-02:** Creating an event with an existing occurrence key must return the existing event rather than send again.
- **IDEM-03:** Concurrent worker runs must not claim the same event.
- **IDEM-04:** Provider idempotency keys should be used where available.
- **IDEM-05:** Provider-level exactly-once delivery must not be claimed for channels that do not support submission idempotency.

### 7.11 Dashboard and audit history

- **DASH-01:** Dashboard shows active tenants, reminders due in the next seven days, recent sends, failures requiring attention, and global pause status.
- **DASH-02:** The system records worker runs and sends a simple admin email alert when the scheduler is stale or provider failures repeatedly exceed the configured threshold.
- **AUD-01:** Audit history records admin login-relevant security events, content publishes/rollbacks, tenant changes, schedule changes, and manual sends.
- **AUD-02:** Audit entries include actor, action, target, timestamp, and safe metadata.
- **AUD-03:** Secrets and full message content should not be copied into general application logs.

## 8. Information Architecture

```text
/admin
  Dashboard
  Website Content
    Header
    Hero
    Property Services
    Featured Rentals
    About
    Contact
    Footer
  Tenants
    Tenant List
    Tenant Detail
    Reminder Schedule
  Notifications
    Send Now
    Templates
    Delivery History
  Settings
    Admin Profile
    Reminder Pause
    Test Contacts
```

Provider credentials and infrastructure secrets are deployment settings, not editable admin fields.

## 9. UX Requirements

- Admin navigation must use plain labels and avoid developer terminology.
- Every destructive or externally visible action needs a clear confirmation.
- Publish and bulk send are visually distinct from draft/save actions.
- The interface must always show whether content is Draft or Published.
- Reminder schedule forms must show the next occurrence in local time.
- Delivery failures must include a plain-language reason and next action.
- The admin must be usable on desktop and tablet; mobile support is required for urgent checks and simple edits, not dense bulk operations.
- All interactive controls must be keyboard accessible and have visible focus states.

## 10. Non-Functional Requirements

### Security

- Server-side authorization on all private reads and mutations.
- Row-level security or equivalent database policies.
- Secrets stored only in deployment/server environments.
- Provider webhook signature verification.
- Rate limiting for login and all send actions.
- No tenant PII in public page payloads, analytics, or general logs.

### Reliability

- Duplicate scheduled sends are prevented by database constraints.
- Failed reminders remain visible until dismissed or successfully retried.
- The reminder scheduler can be paused without deployment.
- Public website uses last-known-good published content.
- The production application runs on a paid, always-on Render Web Service; reminder correctness must not depend on process uptime or in-memory timers.
- Supabase Cron invokes the reminder runner every five minutes. The system must tolerate deployments, restarts, delayed invocations, overlapping invocations, and transient provider failures.
- Reminder occurrences and outbound work are persisted in Postgres before provider submission so a later Cron run can recover incomplete work.

### Performance

- No high-concurrency optimization is required.
- Admin list pages must remain responsive for at least 500 tenant records.
- Public pages should remain cacheable and should not require tenant-related queries.
- The expected public audience is concentrated in Greater Vancouver; global multi-region compute is not required.
- The Render application and Supabase project must both use Oregon to minimize user latency and application-to-database latency.
- Public rental and profile images must be resized, compressed, and delivered in modern formats where supported.

### Backup and recovery

- Supabase Free does not include automatic backups; the MVP requires a weekly encrypted logical export stored off-platform.
- Document and test restore steps before importing real tenants.
- While Supabase Free is used, the accepted recovery point may be up to seven days old.
- Content revisions and archived records must remain recoverable according to the agreed retention period.

## 11. Success Metrics

- Routine public content changes require no developer involvement.
- A content change can be drafted, previewed, and published in under five minutes.
- All active tenants have valid schedule and contact status visible in one list.
- At least 99% of due reminder occurrences are submitted to a provider within five minutes.
- Zero duplicate occurrence creation and zero automatic resubmission after an ambiguous provider response.
- Every failed or skipped reminder is visible with a reason.
- A manual send provides a complete per-recipient result.

Provider delivery itself is not guaranteed by the application; delivered/undelivered status depends on provider and carrier feedback.

## 12. MVP Acceptance Criteria

The MVP is accepted when:

1. An authenticated admin can edit, preview, publish, and roll back every fixed homepage section.
2. Section count and order cannot be changed through the admin.
3. Active rental listings can be managed without changing page structure.
4. Tenant records and one monthly schedule per tenant can be managed.
5. SMS and email reminders can be sent automatically and manually.
6. The same scheduled occurrence cannot produce duplicate sends.
7. Delivery history records success, failure, and skipped outcomes.
8. Automated sends can be globally paused.
9. Critical content and reminder flows pass browser tests.
10. A production dry run succeeds using admin-owned test contacts.
11. Anonymous requests cannot read section drafts, private media, tenant data, or delivery data.
12. A crashed worker resumes durable queued work without duplicating accepted provider submissions.
13. Bulk confirmation sends only to the frozen preview recipient set.

## 13. Deferred Features

- Multiple reminders per tenant per month.
- Follow-up reminders based on payment status.
- Tenant CSV import after initial onboarding, unless needed for launch.
- Multi-role admin permissions.
- Tenant self-service preference management.
- Two-way replies.
- Maintenance requests.
- Rent collection and accounting.
- External CRM or property-management integrations.

## 14. Assumptions Requiring Confirmation

- The admin manages one business and one public website.
- One monthly reminder per tenant is sufficient for MVP.
- The system does not know whether rent has been paid.
- SMS/email reminders are operational notices, not marketing campaigns.
- Ting Ting supplies and approves all templates, sender identities, tenant contact data, and permission/consent records.
- Featured Rentals are manually managed unless a listing data source is later specified.
