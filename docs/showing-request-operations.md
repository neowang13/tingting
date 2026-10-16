# Showing request operations

Each published rental has its own date-only viewing calendar, edited under **Admin → Properties → property → Viewing dates**. Click dates on the monthly calendar to select or remove them, then use the property’s single **Publish** button to publish its details and viewing dates together. **Save draft** is available on unpublished properties and keeps both as drafts without changing the public website. Calendar clicks alone do not change public availability. The public booking form also uses a calendar, with unavailable days disabled. Existing recurring settings are shown as selected dates and are converted to explicit dates on publication.

Visitors choose a date, not a time. Multiple groups may register for the same property on the same date, and different properties may share dates. An agent contacts each visitor to arrange a time. No booking consumes a date or promises a particular appointment time.

## Availability and validation

- Dates use `America/Vancouver`; today through the next calendar month (exclusive) are offered.
- New properties start closed until their calendar is published.
- `GET /api/public/showings?propertySlug=...` returns that published property's available dates, without time slots. Responses are not cached.
- `POST /api/public/showings` requires name, phone, email, property slug, local date, and timezone. Notes are optional.
- The server resolves property information from the published listing and validates the property's calendar. The booking transaction rechecks the calendar before saving.
- Former `requestedLocalTime` and consent fields from already-open forms are ignored. New records have null `requested_start_at` and `requested_local_time`; old appointment timestamps remain intact.
- Existing rate limits remain in place.

## Notifications and follow-up

Notifications use the existing email provider and `CONTACT_TO_EMAIL`. Mock mode sends no external email. Both the success message and notification say the date is registered and an agent must arrange the time.

The persisted `accepted` status means the date registration was accepted, not that an exact appointment time was agreed. The notification contains the property, date, contact information, notes, and request ID, with links to contact the visitor. Use the existing cancellation/rescheduling workflow when needed; do not overwrite original requested dates.

The booking and notification outbox entry commit together. Notification delivery failures are retried without losing the saved registration.

## Database rollout

Apply `202610150060_property_viewing_dates_and_users.sql`, then `202610150061_unified_property_publication.sql`, before running the updated application. It copies the old global calendar's open/closed days into independent records for existing listings, removes global time exclusivity, and preserves historical bookings and the old calendar. It also strengthens the signed-lease requirement for linking a registered user as a tenant.

Test the migration against an isolated Supabase/PostgreSQL database before rollout. Do not replay an older client-link repair migration after this migration without reapplying the latest signed-lease guard.

The second migration adds private calendar drafts and publishes the rental snapshot and calendar in one database transaction. A version conflict or validation failure leaves both public versions unchanged; private edits remain available for correction and retry.

The Properties list offers **Publish + Edit** for unpublished properties and **Unpublish + Edit** for published properties. List publication publishes the saved listing and calendar together. In Edit, unpublished properties offer **Delete / Save draft / Publish**; published properties offer **Delete / Publish**. Publishing edits to a live property updates its snapshot and calendar atomically without taking the listing offline. Unpublishing from the list removes public visibility but retains the saved property. Deletion permanently removes the listing, revisions, and calendar; applications and viewing-request history remain. Apply `202610150062_delete_rental_listing.sql` for deletion support.

Postal code, furnishing, lease type, smoking policy, and pet policy are optional for publication. Empty values remain unknown; they are not replaced with assumed rules. Photos and exactly one cover are still required. Apply `202610150063_optional_rental_publish_fields.sql` to align database publication checks, including legacy review flags. Publication errors appear at the bottom of the property form, above the action buttons, with a red border.
