# Automation API Specification

Status: Proposed  
Version: `v1`  
Base path: `/api/automation/v1`  
Last updated: 2026-07-26

The Automation API is a private, server-to-server API for the
`tingting-operations` OpenClaw Skill. It reuses the existing application
response envelope and repository rules but has separate authentication,
authorization, rate limiting, idempotency, and confirmation behavior.

The machine-readable route and schema summary is in
[openapi.yaml](./openapi.yaml).

## 1. Authentication

Every request requires:

```http
Authorization: Bearer <automation-service-token>
```

Production tokens are generated once, shown once, stored hashed, and supplied
to OpenClaw through its secret configuration. The server records only a token
prefix and an HMAC-SHA-256 digest using a server-side pepper. The token contains
at least 32 random bytes.

The API must reject:

- missing or malformed tokens with `401 AUTOMATION_UNAUTHORIZED`;
- expired, revoked, or inactive service accounts with
  `401 AUTOMATION_TOKEN_INACTIVE`;
- missing action scopes with `403 AUTOMATION_SCOPE_REQUIRED`;
- use over plain HTTP outside local development;
- production mutation requests when `DATA_BACKEND` is not `supabase`.

## 2. Standard headers

| Header | Requirement | Meaning |
|---|---|---|
| `Authorization` | Required | Service-account bearer token |
| `X-Request-Id` | Optional | Caller-generated UUID; server creates one if absent |
| `Idempotency-Key` | Required for mutations | UUID unique to one logical mutation |
| `Content-Type` | Required | `application/json` or `multipart/form-data` |

Never use an idempotency key for two different method/path/body combinations.

## 3. Response envelope

Success:

```json
{
  "success": true,
  "data": {},
  "requestId": "0ee1114c-c1bd-4497-bf76-4ddd9a21cf6d"
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request is invalid.",
    "details": [
      {
        "path": ["monthlyRentCents"],
        "message": "Expected a positive integer"
      }
    ]
  },
  "requestId": "0ee1114c-c1bd-4497-bf76-4ddd9a21cf6d"
}
```

Full destinations, provider credentials, database errors, stack traces, and
message bodies must never appear in general error responses.

## 4. Scopes

| Scope | Permitted operations |
|---|---|
| `rentals:read` | Search and read rental records |
| `rentals:write` | Create and edit rental drafts |
| `rentals:publish` | Preview and execute publish, unpublish, or archive |
| `media:write` | Upload validated draft media |
| `tenants:read` | Search tenants and read one tenant with masked destinations |
| `tenants:write` | Create and edit non-permission tenant fields |
| `tenants:import` | Upload, preview, and commit tenant imports |
| `permissions:grant` | Confirm transitions to `allowed` with evidence |
| `schedules:read` | Read a tenant schedule and next occurrence |
| `schedules:write` | Save a disabled schedule |
| `schedules:enable` | Preview and execute schedule enable/disable |
| `jobs:read` | Read import and automation job status |

The first production service account should omit `permissions:grant` until the
owner has approved the permission evidence workflow.

## 5. Idempotency

Every mutation passes through `withAutomationIdempotency`.

1. Hash method, normalized path, content type, and canonical body/file digest.
2. Insert `(serviceAccountId, idempotencyKey)` with `in_progress`.
3. On conflict:
   - same request hash + completed: return the stored status and safe result;
   - same request hash + in progress: return `409 REQUEST_IN_PROGRESS`;
   - different request hash: return `409 IDEMPOTENCY_KEY_REUSED`.
4. Perform the operation.
5. Store response status, resource type/ID/version, and a redacted response.
6. Retain completed keys for 30 days and failed keys for 7 days.

Network retry policy:

- Retry `408`, `429`, `502`, `503`, and `504` with the same key.
- Do not automatically retry other `4xx` responses.
- Honor `Retry-After`.

## 6. Confirmation intents

The following actions require a confirmation intent:

- rental `publish`, `unpublish`, or `archive`;
- tenant-import commit;
- a contact permission transition to `allowed`;
- tenant archive;
- schedule enable or disable;
- any future real manual send.

### Create a confirmation preview

Resource-specific preview endpoints return:

```json
{
  "confirmation": {
    "id": "uuid",
    "action": "rental.publish",
    "digest": "sha256:...",
    "expiresAt": "2026-07-26T20:30:00Z",
    "summary": {
      "title": "Publish Bright Downtown One Bedroom",
      "effects": ["The listing becomes publicly visible"],
      "warnings": []
    },
    "requiredAcknowledgements": ["public_visibility"]
  }
}
```

