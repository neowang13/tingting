# Ting Ting Website and Admin — Full Project Development Prompt

You are the senior full-stack engineer responsible for completing the entire
Ting Ting Xu Real Estate website and administration system.

Work directly in:

```text
/Users/lazycat/Documents/ting ting
```

This is an existing codebase. Do not restart it, replace it with a new scaffold,
or discard working code. Audit the current implementation, preserve unrelated
changes, and complete the missing production functionality.

## 1. Mandatory source documents

Read these files completely before planning or editing:

```text
docs/Ting Ting Admin PRD.md
docs/Ting Ting Admin Engineering Spec.md
docs/API.md
docs/Homepage Development Prompt.md
plans/tingting-admin-implementation-plan.md
Ting Ting Website Replan.md
Ting Ting Xu Homepage Content.md
README.md
.env.example
render.yaml
```

Then inspect the entire current source tree, migrations, tests, dependencies,
and working-tree state.

Priority when requirements conflict:

1. `docs/Ting Ting Admin Engineering Spec.md`
2. `docs/Ting Ting Admin PRD.md`
3. `docs/API.md`
4. `docs/Homepage Development Prompt.md`
5. Implementation plan
6. Replan and homepage content documents
7. Existing demo implementation

The exhaustive schemas and fixed registry in Engineering Spec Section 6 are
contractual. Do not modify them merely to simplify implementation.

## 2. Product objective

Deliver one production-ready system containing:

1. A public Greater Vancouver real-estate website focused primarily on rentals
   and property services.
2. A private admin application for editing the content of every approved fixed
   website section.
3. Rental listing management.
4. Tenant and monthly rent-reminder management for approximately 100 tenants.
5. Safe manual, individual, selected, bulk, test, email, and SMS reminders.
6. Durable scheduling, audit history, delivery tracking, retries, suppression,
   and provider webhooks.

This is a low-traffic, single-business product. Prefer the smallest reliable
architecture. Do not introduce infrastructure intended for hypothetical scale.

## 3. Approved architecture

Use:

- Next.js 16 App Router
- React and TypeScript strict mode
- React Server Components by default
- Tailwind CSS and focused reusable UI components
- Zod for all external, form, API, CMS, and environment validation
- Supabase Postgres
- Supabase Auth
- Supabase Storage
- Supabase Cron
- Render paid Starter Web Service in Oregon
- Supabase `West US (Oregon)`
- Resend for transactional email
- Twilio for SMS
- Vitest and React Testing Library
- Playwright/browser automation for critical end-to-end flows

Default business timezone:

```text
America/Vancouver
```

Store timestamps as UTC and convert schedules/display values using the stored
IANA timezone.

Do not add:

- microservices;
- Kubernetes;
- Redis unless a proven production problem requires it;
- Kafka, RabbitMQ, or a separate queue;
- GraphQL;
- a second CMS;
- a custom authentication system;
- a generic page builder;
- event sourcing;
- a tenant portal;
- payment or rent-accounting functionality.

## 4. Use of design skills

Before designing or materially changing the Admin UI, use the most relevant
design skill(s) available to you, such as:

- design consultation;
- dashboard/admin design;
- design system;
- frontend design direction;
- accessibility;
- interface polish;
- responsive design review.

Read and follow the selected skill instructions before acting.

You may make independent visual and interaction decisions for the Admin
application, including layout, navigation treatment, typography, spacing,
tables, cards, empty states, forms, filters, drawers, modals, and responsive
behavior.

Design autonomy does not permit changing:

- the PRD’s information architecture;
- fixed section identities;
- roles or authorization boundaries;
- database invariants;
- reminder confirmation requirements;
- idempotency rules;
- audit requirements;
- recipient eligibility;
- provider safety policies;
- required fields or validation;
- the inability to add/remove/reorder website sections.

The Admin should feel calm, clear, professional, and approachable to a
non-technical business owner. Avoid developer terminology in user-facing text.

## 5. Required preliminary audit

Before implementation:

1. Inspect all files and determine what is complete, partial, mocked, or
   inconsistent with the PRD/Spec.
