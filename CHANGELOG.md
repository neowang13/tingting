# Changelog

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
