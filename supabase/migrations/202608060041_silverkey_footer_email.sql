-- Keep the published footer contact link aligned with the Silver Key inbox.
update public.site_sections
set draft_content = jsonb_set(draft_content, '{email}', '"info@silverkey.ca"'::jsonb, true),
    published_content = jsonb_set(published_content, '{email}', '"info@silverkey.ca"'::jsonb, true),
    updated_at = now()
where key = 'footer';
