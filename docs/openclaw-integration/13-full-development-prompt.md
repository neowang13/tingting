# Full OpenClaw Integration Development Prompt

Copy everything below the divider into the development agent.

---

You are the senior full-stack and security engineer responsible for implementing
the complete Ting Ting OpenClaw operations integration in the existing
repository.

Repository root:

```text
/Users/lazycat/Documents/ting ting
```

Your assignment is to implement the entire approved development scope:

1. OpenClaw-assisted rental listing creation and publication.
2. OpenClaw-assisted tenant import and update.
3. OpenClaw-assisted monthly email/SMS reminder schedule configuration.
4. The supporting Automation API, database migrations, service-account
   security, idempotency, confirmation system, Admin controls, tests, runbooks,
   and OpenClaw Skill/CLI.

Do not stop after producing another plan. Inspect the repository, implement the
feature, verify it, and report only what actually works.

## 1. Read the specifications first

Before editing code, read these files completely in order:

```text
docs/openclaw-integration/README.md
docs/openclaw-integration/01-product-scope.md
docs/openclaw-integration/02-system-architecture.md
docs/openclaw-integration/03-automation-api.md
docs/openclaw-integration/openapi.yaml
docs/openclaw-integration/04-data-model-migrations.md
docs/openclaw-integration/05-openclaw-skill.md
docs/openclaw-integration/06-rental-listing-workflow.md
docs/openclaw-integration/07-tenant-import-workflow.md
docs/openclaw-integration/08-reminder-schedule-workflow.md
docs/openclaw-integration/09-admin-ux.md
docs/openclaw-integration/10-security-privacy-audit.md
docs/openclaw-integration/11-testing-rollout-operations.md
docs/openclaw-integration/12-implementation-plan.md
```

Also read the existing product contracts and relevant implementation:

```text
README.md
docs/Full Project Development Prompt.md
docs/Ting Ting Admin PRD.md
docs/Ting Ting Admin Engineering Spec.md
docs/API.md
docs/OPERATIONS.md

src/lib/contracts.ts
src/lib/schemas.ts
src/lib/auth.ts
src/lib/api.ts
src/lib/rate-limit.ts
src/data/repository.ts
src/data/store.ts
src/data/supabase-repository.ts
src/features/content/media-service.ts
src/features/content/image-validation.ts
src/features/reminders/scheduler.ts
src/features/tenants/contact-utils.ts
src/app/api/admin/[...segments]/route.ts
src/app/admin/[[...segments]]/page.tsx
src/components/admin/admin-shell.tsx
src/components/admin/rental-editor.tsx
src/components/admin/tenant-editor.tsx

supabase/migrations/
tests/
```

Treat the numbered OpenClaw specifications as the implementation contract. If
a genuine contradiction exists, preserve the safer behavior, document the
decision, and keep the public contract backward-compatible.

## 2. Current project constraints

The project is a Next.js 16, React 19, TypeScript, Zod, Supabase application
with:

- a public real-estate website;
- fixed-schema website content administration;
- rental and media management;
- tenant records and one monthly reminder schedule per tenant;
- a durable database outbox and five-minute reminder worker;
- Resend/Twilio adapters plus mock/disabled provider modes;
- optimistic concurrency and audit events;
- a memory repository for local demo and Supabase repository for durable use.

The existing implementation is working. Preserve it. Do not replace the
architecture, redesign unrelated pages, or weaken current tests and safety
boundaries.

## 3. Non-negotiable rules

1. OpenClaw is an operator, not the system of record.
2. OpenClaw must never receive the Supabase service-role key, provider
   credentials, admin session token, or reminder Cron secret.
3. OpenClaw must never write Supabase directly.
4. Production integration uses a dedicated versioned Automation API, not
   browser-click automation.
5. The existing website reminder worker remains the only component that sends
   scheduled email and SMS.
6. Do not create one OpenClaw Cron job per tenant.
7. Draft creation and disabled schedule saves may be automated.
8. Rental publication/unpublication/archive, tenant-import commit, permission
   grants, tenant archive, and schedule enable/disable require a version-bound,
   expiring, single-use confirmation intent.
