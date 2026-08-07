-- Tighten the homepage service-card copy and rename the public Property Care
-- card while preserving its stable CMS key and existing detail-page route.
create function pg_temp.refresh_public_service_cards(content jsonb)
returns jsonb
language sql
as $$
  select case
    when content is null
      or jsonb_typeof(content) <> 'object'
      or jsonb_typeof(content->'services') <> 'array'
      then content
    else jsonb_set(
      jsonb_set(
        content,
        '{heading}',
        to_jsonb('Practical care for every part of your property.'::text)
      ),
      '{body}',
      to_jsonb('Reliable support for repairs, projects, ongoing care, and rental management across Greater Vancouver.'::text)
    ) || jsonb_build_object(
      'services',
      (
        select jsonb_agg(
          case service->>'key'
            when 'rental_management' then service || jsonb_build_object(
              'title', 'Rental Management',
              'summary', 'Tenant placement, rent collection, inspections, and day-to-day coordination.',
              'ctaLabel', 'Rental management'
            )
            when 'trade_services' then service || jsonb_build_object(
              'title', 'Trade Services',
              'summary', 'Project assessment and coordination with qualified trades.',
              'ctaLabel', 'Trade services'
            )
            when 'property_care' then service || jsonb_build_object(
              'title', 'Property Management',
              'summary', 'Repairs and ongoing upkeep, clearly scoped from the start.',
              'ctaLabel', 'Property management'
            )
            when 'strata' then service || jsonb_build_object(
              'title', 'Strata Services',
              'summary', 'Repairs, access, moves, and service coordination for strata properties.',
              'ctaLabel', 'Strata services'
            )
            else service
          end
          order by ordinal
        )
        from jsonb_array_elements(content->'services') with ordinality as services(service, ordinal)
      )
    )
  end;
$$;

update public.site_sections
set draft_content = pg_temp.refresh_public_service_cards(draft_content),
    published_content = pg_temp.refresh_public_service_cards(published_content),
    schema_version = greatest(schema_version, 7),
    updated_at = now()
where key = 'property_services';

update public.site_section_revisions
set content = pg_temp.refresh_public_service_cards(content),
    schema_version = greatest(schema_version, 7)
where section_key = 'property_services';
