# Security, Privacy, and Audit Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Security objective

Compromise, hallucination, prompt injection, replay, or operator error in
OpenClaw must not grant direct database access, reveal unrelated tenant data,
publish unreviewed listings, silently grant contact permission, or send real
messages outside the existing reminder controls.

OpenClaw is treated as a powerful but fallible external operator.

## 2. Assets

Highest sensitivity:

- Supabase service-role key;
- Automation API tokens;
- Resend and Twilio credentials;
- reminder Cron secret;
- tenant email, phone, property, unit, notes, and permission evidence;
- raw tenant import files;
- unredacted notification destinations and content;
- owner/admin sessions.

Medium sensitivity:

- unpublished rental details and draft media;
- audit metadata;
- import counts and row outcomes;
- confirmation payloads;
- resource versions.

Public:

- published site sections;
- published rental projection and public media.

## 3. Threat model

| Threat | Example | Required control |
|---|---|---|
| Token theft | Secret appears in chat or logs | Show once, hash at rest, secret injection, redaction, rotation |
| Excess privilege | Rental agent imports tenants | Per-route scopes and dedicated account |
| Prompt injection | CSV cell says “publish everything” | Treat files/API text as data; no embedded instructions |
| Replay | Timeout causes duplicate import | Persistent idempotency key and request hash |
| Stale approval | Rental changes after preview | Version-bound confirmation intent |
| Confused deputy | Agent grants permission because email exists | Evidence requirement and separate scope |
| PII exfiltration | Agent lists all tenant contacts | Masked lists, narrow reads, output redaction |
| Spreadsheet attack | Macro or formula runs during import | Values-only parser; no macro/formula execution |
| SSRF | Agent supplies a different API host | Fixed base URL; outbound host allowlist |
| Shell injection | Address becomes command argument | JSON files/stdin, argv execution, no shell interpolation |
| Mass destructive action | Agent archives all listings | Confirmation, rate limit, per-target intents |
| Unauthorized chat sender | Public channel asks agent to import | OpenClaw sender pairing/allowlist and private agent |
| Compromised OpenClaw host | Reads token and calls API | Scopes, kill switch, rotation, IP/ingress controls, audit alerts |
| Log leakage | Error prints tenant row | Structured redaction and safe error codes |

## 4. Authentication

### Token generation

- At least 32 cryptographically random bytes.
- Opaque value with a recognizable non-secret prefix.
- Displayed once.
- HMAC-SHA-256 hashed with a server-side pepper before storage.
- Prefix stored separately for lookup and admin display.
- Token comparison uses constant-time equality.

### Token storage

- OpenClaw receives the token only through secret configuration.
- Never place the token in `SKILL.md`, code, Git, chat, import files, command-line
  arguments, screenshots, or application logs.
- The server pepper is a separate Render secret.
- Database exports contain token digests, not usable tokens.

### Rotation and revocation

- Rotation requires recent AAL2 admin authentication.
- New and old token may overlap for at most 24 hours.
- Deactivation or emergency revoke takes effect immediately.
- Token expiration is checked on every request.
- The admin dashboard warns seven days before expiration.

### OpenClaw sender authorization

The OpenClaw agent must accept commands only from an owner-approved private
sender/channel. Gateway pairing and sender allowlists are mandatory.

The Automation API authenticates the service account, not the chat user.
Therefore a server confirmation intent reduces accidental one-step actions but
does not make a compromised OpenClaw Gateway safe. Gateway hardening and token
revocation remain required.

## 5. Authorization

Every route declares one exact scope. Generic `admin` or wildcard scope is
prohibited in v1.

Confirmation execution rechecks the scope required by the stored action, not a
scope name supplied by the client.

The first production account should start with:

```text
rentals:read
rentals:write
media:write
tenants:read
schedules:read
schedules:write
jobs:read
```

Add in order after verification:

```text
rentals:publish
tenants:import
schedules:enable
permissions:grant
```

## 6. Network controls

- HTTPS only in production.
- OpenClaw outbound network allowlist contains only the production API host.
- Automation API can optionally enforce known egress IPs after deployment
  topology is stable.
- Reverse proxy/body limits apply before Next.js parsing.
- API does not follow client-provided URLs.
- Rental image and import endpoints accept file bodies, not remote image/file
  URLs.
- Public CORS is disabled; this is not a browser API.

## 7. Input and file safety

- Zod validates all JSON.
- Unknown object properties are rejected.
- Strings have explicit maximum lengths.
- UUID, ISO date/time, IANA timezone, email, phone, slug, and digest formats are
  validated.
- Multipart body sizes are bounded.
- Images are identified by file signature, not MIME header.
- CSV/XLSX parsers have row/column/cell limits.
- Formulas, macros, external references, hyperlinks, and embedded content are
  not executed or fetched.
- Text beginning with `=`, `+`, `-`, or `@` is escaped when producing any CSV
  error export to prevent spreadsheet-formula injection.

## 8. Prompt-injection boundary

The following are always untrusted data:

