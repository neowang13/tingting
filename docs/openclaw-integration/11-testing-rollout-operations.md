# Testing, Rollout, and Operations Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Release principle

The integration ships in layers:

```text
read-only -> draft writes -> import preview -> confirmed commits
          -> schedule preparation -> schedule enable
          -> provider dry run -> live delivery
```

No phase depends on receiving third-party provider credentials early. Email and
SMS remain `mock` or `disabled`, and reminders remain force-paused until the
existing production launch gates pass.

## 2. Test layers

### Unit tests

Add tests for:

- service-token parsing, hashing, expiry, rotation, and constant-time compare;
- scope mapping for every route;
- canonical request hashing;
- idempotency-key state transitions;
- confirmation digest, expiry, ownership, and acknowledgement checks;
- rental external-reference matching;
- CSV/XLSX header normalization;
- tenant row normalization and matching;
- permission evidence rules;
- CSV formula escaping;
- redaction;
- OpenClaw CLI retry decisions;
- Skill intent extraction and confirmation policy;
- next occurrence using existing month/DST cases.

### Repository/database integration tests

Run against a disposable Supabase/PostgreSQL environment:

- RLS denial for every new table;
- service-role-only RPC execution;
- one idempotent create under concurrent requests;
- same key/different hash rejection;
- confirmation single-use under concurrency;
- stale rental publication rejection;
- atomic media/listing publish;
- external-reference uniqueness;
- import commit rollback when any matched tenant is stale;
- permission-event creation;
- disabled schedule creation during import;
- schedule enable recheck under locks;
- audit actor attribution;
- retention cleanup with legal hold.

### API contract tests

- Validate `openapi.yaml`.
- Exercise every method/path/status combination.
- Verify required scopes.
- Verify standard envelopes and stable error codes.
- Verify `Location`, `Retry-After`, request ID, and cursor behavior.
- Verify body and multipart limits.
- Verify production mutations reject memory backend.
- Verify feature flags fail closed.

### Browser tests

Extend Playwright coverage:

- Automation overview states and warnings;
- create a service account and show token once;
- rotate and deactivate;
- import list/detail with masked rows;
- automation audit filtering;
- source markers on rental and tenant details;
- AAL2/recent-auth requirement;
- mobile overflow and keyboard behavior;
- axe WCAG 2.2 AA checks.

### OpenClaw Skill tests

Use a fake Automation API server with recorded requests:

- English, Chinese, and mixed-language commands;
- exact JSON extraction;
- incomplete input clarification;
- entity ambiguity;
- prompt injection in every untrusted field type;
- confirmation must come from a new message;
- expired/stale confirmation recovery;
- timeout replay with the same key;
- `429 Retry-After`;
- PII/token redaction;
- refusal to use browser, arbitrary shell, external URL, or per-tenant Cron.

### Provider tests

No new provider behavior is introduced. Re-run existing mock and webhook tests
after schedule enable integration.

When credentials exist:

- test email goes only to saved admin test email;
- test SMS goes only to saved admin test phone;
- callback signatures and status mapping pass;
- no tenant destination is used in dry run.

## 3. Critical test scenarios

| ID | Scenario | Expected result |
|---|---|---|
| A01 | Replay rental create after timeout | One draft, same response |
| A02 | Reuse key with changed rent | `409 IDEMPOTENCY_KEY_REUSED` |
| A03 | Publish without intent | `403 CONFIRMATION_REQUIRED` |
| A04 | Draft changes after publish preview | `409 PREVIEW_STALE` |
| A05 | Two clients execute one intent | One succeeds; one gets consumed response/conflict |
| A06 | Token lacks publish scope | `403 AUTOMATION_SCOPE_REQUIRED` |
| A07 | Token revoked during request sequence | Next request fails |
| I01 | CSV formula/prompt injection | Stored as inert data or rejected |
| I02 | Email and phone match different tenants | Blocking conflict |
| I03 | `allowed` with no evidence | Invalid row |
| I04 | One stale tenant at commit | Entire import rolls back |
| I05 | Duplicate import file replay | Same job/result; no duplicate tenants |
| S01 | Save schedule with `isEnabled=true` | Rejected |
| S02 | Email unconfirmed | Enable blocked |
| S03 | Day 31 in February | Clamped correctly |
| S04 | DST spring-forward/fall-back | Existing Temporal behavior preserved |
| S05 | Schedule disabled after event claim | Provider submission cancelled/skipped |
| P01 | PII in API validation failure | Redacted response/log |
| P02 | Service token in exception | Redacted |
| F01 | Supabase unavailable | Safe `503`; no partial write |

## 4. Capacity tests

### Tenant import

- 100-row normal operating case.
- 1,000-row maximum case.
- 40-column maximum.
- 10 MB file boundary.
- 50% updates with optimistic-version checks.
- 10% invalid rows and 10% conflicts.

Targets:

- 100-row preview under 10 seconds;
- 100-row commit under 30 seconds;
- 1,000-row job completes within an agreed background/request budget;
- memory remains within the deployed Render plan;
- no N+1 tenant lookup: match in bulk.

If 1,000 rows cannot reliably finish inside the web request budget, move parsing
and preview to a durable background worker while preserving the job API and
database model.

### Concurrent automation

- 20 simultaneous read requests.
- 10 simultaneous draft mutations.
- concurrent replay of one key.
- concurrent execute of one confirmation.
- admin and automation editing the same tenant.

## 5. Observability

### Metrics

