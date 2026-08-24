-- Contract: all future Properties receive one immutable database-backed number.

alter table public.rental_properties
  alter column property_number set default (
    'P-' || lpad(nextval('public.rental_property_number_seq')::text, 6, '0')
  ),
  alter column property_number set not null,
  add constraint rental_properties_property_number_format_check
    check (property_number ~ '^P-[0-9]{6}$'),
  add constraint rental_properties_property_number_unique
    unique (property_number);

create or replace function public.prevent_property_number_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.property_number is distinct from old.property_number then
    raise exception using errcode = 'TT409', message = 'property number is immutable';
  end if;
  return new;
end;
$$;

create trigger rental_properties_property_number_immutable
before update of property_number on public.rental_properties
for each row execute function public.prevent_property_number_change();
