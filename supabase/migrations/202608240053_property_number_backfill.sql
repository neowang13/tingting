-- Backfill: preserve every existing Property and assign numbers in stable
-- creation order. No address, listing, publication, or tenancy data is changed.

with numbered as (
  select
    id,
    row_number() over (order by created_at, id) as property_sequence
  from public.rental_properties
  where property_number is null
)
update public.rental_properties property
set property_number = 'P-' || lpad(numbered.property_sequence::text, 6, '0')
from numbered
where property.id = numbered.id;

do $$
declare
  highest_property_number bigint;
begin
  select max(substring(property_number from 3)::bigint)
  into highest_property_number
  from public.rental_properties;

  if highest_property_number is null then
    perform setval('public.rental_property_number_seq', 1, false);
  else
    perform setval('public.rental_property_number_seq', highest_property_number, true);
  end if;
end;
$$;
