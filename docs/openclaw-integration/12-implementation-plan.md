# Implementation Plan

Status: Proposed  
Last updated: 2026-07-26

This plan turns the preceding specifications into backlog-ready work packages.
It does not authorize production deployment, real tenant import, provider
activation, or reminder unpause.

## 1. Dependency graph

```text
WP0 decisions
    |
    v
WP1 database foundation
    |
    +------------+
    v            v
WP2 API core   WP3 Admin control plane
    |
    +------------------+------------------+
    v                  v                  v
WP4 rentals       WP5 tenant import   WP6 schedules
    \                  |                  /
     +-----------------+-----------------+
                       v
                 WP7 OpenClaw Skill
                       |
                       v
                 WP8 QA and rollout
```

## 2. WP0: Confirm product decisions

Priority: P0  
Human estimate: 0.5 day

Decisions:

- confirm the platform is OpenClaw rather than another OpenCloud product;
- choose the authorized private messaging channel/sender;
- approve the 7-day raw-file and 30-day normalized-import retention;
- approve the contact-permission evidence rule;
- name the delegated production admin;
- approve the initial service-account scopes;
- confirm one monthly schedule and one shared email/SMS time is sufficient.

Exit criteria:

- decisions recorded;
- no unresolved interpretation changes the API or data model.

## 3. WP1: Database and storage foundation

Priority: P0  
Human estimate: 2–3 days  
Depends on: WP0

Create append-only migrations:

```text
supabase/migrations/202607260010_automation_identity.sql
supabase/migrations/202607260011_automation_imports.sql
supabase/migrations/202607260012_automation_transactions.sql
supabase/migrations/202607260013_automation_retention.sql
```

Deliver:

- service accounts and token rotation;
- idempotency keys;
- confirmation intents;
- automation jobs;
- import batches and rows;
- permission events;
- external references;
- audit service-account attribution;
- RLS and grants;
- private import bucket provisioning;
- transaction/RPC functions;
- retention integration.

Tests:

```text
tests/sql/automation-migration-behavior.sql
tests/integration/automation-rls.test.ts
tests/integration/automation-transactions.test.ts
```

Exit criteria:

- migrations apply to a clean PostgreSQL 17 database;
- concurrency and rollback behavior pass;
- anonymous/authenticated users cannot read new tables;
- no secret is stored in plaintext.

## 4. WP2: Automation API core

Priority: P0  
Human estimate: 2–3 days  
Depends on: WP1

Proposed files:

```text
src/features/automation/contracts.ts
src/features/automation/schemas.ts
src/features/automation/auth.ts
src/features/automation/scopes.ts
src/features/automation/idempotency.ts
src/features/automation/confirmations.ts
src/features/automation/redaction.ts
src/features/automation/rate-limit.ts
src/features/automation/jobs.ts
src/data/automation-repository.ts
src/app/api/automation/v1/[...segments]/route.ts
```

Deliver:

- feature flags;
- token authentication and rotation lookup;
- per-route scope enforcement;
- mutation backend guard;
- request ID handling;
- idempotency wrapper;
- confirmation preview/execute framework;
- cursor pagination;
- standard error mapping;
- structured safe logging;
- health/status read.

Tests:

```text
tests/unit/automation-auth.test.ts
tests/unit/automation-idempotency.test.ts
tests/unit/automation-confirmations.test.ts
tests/unit/automation-redaction.test.ts
tests/unit/automation-schemas.test.ts
tests/integration/automation-api.test.ts
```

Exit criteria:

- every route is disabled by default;
- each operation declares exactly one scope;
- OpenAPI contract tests pass;
- same-key replay and different-body conflict work under concurrency.

## 5. WP3: Admin control plane

Priority: P1  
Human estimate: 2 days  
Depends on: WP1, WP2

Proposed files:

```text
src/components/admin/automation-overview.tsx
src/components/admin/service-account-manager.tsx
src/components/admin/tenant-import-history.tsx
src/components/admin/automation-audit.tsx
src/features/automation/admin-service.ts
```

Update:

```text
src/components/admin/admin-shell.tsx
src/app/admin/[[...segments]]/page.tsx
src/app/globals.css
```

Deliver:

- overview and warnings;
- create/show-once/rotate/revoke service-account flows;
- import history/detail;
- audit filters;
- source/actor markers on rental and tenant pages;
- recent AAL2 authentication on sensitive token actions.

Exit criteria:

- token cannot be retrieved after creation;
- owner can revoke without deployment;
- PII is masked;
- desktop/mobile/accessibility tests pass.

## 6. WP4: Rental automation

Priority: P1  
Human estimate: 1.5–2 days  
Depends on: WP2

Deliver API operations:

```text
GET/POST /rentals
GET/PATCH /rentals/{id}
POST /media
POST /rentals/{id}/status-previews
POST /confirmations/{id}/execute
```

Reuse:

- `rentalInputSchema`;
- `validateImageFile`;
- media draft storage;
- `save_rental_listing`;
- `set_rental_status_with_media`;
- optimistic concurrency.

Required new behavior:

- external-reference matching;
- published-edit guard;
- publication confirmation;
- service-account audit context;
- idempotent media digest handling.

Exit criteria:

- draft flow works with mock/local synthetic data;
- publish/unpublish/archive pass in staging Supabase;
- stale preview and media transaction tests pass.

## 7. WP5: Tenant import