- requests by route, status, and service account;
- authentication and scope failures;
- rate-limit events;
- idempotency replays, conflicts, and stuck in-progress rows;
- confirmation created, expired, stale, and executed;
- import duration and row outcomes;
- automation job failures;
- permission grants;
- schedule enable/disable;
- redaction failures detected by tests/scanners.

### Logs

Structured fields:

```text
timestamp
requestId
serviceAccountId
routeName
method
status
durationMs
idempotencyReplay
confirmationId
jobId
safeErrorCode
resultCounts
```

Do not include request bodies for tenant, import, permission, or confirmation
routes.

### Alerts

- invalid-token burst;
- scope-violation burst;
- automation job failed/stuck over 15 minutes;
- confirmation execution failures;
- token expiring within seven days;
- active service account delegated to inactive admin;
- import raw file past retention deadline;
- reminder worker warnings already defined in existing operations.

## 6. Environments

### Local

- `DATA_BACKEND=memory`;
- provider mode `mock`;
- force pause `true`;
- synthetic tenants only;
- Automation API may run with a development-only token;
- tenant import commit endpoint returns
  `DURABLE_BACKEND_REQUIRED` unless an explicit test-only adapter is active.

### Integration/staging

- dedicated Supabase project;
- synthetic/anonymized data;
- provider mode `mock` or provider test credentials;
- force pause `true`;
- Automation API exposed only to the test OpenClaw agent.

### Production

- production Supabase;
- Render HTTPS;
- provider mode initially `disabled`;
- force pause `true`;
- one dedicated service account;
- smallest verified scope set;
- no real tenant import until backup restore test and privacy approval.

## 7. Rollout phases

### Phase 0: Spec approval

- Owner confirms the product is OpenClaw.
- Owner approves contact-permission evidence rules.
- Owner approves import retention.
- Developer confirms endpoint and migration design.

### Phase 1: Foundation, flags off

- Apply new schema.
- Deploy service-account auth, idempotency, confirmation, audit, and admin UI.
- Keep all automation feature flags off.
- Verify RLS and secret scanning.

### Phase 2: Read-only

- Activate one account with read scopes.
- Connect OpenClaw Skill.
- Test health, rental lookup, masked tenant search, schedule read, and job read.
- Observe for at least two business days.

### Phase 3: Draft operations

- Add `rentals:write`, `media:write`, and `schedules:write`.
- Create synthetic rental drafts and disabled schedules.
- Keep publishing/import/enable scopes absent.

### Phase 4: Confirmed rental publication

- Add `rentals:publish`.
- Publish and unpublish one test listing.
- Verify public projection, media promotion, stale-preview rejection, and audit.

### Phase 5: Tenant import

- Create and restore-test an encrypted database backup.
- Approve retention and file template.
- Add `tenants:import` without `permissions:grant`.
- Preview and commit a small synthetic batch.
- Preview real data.
- Owner reviews every conflict and permission column.
- Commit real data while all schedules remain disabled.

### Phase 6: Schedule enable

- Validate templates and next-run values.
- Add `schedules:enable`.
- Enable schedules while force pause remains active.
- Run worker and reconciliation in paused/mock mode.

### Phase 7: Permission grants

- Add `permissions:grant` only if the owner approves the evidence process.
- Test with synthetic evidence references.
- Review resulting audit and permission-event rows.

### Phase 8: Provider launch

Blocked until Supabase, Resend, Twilio, callbacks, domain, test contacts, and
owner approvals from the existing Operations runbook are complete.

1. Use mock.
2. Use provider test credentials and admin contacts.
3. Verify callbacks.
4. Enable Cron while global pause remains active.
5. Remove force pause.
6. Explicitly unpause in Admin.
7. Observe first real occurrence.

## 8. Rollback

### Application rollback

1. Set `AUTOMATION_MUTATIONS_ENABLED=false`.
2. Revoke the service-account token if needed.
3. Roll back application code.
4. Leave append-only schema in place.

### Data rollback

- Rentals: unpublish or correct through Admin using revisions.
- Tenant import: no generic automatic rollback after subsequent human edits.
  Use import audit and changed-field list to prepare a reviewed correction.
- Schedules: disable through Admin; preserve notification history.
- Permissions: opt-out/suppress immediately when appropriate; otherwise correct
  with a new permission event.

Do not delete audit, confirmation, import, or idempotency evidence during an
incident.

## 9. Operational commands and runbooks

Implementation must add documented procedures for:

- create service account;
- rotate token;
- emergency revoke;
- list failed/stuck automation jobs;
- delete expired raw imports;
- rerun retention;
- export automation audit for an incident;
- disable all mutations;
- verify reminder force/global pause;
- restore staging from encrypted backup with automation disabled.

## 10. Release gates

- Lint, typecheck, unit, integration, build, and Playwright pass.
- OpenAPI validation passes.
- New migration behavior tests pass on PostgreSQL 17.
- Anonymous RLS tests include every automation table.
- Secret/PII redaction scan passes.
- Prompt-injection Skill suite passes.
- Concurrency/idempotency tests pass.
- Admin accessibility checks pass.
- Backup restore test passes before real import.
- Owner signs off on import preview and schedule next-run report.
- Real provider launch gates from `docs/OPERATIONS.md` pass.

## 11. Definition of done

The integration is done when the owner can complete these three scenarios from
OpenClaw with production-safe controls:

1. create a rental draft, review it, confirm publication, and open the public
   listing;
2. upload a tenant file, resolve all row issues, confirm one atomic import, and
   verify audit history;
3. save a disabled monthly schedule, review next occurrence and eligibility,
   confirm enable, and observe the existing worker handle it without duplicate
   delivery.

