## Design System

Always read DESIGN.md before making visual or UI decisions.
All font choices, colors, spacing, Admin content rules, and workflow principles are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that does not match DESIGN.md.

## Current project baseline

Read `PRD.md` for the current product scope. The OpenClaw integration is retired;
do not restore its API, service accounts, Agent notifications, or local adapter
from old branches or historical specifications. Website reminder Cron and email
delivery are separate supported features. Use memory data and mock delivery for
local tests. Compare changes with the latest successful Render main deployment.
