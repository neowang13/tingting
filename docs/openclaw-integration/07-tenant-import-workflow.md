# Tenant Import Workflow Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Goal

The owner can upload a tenant spreadsheet, review deterministic validation and
matching results, and commit the exact preview atomically. No row changes
tenant data before confirmation.

## 2. Supported files

| Format | Rules |
|---|---|
| CSV | UTF-8, comma-delimited, one header row |
| XLSX | One selected worksheet, values only, no macro execution |

Limits:

- maximum 10 MB;
- maximum 1,000 data rows;
- maximum 40 columns;
- header on row 1;
- no merged cells in the data range;
- no password-protected files;
- no `.xls`, `.xlsm`, external workbook references, or embedded objects.

Formulas are never evaluated. If the parser library exposes only formula text
without a cached value, the cell is invalid.

## 3. Canonical columns

| Column | Required | Constraint |
|---|---:|---|
| `external_reference` | Recommended | 1–120 characters; unique per source system |
| `full_name` | Yes | 1–120 characters |
| `property` | Yes | 1–160 characters |
| `unit` | No | Up to 60 characters |
| `email` | No | Valid normalized email |
| `phone` | No | Normalizable to E.164 |
| `preferred_channels` | No | `email`, `sms`, or `email,sms` |
| `email_permission` | No | Approved status enum |
| `email_permission_source` | Conditional | Required when email status is `allowed` |
| `email_permission_recorded_at` | Conditional | ISO timestamp required for `allowed` |
| `sms_permission` | No | Approved status enum |
| `sms_permission_source` | Conditional | Required when SMS status is `allowed` |
| `sms_permission_recorded_at` | Conditional | ISO timestamp required for `allowed` |
| `timezone` | No | Valid IANA timezone; default `America/Vancouver` |
| `internal_notes` | No | Up to 2,000 characters |
| `is_active` | No | Boolean; default `true` |
| `rent_due_day` | No | Integer 1–31 |
| `reminder_day` | No | Integer 1–31 |
| `reminder_time` | No | `HH:mm` |
| `reminder_channels` | No | `email`, `sms`, or both |
| `email_template` | No | Template UUID or exact active template name |
| `sms_template` | No | Template UUID or exact active template name |

Imported schedules are always saved with `isEnabled=false`, regardless of any
source column.

## 4. Header normalization

The importer:

1. trims whitespace;
2. lowercases;
3. replaces spaces and hyphens with underscores;
4. maps only allowlisted aliases;
5. rejects two source columns mapping to the same canonical column;
6. warns about unknown columns and excludes them.

Example aliases:

```text
name -> full_name
property_name -> property
suite -> unit
mobile -> phone
email_consent -> email_permission
sms_consent -> sms_permission
```

Alias mappings are versioned code, not model guesses.

## 5. Normalization

### Email

- trim;
- lowercase;
- validate format;
- blank becomes `null`.

### Phone

- strip presentation characters;
- normalize North American ten-digit numbers to `+1`;
- preserve a valid supplied international country code;
- require `^\+[1-9]\d{7,14}$`;
- blank becomes `null`.

### Text

- normalize Unicode to NFC;
- trim leading/trailing whitespace;
- collapse repeated whitespace except internal notes;
- reject control characters other than line breaks in notes.

### Permissions

Blank status becomes `unconfirmed`.

Allowed values:

```text
unconfirmed
allowed
opted_out
invalid
bounced
complained
suppressed
```

SMS excludes `bounced` and `complained`.

A transition to `allowed` requires:

- non-empty permission source;
- permission timestamp;
- evidence reference or approved batch source reference;
- service account scope `permissions:grant`;
- commit confirmation that lists how many permissions will be granted.

Otherwise the row is invalid. The importer must not silently downgrade an
explicit but unsupported `allowed` value.

## 6. Matching and deduplication

Matching is deterministic.

### Step 1: External reference

Match exact `(source_system, external_reference)`.

- One match: candidate update.
- More than one match: database integrity error.

### Step 2: Contact identifiers

If no external reference match:

- match normalized email;
- match normalized phone;
- require property and unit to be compatible;
- if email and phone resolve to different tenants, mark `conflict`;
- if an identifier matches multiple tenants, mark `conflict`.

