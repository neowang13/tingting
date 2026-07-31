# Safe error recovery

- `VALIDATION_ERROR`: show field paths and request corrected values.
- `LOCAL_VALIDATION_ERROR`: do not call the API; correct the generated JSON.
- `TENANT_REVIEW_REQUIRED`: show the masked tenant ID and ask whether the owner
  wants to review it in Admin; do not create a duplicate.
- `TENANT_SEARCH_TRUNCATED`: stop and ask for an external reference or more
  specific identity; do not create after an incomplete duplicate preflight.
- `VERSION_CONFLICT`: re-read and summarize; never overwrite.
- `PREVIEW_STALE`: create and display a new preview.
- `IDEMPOTENCY_KEY_REUSED`: stop; never retry changed input with the old key.
- `REQUEST_IN_PROGRESS`: retry the exact request with the same idempotency key.
- `REQUEST_TIMEOUT` or `NETWORK_ERROR`: the outcome may be unknown; keep the
  input file and retry the exact mutation with the same operation ID.
- `RATE_LIMITED`: honor `Retry-After`; keep the same key.
- `AUTOMATION_SCOPE_REQUIRED`: stop and report the missing scope; never seek a
  broader token or another credential.
- `DURABLE_BACKEND_REQUIRED`: stop; Supabase is required.
- `CHANNEL_INELIGIBLE`: keep the schedule disabled and show masked reasons.
- `GLOBAL_REMINDER_POLICY`: stop; direct the owner to Admin Reminder settings.
- `AUTOMATION_DISABLED`: stop and identify the disabled feature.
- `408`, `429`, `502`, `503`, `504`: retry at most three times with bounded
  backoff and the same idempotency key.

After three transient failures, return only the safe request ID and error code.
