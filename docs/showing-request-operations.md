# Showing request operations

The **Book a viewing** action on each published rental records a preferred time. It does not promise or create a confirmed appointment.

## Availability and validation

- All times use `America/Vancouver` (Pacific Time), including daylight-saving changes.
- Visitors can request Monday through Saturday from 9:00 AM through 6:00 PM, in 30-minute increments.
- Requests need at least two hours’ notice and can be made up to 60 days ahead.
- Name, phone, date, time, and consent are required. The server resolves the rental from the published property slug rather than trusting browser-supplied property details.

## Notification configuration

Showing notifications use the existing email provider configuration and are sent to `CONTACT_TO_EMAIL`. In production, configure `EMAIL_PROVIDER_MODE=live`, `RESEND_API_KEY`, `EMAIL_FROM`, and `CONTACT_TO_EMAIL`. In demo and automated-test modes, the mock provider does not send external mail.

The notification includes the property title and address, listing path, visitor name and phone, requested Pacific time, notes, and request ID. Its status is explicitly **REQUESTED — not yet confirmed**.

## Handling a request

1. Review the notification and the corresponding `showing_requests` row.
2. Contact the visitor by phone to accept the requested time or propose another time.
3. Only after Ting Ting accepts the appointment should an authorized admin workflow change `status` to `accepted` and set `accepted_at`.
4. Use `reschedule_requested`, `declined`, or `cancelled` when appropriate. Do not silently overwrite the visitor’s original requested date/time.

If notification delivery fails after persistence, the visitor sees guidance to call Ting Ting. The saved request remains available for follow-up. Avoid copying request details into unapproved systems; the record contains personal contact and consent data.
