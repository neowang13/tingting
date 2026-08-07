-- Expand Rental Management into distinct residential and commercial scopes.
-- Existing administrator-selected media IDs and focal positions are preserved;
-- prior revisions remain untouched and are upgraded by the application schema
-- if an administrator restores one later.
create function pg_temp.upgrade_rental_management(content jsonb, template jsonb)
returns jsonb
language plpgsql
as $$
declare
  upgraded jsonb := template;
  item_index integer;
begin
  if content is null or jsonb_typeof(content) <> 'object' then
    return upgraded;
  end if;

  if content #> '{heroImage,mediaAssetId}' is not null then
    upgraded := jsonb_set(upgraded, '{heroImage,mediaAssetId}', content #> '{heroImage,mediaAssetId}');
  end if;
  if content #> '{storyImage,mediaAssetId}' is not null then
    upgraded := jsonb_set(upgraded, '{storyImage,mediaAssetId}', content #> '{storyImage,mediaAssetId}');
  end if;
  if jsonb_typeof(content->'heroPosition') = 'string' then
    upgraded := jsonb_set(upgraded, '{heroPosition}', content->'heroPosition');
  end if;

  for item_index in 0..3 loop
    if content #> array['gallery', item_index::text, 'image', 'mediaAssetId'] is not null then
      upgraded := jsonb_set(
        upgraded,
        array['gallery', item_index::text, 'image', 'mediaAssetId'],
        content #> array['gallery', item_index::text, 'image', 'mediaAssetId']
      );
    end if;
  end loop;

  return upgraded;
end;
$$;

with rental_template as (
  select $rental${"eyebrow":"RESIDENTIAL & COMMERCIAL RENTAL MANAGEMENT","title":"Rental Management for Homes and Commercial Properties.","description":"Residential and commercial rental-management support in Greater Vancouver, with responsibilities, authority, fees, and next steps confirmed for each property before service begins.","heroImage":{"mediaAssetId":"11000000-0000-4000-8000-000000000012","alt":"Rental property represented by a modern building exterior"},"heroPosition":"center 56%","managementTypesEyebrow":"TWO RENTAL CONTEXTS","managementTypesTitle":"Different properties require different management plans.","managementTypes":[{"title":"Residential Rental Management","summary":"Support for homes and residential tenancies is scoped to the property, the owner’s authority, and applicable brokerage requirements before any work begins.","tasks":["Coordinate approved marketing, enquiries, showings, application information, and tenancy documentation.","Track rent administration, scheduled condition inspections, notices, records, and owner reporting within the agreed scope.","Receive tenant requests and coordinate approved access, maintenance, and qualified providers when specialized work is required."],"intake":"Property type and location, occupancy and tenancy status, rent and deposit records, strata rules, known repairs, service authority, and owner priorities.","framework":"Work must follow the BC Residential Tenancy Act and regulations, brokerage policies, the management agreement, and lawful owner instructions. Legal advice and unapproved work are excluded.","escalation":"Life-safety emergencies go to emergency services or the appropriate utility. Disputes, legal questions, regulated work, and costs beyond approved authority are escalated to the owner or an appropriate professional."},{"title":"Commercial Rental Management","summary":"Support for offices, retail, and other approved commercial spaces is built around the negotiated lease and a written property-specific scope.","tasks":["Coordinate approved leasing enquiries, showings, applicant information, possession details, renewals, and lease-administration milestones.","Track base rent, additional-rent or operating-cost information, records, and owner reporting as defined by the lease and management agreement.","Coordinate tenant access, service requests, vendors, and owner-approved maintenance while recording responsibilities under the lease."],"intake":"Property and permitted use, lease status and key dates, rent and operating-cost terms, access rules, insurance requirements, service contracts, authority limits, and owner priorities.","framework":"Commercial work follows the negotiated lease, applicable laws, brokerage policies, and written owner authority; residential-tenancy rules do not govern commercial leases. Legal, tax, and accounting advice are excluded.","escalation":"Defaults, disputes, environmental or life-safety issues, regulated work, and decisions outside approved authority are referred to the owner and the appropriate legal, accounting, emergency, or qualified service professional."}],"servicesEyebrow":"SHARED MANAGEMENT SUPPORT","servicesTitle":"A documented plan for day-to-day coordination.","services":[{"title":"Leasing & Onboarding","body":"Coordinate approved marketing, enquiries, documentation, access, and move-in or possession steps for the property type.","icon":"users"},{"title":"Rent Administration & Reporting","body":"Track agreed rent information, records, follow-up, and owner reports without making unapproved financial or legal decisions.","icon":"file-chart"},{"title":"Property Checks & Maintenance","body":"Coordinate agreed inspections, service requests, access, and qualified providers within documented authority limits.","icon":"wrench"},{"title":"Communication & Escalation","body":"Keep owners and occupants informed, document material issues, and escalate emergencies, disputes, and out-of-scope decisions.","icon":"message"}],"highlightTitle":"Scope is confirmed before management begins.","highlightBody":"Property type, geography, fees, availability, money handling, repair authority, reporting, and the responsible service entity must be approved in writing for each engagement.","storyEyebrow":"HOW THE SERVICE IS DEFINED","storyTitle":"Clear Authority. Documented Responsibilities.","storyBody":"The owner, brokerage, and service provider confirm who may act, what is included, how records and funds are handled, and when approval or specialist help is required. No page can replace the property-specific management agreement or lease.","storyImage":{"mediaAssetId":"11000000-0000-4000-8000-000000000011","alt":"Greater Vancouver skyline with residential and commercial buildings"},"benefits":[{"title":"Property-Specific Intake","body":"Start with the property, lease or tenancy, current records, risks, and owner priorities.","icon":"clipboard"},{"title":"Written Scope","body":"Document included work, exclusions, fees, authority limits, availability, and reporting expectations.","icon":"file-chart"},{"title":"Approval Controls","body":"Refer costs, notices, disputes, regulated work, and other material decisions to the appropriate approver.","icon":"shield"},{"title":"Recorded Communication","body":"Maintain practical updates and records for owners, occupants, providers, and approved professionals.","icon":"message"}],"galleryEyebrow":"MANAGEMENT WORKFLOWS","galleryTitle":"Examples of property-specific coordination.","gallery":[{"title":"Residential Leasing","body":"Approved enquiries, showing access, applicant information, and tenancy documentation.","icon":"users","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000013","alt":"Office setting for a residential leasing consultation"}},{"title":"Commercial Lease Administration","body":"Key dates, possession details, rent terms, records, and lease-specific owner approvals.","icon":"building","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000014","alt":"Commercial lease administration documents"}},{"title":"Property Access & Maintenance","body":"Documented access, requests, authority limits, and qualified-provider coordination.","icon":"wrench","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000006","alt":"Maintenance tools used for rental property coordination"}},{"title":"Reporting & Escalation","body":"Owner updates, supporting records, open decisions, and referrals for out-of-scope issues.","icon":"file-chart","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000014","alt":"Rental property reports and supporting records"}}],"ctaTitle":"Discuss Your Residential or Commercial Rental","ctaBody":"Tell us about the property, current tenancy or lease, timing, and support needed so the appropriate scope and next step can be confirmed."}$rental$::jsonb as content
)
update public.site_sections as section
set display_name = 'Residential & commercial rental management',
    draft_content = pg_temp.upgrade_rental_management(section.draft_content, rental_template.content),
    published_content = pg_temp.upgrade_rental_management(section.published_content, rental_template.content),
    schema_version = greatest(section.schema_version, 2),
    updated_at = now()