The intent captures the service account, action, resource ID, expected resource
version, request digest, preview summary, warning codes, and expiration. Default
expiration is 15 minutes.

### Execute a confirmation

```http
POST /api/automation/v1/confirmations/{confirmationId}/execute
Idempotency-Key: <uuid>
Content-Type: application/json

{
  "digest": "sha256:...",
  "acknowledged": ["public_visibility"]
}
```

Execution must:

1. lock the intent;
2. ensure it is unexpired and unused;
3. ensure the calling service account created it;
4. re-read and lock affected resources;
5. compare versions and eligibility;
6. consume the intent and mutate in one transaction.

Return `409 PREVIEW_STALE` if the target, input, permission, template, or global
state changed.

## 7. Health

### Health

```http
GET /health
Authentication: any active automation service token
```

Returns Automation API feature flags, durable-backend readiness, provider mode,
effective reminder pause, current API version, and server time. It never
returns secrets, database identifiers, tenant counts, or full configuration.

## 8. Rental endpoints

### List rentals

```http
GET /rentals?status=draft&q=burnaby&limit=50&cursor=<opaque>
Scope: rentals:read
```

Results include resource versions and media IDs. Default limit is 50; maximum
is 100. Cursor pagination orders by `(updatedAt DESC, id DESC)`.

### Create a draft

```http
POST /rentals
Scope: rentals:write
Idempotency-Key: <uuid>
```

Body matches the existing `rentalInputSchema`, plus optional:

```json
{
  "sourceSystem": "openclaw",
  "externalReference": "listing-2026-0042"
}
```

The server always creates `status=draft`. A client-supplied status is rejected.
Return `201` with `Location`.

### Read or update a rental

```http
GET   /rentals/{id}
PATCH /rentals/{id}
```

`PATCH` body:

```json
{
  "rental": {},
  "expectedVersion": "2026-07-26T20:00:00Z"
}
```

Only drafts and unpublished listings may be edited through automation in v1.
Published updates require unpublish confirmation first.

### Preview a status change

```http
POST /rentals/{id}/status-previews
Scope: rentals:publish

{
  "action": "publish",
  "expectedVersion": "2026-07-26T20:00:00Z"
}
```

Before `publish`, require:

- all required rental fields valid;
- 1–20 images;
- exactly one cover image;
- all media present, draft/published, and not archived;
- non-empty alt text at most 160 characters;
- slug conflict check;
- an immutable target resource version.

Execute through `/confirmations/{id}/execute`.

## 9. Media endpoint

```http
POST /media
Scope: media:write
Content-Type: multipart/form-data
Idempotency-Key: <uuid>

file=<binary>
altText=<1..160 characters>
sourceDigest=<optional sha256>
```

Reuse `validateImageFile`:

- JPEG, PNG, WebP, or AVIF by detected signature;
- 1 byte through 8 MB;
- both dimensions between 64 and 8,000 pixels;
- SVG excluded;
- private draft storage and signed preview URL.

Return `201` with the `MediaAsset`.

## 10. Tenant endpoints

### Search tenants

```http
GET /tenants?q=jane&property=main&limit=50&cursor=<opaque>
Scope: tenants:read
```

List results include masked email/phone, preferred channels, permission states,
active state, schedule state, and `updatedAt`.

### Read, create, or update

```http
GET   /tenants/{id}
POST  /tenants
PATCH /tenants/{id}
```

Automation-created tenants default to:

- `emailContactStatus=unconfirmed`;
- `smsContactStatus=unconfirmed`;
- `isActive=true`;
- no enabled schedule.

`PATCH` may preserve an existing `allowed` status but cannot create a transition
to `allowed`. That transition uses a permission preview with
`permissions:grant`.

### Permission preview

```http
POST /tenants/{id}/permission-previews
Scope: permissions:grant

{
  "channel": "email",
  "status": "allowed",
  "source": "signed-lease",
  "reason": "Operational rent reminder consent",
  "evidenceReference": "lease-2026-0042#communications",
  "permissionRecordedAt": "2026-07-01T18:00:00Z",
  "expectedVersion": "2026-07-26T20:00:00Z"
}
```

The API stores an evidence reference, not the underlying document. Opt-out,
invalid, bounce, complaint, and suppression transitions do not require approval
and must not be delayed.

## 11. Tenant import endpoints

### Create import

```http
POST /tenant-imports
Scope: tenants:import
Content-Type: multipart/form-data
Idempotency-Key: <uuid>

file=<CSV or XLSX>
mode=create_or_update
sourceSystem=<short identifier>
```

