-- Listing V2: normalized property and child records, atomic aggregate saves,
-- and immutable schema-v2 public snapshots.

create table public.rental_properties (
  id uuid primary key default gen_random_uuid(),
  property_type text null check (property_type is null or property_type in (
    'apartment', 'condo', 'townhome', 'house', 'basement_suite', 'room', 'other'
  )),
  building_name text null,
  unit_number text null,
  street_address text not null,
  neighbourhood text null,
  city text not null,
  province_code text null check (province_code is null or province_code ~ '^[A-Z]{2}$'),
  postal_code text null check (postal_code is null or postal_code ~ '^[A-Z][0-9][A-Z] [0-9][A-Z][0-9]$'),
  country_code text not null default 'CA' check (country_code ~ '^[A-Z]{2}$'),
  latitude numeric(9,6) null check (latitude is null or latitude between -90 and 90),
  longitude numeric(9,6) null check (longitude is null or longitude between -180 and 180),
  created_by uuid not null references public.admin_profiles(user_id),
  updated_by uuid not null references public.admin_profiles(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index rental_properties_location_type_idx
  on public.rental_properties(city, neighbourhood, property_type);
create index rental_properties_postal_code_idx
  on public.rental_properties(postal_code) where postal_code is not null;

alter table public.rental_listings
  add column property_id uuid null references public.rental_properties(id),
  add column currency_code text not null default 'CAD' check (currency_code ~ '^[A-Z]{3}$'),
  add column den_count smallint not null default 0 check (den_count >= 0),
  add column availability_status text null check (
    availability_status is null or availability_status in ('available_now', 'available_on', 'contact')
  ),
  add column furnished_status text null check (
    furnished_status is null or furnished_status in ('unfurnished', 'furnished', 'partly_furnished')
  ),
  add column lease_type text null check (
    lease_type is null or lease_type in ('fixed_term', 'month_to_month', 'flexible')
  ),
  add column minimum_lease_months smallint null check (minimum_lease_months is null or minimum_lease_months > 0),
  add column smoking_policy text null check (
    smoking_policy is null or smoking_policy in ('not_allowed', 'outdoor_only', 'allowed', 'contact')
  ),
  add column credit_check_required boolean null,
  add column references_required boolean null,
  add column parking_available boolean null,
  add column parking_type text null check (
    parking_type is null or parking_type in ('underground', 'garage', 'surface', 'street', 'carport', 'other')
  ),
  add column parking_stalls smallint null check (parking_stalls is null or parking_stalls >= 0),
  add column parking_included boolean null,
  add column parking_notes text null,
  add column visitor_parking_available boolean null,
  add column storage_available boolean null,
  add column storage_lockers smallint null check (storage_lockers is null or storage_lockers >= 0),
  add column storage_included boolean null,
  add column storage_notes text null,
  add column pet_status text null check (
    pet_status is null or pet_status in ('not_allowed', 'considered', 'allowed')
  ),
  add column cats_allowed boolean null,
  add column dogs_allowed boolean null,
  add column pet_max_count smallint null check (pet_max_count is null or pet_max_count > 0),
  add column pet_size_limit_lbs smallint null check (pet_size_limit_lbs is null or pet_size_limit_lbs > 0),
  add column pet_notes text null,
  add column utilities_notes text null,
  add column contact_mode text not null default 'site_default' check (contact_mode in ('site_default', 'custom')),
  add column contact_name text null,
  add column contact_email text null,
  add column contact_phone text null,
  add column amenity_notes text null,
  add column draft_digest text null,
  add column review_required_fields text[] not null default '{}';

alter table public.rental_listings
  add constraint rental_listing_availability_consistent check (
    availability_status is null
    or (availability_status = 'available_on' and available_on is not null)
    or (availability_status <> 'available_on' and available_on is null)
  ),
  add constraint rental_listing_parking_consistent check (
    parking_available is null
    or parking_available
    or (parking_type is null and coalesce(parking_stalls, 0) = 0 and parking_included is null)
  ),
  add constraint rental_listing_storage_consistent check (
    storage_available is null
    or storage_available
    or (coalesce(storage_lockers, 0) = 0 and storage_included is null)
  ),
  add constraint rental_listing_pets_consistent check (
    pet_status is null
    or pet_status <> 'not_allowed'
    or (
      not coalesce(cats_allowed, false)
      and not coalesce(dogs_allowed, false)
      and pet_max_count is null
      and pet_size_limit_lbs is null
    )
  ),
  add constraint rental_listing_custom_contact_consistent check (
    contact_mode = 'site_default'
    or (
      nullif(btrim(contact_name), '') is not null
      and (
        nullif(btrim(contact_email), '') is not null
        or nullif(btrim(contact_phone), '') is not null
      )
    )
  );

create table public.rental_amenities (
  code text primary key,
  category text not null check (category in ('unit', 'appliance', 'building', 'nearby')),
  label text not null,
  sort_order integer not null,
  is_active boolean not null default true
);

create table public.rental_listing_amenities (
  rental_listing_id uuid not null references public.rental_listings(id) on delete cascade,
  amenity_code text not null references public.rental_amenities(code) on delete restrict,
  primary key (rental_listing_id, amenity_code)
);

create table public.rental_utilities (
  code text primary key,
  label text not null,
  sort_order integer not null,
  is_active boolean not null default true
);

create table public.rental_listing_utilities (
  rental_listing_id uuid not null references public.rental_listings(id) on delete cascade,
  utility_code text not null references public.rental_utilities(code) on delete restrict,
  primary key (rental_listing_id, utility_code)
);

create table public.rental_listing_fees (
  id uuid primary key default gen_random_uuid(),
  rental_listing_id uuid not null references public.rental_listings(id) on delete cascade,
  fee_type text not null check (fee_type in (
    'security_deposit', 'pet_deposit', 'parking', 'storage', 'move_in', 'other'
  )),
  label text null,
  amount_cents integer not null check (amount_cents > 0),
  frequency text not null check (frequency in ('one_time', 'monthly')),
  refundable boolean not null,
  required boolean not null,
  notes text null,
  sort_order integer not null check (sort_order >= 0),
  check (fee_type <> 'other' or nullif(btrim(label), '') is not null)
);

insert into public.rental_amenities(code, category, label, sort_order) values
  ('balcony', 'unit', 'Balcony', 10),
  ('ensuite_bathroom', 'unit', 'Ensuite bathroom', 20),
  ('air_conditioning', 'unit', 'Air conditioning', 30),
  ('laminate_flooring', 'unit', 'Laminate flooring', 40),
  ('walk_in_closet', 'unit', 'Walk-in closet', 50),
  ('floor_to_ceiling_windows', 'unit', 'Floor-to-ceiling windows', 60),
  ('wheelchair_access', 'unit', 'Wheelchair access', 70),
  ('private_yard', 'unit', 'Private yard', 80),
  ('mountain_view', 'unit', 'Mountain view', 90),
  ('city_view', 'unit', 'City view', 100),
  ('park_view', 'unit', 'Park view', 110),
  ('water_view', 'unit', 'Water view', 120),
  ('refrigerator', 'appliance', 'Refrigerator', 210),
  ('stove_oven', 'appliance', 'Stove / oven', 220),
  ('gas_stove', 'appliance', 'Gas stove', 230),
  ('dishwasher', 'appliance', 'Dishwasher', 240),
  ('microwave', 'appliance', 'Microwave', 250),
  ('in_suite_washer', 'appliance', 'In-suite washer', 260),
  ('in_suite_dryer', 'appliance', 'In-suite dryer', 270),
  ('elevator', 'building', 'Elevator', 310),
  ('fitness_room', 'building', 'Fitness room', 320),
  ('recreation_room', 'building', 'Recreation room', 330),
  ('social_lounge', 'building', 'Social lounge', 340),
  ('swimming_pool', 'building', 'Swimming pool', 350),
  ('hot_tub', 'building', 'Hot tub', 360),
  ('sauna', 'building', 'Sauna', 370),
  ('concierge', 'building', 'Concierge', 380),
  ('video_surveillance', 'building', 'Video surveillance', 390),
  ('on_site_staff', 'building', 'On-site staff', 400),
  ('shared_laundry', 'building', 'Shared laundry', 410),
  ('bicycle_storage', 'building', 'Bicycle storage', 420),
  ('public_transit', 'nearby', 'Public transit', 510),
  ('shopping', 'nearby', 'Shopping', 520),
  ('grocery', 'nearby', 'Grocery', 530),
  ('parks', 'nearby', 'Parks', 540),
  ('schools', 'nearby', 'Schools', 550),
  ('restaurants', 'nearby', 'Restaurants', 560);

insert into public.rental_utilities(code, label, sort_order) values
  ('water', 'Water', 10),
  ('hot_water', 'Hot water', 20),
  ('gas', 'Gas', 30),
  ('electricity', 'Electricity', 40),
  ('heating', 'Heating', 50),
  ('internet', 'Internet', 60),
  ('sewage', 'Sewage', 70),
  ('garbage_collection', 'Garbage collection', 80);

-- Conservative backfill: do not parse unit/building or infer uncertain policy.
insert into public.rental_properties(
  street_address, neighbourhood, city, country_code,
  created_by, updated_by, created_at, updated_at
)
select
  rental.address_line, rental.neighbourhood, rental.city, 'CA',
  rental.created_by, rental.updated_by, rental.created_at, rental.updated_at
from public.rental_listings rental
where rental.property_id is null
order by rental.created_at;

with properties as (
  select
    property.id,
    row_number() over (order by property.created_at, property.id) as row_number
  from public.rental_properties property
  where not exists (
    select 1 from public.rental_listings listing where listing.property_id = property.id
  )
),
listings as (
  select
    listing.id,
    row_number() over (order by listing.created_at, listing.id) as row_number
  from public.rental_listings listing
  where listing.property_id is null
)
update public.rental_listings listing
set property_id = properties.id,
    availability_status = case when listing.available_on is not null then 'available_on' else null end,
    pet_notes = listing.pet_policy,
    review_required_fields = array[
      'property.propertyType', 'property.provinceCode', 'property.postalCode',
      'availability.status', 'layout.furnishedStatus', 'availability.leaseType',
      'smokingPolicy', 'pets.status'
    ]::text[]
from properties
join listings using (row_number)
where listing.id = listings.id;

alter table public.rental_listings alter column property_id set not null;
create unique index rental_listings_property_unique on public.rental_listings(property_id);

alter table public.rental_properties enable row level security;
alter table public.rental_amenities enable row level security;
alter table public.rental_listing_amenities enable row level security;
alter table public.rental_utilities enable row level security;
alter table public.rental_listing_utilities enable row level security;
alter table public.rental_listing_fees enable row level security;

revoke all on public.rental_properties, public.rental_amenities,
  public.rental_listing_amenities, public.rental_utilities,
  public.rental_listing_utilities, public.rental_listing_fees
  from public, anon, authenticated;

create or replace view public.admin_rental_listings_v2
with (security_barrier = true)
as
select
  rental.*,
  cover_media.public_url as cover_image_url,
  jsonb_build_object(
    'id', property.id,
    'propertyType', property.property_type,
    'buildingName', property.building_name,
    'unitNumber', property.unit_number,
    'streetAddress', property.street_address,
    'neighbourhood', property.neighbourhood,
    'city', property.city,
    'provinceCode', property.province_code,
    'postalCode', property.postal_code,
    'countryCode', property.country_code,
    'updatedAt', property.updated_at
  ) as property,
  jsonb_build_object(
    'available', rental.parking_available,
    'type', rental.parking_type,
    'stalls', rental.parking_stalls,
    'included', rental.parking_included,
    'visitorAvailable', rental.visitor_parking_available,
    'notes', rental.parking_notes
  ) as parking,
  jsonb_build_object(
    'available', rental.storage_available,
    'lockers', rental.storage_lockers,
    'included', rental.storage_included,
    'notes', rental.storage_notes
  ) as storage,
  jsonb_build_object(
    'status', rental.pet_status,
    'catsAllowed', rental.cats_allowed,
    'dogsAllowed', rental.dogs_allowed,
    'maxCount', rental.pet_max_count,
    'sizeLimitLbs', rental.pet_size_limit_lbs,
    'notes', rental.pet_notes
  ) as pets,
  jsonb_build_object(
    'mode', rental.contact_mode,
    'name', rental.contact_name,
    'email', rental.contact_email,
    'phone', rental.contact_phone
  ) as contact,
  coalesce((
    select array_agg(link.amenity_code order by amenity.sort_order)
    from public.rental_listing_amenities link
    join public.rental_amenities amenity on amenity.code = link.amenity_code
    where link.rental_listing_id = rental.id
  ), '{}'::text[]) as amenity_codes,
  coalesce((
    select array_agg(link.utility_code order by utility.sort_order)
    from public.rental_listing_utilities link
    join public.rental_utilities utility on utility.code = link.utility_code
    where link.rental_listing_id = rental.id
  ), '{}'::text[]) as included_utility_codes,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', fee.id,
      'feeType', fee.fee_type,
      'label', fee.label,
      'amountCents', fee.amount_cents,
      'frequency', fee.frequency,
      'refundable', fee.refundable,
      'required', fee.required,
      'notes', fee.notes,
      'sortOrder', fee.sort_order
    ) order by fee.sort_order, fee.id)
    from public.rental_listing_fees fee
    where fee.rental_listing_id = rental.id
  ), '[]'::jsonb) as fees,
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
  ), '[]'::jsonb) as images,
  (
    select revision.source_digest
    from public.rental_listing_revisions revision
    where revision.id = rental.published_revision_id
      and revision.rental_listing_id = rental.id
  ) as published_source_digest
