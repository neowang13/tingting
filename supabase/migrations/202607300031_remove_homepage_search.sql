-- The homepage no longer shows the legacy search bar. Keep the section row for
-- backward compatibility, but update the visible hero action to describe the
-- featured-rentals destination accurately.

update public.site_sections
set draft_content = jsonb_set(
      jsonb_set(draft_content, '{primaryCta,label}', '"View Rentals"'::jsonb, true),
      '{primaryCta,href}',
      '"/#rentals"'::jsonb,
      true
    ),
    published_content = jsonb_set(
      jsonb_set(published_content, '{primaryCta,label}', '"View Rentals"'::jsonb, true),
      '{primaryCta,href}',
      '"/#rentals"'::jsonb,
      true
    ),
    updated_at = now()
where key = 'hero';
