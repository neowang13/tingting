-- Add the fifth fixed property service while preserving all administrator copy
-- already stored in the property_services draft and published documents.
with rental_management as (
  select '{
    "key": "rental_management",
    "title": "Rental Management",
    "summary": "Tenant support, rent coordination, inspections, and day-to-day care for rental properties.",
    "ctaLabel": "Explore Rental Management",
    "detail": {
      "eyebrow": "RENTAL MANAGEMENT",
      "heading": "Dependable oversight for your rental property.",
      "body": "Keep your rental running smoothly with responsive tenant communication, routine oversight, and practical property care.",
      "includedHeading": "Rental management includes",
      "includedItems": [
        "Tenant communication",
        "Rent coordination",
        "Routine inspections",
        "Maintenance coordination"
      ],
      "processHeading": "Clear, ongoing support",
      "processBody": "We coordinate day-to-day needs, keep you informed, and help protect the property over time.",
      "primaryCtaLabel": "Request Rental Management",
      "secondaryCtaLabel": "Ask a Question"
    }
  }'::jsonb as service
)
update public.site_sections as section
set draft_content = case
      when jsonb_typeof(section.draft_content->'services') = 'array'
        and not section.draft_content->'services' @> '[{"key":"rental_management"}]'::jsonb
      then jsonb_set(
        section.draft_content,
        '{services}',
        section.draft_content->'services' || jsonb_build_array(rental_management.service)
      )
      else section.draft_content
    end,
    published_content = case
      when jsonb_typeof(section.published_content->'services') = 'array'
        and not section.published_content->'services' @> '[{"key":"rental_management"}]'::jsonb
      then jsonb_set(
        section.published_content,
        '{services}',
        section.published_content->'services' || jsonb_build_array(rental_management.service)
      )
      else section.published_content
    end,
    schema_version = greatest(section.schema_version, 2),
    updated_at = now()
from rental_management
where section.key = 'property_services';
