-- Replace the Renovation public/CMS identity with Trade Services without
-- orphaning media, published revision pointers, or the revision history.

create or replace function public.migrate_renovation_page_to_trade_services(p_content jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  v_result jsonb := $trade$
  {
    "eyebrow": "TRADE SERVICES",
    "title": "A Clear First Step for Property Projects.",
    "description": "Tell us what your property needs. We’ll assess the request, confirm the available scope, and explain whether the next step is coordination or a referral to an appropriate qualified trade.",
    "heroImage": {"mediaAssetId":"11000000-0000-4000-8000-000000000001","alt":"Kitchen used as an example of a property project"},
    "heroPosition": "center 54%",
    "servicesEyebrow": "HOW REQUESTS ARE ASSESSED",
    "servicesTitle": "Clear scope before work begins.",
    "services": [
      {"title":"Project Assessment","body":"Review the request, property context, photos, timing, and any strata requirements before recommending a next step.","icon":"clipboard","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000001","alt":"Property project assessment for a kitchen"}},
      {"title":"Trade Referrals","body":"Connect you with an appropriate qualified trade when specialized or regulated work is required.","icon":"hard-hat","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000003","alt":"Bathroom fixtures reviewed for a trade-services request"}},
      {"title":"Scheduling Coordination","body":"Help align approved work, access, and communication among the property contact and service provider.","icon":"calendar","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000004","alt":"Condominium access considered during project coordination"}},
      {"title":"Scope & Quote Review","body":"Clarify who will define the work, provide the quote, collect payment, and address follow-up before work begins.","icon":"file-chart","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000002","alt":"Living space reviewed while defining project scope"}}
    ],
    "highlightTitle": "Scope comes before scheduling.",
    "highlightBody": "Each request is assessed individually. Availability, service area, provider, permits, insurance, pricing, payment, warranties, and approvals must be confirmed for the specific project.",
    "storyEyebrow": "TING TING’S ROLE",
    "storyTitle": "Coordination With Clear Boundaries.",
    "storyBody": "We help identify the next practical step and, when appropriate, coordinate communication with the service provider. The provider remains responsible for its own quote, trade work, licensing, insurance, permits, warranties, and workmanship unless a written agreement states otherwise.",
    "storyImage": {"mediaAssetId":"11000000-0000-4000-8000-000000000002","alt":"Property interior reviewed for trade-services coordination"},
    "benefits": [
      {"title":"Request Review","body":"The property, timing, access, and requested outcome are reviewed before a next step is suggested.","icon":"search"},
      {"title":"Written Next Steps","body":"The proposed provider, responsibilities, approvals, and contact path can be confirmed before scheduling.","icon":"message"},
      {"title":"Qualified-Trade Boundary","body":"Specialized or regulated work is directed to an appropriately qualified provider.","icon":"hard-hat"},
      {"title":"Approval Awareness","body":"Owner, strata, municipal, and other required approvals remain part of the project assessment.","icon":"shield"}
    ],
    "galleryEyebrow": "PROJECT REQUESTS",
    "galleryTitle": "Examples we can assess.",
    "gallery": [
      {"title":"Interior Projects","body":"Requests involving kitchens, bathrooms, finishes, fixtures, or room updates.","icon":"panel","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000001","alt":"Kitchen representing an interior project request"}},
      {"title":"Building Systems","body":"Electrical, plumbing, HVAC, and other regulated work requiring an appropriate qualified provider.","icon":"wrench","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000003","alt":"Plumbing fixtures representing a building-systems request"}},
      {"title":"Exterior & Common Property","body":"Requests that may need owner, strata, municipal, or other approval before coordination.","icon":"building","image":{"mediaAssetId":"11000000-0000-4000-8000-000000000004","alt":"Condominium exterior representing an approval-dependent request"}}
    ],
    "ctaTitle": "Request a Trade-Services Assessment",
    "ctaBody": "Describe the property, requested work, timing, and known approvals so we can confirm an appropriate next step."
  }
  $trade$::jsonb;
  v_index integer;
  v_media_id jsonb;
