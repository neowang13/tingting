-- Delete the listing, its publication snapshots, and its calendar atomically.
-- Applications and showing requests retain their historical property snapshots;
-- their existing foreign keys set rental_listing_id to null on deletion.
create function public.delete_rental_listing(
  p_id uuid, p_expected_updated_at timestamptz, p_actor_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rental public.rental_listings;
begin
  if auth.role() is distinct from 'service_role' or not exists (
    select 1 from public.admin_profiles where user_id = p_actor_id and is_active
  ) then raise exception using errcode = '42501', message = 'active administrator required'; end if;

  select * into v_rental from public.rental_listings where id = p_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'property not found'; end if;
  if v_rental.updated_at is distinct from p_expected_updated_at then
    raise exception using errcode = 'TT409', message = 'property changed';
  end if;
  -- Serialize orphan-property cleanup with another listing using this address.
  perform 1 from public.rental_properties where id = v_rental.property_id for update;
  update public.rental_listings set published_revision_id = null where id = p_id;
  delete from public.rental_listing_revisions where rental_listing_id = p_id;
  delete from public.rental_listings where id = p_id;
  delete from public.rental_properties
    where id = v_rental.property_id
      and not exists (select 1 from public.rental_listings where property_id = v_rental.property_id);

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (p_actor_id, 'rental.deleted', 'rental_listing', p_id::text,
    jsonb_build_object('slug', v_rental.slug, 'title', v_rental.title));
end;
$$;
revoke all on function public.delete_rental_listing(uuid, timestamptz, uuid) from public, anon, authenticated;
grant execute on function public.delete_rental_listing(uuid, timestamptz, uuid) to service_role;