### Step 3: Human-review candidate

Exact normalized `full_name + property + unit` can produce a suggested match,
but cannot auto-update in v1. Mark `conflict` and require the owner to supply an
external reference or resolve the row.

### Within-file duplicates

Rows sharing an external reference, normalized email, or normalized phone are
compared:

- identical normalized payload: later rows are `duplicate`;
- materially different payload: all related rows are `conflict`.

## 7. Row outcomes

| Outcome | Meaning | Commit behavior |
|---|---|---|
| `new` | No existing tenant match | Insert |
| `update` | Deterministic existing match with changes | Update with version check |
| `unchanged` | Deterministic match and identical managed fields | No write |
| `duplicate` | Duplicate source row | No write; blocking until acknowledged/resolved |
| `conflict` | Ambiguous or divergent identity/state | Blocking |
| `invalid` | Schema, permission, or format failure | Blocking |

The commit intent is unavailable while any `conflict` or `invalid` row exists.
The owner may explicitly exclude `duplicate` rows during a new preview.

## 8. Preview flow

```text
Upload file
   |
   v
Hash and store privately
   |
   v
Parse as inert values
   |
   v
Normalize and validate rows
   |
   v
Match existing tenants
   |
   v
Persist row outcomes and versions
   |
   v
Return aggregate preview + blocking rows
```

The preview response contains masked row identifiers:

```json
{
  "row": 14,
  "outcome": "conflict",
  "display": "Jane C. · Main Street · Unit 12",
  "emailMasked": "j***@example.com",
  "phoneMasked": "+16***23",
  "errorCodes": ["EMAIL_PHONE_MATCH_DIFFERENT_TENANTS"]
}
```

## 9. Commit flow

1. Require `preview_ready`.
2. Require zero invalid or unresolved conflict rows.
3. Create a commit confirmation intent.
4. Show exact counts, permission grants, schedules created disabled, and
   warnings.
5. Wait for a new owner confirmation.
6. Lock the import, confirmation, and matched tenants.
7. Recheck source digest and every expected tenant version.
8. Insert/update all rows in one transaction.
9. Create disabled schedules after tenant IDs exist.
10. Write permission and audit events.
11. Mark import and job completed.

No partial commit is allowed. A single stale tenant produces
`409 PREVIEW_STALE`; the owner must generate a new preview.

## 10. Import modes

### `create_only`

- existing matches become `conflict`;
- no existing tenant is updated.

### `create_or_update`

- deterministic matches may update allowlisted fields;
- archive state is never changed from a spreadsheet;
- a blank input does not erase an existing non-blank value unless an explicit
  clear marker is supported in a later version;
- opted-out/suppressed/invalid statuses cannot be overwritten by blank or
  `unconfirmed`;
- existing `allowed` may be preserved without new permission evidence.

## 11. Privacy behavior

- Raw files use private storage.
- General API lists return masked destinations.
- Import row PII is visible only to the scoped import operation.
- OpenClaw must summarize errors instead of repeating full rows.
- Raw files expire after seven days.
- Normalized row payloads expire after 30 days.
- Audit logs store counts and row numbers, not full contact values.

## 12. Audit events

```text
automation.tenant_import.created
automation.tenant_import.preview_completed
automation.tenant_import.commit_previewed
automation.tenant_import.committed
automation.tenant_import.failed
automation.tenant.created
automation.tenant.updated
automation.permission.changed
automation.schedule.created_disabled
```

## 13. Acceptance tests

- CSV and XLSX produce the same normalized rows.
- Spreadsheet formulas, macros, and hyperlinks are not executed.
- Phone and email normalization matches existing unit tests.
- Duplicate external references cannot create duplicate tenants.
- Email and phone matching different tenants produces a conflict.
- Name-only similarity never updates a tenant automatically.
- Blank permission becomes `unconfirmed`.
- `allowed` without evidence is invalid.
- Imports always create disabled schedules.
- Commit without confirmation is impossible.
- A stale tenant aborts the whole transaction.
- Replaying the commit key does not repeat audit or writes.
- Raw and normalized import data expire according to retention rules.