from public.rental_listings rental
join public.rental_properties property on property.id = rental.property_id
left join public.rental_listing_images cover_image
  on cover_image.rental_listing_id = rental.id and cover_image.is_cover
left join public.media_assets cover_media on cover_media.id = cover_image.media_asset_id;

revoke all on public.admin_rental_listings_v2 from public, anon, authenticated;
grant select on public.admin_rental_listings_v2 to service_role;

create or replace function public.save_rental_listing_v2(
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
  v_property public.rental_properties;
  v_image jsonb;
  v_fee jsonb;
  v_code text;
  v_property_payload jsonb := p_payload->'property';
  v_digest text;
  v_review_fields text[] := coalesce(
    array(select jsonb_array_elements_text(coalesce(p_payload->'reviewRequiredFields', '[]'::jsonb))),
    '{}'::text[]
  );
begin
  if p_id is null then
    insert into public.rental_properties(
      property_type, building_name, unit_number, street_address, neighbourhood,
      city, province_code, postal_code, country_code, created_by, updated_by
    ) values (
      nullif(v_property_payload->>'propertyType', ''),
      nullif(btrim(v_property_payload->>'buildingName'), ''),
      nullif(btrim(v_property_payload->>'unitNumber'), ''),
      btrim(v_property_payload->>'streetAddress'),
      nullif(btrim(v_property_payload->>'neighbourhood'), ''),
      btrim(v_property_payload->>'city'),
      nullif(upper(btrim(v_property_payload->>'provinceCode')), ''),
      nullif(upper(btrim(v_property_payload->>'postalCode')), ''),
      coalesce(nullif(upper(btrim(v_property_payload->>'countryCode')), ''), 'CA'),
      p_actor_id, p_actor_id
    ) returning * into v_property;

    insert into public.rental_listings(
      property_id, slug, title, address_line, neighbourhood, city,
      monthly_rent_cents, currency_code, bedrooms, bathrooms, den_count,
      square_feet, availability_status, available_on, furnished_status,
      lease_type, minimum_lease_months, smoking_policy,
      credit_check_required, references_required,
      parking_available, parking_type, parking_stalls, parking_included,
      parking_notes, visitor_parking_available,
      storage_available, storage_lockers, storage_included, storage_notes,
      pet_status, cats_allowed, dogs_allowed, pet_max_count,
      pet_size_limit_lbs, pet_notes, pet_policy, utilities_notes,
      contact_mode, contact_name, contact_email, contact_phone,
      amenity_notes, description, review_required_fields,
      created_by, updated_by
    ) values (
      v_property.id, p_payload->>'slug', p_payload->>'title',
      concat_ws(', ', nullif('Unit ' || (v_property_payload->>'unitNumber'), 'Unit '), v_property.street_address),
      v_property.neighbourhood, v_property.city,
      (p_payload#>>'{pricing,monthlyRentCents}')::integer,
      coalesce(p_payload#>>'{pricing,currencyCode}', 'CAD'),
      (p_payload#>>'{layout,bedrooms}')::numeric,
      (p_payload#>>'{layout,bathrooms}')::numeric,
      coalesce((p_payload#>>'{layout,denCount}')::smallint, 0),
      nullif(p_payload#>>'{layout,squareFeet}', '')::integer,
      nullif(p_payload#>>'{availability,status}', ''),
      nullif(p_payload#>>'{availability,availableOn}', '')::date,
      nullif(p_payload#>>'{layout,furnishedStatus}', ''),
      nullif(p_payload#>>'{availability,leaseType}', ''),
      nullif(p_payload#>>'{availability,minimumLeaseMonths}', '')::smallint,
      nullif(p_payload->>'smokingPolicy', ''),
      (p_payload#>>'{applicationRequirements,creditCheckRequired}')::boolean,
      (p_payload#>>'{applicationRequirements,referencesRequired}')::boolean,
      (p_payload#>>'{parking,available}')::boolean,
      nullif(p_payload#>>'{parking,type}', ''),
      nullif(p_payload#>>'{parking,stalls}', '')::smallint,
      nullif(p_payload#>>'{parking,included}', '')::boolean,
      nullif(btrim(p_payload#>>'{parking,notes}'), ''),
      (p_payload#>>'{parking,visitorAvailable}')::boolean,
      (p_payload#>>'{storage,available}')::boolean,
      nullif(p_payload#>>'{storage,lockers}', '')::smallint,
      nullif(p_payload#>>'{storage,included}', '')::boolean,
      nullif(btrim(p_payload#>>'{storage,notes}'), ''),
      nullif(p_payload#>>'{pets,status}', ''),
      (p_payload#>>'{pets,catsAllowed}')::boolean,
      (p_payload#>>'{pets,dogsAllowed}')::boolean,
      nullif(p_payload#>>'{pets,maxCount}', '')::smallint,
      nullif(p_payload#>>'{pets,sizeLimitLbs}', '')::smallint,
      nullif(btrim(p_payload#>>'{pets,notes}'), ''),
      nullif(btrim(p_payload#>>'{pets,notes}'), ''),
      nullif(btrim(p_payload->>'utilitiesNotes'), ''),
      coalesce(p_payload#>>'{contact,mode}', 'site_default'),
      nullif(btrim(p_payload#>>'{contact,name}'), ''),
      nullif(lower(btrim(p_payload#>>'{contact,email}')), ''),
      nullif(btrim(p_payload#>>'{contact,phone}'), ''),
      nullif(btrim(p_payload->>'amenityNotes'), ''),
      p_payload->>'description', v_review_fields,
      p_actor_id, p_actor_id
    ) returning * into v_rental;
  else
    select * into v_rental
    from public.rental_listings
    where id = p_id and updated_at = p_expected_updated_at
    for update;
    if not found then
      raise exception using errcode = 'TT409', message = 'stale rental';
    end if;
    if v_rental.published_at is not null and v_rental.slug <> p_payload->>'slug' then
      raise exception using errcode = 'TT409', message = 'rental slug is immutable';
    end if;
    if (v_property_payload->>'id')::uuid is distinct from v_rental.property_id then
      raise exception using errcode = 'TT409', message = 'property ownership changed';
    end if;

    select * into v_property
    from public.rental_properties
    where id = v_rental.property_id
      and updated_at = (v_property_payload->>'expectedVersion')::timestamptz
    for update;
    if not found then
      raise exception using errcode = 'TT409', message = 'stale property';
    end if;

    update public.rental_properties set
      property_type = nullif(v_property_payload->>'propertyType', ''),
      building_name = nullif(btrim(v_property_payload->>'buildingName'), ''),
      unit_number = nullif(btrim(v_property_payload->>'unitNumber'), ''),
      street_address = btrim(v_property_payload->>'streetAddress'),
      neighbourhood = nullif(btrim(v_property_payload->>'neighbourhood'), ''),
      city = btrim(v_property_payload->>'city'),
      province_code = nullif(upper(btrim(v_property_payload->>'provinceCode')), ''),
      postal_code = nullif(upper(btrim(v_property_payload->>'postalCode')), ''),
      country_code = coalesce(nullif(upper(btrim(v_property_payload->>'countryCode')), ''), 'CA'),
      updated_by = p_actor_id,
      updated_at = now()
    where id = v_property.id
    returning * into v_property;

    update public.rental_listings set
      title = p_payload->>'title',
      address_line = concat_ws(', ', nullif('Unit ' || (v_property_payload->>'unitNumber'), 'Unit '), v_property.street_address),
      neighbourhood = v_property.neighbourhood,
      city = v_property.city,
      monthly_rent_cents = (p_payload#>>'{pricing,monthlyRentCents}')::integer,
      currency_code = coalesce(p_payload#>>'{pricing,currencyCode}', 'CAD'),
      bedrooms = (p_payload#>>'{layout,bedrooms}')::numeric,
      bathrooms = (p_payload#>>'{layout,bathrooms}')::numeric,
      den_count = coalesce((p_payload#>>'{layout,denCount}')::smallint, 0),
      square_feet = nullif(p_payload#>>'{layout,squareFeet}', '')::integer,
      availability_status = nullif(p_payload#>>'{availability,status}', ''),
      available_on = nullif(p_payload#>>'{availability,availableOn}', '')::date,
      furnished_status = nullif(p_payload#>>'{layout,furnishedStatus}', ''),
      lease_type = nullif(p_payload#>>'{availability,leaseType}', ''),
      minimum_lease_months = nullif(p_payload#>>'{availability,minimumLeaseMonths}', '')::smallint,
      smoking_policy = nullif(p_payload->>'smokingPolicy', ''),
      credit_check_required = (p_payload#>>'{applicationRequirements,creditCheckRequired}')::boolean,
      references_required = (p_payload#>>'{applicationRequirements,referencesRequired}')::boolean,
      parking_available = (p_payload#>>'{parking,available}')::boolean,
      parking_type = nullif(p_payload#>>'{parking,type}', ''),
      parking_stalls = nullif(p_payload#>>'{parking,stalls}', '')::smallint,
      parking_included = nullif(p_payload#>>'{parking,included}', '')::boolean,
      parking_notes = nullif(btrim(p_payload#>>'{parking,notes}'), ''),
      visitor_parking_available = (p_payload#>>'{parking,visitorAvailable}')::boolean,
      storage_available = (p_payload#>>'{storage,available}')::boolean,
      storage_lockers = nullif(p_payload#>>'{storage,lockers}', '')::smallint,
      storage_included = nullif(p_payload#>>'{storage,included}', '')::boolean,
      storage_notes = nullif(btrim(p_payload#>>'{storage,notes}'), ''),
      pet_status = nullif(p_payload#>>'{pets,status}', ''),
      cats_allowed = (p_payload#>>'{pets,catsAllowed}')::boolean,
      dogs_allowed = (p_payload#>>'{pets,dogsAllowed}')::boolean,
      pet_max_count = nullif(p_payload#>>'{pets,maxCount}', '')::smallint,
      pet_size_limit_lbs = nullif(p_payload#>>'{pets,sizeLimitLbs}', '')::smallint,
      pet_notes = nullif(btrim(p_payload#>>'{pets,notes}'), ''),
      pet_policy = nullif(btrim(p_payload#>>'{pets,notes}'), ''),
      utilities_notes = nullif(btrim(p_payload->>'utilitiesNotes'), ''),
      contact_mode = coalesce(p_payload#>>'{contact,mode}', 'site_default'),
      contact_name = nullif(btrim(p_payload#>>'{contact,name}'), ''),
      contact_email = nullif(lower(btrim(p_payload#>>'{contact,email}')), ''),
      contact_phone = nullif(btrim(p_payload#>>'{contact,phone}'), ''),
      amenity_notes = nullif(btrim(p_payload->>'amenityNotes'), ''),
      description = p_payload->>'description',
      review_required_fields = v_review_fields,
      updated_by = p_actor_id,
      updated_at = now()
    where id = p_id
    returning * into v_rental;
  end if;

  delete from public.rental_listing_images where rental_listing_id = v_rental.id;
  for v_image in select * from jsonb_array_elements(coalesce(p_payload->'images', '[]'::jsonb))
  loop
    insert into public.rental_listing_images(rental_listing_id, media_asset_id, sort_order, is_cover)
    values (
      v_rental.id,
      (v_image->>'mediaAssetId')::uuid,
      (v_image->>'sortOrder')::integer,
      (v_image->>'isCover')::boolean
    );
  end loop;

  delete from public.rental_listing_amenities where rental_listing_id = v_rental.id;
  for v_code in select jsonb_array_elements_text(coalesce(p_payload->'amenityCodes', '[]'::jsonb))
  loop
    insert into public.rental_listing_amenities(rental_listing_id, amenity_code)
    values (v_rental.id, v_code);
  end loop;

  delete from public.rental_listing_utilities where rental_listing_id = v_rental.id;
  for v_code in select jsonb_array_elements_text(coalesce(p_payload->'includedUtilityCodes', '[]'::jsonb))
  loop
    insert into public.rental_listing_utilities(rental_listing_id, utility_code)
    values (v_rental.id, v_code);
  end loop;

  delete from public.rental_listing_fees where rental_listing_id = v_rental.id;
  for v_fee in select * from jsonb_array_elements(coalesce(p_payload->'fees', '[]'::jsonb))
  loop
    insert into public.rental_listing_fees(
      rental_listing_id, fee_type, label, amount_cents, frequency,
      refundable, required, notes, sort_order
    ) values (
      v_rental.id, v_fee->>'feeType', nullif(btrim(v_fee->>'label'), ''),
      (v_fee->>'amountCents')::integer, v_fee->>'frequency',
      (v_fee->>'refundable')::boolean, (v_fee->>'required')::boolean,
      nullif(btrim(v_fee->>'notes'), ''), (v_fee->>'sortOrder')::integer
    );
  end loop;

  v_digest := encode(extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256'), 'hex');
  update public.rental_listings
  set draft_digest = v_digest
  where id = v_rental.id;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id, 'rental.v2.saved', 'rental_listing', v_rental.id::text,
    jsonb_build_object('draftDigest', v_digest)
  );

  return (
    select to_jsonb(result)
    from public.admin_rental_listings_v2 result
    where result.id = v_rental.id
  );
end;
$$;

-- V1 writes remain available, but are normalized into the V2 transaction.
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
  v_property_id uuid;
  v_property_version timestamptz;
  v_payload jsonb;
begin
  if p_id is not null then
    select listing.property_id, property.updated_at
    into v_property_id, v_property_version
    from public.rental_listings listing
    join public.rental_properties property on property.id = listing.property_id
    where listing.id = p_id;
  end if;

  v_payload := jsonb_build_object(
    'slug', p_payload->>'slug',
    'title', p_payload->>'title',
    'property', jsonb_build_object(
      'id', v_property_id,
      'expectedVersion', v_property_version,
      'propertyType', null,
      'buildingName', null,
      'unitNumber', null,
      'streetAddress', p_payload->>'addressLine',
      'neighbourhood', p_payload->'neighbourhood',
      'city', p_payload->>'city',
      'provinceCode', null,
      'postalCode', null,
      'countryCode', 'CA'
    ),
    'pricing', jsonb_build_object(
      'monthlyRentCents', p_payload->'monthlyRentCents',
      'currencyCode', 'CAD'
    ),
    'layout', jsonb_build_object(
      'bedrooms', p_payload->'bedrooms',
      'bathrooms', p_payload->'bathrooms',
      'denCount', 0,
      'squareFeet', p_payload->'squareFeet',
      'furnishedStatus', null
    ),
    'availability', jsonb_build_object(
      'status', case when nullif(p_payload->>'availableOn', '') is null then null else 'available_on' end,
      'availableOn', p_payload->'availableOn',
      'leaseType', null,
      'minimumLeaseMonths', null
    ),
    'parking', jsonb_build_object(
      'available', false, 'type', null, 'stalls', null,
      'included', null, 'visitorAvailable', false, 'notes', null
    ),
    'storage', jsonb_build_object(
      'available', false, 'lockers', null, 'included', null, 'notes', null
    ),
    'pets', jsonb_build_object(
      'status', null, 'catsAllowed', false, 'dogsAllowed', false,
      'maxCount', null, 'sizeLimitLbs', null, 'notes', p_payload->'petPolicy'
    ),
    'smokingPolicy', null,
    'applicationRequirements', jsonb_build_object(
      'creditCheckRequired', false, 'referencesRequired', false
    ),
    'amenityCodes', '[]'::jsonb,
    'includedUtilityCodes', '[]'::jsonb,
    'fees', '[]'::jsonb,
    'contact', jsonb_build_object(
      'mode', 'site_default', 'name', null, 'email', null, 'phone', null
    ),
    'utilitiesNotes', null,
    'amenityNotes', null,
    'description', p_payload->>'description',
    'images', coalesce(p_payload->'images', '[]'::jsonb),
    'reviewRequiredFields', jsonb_build_array(
      'property.propertyType', 'property.provinceCode', 'property.postalCode',
      'availability.status', 'layout.furnishedStatus', 'availability.leaseType',
      'smokingPolicy', 'pets.status'
    )
  );

  return public.save_rental_listing_v2(
    p_id, v_payload, p_expected_updated_at, p_actor_id
  );
end;
$$;

create or replace function public.build_rental_public_snapshot(p_id uuid)
returns jsonb
language sql
stable
set search_path = public
as $$
  select
    (to_jsonb(listing)
      - 'created_by' - 'updated_by' - 'property_id'
      - 'review_required_fields' - 'draft_digest'
      - 'published_revision_id' - 'published_source_digest')
    || jsonb_build_object(
      'property', (listing.property - 'updatedAt'),
      'schemaVersion', 2
    )
  from public.admin_rental_listings_v2 listing
  where listing.id = p_id;
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
    if cardinality(v_rental.review_required_fields) > 0
      or v_rental.availability_status is null
      or v_rental.furnished_status is null
      or v_rental.lease_type is null
      or v_rental.smoking_policy is null
      or v_rental.pet_status is null
      or not exists (
        select 1 from public.rental_properties property
        where property.id = v_rental.property_id
          and property.property_type is not null
          and property.province_code is not null
          and property.postal_code is not null
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

-- Replace each currently-live v1 pointer with a complete v2 snapshot without
-- removing the listing from public output. Review flags block the next publish.
do $$
declare
  v_rental record;
  v_snapshot jsonb;
  v_revision_id uuid;
begin
  for v_rental in
    select * from public.rental_listings
    where status = 'published'
  loop
    v_snapshot := public.build_rental_public_snapshot(v_rental.id);
    insert into public.rental_listing_revisions(
      rental_listing_id, content_snapshot, action, schema_version,
      source_digest, created_by
    ) values (
      v_rental.id, v_snapshot, 'publish', 2,
      coalesce(v_rental.draft_digest, encode(extensions.digest(convert_to(v_snapshot::text, 'UTF8'), 'sha256'), 'hex')),
      v_rental.updated_by
    ) returning id into v_revision_id;
    update public.rental_listings
    set published_revision_id = v_revision_id
    where id = v_rental.id;
  end loop;
end;
$$;

create or replace view public.public_rental_listings_v2
with (security_barrier = true)
as
select
  rental.id,
  snapshot->>'slug' as slug,
  snapshot->>'title' as title,
  snapshot->>'address_line' as address_line,
  nullif(snapshot->>'neighbourhood', '') as neighbourhood,
  snapshot->>'city' as city,
  (snapshot->>'monthly_rent_cents')::integer as monthly_rent_cents,
  (snapshot->>'bedrooms')::numeric as bedrooms,
  (snapshot->>'bathrooms')::numeric as bathrooms,
  nullif(snapshot->>'square_feet', '')::integer as square_feet,
  nullif(snapshot->>'available_on', '')::date as available_on,
  nullif(snapshot->>'pet_policy', '') as pet_policy,
  snapshot->>'description' as description,
  'published'::text as status,
  rental.sort_order,
  rental.created_at,
  revision.created_at as updated_at,
  rental.published_at,
  snapshot->>'cover_image_url' as cover_image_url,
  coalesce(snapshot->'images', '[]'::jsonb) as images,
  snapshot->'property' as property,
  nullif(snapshot->>'den_count', '')::smallint as den_count,
  nullif(snapshot->>'availability_status', '') as availability_status,
  nullif(snapshot->>'furnished_status', '') as furnished_status,
  nullif(snapshot->>'lease_type', '') as lease_type,
  nullif(snapshot->>'minimum_lease_months', '')::smallint as minimum_lease_months,
  snapshot->'parking' as parking,
  snapshot->'storage' as storage,
  snapshot->'pets' as pets,
  nullif(snapshot->>'smoking_policy', '') as smoking_policy,
  nullif(snapshot->>'credit_check_required', '')::boolean as credit_check_required,
  nullif(snapshot->>'references_required', '')::boolean as references_required,
  coalesce(array(select jsonb_array_elements_text(coalesce(snapshot->'amenity_codes', '[]'::jsonb))), '{}'::text[]) as amenity_codes,
  coalesce(array(select jsonb_array_elements_text(coalesce(snapshot->'included_utility_codes', '[]'::jsonb))), '{}'::text[]) as included_utility_codes,
  coalesce(snapshot->'fees', '[]'::jsonb) as fees,
  snapshot->'contact' as contact,
  nullif(snapshot->>'utilities_notes', '') as utilities_notes,
  nullif(snapshot->>'amenity_notes', '') as amenity_notes,
  null::text as draft_digest,
  revision.source_digest as published_source_digest,
  '{}'::text[] as review_required_fields
from public.rental_listings rental
join public.rental_listing_revisions revision
  on revision.id = rental.published_revision_id
  and revision.rental_listing_id = rental.id
cross join lateral (select revision.content_snapshot as snapshot) content
where rental.status = 'published'
  and rental.published_revision_id is not null;

drop view if exists public.public_rental_listing_details;
create view public.public_rental_listing_details
with (security_barrier = true)
as select * from public.public_rental_listings_v2;

revoke all on public.public_rental_listings_v2, public.public_rental_listing_details from public;
grant select on public.public_rental_listings_v2, public.public_rental_listing_details
  to anon, authenticated, service_role;

revoke all on function public.save_rental_listing_v2(uuid, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.save_rental_listing(uuid, jsonb, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.build_rental_public_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_rental_listing_v2(uuid, jsonb, timestamptz, uuid)
  to service_role;
grant execute on function public.save_rental_listing(uuid, jsonb, timestamptz, uuid)
  to service_role;
grant execute on function public.set_rental_status_with_media(uuid, text, timestamptz, uuid, jsonb)
  to service_role;
