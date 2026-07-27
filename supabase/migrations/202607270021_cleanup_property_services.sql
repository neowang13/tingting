-- The former homepage service modal is no longer part of the public site.
-- Keep each fixed service card, but remove its unused detail/process document
-- so Admin does not offer fields that have no visible effect.
update public.site_sections as section
set
  draft_content = jsonb_set(
    section.draft_content,
    '{services}',
    (
      select jsonb_agg(service - 'detail' order by ordinality)
      from jsonb_array_elements(section.draft_content->'services')
        with ordinality as item(service, ordinality)
    )
  ),
  published_content = jsonb_set(
    section.published_content,
    '{services}',
    (
      select jsonb_agg(service - 'detail' order by ordinality)
      from jsonb_array_elements(section.published_content->'services')
        with ordinality as item(service, ordinality)
    )
  ),
  schema_version = greatest(section.schema_version, 3),
  updated_at = now()
where section.key = 'property_services'
  and jsonb_typeof(section.draft_content->'services') = 'array'
  and jsonb_typeof(section.published_content->'services') = 'array';