2. Run the current tests, typecheck, lint, build, and local app.
3. Verify the current public and admin routes.
4. Produce an internal gap list mapped to PRD requirements and Spec sections.
5. Create a phased implementation plan with one in-progress phase at a time.
6. Continue implementation without waiting for confirmation when decisions are
   already defined by the PRD/Spec.

Only stop for information that cannot be safely inferred, such as missing
production credentials, legally sensitive client copy, sender registration, or
an explicit client decision listed as unresolved.

Do not treat missing external credentials as a reason to stop coding. Implement
and test provider boundaries with mocks/test credentials, and clearly report
what needs production provisioning.

## 6. Current framework milestone

The repository already contains a framework implementation, including:

- Next.js public and admin route structure;
- fixed section schemas;
- demo content and memory adapter;
- public and admin HTTP contracts;
- Supabase schema migration;
- Supabase Auth boundary;
- Render blueprint;
- reminder scheduling utility;
- Resend/Twilio adapter shells;
- initial UI;
- basic unit and smoke tests.

Do not assume these are production-complete.

Important known boundary:

```text
DATA_BACKEND=supabase
```

currently causes the health check to fail intentionally because the production
Supabase repository and transactional reminder RPCs are not yet activated.

Completing and verifying the persistent Supabase path is a required outcome of
this project. The memory adapter must remain available only for local demo/test
usage and must be impossible to use accidentally in production.

## 7. Public website requirements

Implement the public homepage according to:

```text
docs/Homepage Development Prompt.md
```

The homepage uses exactly these fixed sections in order:

```text
header
hero
rental_search
property_services
featured_rentals
about
contact
footer
```

Rules:

- Published content only.
- Published active rentals only.
- Never query or serialize tenant/reminder/admin data publicly.
- Draft content must never appear before publish.
- Do not add/remove/reorder sections.
- Do not use raw HTML or `dangerouslySetInnerHTML`.
- Do not use AI-generated portraits or substitute people.
- Resolve approved media from Supabase Storage.
- Implement last-known-good revision fallback.
- Revalidate affected paths after publishing.
- Optimize images and prevent layout shift.

Also implement:

- `/rentals`;
- rental search query parameters;
- rental detail route if required by the existing listing CTA;
- service detail presentation using the nested fixed service content;
- public contact form;
- correct empty states;
- metadata, canonical URL, Open Graph basics, sitemap, and robots behavior;
- semantic landmarks and WCAG 2.2 AA fundamentals.

Public traffic is primarily Greater Vancouver. Global multi-region application
compute is not required.

## 8. Fixed CMS requirements

Implement a production content-management experience for all eight fixed
sections.

Requirements:

- Dedicated field-based editor for each schema.
- Do not leave JSON textarea editing as the production experience.
- Fixed structural identities are displayed but not structurally editable.
- Zod validation on client for useful feedback and again on the server.
- Draft save with optimistic concurrency.
- Draft status and last-updated information.
- Draft preview.
- Publish confirmation.
- Immutable revision creation.
- Audit event creation.
- Rollback to an approved prior revision.
- Last-known-good public fallback.
- Media upload, selection, alt text, replacement, preview, promotion, and safe
  archive behavior.
- Publishing and rollback must be transactional.
- Unknown fields must fail validation.
- Arbitrary HTML/scripts must be rejected.

No admin API may insert, delete, rename, reorder, duplicate, or hide the fixed
section rows.

## 9. Media requirements

Use Supabase Storage with private draft objects and immutable published paths.

Implement:

- JPEG, PNG, WebP, and AVIF only;
- detected file-signature validation;
- browser MIME headers are not trusted;
- file size and image-dimension limits;
- required alt text;
- signed draft preview URLs;
- published public URLs;
- prevention of deleting/archiving assets referenced by published revisions;
- responsive image rendering;
- safe filename/path generation;
- metadata records in `media_assets`.

SVG upload is out of scope for MVP.

## 10. Rental listing management

Implement complete Admin rental management:

- list, search, filter, and status views;
- create;
- edit;
- optimistic concurrency;
- image upload/selection;
- image ordering;
- exactly one cover image before publish;
- draft;
- publish;
- unpublish;
- archive;
- immutable slug after first publish;
- revision snapshots for publish/unpublish/archive;
- reorder homepage listings;
- preview;
- published-only public projection.

