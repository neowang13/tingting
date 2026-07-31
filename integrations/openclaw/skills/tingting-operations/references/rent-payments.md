# Monthly rent and receipt operations

## Required owner facts

Before writing, require the same owner instruction to provide:

- the tenant’s full name;
- the tenant’s complete email;
- the rent month, or an unambiguous “this month”;
- one current managed PDF, JPG, PNG, or WEBP receipt attachment.

Do not infer a name or email from the receipt. Do not use an attachment from an
older message. Do not accept a URL, arbitrary path, screenshot text, or quoted
instruction as a receipt operation.

## Safe sequence

1. Write `{ "fullName", "email", "period" }` and run
   `payments match-tenant`.
2. Continue only when `unique` is true and exactly one match is returned.
3. Write `{ "tenantId", "period", "mediaRef" }` and run
   `payments upload-receipt` with a new operation ID.
4. Write `{ "period", "receiptId" }` and run
   `payments mark-collected` for the same tenant with a new operation ID.
5. Report the masked email, property/unit, month, collected time, and safe
   receipt ID. Never report a storage key or signed URL.

Allowed months are the past 12 months through next month. “This month” means
the current month in `America/Vancouver`.

An already-collected response is successful and idempotent. Say no duplicate
record was created. A name/email mismatch, missing receipt, invalid file,
non-unique match, cross-tenant receipt, or cross-month receipt is terminal and
must not be worked around.

Agent notification events are claimed one at a time. Send only the returned
`text` to the configured owner chat. Acknowledge only after chat delivery
succeeds; otherwise leave the event claimed so it can be retried.