begin
  if jsonb_typeof(p_content) <> 'object' then
    return v_result;
  end if;

  v_media_id := p_content #> '{heroImage,mediaAssetId}';
  if jsonb_typeof(v_media_id) = 'string' then
    v_result := jsonb_set(v_result, '{heroImage,mediaAssetId}', v_media_id);
  end if;
  v_media_id := p_content #> '{storyImage,mediaAssetId}';
  if jsonb_typeof(v_media_id) = 'string' then
    v_result := jsonb_set(v_result, '{storyImage,mediaAssetId}', v_media_id);
  end if;
  if jsonb_typeof(p_content->'heroPosition') = 'string' then
    v_result := jsonb_set(v_result, '{heroPosition}', p_content->'heroPosition');
  end if;

  for v_index in 0..3 loop
    v_media_id := p_content #> array['services', v_index::text, 'image', 'mediaAssetId'];
    if jsonb_typeof(v_media_id) = 'string' then
      v_result := jsonb_set(
        v_result,
        array['services', v_index::text, 'image', 'mediaAssetId'],
        v_media_id
      );
    end if;
  end loop;
  for v_index in 0..2 loop
    v_media_id := p_content #> array['gallery', v_index::text, 'image', 'mediaAssetId'];
    if jsonb_typeof(v_media_id) = 'string' then
      v_result := jsonb_set(
        v_result,
        array['gallery', v_index::text, 'image', 'mediaAssetId'],
        v_media_id
      );
    end if;
  end loop;

  return v_result;
end;
$$;

create or replace function public.migrate_homepage_renovation_card_to_trade_services(p_content jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(p_content->'services') <> 'array' then p_content
    else jsonb_set(
      p_content,
      '{services}',
      coalesce(
        (
          select jsonb_agg(
            case
              when service->>'key' = 'renovation' then
                jsonb_build_object(
                  'key', 'trade_services',
                  'title', 'Trade Services',
                  'summary', 'Assessment and coordination for approved property projects, with qualified trades engaged where required.',
                  'ctaLabel', 'Explore Trade Services'
                )
              else service
            end
            order by ordinality
          )
          from jsonb_array_elements(p_content->'services') with ordinality as item(service, ordinality)
        ),
        '[]'::jsonb
      )
    )
  end;
$$;

update public.site_sections
set draft_content = public.migrate_homepage_renovation_card_to_trade_services(draft_content),
    published_content = public.migrate_homepage_renovation_card_to_trade_services(published_content),
    schema_version = greatest(schema_version, 4),
    updated_at = now()
where key = 'property_services';

update public.site_section_revisions
set content = public.migrate_homepage_renovation_card_to_trade_services(content),
    schema_version = greatest(schema_version, 4)
where section_key = 'property_services';

do $$
declare
  v_old public.site_sections%rowtype;
  v_temporary_sort integer;
begin
  if exists (select 1 from public.site_sections where key = 'service_trade_services') then
    if exists (select 1 from public.site_sections where key = 'service_renovation') then
      raise exception 'Cannot migrate Trade Services: old and new CMS sections both exist';
    end if;
    return;
  end if;

  select * into v_old
  from public.site_sections
  where key = 'service_renovation'
  for update;

  if not found then
    raise exception 'Cannot migrate Trade Services: service_renovation CMS section is missing';
  end if;

  select coalesce(min(sort_order), 0) - 1 into v_temporary_sort
  from public.site_sections;

  update public.site_sections
  set sort_order = v_temporary_sort
  where key = v_old.key;

  insert into public.site_sections (
    key,
    display_name,
    sort_order,
    schema_version,
    draft_content,
    published_content,
    published_revision_id,
    updated_by,
    updated_at,
    published_at
  ) values (
    'service_trade_services',
    'Trade services',
    v_old.sort_order,
    greatest(v_old.schema_version, 2),
    public.migrate_renovation_page_to_trade_services(v_old.draft_content),
    public.migrate_renovation_page_to_trade_services(v_old.published_content),
    v_old.published_revision_id,
    v_old.updated_by,
    now(),
    v_old.published_at
  );

  update public.site_section_revisions
  set section_key = 'service_trade_services',
      schema_version = greatest(schema_version, 2),
      content = public.migrate_renovation_page_to_trade_services(content)
  where section_key = 'service_renovation';

  update public.audit_events
  set target_id = 'service_trade_services'
  where target_type = 'site_section'
    and target_id = 'service_renovation';

  delete from public.site_sections where key = 'service_renovation';
end;
$$;

drop function public.migrate_homepage_renovation_card_to_trade_services(jsonb);
drop function public.migrate_renovation_page_to_trade_services(jsonb);