Rental fields and constraints must match the Engineering Spec.

Adding/removing rental records is allowed and does not change the fixed website
section structure.

## 11. Tenant management

Implement complete Admin tenant management:

- list;
- search/filter;
- masked contact display in ordinary lists;
- create;
- edit;
- archive;
- active/inactive status;
- property/unit;
- email;
- normalized E.164 phone;
- preferred channels;
- per-channel contact permission/status;
- permission notes/source/timestamp;
- internal notes;
- timezone;
- optimistic concurrency;
- validation and clear error messages.

Rules:

- Archived tenants are inactive.
- At least one valid contact method is required before enabling a schedule.
- Email reminders require valid email and `allowed` email status.
- SMS reminders require valid E.164 phone and `allowed` SMS status.
- Opted-out, suppressed, bounced, complained, or invalid channels are
  ineligible.
- Tenant PII must never enter public payloads or general logs.

## 12. Reminder schedule management

Each tenant may have one monthly schedule in MVP.

Implement:

- rent due day;
- reminder day of month;
- local time;
- IANA timezone;
- selected channel(s);
- matching template(s);
- enabled state;
- next-send preview;
- recalculation after relevant changes;
- pause behavior;
- last-processed information.

Rules:

- Days 29–31 clamp to the final calendar day of shorter months.
- Vancouver DST behavior follows the Engineering Spec.
- A nonexistent spring-forward time moves to the next valid instant that day.
- A repeated fall-back time uses the earlier occurrence.
- The next occurrence must be strictly after the reference instant.
- Automated delivery may begin within five minutes of the configured time.

Use a timezone-aware library/Temporal implementation. Never manually calculate
UTC offsets.

## 13. Templates

Implement email and SMS template management:

- list;
- create;
- edit;
- activate/deactivate;
- immutable revision on every save;
- preview with safe sample data;
- variable validation;
- channel-specific validation;
- subject required for email;
- subject prohibited/ignored for SMS;
- SMS segment estimate.

Allowed variables only:

```text
{{tenant_name}}
{{property}}
{{unit}}
{{due_date}}
{{business_name}}
{{business_phone}}
{{business_email}}
```

Reject unknown variables and missing required render values.

## 14. Manual and bulk reminder flow

Implement the exact safe flow:

1. Select one, selected, or all active tenants.
2. Select requested channels/templates.
3. Create a server-side preview.
4. Freeze recipient/channel/destination/template revision/eligibility data.
5. Display selected, eligible, skipped, per-channel counts, reasons, samples,
   and SMS segment estimates.
6. Require the admin to acknowledge the exact eligible-recipient count.
7. Confirm using a unique idempotency key.
8. Revalidate frozen eligibility versions.
9. Reject and require re-preview if relevant data changed.
10. Create one durable notification event per eligible tenant/channel.

Rules:

- Never trust client-provided recipients or counts as the source of truth.
- Batch creation is idempotent by `request_id`.
- Batch confirmation is idempotent.
- A batch expires after 30 minutes.
- Confirmation occurs once.
- “Send all” never overrides permission, preference, or suppression.
- UI must protect against accidental duplicate submission.
- Bulk sends and security changes require recent authentication.
- Apply the Spec’s rate limits.

## 15. Durable scheduler and outbox

Supabase Cron invokes every five minutes:

```text
POST /api/internal/reminders/run
Authorization: Bearer <REMINDER_CRON_SECRET>
```

Implement the full transactional behavior from Engineering Spec Section 8.

Required properties:

- Cron secret validation.
- Worker-run audit row.
- Global and force-pause handling.
- Select due schedules with `FOR UPDATE SKIP LOCKED`.
- Maximum 200 schedules per materialization pass.
- Canonical `occurrence_local_date`.
- One event per eligible channel.
- `INSERT ... ON CONFLICT DO NOTHING`.
- Database uniqueness for scheduled occurrences.
- Snapshot destination, template revision, render context, content, and due
  date before delivery.