Limits: 10 MB, 1,000 data rows, one worksheet, no macros. Return `202` with a
job ID. CSV must be UTF-8; XLSX is parsed as values only.

### Read job and rows

```http
GET /tenant-imports/{id}
GET /tenant-imports/{id}/rows?outcome=invalid&limit=100&cursor=<opaque>
```

### Create commit preview

```http
POST /tenant-imports/{id}/commit-previews
Scope: tenants:import

{
  "expectedSourceDigest": "sha256:...",
  "expectedPreviewVersion": "2026-07-26T20:00:00Z"
}
```

The preview shows exact new/update/unchanged/conflict/invalid counts. A batch
with any `invalid` or unresolved `conflict` rows cannot create a commit intent.

Execute the returned intent through `/confirmations/{id}/execute`.

## 12. Reminder schedule endpoints

### Read

```http
GET /tenants/{tenantId}/schedule
Scope: schedules:read
```

### Save disabled schedule

```http
PUT /tenants/{tenantId}/schedule
Scope: schedules:write

{
  "schedule": {
    "rentDueDay": 1,
    "dayOfMonth": 28,
    "localTime": "09:00",
    "timezone": "America/Vancouver",
    "channels": ["email", "sms"],
    "emailTemplateId": "uuid",
    "smsTemplateId": "uuid",
    "isEnabled": false
  },
  "expectedVersion": null
}
```

This endpoint rejects `isEnabled=true`.

### Preview enable/disable

```http
POST /tenants/{tenantId}/schedule-status-previews
Scope: schedules:enable

{
  "enabled": true,
  "expectedVersion": "2026-07-26T20:00:00Z"
}
```

The preview returns:

- next occurrence in UTC and local time;
- selected channels and template names;
- effective global/force pause;
- per-channel eligibility;
- warnings about provider mode.

Execute through `/confirmations/{id}/execute`.

## 13. Job endpoint

```http
GET /jobs/{id}
Scope: jobs:read
```

Job states:

```text
queued -> running -> preview_ready -> awaiting_confirmation
                         |                    |
                         v                    v
                       failed       committing -> completed
```

The response includes safe progress counts and error codes, not raw tenant rows.

## 14. Rate limits

| Action | Limit |
|---|---|
| Read routes | 60/minute/service account |
| Draft writes | 30/minute/service account |
| Media uploads | 30/10 minutes/service account |
| Import creation | 5/hour/service account |
| Confirmation previews | 20/10 minutes/service account |
| Confirmation execution | 10/10 minutes/service account |
| Permission grants | 5/hour/service account |

`429` responses include `Retry-After`.

## 15. Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `INVALID_JSON` | Malformed JSON |
| 400 | `INVALID_MULTIPART` | Missing or invalid file form |
| 401 | `AUTOMATION_UNAUTHORIZED` | Token missing or invalid |
| 401 | `AUTOMATION_TOKEN_INACTIVE` | Token expired or revoked |
| 403 | `AUTOMATION_SCOPE_REQUIRED` | Required scope absent |
| 403 | `CONFIRMATION_REQUIRED` | Sensitive action used without preview |
| 409 | `VERSION_CONFLICT` | Optimistic-concurrency conflict |
| 409 | `IDEMPOTENCY_KEY_REUSED` | Same key used for different request |
| 409 | `REQUEST_IN_PROGRESS` | Matching operation still running |
| 409 | `PREVIEW_STALE` | Preview no longer matches current state |
| 409 | `CONFIRMATION_CONSUMED` | Intent already used |
| 409 | `IMPORT_HAS_ERRORS` | Invalid/unresolved rows remain |
| 410 | `CONFIRMATION_EXPIRED` | Intent passed expiration |
| 422 | `VALIDATION_ERROR` | Semantically invalid fields |
| 422 | `CHANNEL_INELIGIBLE` | Selected channel cannot be enabled |
| 429 | `RATE_LIMITED` | Action limit exceeded |
| 503 | `DURABLE_BACKEND_REQUIRED` | Mutation requires Supabase |
| 503 | `AUTOMATION_DISABLED` | Feature kill switch active |

## 16. Feature flags

```text
AUTOMATION_API_ENABLED=false
AUTOMATION_MUTATIONS_ENABLED=false
AUTOMATION_CONFIRMATIONS_ENABLED=false
AUTOMATION_TENANT_IMPORT_ENABLED=false
```

All default to `false` in production until the relevant rollout gate passes.
