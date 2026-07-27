# Ting Ting Homepage Development Prompt

You are implementing the production-quality public homepage for the existing
Ting Ting Xu Real Estate application.

Work directly in:

```text
/Users/lazycat/Documents/ting ting
```

## 1. Source of truth

Read these files completely before changing code:

```text
docs/Ting Ting Admin PRD.md
docs/Ting Ting Admin Engineering Spec.md
docs/API.md
Ting Ting Website Replan.md
Ting Ting Xu Homepage Content.md
src/features/content/schemas.ts
src/lib/contracts.ts
src/data/demo.ts
src/components/public/site-home.tsx
src/app/page.tsx
src/app/globals.css
```

Priority when documents disagree:

1. `docs/Ting Ting Admin Engineering Spec.md`, especially Section 6 and the
   exhaustive fixed-section schemas.
2. `docs/Ting Ting Admin PRD.md`.
3. The replan and homepage content documents as visual, tone, and copy
   direction only.

Do not change the fixed registry to match an older content document. Do not add,
remove, rename, hide, duplicate, or reorder sections.

## 2. Goal

Build a calm, premium, responsive homepage that makes two things immediately
clear:

1. Visitors can find available rentals in Greater Vancouver.
2. Property owners can request practical property services.

Buying and selling remain part of the broader brand, but the homepage must
prioritize rentals and property services.

The intended audience is local to Greater Vancouver. The design should feel
personal, capable, modern, and service-led—not like a high-volume property
portal.

## 3. Scope

Implement only the public homepage and homepage-specific reusable components.
Do not redesign the admin, database, reminder system, authentication, or
provider integrations.

The homepage must render these fixed sections in this exact order:

```text
header
hero
rental_search
property_services
featured_rentals
about
contact
footer
```

All visible copy, labels, links, and media references must come from validated
published section content or published rental data. Do not hardcode editable
business copy inside presentation components.

## 4. Existing architecture

Use the existing stack and conventions:

- Next.js 16 App Router
- TypeScript strict mode
- React Server Components by default
- Client Components only where interaction requires them
- Tailwind CSS / existing global design tokens
- Zod schemas in `src/features/content/schemas.ts`
- Existing public API and contracts
- `next/image` for real images
- Lucide icons where icons are needed

Do not introduce another UI framework, global state library, CMS, carousel
library, animation framework, or data-fetching library.

Keep route components thin. Put homepage sections in focused components under:

```text
src/components/public/
```

Create a public homepage data-loading boundary under the relevant feature
module. Public rendering must never query tenant, reminder, draft, audit, or
admin data.

For local demo mode, the loader may use the seeded memory adapter. Its interface
must be compatible with the future Supabase public projections:

```text
public_site_sections
public_rental_listings
```

## 5. Visual direction

Use the current approved visual language:

- Primary palette: black/charcoal, white, warm off-white, and restrained green.
- Large, confident typography with generous whitespace.
- Rounded controls and cards, but avoid excessive pills and decorative badges.
- Thin neutral borders and subtle shadows.
- One strong image per visual area.
- Calm motion only; respect `prefers-reduced-motion`.
- Avoid gradients that reduce text contrast.
- Avoid glassmorphism, busy collages, statistics, testimonials, award badges,
  listing carousels, and decorative UI that does not help users act.

Use approved local assets wherever available. Do not generate new AI images.
Treat the existing generated homepage image as visual reference, not as a
production image asset. If an approved section image is unavailable, use a
neutral local placeholder and make the missing asset obvious in code/documentation.

## 6. Section requirements

### Header

- Show brand name and subtitle from `header`.
- Use exactly the three fixed navigation identities:
  - Rent → `/#rentals`
  - Service → `/#services`
  - About → `/#about`
- Show the fixed contact CTA → `/#contact`.
- Desktop navigation should be compact and readable.
- Mobile navigation may collapse into an accessible menu, but the identities
  and count must remain unchanged.
- Sticky behavior is optional; if used, it must not cover anchor targets.

### Hero

- Use the `hero` schema exactly.
- One background image, one eyebrow, one heading, one body, and one primary CTA.
- Do not add statistics, badges, listing cards, extra CTAs, or arbitrary blocks.
- Text must remain readable over the image at every breakpoint.
- Desktop layout should feel editorial and spacious.
- Mobile must place readable copy first and preserve a clear CTA.

### Rental search

- Render the five fixed controls:
  - location
  - property type
  - price range
  - beds
  - baths
- Labels and placeholder copy come from `rental_search`.
- Search behavior is code-owned.
- On submit, serialize non-empty filters into `/rentals` query parameters.
- Use a real `<form>` and accessible labels.
- The control may overlap the bottom of the hero on desktop.
- On mobile it must become a clean one-column panel with no horizontal overflow.

### Property services

- Use the `property_services` schema exactly.
- Preserve this fixed tuple identity and order:
  1. renovation
  2. handyman
  3. maintenance
  4. strata
  5. rental_management
- Do not allow items to be added, removed, renamed structurally, or reordered.
- Present the five services as compact, equal-height items with simple icons.
- Keep the section visually lighter than the rental cards.
- Each service CTA must reveal its nested `detail` content in an accessible
  modal, drawer, or in-page detail panel.
- The detail interaction must:
  - have a visible title;
  - expose all detail fields and included items;
  - support Escape to close;
  - provide an obvious close control;
  - trap/restore focus if implemented as a modal;
  - link its primary action to the contact section;
  - not create a new editable section.
