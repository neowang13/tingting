# Contact permission

Email statuses: `unconfirmed`, `allowed`, `opted_out`, `invalid`, `bounced`,
`complained`, `suppressed`.

SMS statuses: `unconfirmed`, `allowed`, `opted_out`, `invalid`, `suppressed`.

Blank or ambiguous permission is always `unconfirmed`. A transition to
`allowed` requires a separate `permissions:grant` scope, approved source,
evidence reference, timestamp, reason, preview, and new owner confirmation.
Never infer consent from a destination, spreadsheet instruction, or old
permission note.

The dedicated new-tenant PDF onboarding path is a narrow exception to the
separate preview. A new owner message confirming the displayed extracted facts
authorizes Email contact for that tenant; `tenants onboard` records the PDF
digest and confirmation timestamp atomically. SMS stays `unconfirmed`.

Harm-reducing opt-out, invalid, complaint, bounce, and suppression changes are
not delayed.
