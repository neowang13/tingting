# QA Report — Local production build — 2026-07-26

## PRD completion verification — 2026-07-26

- ESLint and TypeScript: passed.
- Vitest: 93 unit/service tests passed.
- Supabase anonymous RLS: 16/16 passed against dedicated local Supabase.
- Supabase production-mode Playwright: 1/1 serial critical-write journey
  passed after resetting an empty PostgreSQL 17 database, applying migrations
  `202607240001` through `202607260017`, provisioning fixed content/storage and
  a real password+TOTP test administrator.
- The production journey proved SSR Cookie authentication with no
  `Authorization` header, AAL2 login, draft/public isolation, publish,
  rollback, rental lifecycle, tenant permission changes, schedule enable and
  disable, projected tenant filters, frozen recipient batches, exact-count
  confirmation, UTC delivery-date filters, audit events, and cleanup/archive.
- Safe test sending proved that direct queue bypass is rejected, the rendered
  preview is bound to the actor/request by a short-lived signed token, only the
  masked administrator test address is used, and a force-paused Cron claims
  only the test event and records a mock provider result.
- Demo Playwright: 2/2 journeys passed, including accessibility checks.
- OpenClaw fake-server/policy suite: 7/7 passed.
- `next build`: passed with all required routes.
- `render.yaml`: parsed successfully and contains a `*/5 * * * *` Cron service.

## OpenClaw integration verification

- Automation API v1, Admin Automation pages, and the packaged OpenClaw Skill
  are present in the production build.
- TypeScript and ESLint pass.
- Vitest: 93 passed; the 16 RLS checks also passed in the dedicated local
  Supabase run.
- OpenClaw fake-server and policy suite: 7 passed.
- Playwright: 2 production-build journeys passed, including all Automation
  Admin pages, show-once token handling, responsive checks, and axe.
- OpenAPI 3.1 validation passes with no errors.
- Production dependency audit reports no known vulnerabilities.
- PostgreSQL 17: migrations `202607240001` through `202607260017` applied from
  empty state; the SQL behavioral suite and atomic schedule-confirmation check
  passed.
- No raw token, full tenant destination, spreadsheet row, or signed URL was
  written to logs or Admin list views during automated verification.

## Smoke test

- Production `next build`: passed.
- Console errors: 0 in the completed Playwright journey.
- HTTP responses: no 4xx/5xx in the public journey.
- Required routes: all public, API, Admin, icon, sitemap, and robots routes were
  present in the build manifest.
- Core Web Vitals: not claimed. This local run has no representative field
  traffic or production network, so LCP/CLS/INP remain a post-deployment
  measurement gate.

## Interactions

- Mobile navigation opens and closes.
- Homepage filters navigate to the correct rental result.
- Rental result opens the correct detail page.
- Empty contact submission focuses the first invalid field and preserves the
  invalid required controls.
- Dashboard, content, rentals, tenants, reminder sending, templates, delivery
  history, and settings all render with their expected heading.
- Fixed content editor exposes labeled fields plus distinct Save Draft and
  Publish actions.
- Explicit logout returns to Admin Sign In.
- No valid contact enquiry or outbound reminder was submitted during browser
  QA; those mutations are covered by local service/SQL tests and provider mocks.

## Responsive and visual

- Viewports checked: 375×812, 768×1024, and 1440×900.
- Public and Admin pages had no horizontal document overflow at tested widths.
- Mobile Admin exposes every urgent navigation item and dashboard status.
- Above-the-fold screenshots were visually inspected.
- Pixel regression result: **INCONCLUSIVE** because no committed visual baseline
  existed before this implementation. This is an explicit limitation, not a
  silent pass.

## Accessibility

- axe-core WCAG 2 A/AA, 2.1 AA, and 2.2 AA: 0 violations on the public homepage
  and Admin dashboard after correcting green eyebrow contrast.
- Exactly one main landmark and one H1 were present on the homepage.
- No duplicate IDs, unnamed images, unnamed links, unlabeled visible controls,
  heading-level skips, or focusable controls inside `aria-hidden` content were
  found in the structural scan.
- Real Chrome keyboard Tab navigation begins on an interactive link.
- Visible focus styling is defined globally. Automated axe coverage is not a
  substitute for a future screen-reader session with the production content.

## Capacity and persistence

- 100 recipients × email and SMS (200 events) drained through a 15 ms latency
  mock in 397 ms with concurrency bounded to chunks of 10 and zero backlog.
- PostgreSQL 17 migrations through `202607260017` applied from an empty database
  and the behavioral suite passed.
- Service role reads succeeded; anonymous public-view reads succeeded;
  anonymous tenant-table reads failed with `permission denied`.
- Final encrypted logical backup restored successfully to a separate database.

## Verdict

**Local implementation and dedicated-test deployment path: SHIP. Real
production activation remains gated by external provisioning and Owner launch
approval.**

No known critical or high-severity runtime dependency or code defect remains.
The development-only lint/test dependency graph inherits a `brace-expansion`
advisory; it is not installed by a production-only install and the production
audit is clean. Pixel visual regression, production Core Web Vitals, and the
real Resend dry run with verified live callbacks remain external-environment
gates. Twilio/SMS is Owner-deferred and is not a gate for the Email-only launch.