- Visible skipped/expired outcomes.
- 24-hour late-send grace period.
- No catch-up burst after a long pause.
- Atomic `next_run_at` advancement.
- Durable outbox draining independent from occurrence creation.
- Claim token and 10-minute claim expiry.
- Maximum 200 events per run.
- Provider concurrency maximum 10.
- Invocation time budget maximum 45 seconds.
- Recover claims that expired before provider request.
- Mark ambiguous post-request outcomes `unknown`.
- Never automatically retry ambiguous SMS submissions.
- Maximum three safe automatic attempts.
- Persist exponential backoff.
- No correctness dependency on Render process memory.

Use Postgres functions/RPCs where necessary to make multi-row operations atomic.
Do not attempt to simulate transactions with unrelated client calls.

## 16. Provider integration

### Resend

- One recipient per event.
- Idempotency key derived from occurrence key.
- Verified sender/domain.
- Store provider message ID.
- Verify webhook signatures.
- Idempotent callback processing.
- Map delivered, bounced, complained, failed, and equivalent states.
- Permanent feedback updates future channel eligibility/suppression.

### Twilio

- One recipient per event.
- Store Message SID.
- Record `provider_request_started_at` immediately before the provider call.
- Use at-most-once application submission after ambiguity.
- Configure event-specific status callback.
- Verify the exact callback URL and Twilio signature with the official SDK.
- Idempotently map provider states without assuming all carriers report
  `delivered`.
- Opt-out/invalid feedback updates future channel eligibility.

Never log full destinations, message bodies, provider credentials, or raw
webhook payloads.

No real tenant message may be sent during development or QA. Use mocks, provider
test credentials, or explicit admin-owned test destinations only.

## 17. Status transitions and retry

Enforce only the approved transitions from Engineering Spec Section 12.

Terminal states:

```text
delivered
undelivered
failed
skipped
unknown
expired
cancelled
```

Callbacks may never move terminal events backward.

Retrying a failed eligible event creates a new event with:

```text
source = retry
retry_of_event_id = original event
```

Never rewrite the original history or return the original event to processing.

## 18. Authentication and authorization

Implement:

- Supabase Auth email/password;
- public signup disabled;
- owner-provisioned admins;
- verified email;
- active `admin_profiles` check;
- MFA required before production launch;
- 30-minute idle session limit;
- 12-hour absolute session limit;
- explicit logout;
- recent authentication for bulk sends/security changes;
- Next.js 16 `proxy.ts`;
- server authorization on every private page, read, route, and mutation.

Browser clients must never receive the service-role key.

Do not rely on route hiding, middleware alone, or client state for
authorization.

## 19. Database and RLS

Bring the Supabase schema fully in line with Engineering Spec Section 5.

Requirements:

- append-only migrations after launch;
- all required constraints;
- foreign keys;
- composite schedule/tenant integrity;
- partial unique indexes;
- occurrence uniqueness;
- provider message uniqueness;
- outbox indexes;
- published public projections;
- RLS enabled on private tables;
- no anonymous access to draft/private data;
- validated server/service-role mutations;
- integration tests proving anonymous users cannot read:
  - draft content;
  - section revisions;
  - unpublished media;
  - tenant data;
  - schedules;
  - notification events;
  - audit data.

Review the existing migration rather than assuming it is complete or safe.

## 20. Admin information architecture

Required pages:

```text
/admin
/admin/login
/admin/content
/admin/content/[sectionKey]
/admin/rentals
/admin/rentals/[id]
/admin/tenants
/admin/tenants/[id]
/admin/notifications/send
/admin/notifications/templates
/admin/notifications/history
/admin/settings
```

The dashboard must show:

- active tenant count;
- enabled schedule count;
- due in next seven days;
- failed/undelivered in last 30 days;
- latest worker run;
- global pause state;
- outbox backlog;
- oldest eligible event age;
- scheduler/provider warnings.

Admin UX requirements:

- plain-language labels;
- visible Draft/Published state;
- obvious distinction between save and publish;
- confirmation for destructive or externally visible actions;
- schedule next-run shown in local time;
- failures include plain-language reason and next action;
- accessible keyboard navigation;
- visible focus;
- desktop and tablet support;
- mobile support for urgent review, pause, retry, and simple edits;
- dense bulk operations may remain desktop/tablet oriented.

## 21. API contract

Preserve or deliberately version the API documented in:

```text
docs/API.md
```

All responses use a stable success/error envelope with a request ID.

Requirements:

