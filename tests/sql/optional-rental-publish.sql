\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claim.role', 'service_role', true);
insert into auth.users(id) values ('00000000-0000-4000-8000-000000000700');
insert into public.admin_profiles(user_id, display_name)
values ('00000000-0000-4000-8000-000000000700', 'Optional Fields Test Admin');
insert into public.rental_properties(
  id, property_type, street_address, city, province_code, postal_code, created_by, updated_by
) values (
  '00000000-0000-4000-8000-000000000701', 'condo', '1 Synthetic Street', 'Vancouver', 'BC', null,
  '00000000-0000-4000-8000-000000000700', '00000000-0000-4000-8000-000000000700'
);
insert into public.rental_listings(
  id, property_id, slug, title, address_line, city, monthly_rent_cents, bedrooms, bathrooms,
  description, availability_status, review_required_fields, created_by, updated_by
) values (
  '00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000701',
  'optional-fields-publication-test', 'Optional Fields Test', '1 Synthetic Street', 'Vancouver', 100000, 1, 1,
  'Synthetic publication fixture with five optional fields left null.', 'available_now',
  array['property.postalCode', 'layout.furnishedStatus', 'availability.leaseType', 'smokingPolicy', 'pets.status'],
  '00000000-0000-4000-8000-000000000700', '00000000-0000-4000-8000-000000000700'
);
insert into public.media_assets(
  id, draft_storage_path, published_storage_path, public_url, state, original_filename,
  mime_type, byte_size, width, height, alt_text, created_by
) values (
  '00000000-0000-4000-8000-000000000703', 'test/optional-fields.png', 'test/optional-fields.webp',
  'https://example.test/optional-fields.webp', 'published', 'optional-fields.png', 'image/webp',
  100, 800, 600, 'Synthetic property', '00000000-0000-4000-8000-000000000700'
);
insert into public.rental_listing_images(rental_listing_id, media_asset_id, sort_order, is_cover)
values ('00000000-0000-4000-8000-000000000702', '00000000-0000-4000-8000-000000000703', 0, true);

do $$
declare
  v_version timestamptz;
begin
  select updated_at into v_version from public.rental_listings
    where id = '00000000-0000-4000-8000-000000000702';
  perform public.set_rental_status_with_media('00000000-0000-4000-8000-000000000702', 'publish',
    v_version, '00000000-0000-4000-8000-000000000700', '[]'::jsonb);
  if not exists (select 1 from public.public_rental_listings_v2
    where id = '00000000-0000-4000-8000-000000000702') then
    raise exception 'blank optional fields or their legacy review flags blocked publication';
  end if;
  if exists (select 1 from public.rental_listings
    where id = '00000000-0000-4000-8000-000000000702'
      and (furnished_status is not null or lease_type is not null
        or smoking_policy is not null or pet_status is not null)) then
    raise exception 'publication invented optional policy values';
  end if;

  -- Removing the cover still prevents the next publication.
  select updated_at into v_version from public.rental_listings
    where id = '00000000-0000-4000-8000-000000000702';
  delete from public.rental_listing_images
    where rental_listing_id = '00000000-0000-4000-8000-000000000702';
  begin
    perform public.set_rental_status_with_media('00000000-0000-4000-8000-000000000702', 'publish',
      v_version, '00000000-0000-4000-8000-000000000700', '[]'::jsonb);
    raise exception 'missing photos or cover did not block publication';
  exception when sqlstate '23514' then null;
  end;
end;
$$;
rollback;