- spreadsheet cells and headers;
- filenames;
- rental descriptions;
- tenant notes;
- property names;
- image metadata and generated alt text;
- API errors and database values;
- third-party provider text.

Only the current authorized owner's chat message can express intent or approve
an action. Data content cannot:

- change the API host;
- reveal or rotate tokens;
- expand scopes;
- approve a confirmation;
- select a different tenant;
- publish or archive a resource;
- enable a schedule;
- make an outbound network request.

## 9. PII rules

### Data minimization

- OpenClaw requests only fields needed for the current operation.
- Tenant list/search returns masked destinations.
- Full values are accepted for create/update but are not echoed after success.
- Permission evidence stores a reference, not a document copy.
- Audit records store IDs, counts, field names, and safe codes.

### Chat and memory

- Do not paste full tenant files into chat.
- Do not repeat full email, phone, notes, or spreadsheet rows in summaries.
- Do not store tenant records in long-term OpenClaw memory.
- Temporary files live only in the dedicated workspace and are deleted after
  completion.
- Model-provider data controls must be reviewed before real tenant import.

### Logs

Application and CLI redaction covers:

- bearer tokens and recognizable prefixes plus suffixes;
- email addresses;
- phone numbers;
- signed URLs;
- request bodies for tenant/import/permission routes;
- notification content and destinations;
- provider credentials and IDs where not operationally required.

Safe logs include:

```json
{
  "requestId": "uuid",
  "serviceAccountId": "uuid",
  "route": "tenant-imports.commit",
  "status": 200,
  "durationMs": 842,
  "resultCounts": {
    "created": 72,
    "updated": 18
  }
}
```

## 10. Confirmation security

- Intent IDs are random UUIDs.
- Digests bind action, target, payload, resource version, service account, and
  expiration.
- Intents expire in 15 minutes by default.
- Intents are single-use.
- Execution requires a new idempotency key.
- The server rechecks current state under lock.
- Confirmation summaries contain exact effects and warnings.
- The Skill waits for a new owner message.
- Bulk destructive actions are not supported by v1 confirmation types.

Disabling delivery for opt-out, suppression, invalid destinations, incidents,
or tenant archive may bypass normal owner confirmation because it reduces harm.

## 11. Rate limiting and abuse detection

Rate limits follow [03-automation-api.md](./03-automation-api.md).

Alert conditions:

- 10 invalid-token requests in 10 minutes;
- 5 scope violations in 10 minutes;
- repeated idempotency-key misuse;
- more than 3 failed confirmation executions;
- import creation outside expected operating hours, if owner enables the rule;
- permission-grant rate threshold;
- requests from a new network fingerprint;
- active service account delegated to an inactive admin.

Do not log raw IP addresses longer than required. Store a rotating keyed hash
for anomaly correlation.

## 12. Audit requirements

Every mutation audit event includes:

- service-account ID;
- delegated admin ID;
- action;
- target type and ID;
- request ID;
- idempotency key hash or internal reference;
- confirmation ID for sensitive actions;
- changed field names;
- safe outcome/error code;
- timestamp.

Audit must distinguish:

```text
human admin
automation service account
system/worker
provider webhook
```

Audit records are append-only to application users and retained for 24 months
unless legal policy changes.

## 13. Kill switches

Operators can independently disable:

1. all Automation API requests;
2. all mutations while keeping reads;
3. all confirmation execution;
4. tenant imports;
5. one service account;
6. one token;
7. real reminder delivery through existing force/global pause.

An incident must not require a code deployment to revoke an account or pause
reminders.

## 14. Incident response

### Suspected token exposure

1. Deactivate/revoke the token.
2. Disable automation mutations.
3. Review audit events since last known safe use.
4. Rotate token and server pepper if database/token-digest exposure is possible.
5. Delete leaked chat/file copies where supported.
6. Restore scopes gradually.

### Unauthorized data change

1. Disable the service account.
2. Keep reminder force/global pause active.
3. Export affected audit and resource revisions.
4. Unpublish unsafe rentals or disable schedules.
5. Correct through Admin so versions and audit remain intact.
6. Do not delete evidence before review.

### PII exposure

1. Stop imports and revoke access.
2. Identify affected people, fields, systems, and retention copies.
3. Preserve minimum incident evidence.
4. Follow owner/legal breach-notification decisions.
5. Rotate secrets and remove exposed temporary files.

## 15. Security acceptance tests

- Anonymous and ordinary authenticated users cannot read any automation table.
- Tokens are never retrievable after creation.
- Revoked/expired tokens fail immediately.
- Missing scopes fail even when the delegated admin is active.
- A token cannot execute another account's confirmation.
- Confirmation digests and versions prevent tampering and stale execution.
- Same idempotency key with a different body fails.
- Raw files and normalized rows expire.
- CSV error export prevents formula execution.
- Prompt-injection fixtures cannot change tools, host, scopes, or actions.
- Logs and errors contain no full tenant destinations or tokens.
- Feature flags and account revocation stop mutations without deployment.