- thin route handlers;
- shared Zod validation;
- service layer for business rules;
- repository layer for data access;
- centralized operational errors;
- 409 conflicts for stale optimistic-concurrency updates;
- no PII in ordinary list responses unless required;
- consistent pagination/filter semantics;
- CSRF-safe same-site mutations or equivalent protection;
- shared-store/platform rate limiting, not per-process memory counters.

Do not silently change an existing endpoint used by the UI. Update the contract
document and tests for intentional changes.

## 22. Contact form

Implement the public contact flow completely:

- required validation;
- honeypot;
- rate limiting;
- server-side validation;
- safe transactional email delivery;
- schema-owned success/error messages;
- preserve form data on failure;
- no infrastructure details exposed publicly;
- safe structured logs;
- no contact messages written to general logs.

If persistent enquiry storage is added, document it and apply appropriate
retention and access controls.

## 23. Observability

Implement:

- structured PII-safe logs;
- request/job IDs;
- worker-run history;
- delivery dashboard;
- scheduler stale warning after 15 minutes while unpaused;
- backlog warning beyond the 24-hour grace threshold;
- repeated provider-failure warning;
- daily reconciliation query comparing due occurrences and events;
- admin email alerts using the existing email provider.

Do not add a separate observability platform unless the current system proves
insufficient.

## 24. Backup, retention, and operations

Supabase Free has no automatic backups.

Before real tenant import:

- document weekly encrypted logical export;
- store exports off-platform;
- document restore;
- perform a non-production restore test;
- document the accepted recovery point and recovery time;
- keep reminders force-paused during restore/dry-run work.

Implement/document the Spec’s initial retention proposal:

- content revisions: indefinite unless material;
- tenant data: client-approved operational/legal period;
- notification metadata: 24 months;
- rendered content and destination: redact after 90 days;
- audit events: 24 months.

Provide export, correction, deletion, and legal-hold procedures.

## 25. Security requirements

At minimum:

- server-side authorization;
- RLS/private grants;
- strict validation;
- safe storage upload checks;
- CSP appropriate to used domains;
- secure headers;
- webhook verification;
- rate limits;
- contact and send abuse protection;
- masked destinations;
- secrets only in environment/managed secret storage;
- no secrets in source, database content fields, or browser bundle;
- no arbitrary HTML;
- audit externally visible changes and sends.

Do not claim a formal security certification.

## 26. Testing requirements

Implement all tests required by Engineering Spec Section 16 and Acceptance Test
Matrix Section 20.

At minimum:

### Unit

- all fixed content schemas and boundaries;
- template variable validation/rendering;
- normalization/masking;
- next occurrence;
- short months/leap years;
- Vancouver DST;
- provider status mapping;
- status transition validation;
- eligibility rules.

### Integration

- publishing transaction/revision/audit;
- rollback;
- stale update conflict;
- public/private RLS boundaries;
- rental publish constraints;
- tenant eligibility;
- schedule row locking;
- duplicate occurrence no-op;
- concurrent Cron runners;
- outbox recovery;
- claim expiry before/after provider request;
- persistent retry;
- global pause;
- grace-period expiration;
- disabled tenant/schedule after claim;
- batch idempotency/frozen recipients;
- retry lineage;
- webhook signatures/idempotency;
- suppression from permanent feedback.

### Browser/E2E

1. Login/logout.
2. Edit, preview, publish, and roll back Hero.
3. Add/publish/unpublish/archive rental.
4. Add tenant and enable schedule.
5. Preview/confirm manual send with mocked providers.
6. Pause/resume reminders.
7. Filter failure history and retry.
8. Public homepage desktop/mobile.
9. Rental search.
10. Service detail interactions.
11. Contact success/failure.

### Capacity

Materialize and dispatch 100 tenants across both channels at one timestamp with
mocked realistic provider latency. Verify bounded concurrency, durable backlog
continuation, invocation budget, and five-minute submission target.

If the target cannot be met, replace only the outbox drainer with the smallest
appropriate managed worker. Do not redesign the full application prematurely.

## 27. Browser and accessibility QA

After implementation, use browser QA against the running production build.

Check:

