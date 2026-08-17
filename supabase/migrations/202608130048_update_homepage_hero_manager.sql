-- Keep existing hero copy and media while updating the public manager identity.
update public.site_sections
set draft_content = jsonb_set(
      draft_content,
      '{eyebrow}',
      to_jsonb('Managed by TingTing Xu Personal Real Estate Corporation'::text),
      true
    ),
    published_content = jsonb_set(
      published_content,
      '{eyebrow}',
      to_jsonb('Managed by TingTing Xu Personal Real Estate Corporation'::text),
      true
    ),
    updated_at = now()
where key = 'hero';
