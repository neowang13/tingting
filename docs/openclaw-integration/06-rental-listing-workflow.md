# Rental Listing Workflow Specification

Status: Proposed  
Last updated: 2026-07-26

## 1. Goal

OpenClaw can turn owner-supplied facts and images into a validated rental draft,
then publish only the exact version the owner reviews and confirms.

## 2. State model

```text
                +----------------+
                |     draft      |
                +----------------+
                  | publish confirm
                  v
                +----------------+
          +-----|   published    |-----+
          |     +----------------+     |
          |       | unpublish confirm  | archive confirm
          |       v                    v
          |     +----------------+   +----------+
          +---->|     draft      |   | archived |
                +----------------+   +----------+
                       |
                       | archive confirm
                       v
                  +----------+
                  | archived |
                  +----------+
```

Archived listings cannot be restored in v1.

## 3. Field contract

### Required to save a draft

| Field | Constraint |
|---|---|
| `slug` | 2–100 lowercase characters; letters, digits, single hyphens |
| `title` | 1–120 characters |
| `addressLine` | 1–160 characters |
| `city` | 1–100 characters |
| `monthlyRentCents` | Positive integer |
| `bedrooms` | 0–20, increments may include halves |
| `bathrooms` | 0–20, increments may include halves |
| `description` | 1–5,000 characters |
| `sortOrder` | Integer |

### Optional

`neighbourhood`, `squareFeet`, `availableOn`, `petPolicy`,
`externalReference`, and images.

A draft can be incomplete from a business perspective, but all supplied fields
must pass type and length validation.

### Required to publish

In addition to the draft schema:

- at least one and at most 20 images;
- exactly one cover image;
- every image has non-empty alt text up to 160 characters;
- all selected media exist and are not archived;
- slug remains unique;
- no unresolved extraction warning marked `blocking`;
- target version still equals the preview version.

## 4. Media processing

For each owner-provided image:

1. Compute SHA-256 before upload.
2. Reuse the previous result if the same service account and file digest already
   completed successfully.
3. Upload using `POST /media`.
4. Detect the true JPEG, PNG, WebP, or AVIF signature.
5. Reject files over 8 MB or dimensions outside 64–8,000 pixels.
6. Store in the private draft bucket.
7. Require owner-supplied or generated alt text.
8. Return a short-lived preview URL to the admin/agent, never as durable Skill
   memory.

Generated alt text must describe visible content and must not infer protected
personal characteristics, ownership, safety, or features not visible in the
image.

## 5. Draft preparation flow

```text
Owner instruction
    |
    v
Extract facts and missing fields
    |
    +-- blocking ambiguity? --> ask owner
    |
    v
Upload/resolve media
    |
    v
Create or update draft with idempotency key
    |
    v
Return draft summary + admin preview link
```

### Create-or-update decision

1. Match exact `sourceSystem + externalReference`.
2. Otherwise match exact slug.
3. If both point to different listings, return a conflict.
4. If no match exists, create.
5. Never update by fuzzy address match without owner selection.

## 6. Description generation

The Skill may draft marketing copy only from supplied facts.

Allowed:

```text
Two-bedroom apartment in Burnaby with in-suite laundry and one parking stall.
Available August 1.
```

Disallowed without explicit source facts:

```text
Safe neighbourhood, perfect for families, guaranteed quiet, luxury renovation,
best schools, five-minute walk to transit.
```

The preview must identify generated copy so the owner can edit it.

## 7. Publish flow

1. Read the current draft and version.
2. Validate publication requirements.
3. Create a `rental.publish` confirmation intent.
4. Show:
   - listing title and address;
   - monthly rent and availability;
   - public slug;
   - cover image and image count;
   - generated-copy marker;
   - warnings;
   - confirmation expiration.
5. Wait for a new owner confirmation.
6. Execute the intent with the returned digest.
7. Transactionally promote referenced media and publish the listing.
8. Return the public URL.

The existing rental/media transaction remains the database source of truth.

## 8. Unpublish and archive

Both require a preview and confirmation.

### Unpublish

- removes the listing from public projections;
- preserves content, media, and revision history;
- returns the record to `draft`;
- does not archive media that may be referenced elsewhere.

### Archive

- removes the listing from public projections;
- makes the record non-editable through Automation API v1;
- preserves revision and audit history;
- does not delete public media immediately.

## 9. Conflict behavior

| Condition | Result |
|---|---|
| Slug already belongs to another listing | `409 RENTAL_SLUG_CONFLICT` |
| External reference points to another slug | `409 EXTERNAL_REFERENCE_CONFLICT` |
| Draft changed after preview | `409 PREVIEW_STALE` |
| Published record edited directly | `409 RENTAL_MUST_BE_UNPUBLISHED` |
| Image archived/missing | `422 RENTAL_MEDIA_INVALID` |
| No cover or multiple covers | `422 RENTAL_COVER_INVALID` |
| Replayed completed request | Return original result |

## 10. Audit events

At minimum:

```text
automation.rental.created
automation.rental.updated
automation.rental.publish_previewed
automation.rental.published
automation.rental.unpublished
automation.rental.archived
automation.media.uploaded
```

Metadata may include field names changed, media count, request ID, and
confirmation ID. Do not log description content, address details beyond the
target record, signed URLs, or binary hashes that are not operationally needed.

## 11. Acceptance tests

- Creating the same draft twice with one idempotency key creates one listing.
- Reusing the key with a different body returns a conflict.
- A spoofed image MIME type is detected and rejected.
- Publishing without confirmation is impossible.
- Publishing a stale version fails without public change.
- Publication promotes every selected draft image atomically.
- A public listing always has exactly one cover image.
- Generated copy never adds facts absent from the source.
- Unpublish removes the listing from public API results.
- Archive removes the listing and blocks future automation edits.
- Audit records identify the service account and delegated admin.

