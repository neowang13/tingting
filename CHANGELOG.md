# Changelog

## [0.2.10] - 2026-10-17
### Added
- Let primary and co-applicants remove their own uploaded documents before signing, confirm removal, and upload replacements. Recheck required categories and release upload slots immediately.
- Protect file deletion with account ownership, same-origin requests, rate limits, and the existing database signature lock. Remove private storage objects after the database accepts deletion and record an audit event.

## [0.2.9] - 2026-10-17
### Fixed
- Keep primary action links white on green throughout the applicant portal, including My applications and co-applicant sign-in links. Ordinary link styling no longer overrides button labels.
- Keep disabled action labels readable across Admin and applicant forms, using dark text on an opaque light background instead of fading the whole button. Selected calendar dates preserve their existing readable highlight.
- Switch Admin delete-button foreground and background colors together so hover transitions cannot briefly hide the label.

## [0.2.8] - 2026-10-17
### Changed
- Let the primary applicant sign and submit their part first, then automatically submit the joint application and queue the Admin notification after every declared adult signs. Show the waiting status and lock signed details and the applicant roster.
- Require only the credit score report category for co-applicants; other supporting documents are optional.

### Fixed
- Match co-applicant signatures to their saved legal name, allowing an unsigned invitee to correct an incomplete invitation name.
- Limit invitations to the saved additional adult count, prevent incomplete rosters from signing, and require a fresh tenancy review when shared details change.
- Remove excessive spacing in the co-applicant form and the obsolete pre-production draft notice.

## [0.2.7] - 2026-10-17
### Fixed
- Create and publish rental listings without a street address; city remains required. Omitted addresses display cleanly on public pages, applications and viewing requests.
- Clarify that assistants can download administrator-authorized Facebook listing photos through their browser and upload the files. Hidden connector image URLs require a browser download or original photo attachments; publication still requires a cover image.

## [0.2.6] - 2026-10-17
### Fixed
- Allow Muse OAuth requests that omit the resource parameter by binding them to the single configured MCP resource. Explicitly incorrect targets remain rejected, with Admin consent, PKCE and token audience validation preserved.

## [0.2.5] - 2026-10-17
### Changed
- Remove the applicant-record handling reminder from the Admin application queue.

## [0.2.4] - 2026-10-17
### Changed
- Simplify the application queue to four views. Under review now opens by default and includes new submissions and applications awaiting information; legacy All open links remain compatible.

## [0.2.3] - 2026-10-17
### Fixed
- Render application submission, saved-draft and signing times consistently in Pacific time to prevent server/browser hydration mismatches.

## [0.2.2] - 2026-10-17

### Changed
- Open application review directly on the primary applicant's full details. Switch applicants by name to view one person's details, signed declaration and supporting files together.
- Keep the applicant switcher available while reviewing, support keyboard navigation and horizontal name scrolling on mobile, and preserve whole-application decisions.
- Display the original saved signing text when available; identify missing historical declarations without substituting current terms.

## [0.2.1] - 2026-10-17

### Fixed
- Approval emails use the applicant's verified login account and show the actual recipient. Approved applications can resend the notification.
- Applications can enter review and receive a decision without per-file clearance. Explicitly rejected attachments still prevent approval.

## [0.2.0] - 2026-10-17

### Added
- Connect an assistant through a private MCP interface using the website's Admin login, scoped consent, expiring access, and revocable connections.
- Create and edit rental listings, upload photos, publish or unpublish properties, manage application decisions, and manage viewing requests through MCP.

### Changed
- Submitted applications can enter review or request additional information directly. After information is supplied, review resumes without a separate receipt acknowledgement.

### Security
- Require active Admin authorization for management tools, validate write inputs and record operations to prevent duplicate retries.
