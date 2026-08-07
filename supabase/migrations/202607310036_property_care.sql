-- Merge the Handyman and Property Maintenance CMS identities into one
-- compliance-scoped Property Care page without orphaning revisions or media.
create function pg_temp.merge_property_care(
  handyman jsonb,
  maintenance jsonb,
  template jsonb
)
returns jsonb
language plpgsql
as $$
declare
  merged jsonb := template;
begin
  if handyman #> '{heroImage,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{heroImage,mediaAssetId}', handyman #> '{heroImage,mediaAssetId}');
  elsif maintenance #> '{heroImage,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{heroImage,mediaAssetId}', maintenance #> '{heroImage,mediaAssetId}');
  end if;
  if jsonb_typeof(handyman->'heroPosition') = 'string' then
    merged := jsonb_set(merged, '{heroPosition}', handyman->'heroPosition');
  elsif jsonb_typeof(maintenance->'heroPosition') = 'string' then
    merged := jsonb_set(merged, '{heroPosition}', maintenance->'heroPosition');
  end if;
  if maintenance #> '{storyImage,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{storyImage,mediaAssetId}', maintenance #> '{storyImage,mediaAssetId}');
  elsif handyman #> '{storyImage,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{storyImage,mediaAssetId}', handyman #> '{storyImage,mediaAssetId}');
  end if;

  if handyman #> '{gallery,0,image,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{gallery,0,image,mediaAssetId}', handyman #> '{gallery,0,image,mediaAssetId}');
  end if;
  if handyman #> '{gallery,2,image,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{gallery,1,image,mediaAssetId}', handyman #> '{gallery,2,image,mediaAssetId}');
  end if;
  if maintenance #> '{gallery,0,image,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{gallery,2,image,mediaAssetId}', maintenance #> '{gallery,0,image,mediaAssetId}');
  end if;
  if maintenance #> '{gallery,3,image,mediaAssetId}' is not null then
    merged := jsonb_set(merged, '{gallery,3,image,mediaAssetId}', maintenance #> '{gallery,3,image,mediaAssetId}');
  end if;
  return merged;
end;
$$;

create function pg_temp.merge_property_care_homepage(content jsonb)
returns jsonb
language sql
as $$
  select case
    when jsonb_typeof(content->'services') <> 'array' then content
    when exists (
      select 1 from jsonb_array_elements(content->'services') service
      where service->>'key' = 'property_care'
    ) then content
    else jsonb_set(
      content,
      '{services}',
      coalesce(
        (
          select jsonb_agg(
            case when service->>'key' = 'handyman' then
              '{"key":"property_care","title":"Property Care: Handyman + Maintenance","summary":"One-time fixes and ongoing upkeep, with clear scope and trade referrals where required.","ctaLabel":"Explore Property Care"}'::jsonb
            else service end
            order by ordinal
          )
          from jsonb_array_elements(content->'services') with ordinality as services(service, ordinal)
          where service->>'key' <> 'maintenance'
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

update public.site_sections
set draft_content = pg_temp.merge_property_care_homepage(draft_content),
    published_content = pg_temp.merge_property_care_homepage(published_content),
    schema_version = greatest(schema_version, 6),
    updated_at = now()
where key = 'property_services';

update public.site_section_revisions
set content = pg_temp.merge_property_care_homepage(content),
    schema_version = greatest(schema_version, 6)
where section_key = 'property_services';

do $$
declare
  handyman_section public.site_sections%rowtype;
  maintenance_section public.site_sections%rowtype;
  property_care_template jsonb := $care$
  {
    "eyebrow":"PROPERTY CARE · HANDYMAN + MAINTENANCE",
    "title":"One-Time Fixes and Ongoing Property Upkeep.",
    "description":"Property-care requests are reviewed before scheduling so the scope, provider, approvals, and next step are clear. Specialized or regulated work is referred to or coordinated with an appropriately qualified provider where required.",
    "heroImage":{"mediaAssetId":"11000000-0000-4000-8000-000000000006","alt":"Tools and supplies prepared for a property-care assessment"},
    "heroPosition":"center 58%",
    "servicesEyebrow":"ONE-TIME AND ONGOING PROPERTY CARE",
    "servicesTitle":"Two kinds of support, one clear request path.",
    "services":[
      {"title":"One-Time Fixes · Mounting & Assembly","body":"Requests for furniture assembly, shelving, mirrors, artwork, and similar non-regulated installations can be assessed for an appropriate service provider.","icon":"panel"},
      {"title":"One-Time Fixes · Walls, Doors & Hardware","body":"Drywall touch-ups, minor paint repairs, door adjustments, handles, hinges, and cabinet hardware can be scoped before scheduling.","icon":"door"},
      {"title":"One-Time Fixes · Minor Fixture Support","body":"Minor caulking, sealing, fixture, faucet, or drain requests are assessed first; regulated plumbing or electrical work is directed to a qualified trade.","icon":"droplets"},
      {"title":"Ongoing Upkeep · Cleaning & Exterior Care","body":"One-time or recurring cleaning and exterior-care requests can be coordinated after access, surfaces, safety limits, and approvals are confirmed.","icon":"sparkles"},
      {"title":"Ongoing Upkeep · Lawn & Seasonal Tasks","body":"Lawn care, pruning, leaf or gutter clearing, weather preparation, and seasonal clean-up are considered according to the property and season.","icon":"flower"},
      {"title":"Ongoing Upkeep · Preventive Property Checks","body":"Agreed visual checks can identify concerns for owner review; inspections, diagnosis, and regulated work remain with the appropriate qualified professional.","icon":"clipboard"}
    ],
    "highlightTitle":"Scope and responsibility are confirmed first.",
    "highlightBody":"Availability, geography, provider relationship, estimate, payment, insurance, warranties, safety rules, strata or owner approvals, and emergency limitations must be confirmed for each request.",
    "storyEyebrow":"HOW PROPERTY CARE IS COORDINATED",
    "storyTitle":"The Right Provider for the Approved Scope.",
    "storyBody":"We help review the request and coordinate an appropriate next step. Each service provider remains responsible for its own work, qualifications, insurance, quote, payment terms, safety practices, and warranties unless a written agreement states otherwise. This service is not an emergency-response line.",
    "storyImage":{"mediaAssetId":"11000000-0000-4000-8000-000000000009","alt":"Home exterior reviewed for ongoing property-care needs"},
    "benefits":[
      {"title":"Request Review","body":"Photos, timing, access, property context, and the requested outcome help define the next step.","icon":"search"},
      {"title":"Written Scope","body":"Included work, exclusions, provider, estimate, approvals, and follow-up path can be confirmed before scheduling.","icon":"file-chart"},
      {"title":"Qualified-Provider Boundary","body":"Specialized or regulated work is referred to or coordinated with an appropriately qualified provider.","icon":"hard-hat"},
      {"title":"Approval Awareness","body":"Owner, strata, municipal, and other required permissions remain part of the request assessment.","icon":"shield"}
    ],
    "galleryEyebrow":"PROPERTY-CARE REQUESTS",
    "galleryTitle":"Examples of requests we can assess.",
    "gallery":[
      {"title":"Mounting & Assembly","body":"One-time household installation and assembly requests.","icon":"panel","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000002","alt":"Living room representing mounting and assembly requests"}},
      {"title":"Doors, Walls & Fixtures","body":"Minor repair requests reviewed for safe scope and provider needs.","icon":"door","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000005","alt":"Interior door and hardware representing minor repair requests"}},
      {"title":"Exterior & Seasonal Care","body":"Property-specific outdoor and seasonal upkeep requests.","icon":"flower","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000008","alt":"Garden representing seasonal property-care requests"}},
      {"title":"Preventive Checks","body":"Documented visual checks with concerns escalated for appropriate follow-up.","icon":"clipboard","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000009","alt":"Home exterior representing preventive property checks"}}
    ],
    "ctaTitle":"Discuss a Property-Care Request",
    "ctaBody":"Describe the property, requested work, timing, access, and known approvals so the scope and appropriate next step can be confirmed."
  }
  $care$::jsonb;
  temporary_sort integer;
