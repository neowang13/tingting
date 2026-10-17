# Changelog

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
