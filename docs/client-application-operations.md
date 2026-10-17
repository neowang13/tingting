# Client application operations and privacy runbook

Status: production enabled. The active form and consent were confirmed reviewed
and recorded as `approved` on 2026-08-08. Application creation, editing, and
submission continue to fail closed if either approval is withdrawn.

## Access and assignment

- Clients self-register at `/client/signup` with name, email, and a password of at
  least 11 characters. Supabase email confirmation is required before first sign-in.
- Registration metadata can create only an active `client_profiles` row. It never
  creates `admin_profiles`, assigns an application/property, or grants Admin access.
- After sign-in, a Client may start an application only from a published rental.
  The service-role-only database function atomically creates or reuses one active
  application per Client/rental and attaches only the approved canonical form and
  approved active consent. Draft saves, uploads, and final submission recheck this
  approval and fail closed if either source is pending or approval is withdrawn.
  `scripts/provision-supabase.ts` still supports an optional staff-provisioned initial
  assignment and refuses it unless both source versions are approved.
- Every client read is owner-scoped in the server query and RLS policy. All mutations
  are same-origin server routes. Service-role credentials and private storage paths
  never reach the browser.
- Client sessions have a 15-minute idle limit and 1-hour absolute limit. Admin and
  client local-mode cookies are separate. Supabase identities are independently
  authorized against `admin_profiles` or `client_profiles` on every protected route.

## Applicant workflow

1. Applicant registers, confirms the email link, and signs in. A generic sign-in
   returns to the public homepage. Staff can see the registered account under
   `/admin/users`; the new account initially has no application or tenant assignment.
2. Applicant browses a published rental detail page. `Book a viewing` remains
   available on the listing; `Apply online` asks the Client to sign in when necessary,
   confirms the selected rental, then creates or reuses only that Client's application.
3. Applicant opens the resulting private application (or `/client/applications`) and
   completes the eight-step online application: personal details, household/tenancy,
   housing history, employment/income, references, emergency contact, documents, and
   review/submit. Each explicit save is server-validated, owner-scoped, and audited.
4. Applicant uploads requested PDF/JPEG/PNG supporting files, maximum 10 MB each and
   8 files. The server checks magic bytes, extension/MIME agreement, and rejects PDF
   scripts, launch actions, and embedded files. The assigned downloadable form remains
   available only as a `private, no-store` fallback.
5. Objects use random keys in the private `client-applications` bucket. New files are
   `manual_review_required` as a legacy attachment flag. Manual clearance does not
   block staff review or decisions. Upload validation is not antivirus certification.
6. Server submission revalidates all required online sections. Each applicant uses
   their own verified User account and separately checks the landlord-sharing and
   reference/housing/income verification authorizations. An uploaded credit report
   also requires a personal voluntary-submission checkbox below the uploader; a new
   upload clears it. No external credit-agency query is created. No box is pre-checked.
   Submission verifies the
   exact form/terms versions and hashes, then stores displayed consent text, hashes,
   timestamp, authenticated user, application ID, and minimized request context.
7. After the database accepts the submission, a durable Admin email contains
   the completed applicant details and uploaded PDF/JPEG/PNG attachments.
   `APPLICATION_TO_EMAIL` selects the recipient, with the configured contact,
   alert, and local administrator mailboxes as fallbacks. Large attachments
   are split across numbered emails using a 25 MB raw-file budget. File size
   and SHA-256 are checked before delivery. Failures are audited and retried;
   an email failure does not undo a completed application submission. Attachment
   messages state that staff security screening is still pending.
8. Applicant downloads a receipt showing the reference, files, status, versions,
   hashes, consent time, correction route, and retention-review date.

## Staff processing

Use `/admin/applications`. This is a need-to-know queue and does not expose private
object paths or public download URLs. The configured submission email is the operational delivery path. Do not manually
copy private application details into chat, analytics, issue trackers, or general admin notes.

Allowed progression:

`Submitted → Under review → Approved / Declined`

`Submitted / Under review → Needs information → Under review`; open submitted
records may be withdrawn. There is no manual receipt acknowledgement. Historical
`Received` records can still move directly to review, needs information, or withdrawal.
The UI and server enforce transitions and append an audit event. Status means only
the recorded operational state. `Submitted` is not approval. Per-file clearance is
not a required step. Explicitly rejected attachments block approval, but do not
prevent starting review or declining the application.