from rental_template
where section.key = 'service_rental_management';

-- Keep both CMS versions of the homepage card synchronized by stable key.
update public.site_sections as section
set draft_content = jsonb_set(
      section.draft_content,
      '{services}',
      (
        select jsonb_agg(
          case when service->>'key' = 'rental_management' then
            service || '{"title":"Rental Management","summary":"Residential and commercial rental-management support, with scope and next steps tailored to the property.","ctaLabel":"Explore Rental Management"}'::jsonb
          else service end
          order by ordinal
        )
        from jsonb_array_elements(section.draft_content->'services') with ordinality as services(service, ordinal)
      )
    ),
    published_content = jsonb_set(
      section.published_content,
      '{services}',
      (
        select jsonb_agg(
          case when service->>'key' = 'rental_management' then
            service || '{"title":"Rental Management","summary":"Residential and commercial rental-management support, with scope and next steps tailored to the property.","ctaLabel":"Explore Rental Management"}'::jsonb
          else service end
          order by ordinal
        )
        from jsonb_array_elements(section.published_content->'services') with ordinality as services(service, ordinal)
      )
    ),
    schema_version = greatest(section.schema_version, 5),
    updated_at = now()
where section.key = 'property_services'
  and jsonb_typeof(section.draft_content->'services') = 'array'
  and jsonb_typeof(section.published_content->'services') = 'array';