9. A confirmation must be based on an immutable preview and must fail if the
   relevant resource changes.
10. Every mutation requires a persistent idempotency key. Replaying the same
    logical request must not duplicate data or side effects.
11. Missing tenant permission is `unconfirmed`, never `allowed`.
12. A permission transition to `allowed` requires an approved evidence
    reference, source, timestamp, separate scope, and confirmation.
13. Tenant imports are previewed before commit and committed atomically. One
    stale or invalid row prevents the whole commit.
14. Imported schedules are always disabled.
15. Both selected channels share one monthly reminder date/time in v1.
16. Full tenant destinations, notes, tokens, request bodies, message bodies,
    signed URLs, and provider secrets must not enter general logs or model
    output.
17. Production mutations fail closed unless `DATA_BACKEND=supabase`.
18. All new production automation feature flags default to `false`.
19. Preserve existing reminder force/global pause behavior.
20. Never claim an external integration test passed if credentials or services
    are unavailable.

## 4. Third-party services are not available yet

Supabase production, Render production, Resend, Twilio, the final domain, and
provider callback credentials may not exist.

Therefore:

- do not ask the owner to create accounts before implementing the code;
- do not deploy;
- do not import real tenants;
- do not send a real email or SMS;
- do not set provider mode to `live`;
- do not remove `REMINDERS_FORCE_PAUSED=true`;
- do not unpause reminders;
- do not fabricate secrets;
- use clear placeholder values in examples;
- keep local/demo delivery in `mock`;
- keep production defaults `disabled` and force-paused;
- implement and test external adapters through existing mocks and contract
  boundaries;
- mark truly credential-dependent tests as skipped with an explicit reason.

Missing third-party credentials are not a blocker for completing the
application code, schemas, migrations, tests, OpenClaw package, and runbooks.

## 5. Required implementation

### A. Database foundation

Implement the append-only migrations defined in
`04-data-model-migrations.md`, including:

- automation service accounts;
- separately rotatable/revocable service-account tokens;
- scopes and delegated admin;
- persistent idempotency records;
- confirmation intents;
- automation jobs;
- tenant import batches and rows;
- tenant contact permission events;
- rental and tenant external references;
- automation actor/request attribution in audit events;
- private import storage provisioning;
- service-role-only transaction/RPC functions;
- retention cleanup;
- RLS and grants.

Do not overload an existing admin UUID field with a service-account UUID.
Continue using the delegated admin for legacy `created_by/updated_by` foreign
keys while recording the actual service account separately in audit.

### B. Automation API core

Implement:

```text
/api/automation/v1
```

The route and schema surface must match:

```text
docs/openclaw-integration/03-automation-api.md
docs/openclaw-integration/openapi.yaml
```

Required infrastructure:

- opaque bearer-token authentication;
- HMAC-SHA-256 token digest with server-side pepper;
- token expiration, rotation, revocation, and constant-time comparison;
- exact per-route scope checks;
- durable backend guard;
- request IDs;
- strict Zod validation;
- persistent idempotency;
- confirmation preview and execution;
- action rate limits;
- cursor pagination;
- stable success/error envelopes;
- safe structured logging;
- kill switches.

Do not accept client-supplied SQL, table names, function names, API hosts, or
remote file URLs.

### C. Rental automation

Implement:

- rental search/read;
- create/update draft;
- external-reference matching;
- validated media upload;
- idempotent media digest reuse;
- publication requirement validation;
- publish/unpublish/archive previews;
- confirmed status execution;
- public/admin URL results;
- service-account audit.

Reuse the existing rental schemas, media validation, private draft bucket,
media promotion, transactional status RPCs, and optimistic concurrency.

Automation must not directly edit a published listing. Require a confirmed
unpublish first.

### D. Tenant import

Implement CSV and XLSX values-only import with:

- 10 MB, 1,000-row, 40-column limits;
- explicit canonical headers and versioned aliases;
- email/phone/text/timezone normalization;
- inert formula/macro/hyperlink handling;
- deterministic matching;
- within-file duplicate detection;
- `new`, `update`, `unchanged`, `duplicate`, `conflict`, and `invalid`
  outcomes;
