# OpenClaw Operations Integration Specs

Status: Implemented locally; production enablement gated  
Last updated: 2026-07-26  
Owner: Ting Ting Real Estate

This directory is the implementation contract for allowing OpenClaw to manage
rental listings, import tenant records, and configure monthly rent-reminder
schedules.

The specs assume the product named by the owner is
[OpenClaw](https://docs.openclaw.ai/). If a different product called
"OpenCloud" is selected, the Automation API, database, workflows, and safety
rules remain unchanged; only the agent adapter described in
[05-openclaw-skill.md](./05-openclaw-skill.md) is replaced.

## Non-negotiable decisions

1. OpenClaw is an operator, not the system of record.
2. OpenClaw never receives the Supabase service-role key and never writes the
   database directly.
3. The website's durable reminder worker remains the only component that sends
   scheduled email and SMS.
4. Creating and editing drafts may be automated. Publishing a rental, committing
   a tenant import, granting contact permission, or enabling a schedule requires
   an explicit confirmation step.
5. Real tenant data cannot be imported while `DATA_BACKEND=memory`.
6. Real delivery remains disabled until Supabase, Resend, Twilio, the production
   domain, provider callbacks, and owner approvals are complete.

## Spec index

| Document | Purpose |
|---|---|
| [01-product-scope.md](./01-product-scope.md) | Product goals, actors, use cases, scope, and success criteria |
| [02-system-architecture.md](./02-system-architecture.md) | Component boundaries, trust boundaries, and runtime flows |
| [03-automation-api.md](./03-automation-api.md) | REST contract, authentication, idempotency, confirmation, and errors |
| [openapi.yaml](./openapi.yaml) | Machine-readable implemented Automation API v1 surface |
| [04-data-model-migrations.md](./04-data-model-migrations.md) | New tables, columns, indexes, RLS, retention, and migration order |
| [05-openclaw-skill.md](./05-openclaw-skill.md) | OpenClaw Skill behavior, tools, prompts, permissions, and output schemas |
| [06-rental-listing-workflow.md](./06-rental-listing-workflow.md) | Rental draft, media upload, preview, publish, unpublish, and archive flow |
| [07-tenant-import-workflow.md](./07-tenant-import-workflow.md) | CSV/XLSX import, normalization, deduplication, preview, and commit flow |
| [08-reminder-schedule-workflow.md](./08-reminder-schedule-workflow.md) | Schedule configuration, permission checks, next-run preview, and enable flow |
| [09-admin-ux.md](./09-admin-ux.md) | Admin service-account, import history, audit, status, and accessibility UX |
| [10-security-privacy-audit.md](./10-security-privacy-audit.md) | Service-account security, PII controls, audit requirements, and threat model |
| [11-testing-rollout-operations.md](./11-testing-rollout-operations.md) | Test matrix, observability, staged rollout, rollback, and incident handling |
| [12-implementation-plan.md](./12-implementation-plan.md) | Backlog-ready work packages, dependencies, acceptance gates, and file map |
| [13-full-development-prompt.md](./13-full-development-prompt.md) | Copy-ready master prompt for a coding agent to implement and verify the full scope |
| [14-dependency-decisions.md](./14-dependency-decisions.md) | XLSX parser and dependency-risk decisions |

## Reading order

- Product or business review: 01, 06, 07, 08.
- Backend implementation: 02, 03, 04, 10.
- OpenClaw implementation: 03, 05, 06, 07, 08.
- QA and release: 09, 10, 11, 12.

## Existing project contracts

These specs extend, and do not replace:

- [Ting Ting Admin PRD](../Ting%20Ting%20Admin%20PRD.md)
- [Ting Ting Admin Engineering Spec](../Ting%20Ting%20Admin%20Engineering%20Spec.md)
- [HTTP API Contract](../API.md)
- [Operations and Launch Runbook](../OPERATIONS.md)
