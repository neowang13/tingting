-- Expand: introduce the durable Property Number sequence and nullable column.
-- Existing rows are backfilled separately before the column becomes required.

create sequence public.rental_property_number_seq
  as bigint
  minvalue 1
  maxvalue 999999
  start with 1
  increment by 1
  no cycle;

alter table public.rental_properties
  add column property_number text null;

comment on column public.rental_properties.property_number is
  'Immutable, unique, human-readable identifier for one independently managed rental unit.';