begin
  if exists (select 1 from public.site_sections where key = 'service_property_care') then
    if exists (
      select 1 from public.site_sections
      where key in ('service_handyman', 'service_maintenance')
    ) then
      raise exception 'Cannot merge Property Care: canonical and legacy CMS sections both exist';
    end if;
    return;
  end if;

  select * into handyman_section
  from public.site_sections
  where key = 'service_handyman'
  for update;
  if not found then
    raise exception 'Cannot merge Property Care: service_handyman CMS section is missing';
  end if;

  select * into maintenance_section
  from public.site_sections
  where key = 'service_maintenance'
  for update;
  if not found then
    raise exception 'Cannot merge Property Care: service_maintenance CMS section is missing';
  end if;

  select coalesce(min(sort_order), 0) - 2 into temporary_sort from public.site_sections;
  update public.site_sections set sort_order = temporary_sort where key = 'service_handyman';
  update public.site_sections set sort_order = temporary_sort + 1 where key = 'service_maintenance';

  insert into public.site_sections (
    key, display_name, sort_order, schema_version, draft_content,
    published_content, published_revision_id, updated_by, updated_at, published_at
  ) values (
    'service_property_care',
    'Property care: handyman + maintenance',
    least(handyman_section.sort_order, maintenance_section.sort_order),
    2,
    pg_temp.merge_property_care(handyman_section.draft_content, maintenance_section.draft_content, property_care_template),
    pg_temp.merge_property_care(handyman_section.published_content, maintenance_section.published_content, property_care_template),
    coalesce(handyman_section.published_revision_id, maintenance_section.published_revision_id),
    coalesce(handyman_section.updated_by, maintenance_section.updated_by),
    now(),
    case
      when handyman_section.published_at is null then maintenance_section.published_at
      when maintenance_section.published_at is null then handyman_section.published_at
      else greatest(handyman_section.published_at, maintenance_section.published_at)
    end
  );

  update public.site_section_revisions
  set section_key = 'service_property_care'
  where section_key in ('service_handyman', 'service_maintenance');

  update public.audit_events
  set target_id = 'service_property_care'
  where target_type = 'site_section'
    and target_id in ('service_handyman', 'service_maintenance');

  delete from public.site_sections
  where key in ('service_handyman', 'service_maintenance');
end;
$$;