- console errors;
- failed network requests;
- desktop, tablet, and mobile layouts;
- 375px, 768px, 1024px, and 1440px;
- horizontal overflow;
- focus order;
- keyboard-only operation;
- form validation;
- modals/drawers;
- admin tables/forms;
- public navigation;
- responsive images;
- critical workflows.

Run automated accessibility checks, then manually verify keyboard focus and
interaction behavior. A clean automated scan is necessary but not proof of full
accessibility.

If no committed visual baseline exists, report visual regression as
inconclusive instead of claiming a pixel-perfect match.

## 28. Deployment target

Production target:

```text
Render paid Starter Web Service — Oregon
Supabase — West US (Oregon)
```

Render:

```text
Build: pnpm install --frozen-lockfile && pnpm build
Start: pnpm start -- -H 0.0.0.0 -p $PORT
Health: /api/health
```

Requirements:

- paid always-on service;
- no keep-alive workaround;
- ephemeral local filesystem;
- all persistent data/media in Supabase;
- secrets in Render/Supabase managed environment;
- reminders force-paused during first deploy;
- custom domain after verification.

Do not deploy to production, enable real schedules, import real tenant data, or
send real messages without explicit authorization and the completed launch
checklist.

## 29. Required quality gates

Before declaring completion, run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also:

- apply migrations to a non-production Supabase project;
- run integration tests against that project;
- start the production build locally;
- run HTTP smoke tests;
- run browser/E2E tests;
- test backup and restore;
- test mocked provider failures and ambiguity;
- confirm `DATA_BACKEND=supabase` returns a healthy application;
- confirm production cannot start with memory persistence;
- confirm no real provider send occurs in tests.

Do not weaken tests, validation, database constraints, authentication, or error
handling merely to make a gate pass.

## 30. Implementation sequence

Use this sequence unless the code audit proves a dependency requires adjustment:

1. Baseline audit and test run.
2. Database migration correction and generated types.
3. Repository/service separation and Supabase persistence.
4. Auth/session/RLS completion.
5. Public content/media repository and homepage completion.
6. Fixed-schema CMS editors, preview, publish, revisions, rollback.
7. Rental management.
8. Tenant and schedule management.
9. Templates and rendering.
10. Manual preview/batch confirmation.
11. Cron materializer and durable outbox.
12. Resend/Twilio submission and webhook handling.
13. Dashboard, history, pause, retry, reconciliation, and alerts.
14. Security, rate limits, retention, backup, and runbooks.
15. Full unit/integration/E2E/capacity/browser QA.
16. Production readiness report.

Keep one phase in progress at a time. After each phase, run proportional tests
and fix regressions before moving on.

## 31. Definition of done

The project is complete only when:

1. Every in-scope PRD requirement is implemented or explicitly documented as an
   unresolved client decision.
2. The public site renders validated published content and published rentals
   only.
3. Admin users can safely manage all fixed content, rentals, tenants,
   schedules, templates, sends, history, pause, and retries.
4. No admin can structurally add/remove/reorder website sections.
5. Supabase is the active durable production backend.
6. Publishing, batch confirmation, scheduling, and claims use correct
   transactional boundaries.
7. Duplicate scheduled occurrences are prevented by database constraints.
8. Ambiguous SMS submission is never automatically retried.
9. Provider callbacks are verified and idempotent.
10. RLS/private data tests pass.
11. Backup and restore are documented and tested before real data import.
12. All required test/build/browser gates pass.
13. The Render production configuration is ready, but no production deployment
    or real send occurs without authorization.
14. No known critical or high-severity defect remains.

## 32. Final delivery report

Provide a concise but complete report containing:

- outcome;
- architecture implemented;
- files/modules changed;
- migrations/RPCs added;
- API changes;
- public pages completed;
- Admin pages and design system completed;
- provider and Cron behavior;
- auth/RLS/security status;
- tests and exact results;
- browser/accessibility QA;
- backup/restore result;
- environment variables still required;
- unresolved client decisions;
- production launch checklist;
- known limitations and recommended next actions.

Use clickable absolute file links in the report.

Do not report the project as production-ready if the Supabase persistence path,
transactional reminder engine, provider verification, RLS tests, or backup
restore exercise is incomplete.

Do not stop at a plan, mockup, API skeleton, or local memory demo. Implement,
verify, and hand off the complete system.