- masked row previews;
- persistent import jobs;
- source and row digests;
- stale-version checks;
- permission evidence rules;
- exact aggregate preview;
- confirmation intent;
- one atomic commit transaction;
- disabled schedule creation;
- sanitized CSV error export with formula-injection escaping;
- raw and normalized data retention.

Do not auto-update a tenant from fuzzy name matching. Do not let blank import
values erase existing non-blank data in v1.

Choose a maintained XLSX parser only after checking its security and maintenance
state. Record the dependency decision.

### E. Reminder schedule automation

Implement:

- tenant schedule read;
- disabled-only schedule save;
- next-run preview for disabled schedules;
- active template/channel checks;
- email and SMS eligibility report;
- global pause, force pause, and provider-mode summary;
- enable/disable preview;
- confirmed enable/disable;
- current-time recalculation at confirmation execution;
- service-account audit.

Reuse the existing Temporal-based `nextOccurrence` behavior, including short
months and DST.

Do not implement direct sending or a second scheduler.

### F. Admin Automation UX

Add the `Automation` Admin area specified in `09-admin-ux.md`:

- overview and warnings;
- service-account list/create/show-once/rotate/revoke/deactivate;
- scope and delegated-admin management;
- import history and masked detail;
- automation audit filters;
- source/actor markers on relevant rental and tenant pages;
- recent AAL2 authentication for sensitive token operations;
- loading, empty, error, conflict, success, disabled, and unavailable states;
- keyboard, mobile, and WCAG 2.2 AA behavior.

The raw token may be returned and displayed exactly once.

### G. OpenClaw Skill and CLI

Implement under:

```text
integrations/openclaw/skills/tingting-operations/
```

Include:

- `SKILL.md`;
- referenced field/permission/schedule/error guides;
- deterministic `tingtingctl`;
- fixed-host HTTP client;
- JSON Schemas;
- local validation;
- automatic request/idempotency UUIDs;
- bounded safe retry with the same key;
- output redaction;
- bilingual examples;
- entity-resolution rules;
- prompt-injection handling;
- confirmation from a new owner message only;
- fake-server tests;
- installation/configuration guide.

The CLI must not accept arbitrary URLs or shell fragments. Use structured argv
and JSON files/stdin. Do not interpolate business data into a shell command.

The production agent policy must deny browser control, general network, general
shell, database clients, provider tools, and arbitrary Cron creation.

## 6. Recommended code organization

Follow the implementation map in `12-implementation-plan.md`. Prefer:

```text
src/features/automation/
  contracts.ts
  schemas.ts
  auth.ts
  scopes.ts
  idempotency.ts
  confirmations.ts
  redaction.ts
  rate-limit.ts
  jobs.ts
  imports/

src/data/automation-repository.ts
src/app/api/automation/v1/[...segments]/route.ts

src/components/admin/
  automation-overview.tsx
  service-account-manager.tsx
  tenant-import-history.tsx
  automation-audit.tsx

integrations/openclaw/
```

Reuse current services rather than duplicating rental, media, tenant, schedule,
notification, or provider logic.

Keep files focused. Do not create one catch-all automation module or one
catch-all tool.

## 7. Implementation order

Work in this order:

1. Inspect the worktree and preserve unrelated existing changes.
2. Produce a concise execution checklist mapped to the numbered specs.
3. Implement database/RLS/transaction foundation.
4. Implement Automation API auth, scopes, idempotency, confirmation, errors,
   redaction, and feature flags.
5. Implement Admin service-account controls.
6. Implement rental automation.
7. Implement tenant import.
8. Implement schedule automation.
9. Implement Admin import/audit pages.
10. Implement OpenClaw Skill and CLI.
11. Update API, operations, environment, and setup documentation.
12. Run all tests and fix failures.
13. Perform final security/PII/secret review.

Verify each logical phase before starting the next. Do not postpone all tests
until the end.

## 8. Testing requirements

Implement every relevant test defined in:

