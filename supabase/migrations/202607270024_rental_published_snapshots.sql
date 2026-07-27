-- Immutable public rental snapshots and a public detail projection. Saving a
-- live Admin draft no longer changes the website until Publish updates.

alter table public.rental_listing_revisions
  add column if not exists schema_version integer not null default 1,
  add column if not exists source_digest text null;

alter table public.rental_listing_revisions
  add constraint rental_listing_revisions_id_listing_unique
  unique (id, rental_listing_id);

alter table public.rental_listings
  add column if not exists published_revision_id uuid null;

create or replace function public.build_rental_public_snapshot(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select to_jsonb(rental)
    || jsonb_build_object(
      'cover_image_url', (
        select media.public_url
        from public.rental_listing_images image
        join public.media_assets media on media.id = image.media_asset_id
        where image.rental_listing_id = rental.id
          and image.is_cover
          and media.state = 'published'
          and media.public_url is not null
        limit 1
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
        where image.rental_listing_id = rental.id
          and media.state = 'published'
          and media.public_url is not null
      ), '[]'::jsonb)
    )
  from public.rental_listings rental
  where rental.id = p_id;
$$;

do $$
declare
  v_rental record;
  v_snapshot jsonb;
  v_revision_id uuid;
begin
  for v_rental in
    select * from public.rental_listings where status = 'published'
  loop
    v_snapshot := public.build_rental_public_snapshot(v_rental.id);
    insert into public.rental_listing_revisions(
      rental_listing_id, content_snapshot, action, schema_version,
      source_digest, created_by
    )
    values (
      v_rental.id,
      v_snapshot,
      'publish',
      1,
      encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
      v_rental.updated_by
    )
    returning id into v_revision_id;
    update public.rental_listings
    set published_revision_id = v_revision_id
    where id = v_rental.id;
  end loop;
end;
$$;

alter table public.rental_listings
  add constraint rental_listings_published_revision_owner_fk
  foreign key (published_revision_id, id)
  references public.rental_listing_revisions(id, rental_listing_id);

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
  if not found then raise exception using errcode = 'TT409', message = 'stale rental'; end if;

  if p_action = 'publish' then
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

    select count(*) into v_cover_count
    from public.rental_listing_images image
    join public.media_assets media on media.id = image.media_asset_id
    where image.rental_listing_id = p_id
      and image.is_cover
      and media.state = 'published'
      and media.public_url is not null;
    if v_cover_count <> 1 then
      raise exception using errcode = '23514', message = 'rental requires exactly one published cover image';
    end if;

    v_snapshot := public.build_rental_public_snapshot(p_id);
    insert into public.rental_listing_revisions(
      rental_listing_id, content_snapshot, action, schema_version,
      source_digest, created_by
    )
    values (
      p_id,
      v_snapshot,
      'publish',
      1,
      encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex'),
      p_actor_id
    )
    returning id into v_revision_id;

    update public.rental_listings
    set status = 'published',
        published_revision_id = v_revision_id,
        published_at = now(),
        updated_at = now(),
        updated_by = p_actor_id
    where id = p_id
    returning * into v_rental;
  else
    insert into public.rental_listing_revisions(
      rental_listing_id, content_snapshot, action, schema_version, created_by
    )
    values (p_id, public.build_rental_public_snapshot(p_id), p_action, 1, p_actor_id);

    update public.rental_listings
    set status = case when p_action = 'archive' then 'archived' else 'draft' end,
        published_revision_id = null,
        updated_at = now(),
        updated_by = p_actor_id
    where id = p_id
    returning * into v_rental;
  end if;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'rental.' || p_action,
    'rental_listing',
    p_id::text,
    jsonb_build_object('publishedRevisionId', v_revision_id)
  );

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

drop view if exists public.public_rental_listing_details;
drop view if exists public.public_rental_listings;

create view public.public_rental_listings
with (security_barrier = true)
as
select
  rental.id,
  revision.content_snapshot->>'slug' as slug,
  revision.content_snapshot->>'title' as title,
  revision.content_snapshot->>'address_line' as address_line,
  nullif(revision.content_snapshot->>'neighbourhood', '') as neighbourhood,
  revision.content_snapshot->>'city' as city,
  (revision.content_snapshot->>'monthly_rent_cents')::integer as monthly_rent_cents,
  (revision.content_snapshot->>'bedrooms')::numeric as bedrooms,
  (revision.content_snapshot->>'bathrooms')::numeric as bathrooms,
  nullif(revision.content_snapshot->>'square_feet', '')::integer as square_feet,
  nullif(revision.content_snapshot->>'available_on', '')::date as available_on,
  nullif(revision.content_snapshot->>'pet_policy', '') as pet_policy,
  revision.content_snapshot->>'description' as description,
  'published'::text as status,
  rental.sort_order,
  rental.created_at,
  revision.created_at as updated_at,
  rental.published_at,
  revision.content_snapshot->>'cover_image_url' as cover_image_url
from public.rental_listings rental
join public.rental_listing_revisions revision
  on revision.id = rental.published_revision_id
  and revision.rental_listing_id = rental.id
where rental.status = 'published'
  and rental.published_revision_id is not null;

create view public.public_rental_listing_details
with (security_barrier = true)
as
select
  listing.*,
  coalesce(revision.content_snapshot->'images', '[]'::jsonb) as images
from public.public_rental_listings listing
join public.rental_listings rental on rental.id = listing.id
join public.rental_listing_revisions revision
  on revision.id = rental.published_revision_id
  and revision.rental_listing_id = rental.id;

revoke all on public.public_rental_listings, public.public_rental_listing_details
  from public;
grant select on public.public_rental_listings, public.public_rental_listing_details
  to anon, authenticated, service_role;

revoke all on function public.build_rental_public_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb)
  to service_role;