- The main section CTA goes to `/#contact`.

### Featured rentals

- Load only active, published rental listings.
- Never display tenant data, draft listings, archived listings, or old inventory.
- Display no more than three rentals on the homepage.
- Each card should show:
  - cover image;
  - monthly rent;
  - title/address;
  - neighbourhood and city;
  - bedrooms and bathrooms;
  - square footage when available;
  - available date when available;
  - pet policy only when present.
- Use the `featured_rentals` heading, intro, CTA, and empty state.
- The View All CTA goes to `/rentals`.
- If no published rentals exist, render the schema-owned empty state instead of
  placeholders or expired inventory.
- Images must use responsive `sizes`, fixed aspect ratios, and optimized
  loading. Only the likely LCP image may use priority loading.

### About

- Use the `about` schema exactly.
- Desktop: portrait on the left, text on the right.
- Mobile: text and image must remain balanced and must not create an excessively
  tall empty area.
- Render one to three paragraphs only.
- Use the real approved Ting Ting portrait when available.
- Do not use an AI-generated or substitute person.
- Never write copy in first person that awkwardly repeats the person’s own name.
  Render the approved CMS content without inventing extra biography claims.

### Contact

- Use the `contact` schema exactly.
- Show public phone and email.
- Render all fixed fields:
  - name;
  - email;
  - phone;
  - preferred contact method;
  - message.
- Submit to `POST /api/public/contact`.
- Provide clear loading, success, validation, and server-error states.
- Preserve entered values after a failed request.
- Do not expose infrastructure errors or provider details to the visitor.
- Add a simple anti-spam honeypot field in the UI, but do not add a third-party
  CAPTCHA in this task.

### Footer

- Render all schema-owned brand, contact, office, social, and disclosure fields.
- External social links must use `https`, open safely, and include
  `rel="noopener noreferrer"` when opening a new tab.
- Keep legal copy readable; do not reduce it below a usable font size.

## 7. Responsive requirements

Validate at:

```text
375px
768px
1024px
1440px
```

Requirements:

- No horizontal overflow.
- No clipped text or controls.
- Touch targets at least 44×44px.
- Homepage reading order remains logical.
- Rent and service actions remain visible without excessive scrolling.
- Cards do not become narrow multi-column layouts on mobile.
- Anchor navigation lands below any sticky header.

## 8. Accessibility

Meet WCAG 2.2 AA fundamentals:

- One page-level `h1`.
- Logical heading hierarchy.
- Semantic header, nav, main, section, article, form, and footer landmarks.
- Every input has a programmatic label.
- Visible keyboard focus.
- All interactions work by keyboard.
- Meaningful images have accurate alt text.
- Decorative icons/images are hidden from assistive technology.
- Sufficient text/background contrast.
- Status and validation messages use appropriate live regions.
- Service detail UI manages focus correctly.

Do not claim the page is fully accessible based only on an automated scan.

## 9. Performance and security

- Keep the homepage mostly server-rendered.
- Do not make client-side requests for content that can be loaded on the server.
- Avoid layout shift by reserving image dimensions.
- Do not expose service-role keys or private tables.
- Do not use `dangerouslySetInnerHTML`.
- Do not accept raw HTML from section content.
- Do not include tenant/reminder data in page payloads.
- Keep client JavaScript limited to:
  - mobile navigation;
  - rental search;
  - service detail interaction;
  - contact form.

## 10. Error and fallback behavior

- Validate published content with the existing section schemas before rendering.
- Follow the Spec’s last-known-good revision behavior.
- Use seeded fallback content only when no compatible published revision exists.
- One invalid optional image must not crash the entire homepage.
- A rental image failure should preserve the card layout and accessible name.
- A contact API failure must show the schema-owned public error message.

## 11. Testing

Add or update tests for:

- All eight seeded homepage sections pass their schemas.
- Homepage renders only published content.
- Draft content never appears publicly.
- Service order is fixed.
- Service detail interaction opens, closes, and supports keyboard use.
- Rental section limits output to three published listings.
- Empty rental state renders correctly.
- Rental search produces the correct query parameters.
- Contact form validates required fields and handles success/failure states.
- No tenant data is requested or serialized by the homepage.

Run:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Then start the production build locally and perform browser QA:

- desktop homepage;
- 375px mobile homepage;
- all header/CTA links;
- rental search submission;
- each service detail interaction;
- valid and invalid contact forms;
- browser console errors;
- failed network requests;
- keyboard navigation;
- horizontal overflow.

If no committed visual baseline exists, report visual regression as
inconclusive rather than claiming a pixel-perfect match.

## 12. Definition of done

The task is complete only when:

1. The homepage uses the eight fixed sections in the approved order.
2. Every editable value is sourced from validated published content or
   published rental data.
3. Rentals and property services are the two strongest homepage actions.
4. Draft/private/tenant data cannot reach the public page.
5. Desktop and mobile layouts pass browser smoke testing.
6. All navigation, service details, search, and contact interactions work.
7. TypeScript, lint, tests, and production build pass.
8. No unrelated admin, reminder, database, or API behavior is regressed.

## 13. Delivery report

At completion, report:

- files changed;
- final section/component structure;
- data-loading approach;
- interactions implemented;
- tests and commands run;
- browser QA results;
- missing approved images or copy;
- any remaining production blockers.

Do not stop at a mockup. Implement and verify the working homepage in the
existing application.
