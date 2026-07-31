# Ting Ting OpenClaw integration

This package contains the restricted `tingting-operations` Skill and
deterministic `tingtingctl` adapter.

## Configure

Set the non-secret values in the dedicated Skill entry:

```text
TINGTING_API_BASE_URL=https://<production-host>/api/automation/v1
TINGTING_INPUT_DIRECTORY=/absolute/host/workspace/imports
TINGTING_MEDIA_DIRECTORY=/absolute/openclaw/media/inbound
```

Store `TINGTING_AUTOMATION_TOKEN` in a mode-`0600` single-value secret file and
inject it through `skills.entries.tingting-operations.apiKey` with a file
SecretRef. Never write the token into the Skill, chat history,
`openclaw.json`, or a shared/global environment file.

The base URL is fixed at process startup. The CLI rejects arbitrary URL
arguments, non-HTTPS production hosts, path traversal, shell fragments, and
files outside `TINGTING_INPUT_DIRECTORY`.

## Install

Install the Skill into the dedicated Agent workspace:

```bash
openclaw skills install \
  --agent tingting-operations \
  --as tingting-operations \
  ./integrations/openclaw/skills/tingting-operations
```

After changing the Skill contract, reset any long-lived owner-channel session
before testing the new behavior. Existing transcripts can contain earlier
Skill reads and are intentionally not rewritten by installation. The owner can
send `/reset`, or an operator can invoke the same reset trigger against the
exact channel session key without delivery.

Expose `skills/tingting-operations/scripts/tingtingctl.mjs` as the only allowed
executable for the dedicated OpenClaw agent. Pin `tools.exec.host` to
`gateway`, set both requested and host policies to `allowlist`, and approve the
resolved real path rather than a symlink path. Configure its sandbox with:

- browser denied;
- general network denied except the exact Ting Ting API host;
- general shell and package installation denied;
- database, provider, hosting, and Cron tools denied;
- workspace access restricted to the dedicated workspace/import directory;
- owner sender/channel allowlist enabled.

For inbound tenant or lease PDFs, keep the model-facing tools limited to
`read`, `write`, and `exec`. The allowlisted
`tingtingctl documents inspect-tenant` command accepts only a fresh managed
`media://inbound/<basename>.pdf`, validates path containment, magic, size, page
count, and symlink state, and uses local macOS PDFKit/Vision OCR in a
token-free, network-denied worker. Do not expose the shared inbound directory
through the model's `read` tool, and do not add browser, image-generation,
generic shell OCR, or broad filesystem access.

The worker preserves normalized Vision bounding boxes. For recognized BC RTB
forms, the adapter pairs tenant-name rows with contact rows by their visual
index and emits structured `tenantCandidates` with the
`bc_rtb_row_order` association. It does not infer ownership from email text.
For an explicitly targeted existing tenant, `documents update-tenant` combines
OCR, row matching, target/property/version validation, and the contact PATCH in
one adapter command so full contact values never pass through model-generated
request JSON.

This implementation targets the current macOS OpenClaw gateway and requires
the system `swift` and `sandbox-exec` binaries. A Linux deployment needs a
separately reviewed OCR worker with equivalent isolation.

`pnpm configure:openclaw` provisions or updates the least-privilege tenant
service account, enables the local Automation API gates, creates the token
pepper when absent, and writes the show-once token to the protected OpenClaw
secret file. Add `-- --rotate` only for an intentional token rotation.

Run the fake-server suite with:

```bash
pnpm --dir integrations/openclaw test
```

## Upload one tenant

Place a JSON file matching
`skills/tingting-operations/schemas/tenant-upload.schema.json` inside
`TINGTING_INPUT_DIRECTORY`, then run:

```bash
tingtingctl tenants upload --operation-id <uuid> --input tenant.json
```

The command validates and defaults the payload, searches for duplicates, and
creates the tenant with email/SMS permission set to `unconfirmed`. The service
account needs both `tenants:read` and `tenants:write`.

## Update one tenant

Place a field-level request matching
`skills/tingting-operations/schemas/tenant-update.schema.json` inside
`TINGTING_INPUT_DIRECTORY`, then run:

```bash
tingtingctl tenants update --id <tenant-uuid> \
  --operation-id <uuid> --input tenant-update.json
```

This path can add or correct names, property details, email, phone, due date,
and other safe tenant fields without requiring the agent to read full stored
PII. A changed destination is always reset to `unconfirmed`; a later
`allowed` transition still requires the permission preview and confirmation
flow.
