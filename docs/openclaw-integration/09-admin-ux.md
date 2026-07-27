# Admin Automation UX Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Goal

The existing Admin must give the owner visibility and control over OpenClaw
access without requiring database or command-line work. It must not expose
tenant PII or automation secrets unnecessarily.

## 2. Navigation

Add one sidebar item:

```text
Automation
```

Routes:

```text
/admin/automation
/admin/automation/service-accounts
/admin/automation/imports
/admin/automation/audit
```

The top-level page summarizes status and links to the three detailed areas.

## 3. Automation overview

Display:

- Automation API enabled/disabled.
- Mutation feature flag enabled/disabled.
- Active service-account count.
- Last successful automation request.
- Requests and failures in the last 24 hours.
- Active/expired confirmation-intent counts.
- Imports awaiting resolution or confirmation.
- Current data backend.
- Current email and SMS provider modes.
- Effective reminder force-pause/global-pause state.

Warnings:

```text
Production tenant import is unavailable while DATA_BACKEND=memory.
Automation mutations are disabled.
OpenClaw token expires in 7 days.
One tenant import has unresolved conflicts.
At least one provider mode is live while reminder force pause is off.
```

The page must never show raw tokens, full tenant contact data, imported rows, or
signed storage URLs.

## 3.1 Admin API

These are browser-admin endpoints, not OpenClaw endpoints. They use the existing
Supabase admin bearer/session authentication and same-origin protection.

```text
GET  /api/admin/automation/summary

GET  /api/admin/automation/service-accounts
POST /api/admin/automation/service-accounts
GET  /api/admin/automation/service-accounts/{id}
PATCH /api/admin/automation/service-accounts/{id}
POST /api/admin/automation/service-accounts/{id}/tokens
POST /api/admin/automation/service-accounts/{id}/tokens/{tokenId}/revoke

GET  /api/admin/automation/imports
GET  /api/admin/automation/imports/{id}
POST /api/admin/automation/imports/{id}/cancel
POST /api/admin/automation/imports/{id}/delete-source

GET  /api/admin/automation/audit
```

Creating, rotating, revoking, deactivating, changing scopes, or changing the
delegated admin requires recent AAL2 authentication and action rate limiting.
List endpoints use cursor pagination.

## 4. Service-account management

### List

Columns:

| Column | Content |
|---|---|
| Name | Human-readable account name |
| Delegated admin | Active admin identity |
| Status | Active, inactive, expired |
| Scopes | Compact list with expansion |
| Token prefix | Non-secret prefix only |
| Last used | Timestamp or Never |
| Expires | Timestamp or No expiry |
| Actions | Rotate, change scopes, deactivate |

### Create

Step 1: enter name, delegated admin, expiration, and scopes.

Step 2: review warnings. Sensitive scopes have explicit descriptions:

- `rentals:publish`: can make listings public or remove them;
- `tenants:import`: can add or update tenant PII;
- `permissions:grant`: can authorize future contact;
- `schedules:enable`: can activate recurring communication.

Step 3: require recent MFA authentication.

Step 4: create and display the token exactly once.

The UI provides:

- copy button;
- download-as-text button with a warning;
- checkbox: "I saved this token";
- no way to reveal it again.

### Rotate

1. Require recent MFA authentication.
2. Create a replacement token and display it once.
3. Allow a cutover period: immediate revocation, 1 hour, or 24 hours.
4. Show the old and new prefixes.
5. Revoke the old token automatically after the selected period.

### Deactivate

Require typed service-account name and recent MFA. Deactivation immediately
blocks new calls but preserves audit and job history.

## 5. Tenant import view

### List

Columns:

- filename;
- source system;
- status;
- created time;
- new/update/unchanged/duplicate/conflict/invalid counts;
- service account;
- raw-file expiration;
- action.

### Detail

Show:

- aggregate counts;
- source digest prefix;
- job progress and safe error;
- masked row outcomes;
- changed field names;
- row-level error/warning codes;
- confirmation status;
- committed time;
- audit link.

Full email/phone is hidden by default. A future audited reveal action is out of
scope for v1; the owner resolves source data outside this screen and uploads a
new file.

### Actions

- download a sanitized error report without full contact values;
- cancel a queued/preview import;
- delete an expired raw source file early;
- open related tenant records after commit.

Committing from the Admin UI is optional in v1 because the existing flow is
OpenClaw-driven. If implemented, it must use the same confirmation intent and
transaction as the Automation API.

## 6. Automation audit view

Filters:

- date range;
- service account;
- delegated admin;
- action category;
- target type;
- outcome;
- request ID.

Columns:

- timestamp;
- actor display;
- action;
- target;
- outcome;
- request ID prefix.

Detail includes safe metadata, field names changed, confirmation ID, and job ID.
It excludes full PII, request bodies, tokens, descriptions, message bodies,
signed URLs, and provider credentials.

## 7. Existing-screen changes

### Rentals

Show a small source marker:

```text
Created by OpenClaw Operations · 2026-07-26
```

### Tenants

Show:

- source system and external reference;
- last imported batch link;
- automation-created permission event link;
- schedule creator and last updater.

The normal tenant detail remains the place to correct a record manually.

### Dashboard

Add warnings only when action is required:

- failed/stuck import;
- automation token expiring within seven days;
- repeated Automation API authentication failures;
- active service account delegated to an inactive admin.

## 8. States

Every new page defines:

- loading skeleton;
- empty state with setup guidance;
- success confirmation;
- validation error;
- permission/MFA error;
- network retry state;
- stale resource conflict;
- feature-disabled state;
- inaccessible backend state;
- paginated results.

## 9. Accessibility

- Full keyboard navigation.
- Visible focus.
- WCAG 2.2 AA contrast.
- Status is not conveyed by color alone.
- Confirmation dialogs have descriptive headings and initial focus.
- Copy-token success is announced through an ARIA live region.
- Tables have captions and responsive card fallback.
- Touch targets are at least 44 by 44 CSS pixels.

## 10. Acceptance tests

- Only an authenticated AAL2 admin can create, rotate, or deactivate a service
  account.
- Raw token is shown once and never returned by subsequent reads.
- Token rotation honors the selected cutover window.
- Inactive service accounts fail the next API request.
- Imports list and detail mask contact values.
- Audit view attributes the OpenClaw service account and delegated admin.
- Feature-disabled and memory-backend warnings are visible and actionable.
- Every new route passes axe checks and desktop/mobile overflow tests.
