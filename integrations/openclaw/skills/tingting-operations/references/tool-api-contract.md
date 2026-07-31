# Tool and API contract

## Architecture

```text
Owner message
  -> tingting-operations Skill
  -> OpenClaw read/write/exec tools
  -> allowlisted tingtingctl
  -> Ting Ting Automation API v1
  -> repository and Supabase transaction
```

The model never calls the API directly. `tingtingctl` fixes the API origin,
injects the bearer token, creates request and idempotency UUIDs, validates JSON,
retries bounded transient failures with the same key, and redacts the response.

## OpenClaw tools

| Tool | Allowed use | Forbidden use |
|---|---|---|
| `read` | Skill references and owner-provided input in the dedicated workspace | secrets, OpenClaw state, unrelated workspaces |
| `write` | generated JSON request files under `TINGTING_INPUT_DIRECTORY`; overwrite them with `{}` afterward | Skill files, configuration, source code, credentials |
| `exec` | one `tingtingctl` process with a command listed below | shell operators, other binaries, arbitrary URLs, environment overrides |

Use fixed command arguments. Variable data belongs in the JSON input file,
except for an exact current shell-safe managed PDF reference passed with
`documents inspect-tenant --media-path`. Every mutation must also include an agent-generated
`--operation-id <uuid>`. This UUID becomes the API idempotency key.

## Command to API mapping

| CLI command | HTTP API | Required scope | Result |
|---|---|---|---|
| `health` | `GET /health` | active token | feature and backend readiness |
| `rentals list` | `GET /rentals` | `rentals:read` | masked/paged matches |
| `rentals get` | `GET /rentals/{id}` | `rentals:read` | one rental and version |
| `rentals upload-media` | `POST /media` | `media:write` | private draft asset |
| `rentals create-draft` | `POST /rentals` | `rentals:write` | draft only |
| `rentals update-draft` | `PATCH /rentals/{id}` | `rentals:write` | version-bound draft update |
| `rentals preview-status` | `POST /rentals/{id}/status-previews` | `rentals:publish` | confirmation intent |
| `tenants search` | `GET /tenants` | `tenants:read` | masked/paged matches |
| `tenants get` | `GET /tenants/{id}` | `tenants:read` | masked tenant and reminder status |
| `documents update-tenant` | local OCR → `GET/PATCH /tenants/{id}` | `tenants:read`, `tenants:write` | atomic row-matched contact update |
| `tenants upload` | preflight `GET /tenants`, then `POST /tenants` | `tenants:read`, `tenants:write` | created/existing/review-required |
| `tenants update` | `PATCH /tenants/{id}` | `tenants:write` | field-level update with masked result |
| `tenants preview-permission` | `POST /tenants/{id}/permission-previews` | `permissions:grant` | confirmation intent |
| `imports create` | `POST /tenant-imports` | `tenants:import` | preview job/batch |
| `imports get` | `GET /tenant-imports/{id}` | `tenants:import` | preview summary |
| `imports rows` | `GET /tenant-imports/{id}/rows` | `tenants:import` | masked blocking rows |
| `imports preview-commit` | `POST /tenant-imports/{id}/commit-previews` | `tenants:import` | confirmation intent |
| `confirmations execute` | `POST /confirmations/{id}/execute` | action-specific scope | exact confirmed effect |
| `jobs get` | `GET /jobs/{id}` | `jobs:read` | asynchronous job state |
| `schedules get` | `GET /tenants/{id}/schedule` | `schedules:read` | read-only derived reminder |

`tenants upload` is the safe conversational create path. `tenants update` is
the field-level edit path and never accepts contact permission status fields.
Changing an email address or phone number resets that channel to `unconfirmed`;
granting `allowed` remains a separate evidence-bound confirmation.

Exact high-use syntax:

```text
tingtingctl documents inspect-tenant --media-path media://inbound/<managed-name>.pdf
tingtingctl documents update-tenant --id <tenant-uuid> --operation-id <uuid> --media-path media://inbound/<managed-name>.pdf
tingtingctl tenants get --id <tenant-uuid>
tingtingctl tenants update --id <tenant-uuid> --operation-id <uuid> --input <request.json>
```

## API request behavior

The adapter supplies:

```http
Authorization: Bearer <service token>
X-Request-Id: <uuid>
Idempotency-Key: <uuid for mutation>
Content-Type: application/json or multipart/form-data
```

Never reuse an idempotency key for changed method, path, content type, or body.
The adapter reuses one key only when retrying the same transiently failed call.
If a process exits before the outcome is known, rerun the exact command with
the unchanged input file and the same operation ID.

Success envelope:

```json
{
  "success": true,
  "data": {},
  "requestId": "uuid"
}
```

Error envelope:

```json
{
  "success": false,
  "error": {
    "code": "STABLE_CODE",
    "message": "Safe explanation",
    "details": []
  },
  "requestId": "uuid"
}
```

Trust HTTP status and `error.code`; never infer success from prose.

## Confirmation state machine

```text
resolved
  -> preview created
  -> waiting for a new owner message
  -> exact confirmation executed
  -> completed

preview created
  -> expired or resource changed
  -> create a new preview
```

Never execute a confirmation in the same owner message that caused the preview.
Never reconstruct a digest or acknowledgement; copy the exact server values.

## Input file rules

- Generate names such as `request-<uuid>.json`.
- Never reuse an old request file without overwriting the entire object.
- Keep owner filenames inside JSON; never interpolate them into a shell command.
- Use only relative paths that resolve under `TINGTING_INPUT_DIRECTORY`.
- Overwrite generated JSON with `{}` after success or terminal failure.
- Retain original CSV/XLSX/media only according to the configured retention
  policy; never modify them.