```text
docs/openclaw-integration/11-testing-rollout-operations.md
```

At minimum, add:

- service-token unit tests;
- scope tests for every route;
- idempotency replay/concurrency tests;
- confirmation ownership, expiry, stale state, and single-use tests;
- RLS integration tests for every new table;
- migration transaction tests;
- rental media/publication tests;
- CSV/XLSX normalization/matching/import tests;
- formula/macro/prompt-injection fixtures;
- atomic rollback on one stale tenant;
- permission evidence tests;
- disabled schedule and eligibility tests;
- existing short-month/DST coverage;
- log/output redaction tests;
- Admin Playwright and accessibility tests;
- OpenAPI validation;
- OpenClaw fake-server and prompt-injection tests;
- 100-row and 1,000-row import capacity tests.

Required project verification:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Also run the PostgreSQL migration behavior suite when the required local test
database is available.

If a test cannot run because an external credential or service is absent:

1. keep the safe mock/contract test;
2. mark only the genuinely external test skipped;
3. state the exact missing prerequisite;
4. never report it as passed.

## 9. Security review before completion

Before declaring completion, verify:

- no secrets committed;
- no example uses a live-format credential;
- no full tenant contact information appears in ordinary logs, list responses,
  error messages, snapshots, or fixtures;
- token creation is show-once;
- token revocation works without deployment;
- all production flags default off;
- all new private tables have RLS;
- anonymous and ordinary authenticated reads fail;
- high-impact actions cannot bypass confirmation;
- idempotency survives process restart because it is stored durably;
- confirmation execution rechecks current state under lock;
- imports cannot partially commit;
- prompt-injection data cannot choose tools, host, action, scope, or
  confirmation;
- reminder delivery remains force-paused/mock or disabled.

## 10. Documentation updates

Update these as implementation changes land:

```text
README.md
.env.example
docs/API.md
docs/OPERATIONS.md
docs/QA-REPORT.md
docs/PRD-COMPLETION.md
docs/openclaw-integration/openapi.yaml
```

Add:

- local Automation API setup;
- token provisioning and rotation;
- emergency revoke;
- import troubleshooting;
- feature-flag rollout;
- OpenClaw Skill installation;
- explicit list of third-party production values still missing.

Keep proposed and implemented behavior clearly distinguished.

## 11. Stop conditions

Stop and request owner direction only if:

- the product is not OpenClaw and the alternative has materially different
  integration constraints;
- implementing the specification would require destructive production data
  changes;
- a legal/privacy choice is required to process real tenant data;
- existing uncommitted user changes directly conflict with required files and
  cannot be safely preserved;
- a security requirement cannot be met with the current architecture.

Missing third-party credentials, no production deployment, or unavailable real
tenant data are expected conditions. They are not reasons to stop local
implementation.

## 12. Definition of done

The assignment is complete only when:

1. the complete Automation API and migrations exist;
2. service accounts, scopes, token rotation/revocation, idempotency, and
   confirmations work;
3. rental draft through confirmed publication works;
4. tenant file through reviewed atomic import works;
5. disabled schedule through confirmed enable works;
6. Admin can control and audit automation;
7. the OpenClaw Skill/CLI exists and passes fake-server tests;
8. private data is masked and audited;
9. all available verification commands pass;
10. external/provider-dependent skips are explicitly documented;
11. no deployment, real import, real delivery, unpause, or credential creation
    occurred without owner authorization.

## 13. Final report format

Return:

```text
STATUS: DONE | DONE_WITH_CONCERNS | BLOCKED

Implemented
- grouped by database, API, Admin, rental, tenant import, schedules, OpenClaw

Key decisions
- only decisions not already fixed by the specs

Verification
- exact commands and pass/fail counts
- skipped tests and exact reasons

Safety state
- data backend
- provider mode
- force/global pause
- feature flags
- confirmation/idempotency status

Files
- important new and modified files

Still required from the owner
- third-party accounts/credentials
- production hostname/domain
- retention/privacy approvals
- provider dry-run and launch approval
```

Do not describe unimplemented work as complete. Do not hide skipped tests or
warnings.

---

