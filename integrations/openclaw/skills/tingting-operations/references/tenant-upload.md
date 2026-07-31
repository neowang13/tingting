# Single-tenant upload

Use `tenants upload` when the owner provides one tenant in a message or a small
structured note. Use the import workflow for CSV/XLSX files or multiple rows.
For a new tenant supplied in a PDF, use the correctness-confirmed
`tenants onboard` workflow in `SKILL.md` instead.

Required facts:

- full name;
- property label.

Optional facts include unit, move-in date, rent due day, email, E.164 phone,
timezone, internal notes, active state, source system, and an external
reference.

The command safely supplies these defaults:

- `sourceSystem=openclaw`;
- `rentDueDay=1`;
- `timezone=America/Vancouver`;
- `isActive=true`;
- preferred channels derived only from supplied destinations;
- both contact permission states set to `unconfirmed`.

Never infer `allowed` permission from an email address, phone number, lease,
message, or request to upload. Permission grant is a separate preview and
confirmation workflow.

Before creating, the command searches for an exact source/external-reference
match. Repeating that upload returns the existing masked tenant without a
second write. Without an external reference, an exact name/property/unit match
stops with `TENANT_REVIEW_REQUIRED`; review the existing record and ask the
owner before updating it.

Example input:

```json
{
  "externalReference": "lease-2026-0042",
  "fullName": "Jane Chen",
  "propertyLabel": "123 Main Street",
  "unitLabel": "1208",
  "moveInDate": "2026-08-01",
  "rentDueDay": 1,
  "email": "jane@example.com"
}
```

Run:

```text
tingtingctl tenants upload --operation-id <uuid> --input tenant.json
```

The result reports `action=created` or `action=existing` and contains only
masked contact destinations.

## Owner-confirmed PDF onboarding

After `documents inspect-tenant` and a new owner message confirming the
displayed facts are correct, write the complete candidate fields and:

```json
{
  "ownerConfirmation": {
    "confirmedAt": "2026-07-30T20:00:00Z",
    "documentDigest": "sha256:<64 lowercase hex characters>"
  }
}
```

Run:

```text
tingtingctl tenants onboard --operation-id <uuid> --input tenant.json
```

This dedicated command requires an email. It creates the tenant, records the
owner confirmation as the Email permission source, sets Email permission to
`allowed`, leaves SMS permission `unconfirmed`, and returns the global reminder
schedule status. Do not use it without the new correctness confirmation.
