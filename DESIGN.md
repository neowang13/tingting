# Design System — Ting Ting Real Estate

## Product Context

- **What this is:** A public rental and property-services website with a private operations area for listings, tenants, rent reminders, and delivery records.
- **Who it is for:** A small, non-technical property-management team that needs to complete recurring tasks without learning database or email-provider terminology.
- **Space/industry:** Greater Vancouver real estate and rental operations.
- **Project type:** Public marketing and listings website plus an internal operations dashboard.
- **Memorable thing:** The administrator always knows what will happen next and whether an email was actually sent.

## Aesthetic Direction

- **Direction:** Calm utilitarian.
- **Decoration level:** Intentional. Hierarchy comes from typography, spacing, borders, and a restrained use of status color.
- **Mood:** Trustworthy, practical, and human. The Admin should feel like a clear operating checklist, not a database console.
- **Admin content rule:** Product language describes the user's outcome. Internal terms such as schema, frozen batch, provider mode, and event occurrence do not appear without a plain-language explanation.

## Typography

- **Display/Hero:** IBM Plex Sans, semibold. Clear at large sizes without feeling promotional.
- **Body:** IBM Plex Sans, regular. Optimized for forms, instructions, and dense operational content.
- **UI/Labels:** IBM Plex Sans, semibold.
- **Data/Tables:** IBM Plex Sans with tabular numerals; IBM Plex Mono is reserved for tokens, IDs, and code-like values.
- **Code:** IBM Plex Mono.
- **Loading:** Self-host when font assets are added; fall back to Segoe UI and sans-serif.
- **Scale:** 12px metadata, 13px labels, 16px body, 20px section title, 30px page title, 44–64px public hero.

## Color

- **Approach:** Restrained. Green identifies primary actions and successful states; amber means waiting or paused; red means failed or blocked.
- **Primary:** `#2F6F5E` — actions, active states, and focus support.
- **Primary dark:** `#255A4C` — hover and high-contrast text.
- **Admin navigation:** `#1C2B28` — stable dark green anchor.
- **Neutrals:** `#FFFFFF`, `#F6F4EF`, `#E4E0DA`, `#6B6F6D`, `#1F2321`.
- **Semantic:** success `#2F6F5E`, waiting `#A6720A`, error `#B3411F`, info `#2A4B45`.
- **Dark mode:** Not currently supported. Do not create a token-inverted dark theme without testing every status and public image treatment.

## Spacing

- **Base unit:** 4px.
- **Density:** Comfortable for primary workflows; compact only for tables and metadata.
- **Scale:** 2xs 2px, xs 4px, sm 8px, md 16px, lg 24px, xl 32px, 2xl 48px, 3xl 64px.
- **Form rule:** Related fields share one card. Advanced audit fields stay collapsed until requested.

## Layout

- **Approach:** Grid-disciplined.
- **Admin grid:** Persistent grouped navigation, clear page purpose, then one primary workflow. Supporting history or advanced controls follow the main task.
- **Workflow pattern:** Context → user input → consequence preview → one primary action → explicit result.
- **Max content width:** Use the available Admin canvas; readable instructional copy stays under 760px.
- **Border radius:** 8px controls, 10–12px operational panels, 12–16px cards, full radius only for status pills and public call-to-action buttons.

## Motion

- **Approach:** Minimal-functional.
- **Easing:** enter ease-out, exit ease-in, move ease-in-out.
- **Duration:** micro 80ms, short 160ms, medium 260ms.
- **Rule:** Motion may confirm focus, hover, expansion, or completion. It must not delay an Admin action or hide status information.

## Admin UX Rules

1. A save action says whether the public website changed.
2. “Waiting to send” never appears as “sent.”
3. Every automatic reminder shows its next planned time and the system-wide blockers that can prevent delivery.
4. Adding a tenant includes the rent due day and reminder plan in the same workflow.
5. Email activity is the source of truth for sending and delivery outcomes.
6. Test mode and disabled delivery are visible before the user confirms a send.
7. Technical controls and audit metadata remain available under Advanced, not in the primary path.
8. Destructive and public actions use explicit verbs: “Publish to website,” “Remove from website,” and “Archive tenant.”

## Safe Choices

- Conventional left navigation and table layouts keep the Admin familiar.
- Green, amber, and red retain common status meaning.
- Save, preview, and publish remain separate website-content actions.

## Deliberate Risks

- The Admin favors sentence-level guidance and status explanations over maximum data density. This costs vertical space but prevents false assumptions about sends and publishes.
- Rent reminder setup lives inside the tenant workflow instead of a separate scheduling tool. This couples related tasks and reduces missed schedules, at the cost of a longer Add Tenant page.
- SMS remains in advanced records while the primary product flow is email-first. This keeps the launch path coherent while preserving existing data.

## Decisions Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-07-27 | Initial Admin design system created | The existing Admin exposed database and queue terminology, separated tenant creation from reminder setup, and did not explain whether an email had actually sent. |
| 2026-07-27 | Email-first primary workflow | Rent reminder email is the current user goal and production SMS remains disabled. |
| 2026-07-27 | Website publishing uses outcome-based language | Administrators must know whether a change is saved privately or live to visitors. |
