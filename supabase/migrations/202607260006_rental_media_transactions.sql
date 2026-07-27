drop view if exists public.admin_rental_listings;
create view public.admin_rental_listings
with (security_barrier = true)
as
select
  rental.*,
  cover_media.public_url as cover_image_url,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'mediaAssetId', image.media_asset_id,
      'url', media.public_url,
      'alt', media.alt_text,
      'sortOrder', image.sort_order,
      'isCover', image.is_cover
    ) order by image.sort_order)
    from public.rental_listing_images image
    join public.media_assets media on media.id = image.media_asset_id
    where image.rental_listing_id = rental.id
  ), '[]'::jsonb) as images
from public.rental_listings rental
left join public.rental_listing_images cover_image
  on cover_image.rental_listing_id = rental.id and cover_image.is_cover
left join public.media_assets cover_media
  on cover_media.id = cover_image.media_asset_id;

revoke all on public.admin_rental_listings from anon, authenticated;

create or replace function public.save_rental_listing(
  p_id uuid,
  p_payload jsonb,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rental public.rental_listings;
  v_image jsonb;
  v_cover_count integer;
begin
  if p_id is null then
    insert into public.rental_listings(
      slug, title, address_line, neighbourhood, city, monthly_rent_cents,
      bedrooms, bathrooms, square_feet, available_on, pet_policy, description,
      sort_order, created_by, updated_by
    )
    values (
      p_payload->>'slug',
      p_payload->>'title',
      p_payload->>'addressLine',
      nullif(p_payload->>'neighbourhood', ''),
      p_payload->>'city',
      (p_payload->>'monthlyRentCents')::integer,
      (p_payload->>'bedrooms')::numeric,
      (p_payload->>'bathrooms')::numeric,
      nullif(p_payload->>'squareFeet', '')::integer,
      nullif(p_payload->>'availableOn', '')::date,
      nullif(p_payload->>'petPolicy', ''),
      p_payload->>'description',
      (p_payload->>'sortOrder')::integer,
      p_actor_id,
      p_actor_id
    )
    returning * into v_rental;
  else
    select * into v_rental
    from public.rental_listings
    where id = p_id and updated_at = p_expected_updated_at
    for update;
    if not found then raise exception using errcode = 'TT409', message = 'stale rental'; end if;
    if v_rental.published_at is not null and v_rental.slug <> p_payload->>'slug' then
      raise exception using errcode = 'TT409', message = 'rental slug is immutable';
    end if;

    update public.rental_listings
    set title = p_payload->>'title',
        address_line = p_payload->>'addressLine',
        neighbourhood = nullif(p_payload->>'neighbourhood', ''),
        city = p_payload->>'city',
        monthly_rent_cents = (p_payload->>'monthlyRentCents')::integer,
        bedrooms = (p_payload->>'bedrooms')::numeric,
        bathrooms = (p_payload->>'bathrooms')::numeric,
        square_feet = nullif(p_payload->>'squareFeet', '')::integer,
        available_on = nullif(p_payload->>'availableOn', '')::date,
        pet_policy = nullif(p_payload->>'petPolicy', ''),
        description = p_payload->>'description',
        sort_order = (p_payload->>'sortOrder')::integer,
        updated_by = p_actor_id,
        updated_at = now()
    where id = p_id
    returning * into v_rental;
  end if;

  delete from public.rental_listing_images where rental_listing_id = v_rental.id;
  for v_image in select * from jsonb_array_elements(coalesce(p_payload->'images', '[]'::jsonb))
  loop
    insert into public.rental_listing_images(
      rental_listing_id, media_asset_id, sort_order, is_cover
    )
    values (
      v_rental.id,
      (v_image->>'mediaAssetId')::uuid,
      (v_image->>'sortOrder')::integer,
      (v_image->>'isCover')::boolean
    );
  end loop;

  select count(*) into v_cover_count
  from public.rental_listing_images
  where rental_listing_id = v_rental.id and is_cover;
  if v_cover_count > 1 then
    raise exception using errcode = '23514', message = 'only one cover image is allowed';
  end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'rental.saved', 'rental_listing', v_rental.id::text);

  return to_jsonb(v_rental)
    || jsonb_build_object(
      'cover_image_url', (
        select media.public_url
        from public.rental_listing_images image
        join public.media_assets media on media.id = image.media_asset_id
        where image.rental_listing_id = v_rental.id and image.is_cover
      ),
      'images', coalesce((
        select jsonb_agg(jsonb_build_object(
          'mediaAssetId', image.media_asset_id,
          'url', media.public_url,
          'alt', media.alt_text,
          'sortOrder', image.sort_order,
          'isCover', image.is_cover
        ) order by image.sort_order)
        from public.rental_listing_images image
        join public.media_assets media on media.id = image.media_asset_id
        where image.rental_listing_id = v_rental.id
      ), '[]'::jsonb)
    );
end;
$$;

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
begin
  if p_action not in ('publish', 'unpublish', 'archive') then
    raise exception using errcode = '22023', message = 'invalid rental action';
  end if;
  select * into v_rental
  from public.rental_listings
  where id = p_id and updated_at = p_expected_updated_at
  for update;
  if not found then raise exception using errcode = 'TT409', message = 'stale rental'; end if;

  if p_action = 'publish' then
    for v_media_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb))
    loop
      update public.media_assets
      set state = 'published',
          published_storage_path = v_media_item->>'path',
          public_url = v_media_item->>'url'
      where id = (v_media_item->>'id')::uuid and state in ('draft', 'published');
      if not found then raise exception using errcode = '23514', message = 'rental media is unavailable'; end if;
    end loop;

    select count(*) into v_cover_count
    from public.rental_listing_images image
    join public.media_assets media on media.id = image.media_asset_id
    where image.rental_listing_id = p_id
      and image.is_cover
      and media.state = 'published';
    if v_cover_count <> 1 then
      raise exception using errcode = '23514', message = 'rental requires exactly one published cover image';
    end if;
  end if;

  insert into public.rental_listing_revisions(rental_listing_id, content_snapshot, action, created_by)
  values (p_id, to_jsonb(v_rental), p_action, p_actor_id);

  update public.rental_listings
  set status = case when p_action = 'publish' then 'published' when p_action = 'archive' then 'archived' else 'draft' end,
      published_at = case when p_action = 'publish' then now() else published_at end,
      updated_at = now(),
      updated_by = p_actor_id
  where id = p_id
  returning * into v_rental;

  insert into public.audit_events(actor_user_id, action, target_type, target_id)
  values (p_actor_id, 'rental.' || p_action, 'rental_listing', p_id::text);

  return to_jsonb(v_rental)
    || jsonb_build_object(
      'cover_image_url', (
        select media.public_url
        from public.rental_listing_images image
        join public.media_assets media on media.id = image.media_asset_id
        where image.rental_listing_id = p_id and image.is_cover
      ),
      'images', coalesce((
        select jsonb_agg(jsonb_build_object(
          'mediaAssetId', image.media_asset_id,
          'url', media.public_url,
          'alt', media.alt_text,
          'sortOrder', image.sort_order,
          'isCover', image.is_cover
        ) order by image.sort_order)
        from public.rental_listing_images image
        join public.media_assets media on media.id = image.media_asset_id
        where image.rental_listing_id = p_id
      ), '[]'::jsonb)
    );
end;
$$;

revoke all on function public.save_rental_listing(uuid, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_rental_listing(uuid, jsonb, timestamptz, uuid)
  to service_role;
grant execute on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb)
  to service_role;
