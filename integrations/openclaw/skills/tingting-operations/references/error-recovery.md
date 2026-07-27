# Safe error recovery

- `VALIDATION_ERROR`: show field paths and request corrected values.
- `VERSION_CONFLICT`: re-read and summarize; never overwrite.
- `PREVIEW_STALE`: create and display a new preview.
- `REQUEST_IN_PROGRESS`: retry the exact request with the same idempotency key.
- `RATE_LIMITED`: honor `Retry-After`; keep the same key.
- `DURABLE_BACKEND_REQUIRED`: stop; Supabase is required.
- `CHANNEL_INELIGIBLE`: keep the schedule disabled and show masked reasons.
- `AUTOMATION_DISABLED`: stop and identify the disabled feature.
- `408`, `429`, `502`, `503`, `504`: retry at most three times with bounded
  backoff and the same idempotency key.

After three transient failures, return only the safe request ID and error code.