Priority: P1  
Human estimate: 3–4 days  
Depends on: WP1, WP2

Proposed files:

```text
src/features/automation/imports/file-parser.ts
src/features/automation/imports/header-map.ts
src/features/automation/imports/normalizer.ts
src/features/automation/imports/matcher.ts
src/features/automation/imports/preview-service.ts
src/features/automation/imports/report-export.ts
```

Choose a maintained XLSX parser after a dependency/security review. Configure
it for values-only parsing with explicit file, row, column, and cell limits.

Deliver:

- CSV/XLSX ingestion;
- header aliases;
- normalization;
- deterministic matching;
- row outcomes;
- preview job;
- commit confirmation;
- atomic commit RPC;
- permission evidence events;
- disabled schedule creation;
- sanitized error report.

Exit criteria:

- 100-row and 1,000-row fixtures pass;
- prompt/formula/macro fixtures are inert;
- one stale row rolls back the batch;
- no import can silently set permission to `allowed`;
- retention removes raw and normalized PII.

## 8. WP6: Reminder schedule automation

Priority: P1  
Human estimate: 1–1.5 days  
Depends on: WP2

Deliver:

```text
GET /tenants/{id}/schedule
PUT /tenants/{id}/schedule
POST /tenants/{id}/schedule-status-previews
```

Reuse:

- `scheduleInputSchema`;
- `nextOccurrence`;
- active template list;
- repository schedule save;
- durable worker and outbox.

Add:

- disabled-only save schema;
- next-run preview for disabled schedules;
- channel eligibility report;
- enable/disable confirmation;
- force/global pause and provider-mode summary.

Exit criteria:

- no ordinary API call enables a schedule;
- eligibility, month edge, and DST tests pass;
- existing reminder-worker behavior remains unchanged;
- OpenClaw does not become a scheduler.

## 9. WP7: OpenClaw Skill and CLI

Priority: P1  
Human estimate: 2–3 days  
Depends on: WP4, WP5, WP6

Proposed repository location:

```text
integrations/openclaw/skills/tingting-operations/
integrations/openclaw/package.json
integrations/openclaw/tests/
```

Deliver:

- `SKILL.md` and references;
- deterministic `tingtingctl`;
- JSON Schemas;
- fixed-host HTTP client;
- local validation;
- idempotent retry;
- output redaction;
- bilingual interaction examples;
- confirmation policy;
- prompt-injection fixtures;
- install/configuration guide.

OpenClaw host setup remains outside the application deployment and must use its
own secret/sandbox configuration.

Exit criteria:

- Skill passes fake-server tests;
- it can complete all three synthetic scenarios;
- tool policy blocks browser, arbitrary shell, and external network;
- no token or PII persists in the workspace after cleanup.

## 10. WP8: QA, documentation, and staged rollout

Priority: P0 release gate  
Human estimate: 2–3 days plus observation windows  
Depends on: WP1–WP7

Deliver:

- OpenAPI validation;
- full unit/integration/browser/Skill suite;
- capacity and concurrency results;
- secret and PII scan;
- admin runbooks;
- service-account provisioning procedure;
- token rotation/revocation exercise;
- staging backup/restore exercise;
- phase-by-phase rollout evidence;
- updated `docs/API.md`, `docs/OPERATIONS.md`, `README.md`, and
  `docs/QA-REPORT.md`.

Exit criteria:

- all gates in [11-testing-rollout-operations.md](./11-testing-rollout-operations.md)
  pass;
- owner approves import preview, permission behavior, and schedule report;
- production credentials remain optional until provider launch phase.

## 11. Suggested delivery slices

### Slice A: Safe foundation

WP0, WP1, WP2, service-account portion of WP3.

Owner result: OpenClaw can authenticate read-only, and access can be revoked.

### Slice B: Rental operations

WP4 plus relevant WP7 commands.

Owner result: create drafts and confirm publication.

### Slice C: Tenant import

WP5 plus import UI and Skill commands.

Owner result: preview and atomically import a reviewed file.

### Slice D: Schedule operations

WP6 plus schedule Skill commands.

Owner result: prepare and confirm monthly schedules while delivery remains
paused/mock.

### Slice E: Production readiness

WP8 and existing provider launch runbook.

Owner result: controlled transition from mock to real providers.

## 12. Estimated effort

For one experienced full-stack engineer:

```text
Core implementation and automated tests: approximately 14–20 working days
Owner decisions and review: approximately 1–2 working days
Staging observation and provider rollout: calendar time depends on account setup
```

The estimate excludes third-party account approval delays, production domain
verification, legal/privacy advice, and unexpected provider compliance work.

## 13. External prerequisites

Not required for Slices A–D:

- Resend account/key;
- Twilio account/sender;
- production domain;
- provider webhooks.

Required before real tenant import:

- production Supabase;
- owner-approved retention;
- tested encrypted backup and restore;
- approved tenant source file.

Required before real reminder delivery:

- Resend and Twilio credentials;
- verified sender/domain;
- callback secrets and URLs;
- admin test contacts;
- template and recipient approval;
- force/global pause launch sequence.

## 14. Final implementation acceptance

No work package is complete based only on UI appearance or a successful happy
path. It must include:

- schema and validation;
- authorization;
- idempotency;
- concurrency;
- error and retry behavior;
- audit;
- PII redaction;
- unit/integration/E2E tests;
- operations and rollback documentation.