Open `Review application` to inspect the complete application and private-file
screening state. Approve and decline controls are available only inside that review
dialog. Approval queues a separate email to the primary applicant's verified login
account address, rather than the editable form email, stating that the application
was approved and that the team will contact them; it also states that the email is not
a tenancy agreement. The application decision remains recorded if the email provider
fails. The Admin UI shows the recipient and distinguishes provider acceptance from
inbox delivery. Approved records offer **Resend approval email**, protected by Admin
authentication, same-origin checks, rate limits and a retry identifier.
Requesting information and declining do not automatically notify the applicant;
staff must arrange that contact. Approved, declined, and withdrawn records cannot
be reopened through the current status workflow.

After both parties sign the tenancy agreement, use `Mark as tenant` on the approved
application. Upload the final signed agreement as a PDF (maximum 20 MB); selection
starts the upload immediately. The server verifies the extension, MIME type, PDF magic
bytes, and rejects active-content markers. Agreements use random object keys in the
private `client-applications` bucket and are downloadable only by an authenticated
Admin with a `private, no-store` response. Replacing an agreement preserves the
supersession audit trail while removing the old private object.

Confirm the property, unit, lease dates/type, and rent due day from that signed
agreement. Both the server and the database refuse conversion until a current signed
agreement exists. The database transaction creates one active tenant, links it to the
registered Client account, records the source application and exact agreement file,
and prevents duplicate tenant creation if the action is retried. Do not use this action
before both parties have signed.

For corrections or missing information, contact the applicant without including
sensitive content in URLs. The applicant should upload replacement information only
through Client Login. Staff may download an attachment only from the authenticated
Admin queue to the approved screening workstation. The response is private/no-store,
never a public URL, and carries the current attachment-status header. The queue has
no per-file confirmation or rejection buttons: staff review the documents, then
approve or decline the application. The legacy file-decision API still requires
recent AAL2 authentication, refuses changes after a final application decision,
and locks the parent application to serialize file rejection with approval.
Explicitly rejected attachments still prevent approval.

Use `/admin/users` to review every registered Client account, including accounts
still waiting for email verification. Tenant status requires the approved application,
a current signed lease, and explicit administrator confirmation through **Mark as tenant**.
Matching names or email addresses never creates a link. Link history remains available
for operational review; current verified tenants open in the existing Tenant editor
for rent, lease, reminder, and payment management. Clients cannot directly read the
private `tenants` table or another Client's records.

## Retention, deletion, and incidents

- Submission sets a 12-month retention review date. A decision affecting an applicant,
  dispute, law, or approved hold can require longer retention. Holds must be documented,
  least-privilege, reviewed, and released when the reason ends.
- A withdrawal or deletion request records intent; it does not bypass a lawful hold.
  When eligible, remove private objects first, verify removal, then delete or de-identify
  application/file metadata while preserving only the minimum required audit evidence.
- Review expired records on a documented schedule. The retention index supports the
  query `retain_until <= now() and not retention_hold and deleted_at is null`.
- On suspected exposure: stop access, preserve minimal incident evidence, rotate affected
  credentials, identify objects/accounts/actions from audit records, notify the privacy
  lead and required parties, remediate, and document the final deletion/retention action.
- Privacy/correction/deletion contact: `tingtingtech@outlook.com`. Messages should contain
  only the application reference, never completed forms or identity documents.

## Production verification

Apply migrations, provision the private bucket, and run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
```

Run the Supabase RLS suite against a dedicated non-production project. Verify two client
users cannot read one another's application, form assignment, file metadata, receipt, or
audit events; anonymous users cannot read any application table; and active staff can
read the queue without receiving storage public URLs.

For production email, verify `silverkey.ca` in Resend and configure
`EMAIL_FROM="Ting Ting Xu <notifications@silverkey.ca>"`, `EMAIL_PROVIDER_MODE=live`,
`RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, and the approved `CONTACT_TO_EMAIL` inbox.

## Admin Users directory and tenant status

**Admin → Users** lists every registered client account, including unverified and inactive accounts and users who have never applied. Application status and email verification are separate from tenancy status.

A tenant requires an approved application, an uploaded signed lease PDF, and explicit administrator confirmation (`signedAgreementConfirmed: true`) through the application's **Mark as tenant** action. Uploading a lease or signing an application alone does not mark a user as a tenant. The conversion creates and links the tenant in one database transaction, records the confirming administrator and time, and supports retries without duplicate conversion.

The Users directory labels a current verified tenancy as **Tenant**, a converted historical tenancy as **Former tenant**, and historical account links without matching lease evidence as **Needs verification**. Existing tenant records remain available for rent, lease, reminder, and historical record management. New direct tenant creation and manual user-to-tenant linking through the admin API return `SIGNED_LEASE_REQUIRED`; use application conversion instead.

The sidebar contains **Properties**, **Applications**, and **Users**. Application status filters remain inside Applications. Viewing calendars are managed within individual properties.
