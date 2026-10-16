-- Postal code, furnishing, lease type, smoking and pet policy are optional.
-- Keep required property identity, availability and photo/cover validation.
-- Ignore legacy review flags only for the five newly optional fields.
create or replace function public.set_rental_status_with_media(
  p_id uuid,
  p_action text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid,
  p_media jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rental public.rental_listings;
  v_media_item jsonb;
  v_cover_count integer;
  v_image_count integer;
  v_snapshot jsonb;
  v_revision_id uuid;
begin
  if p_action not in ('publish', 'unpublish', 'archive') then
    raise exception using errcode = '22023', message = 'invalid rental action';
  end if;
  select * into v_rental
  from public.rental_listings
  where id = p_id and updated_at = p_expected_updated_at
  for update;
  if not found then
    raise exception using errcode = 'TT409', message = 'stale rental';
  end if;

  if p_action = 'publish' then
    if exists (
      select 1 from unnest(v_rental.review_required_fields) as review(field)
      where review.field <> all(array[
        'property.postalCode', 'layout.furnishedStatus', 'availability.leaseType',
        'smokingPolicy', 'pets.status'
      ]::text[])
    )
      or v_rental.availability_status is null
      or not exists (
        select 1 from public.rental_properties property
        where property.id = v_rental.property_id
          and property.property_type is not null
          and property.province_code is not null
      )
    then
      raise exception using errcode = '23514', message = 'listing is missing publish requirements';
    end if;

    for v_media_item in
      select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb))
    loop
      update public.media_assets
      set state = 'published',
          published_storage_path = v_media_item->>'path',
          public_url = v_media_item->>'url'
      where id = (v_media_item->>'id')::uuid
        and state in ('draft', 'published');
      if not found then
        raise exception using errcode = '23514', message = 'rental media is unavailable';
      end if;
    end loop;

    select count(*), count(*) filter (where image.is_cover)
    into v_image_count, v_cover_count
    from public.rental_listing_images image
    join public.media_assets media on media.id = image.media_asset_id
    where image.rental_listing_id = p_id
      and media.state = 'published'
      and media.public_url is not null;
    if v_image_count < 1 or v_image_count > 20 or v_cover_count <> 1 then
      raise exception using errcode = '23514', message = 'listing requires one to twenty images and exactly one cover';
    end if;

    v_snapshot := public.build_rental_public_snapshot(p_id);
    insert into public.rental_listing_revisions(
      rental_listing_id, content_snapshot, action, schema_version,
      source_digest, created_by
    ) values (
      p_id, v_snapshot, 'publish', 2, v_rental.draft_digest, p_actor_id
    ) returning id into v_revision_id;

    update public.rental_listings
    set status = 'published',
        published_revision_id = v_revision_id,
        published_at = now(),
        updated_at = now(),
        updated_by = p_actor_id
    where id = p_id;
  else
    insert into public.rental_listing_revisions(
      rental_listing_id, content_snapshot, action, schema_version, created_by
    ) values (
      p_id, public.build_rental_public_snapshot(p_id), p_action, 2, p_actor_id
    );
    update public.rental_listings
    set status = case when p_action = 'archive' then 'archived' else 'draft' end,
        published_revision_id = null,
        updated_at = now(),
        updated_by = p_actor_id
    where id = p_id;
  end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id, 'rental.' || p_action, 'rental_listing', p_id::text,
    jsonb_build_object('publishedRevisionId', v_revision_id, 'schemaVersion', 2)
  );

  return (
    select to_jsonb(result)
    from public.admin_rental_listings_v2 result
    where result.id = p_id
  );
end;
$$;

revoke all on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb) to service_role;
