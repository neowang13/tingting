-- Let a verified Client start one private application per published rental.
-- The browser still has no INSERT grant; only the server service role may call
-- this atomic function after validating the Client session and same-origin POST.

create unique index if not exists client_applications_owner_rental_active_unique
  on public.client_applications(owner_user_id, rental_listing_id)
  where rental_listing_id is not null and deleted_at is null;

create or replace function public.start_client_application(
  p_owner_user_id uuid,
  p_rental_slug text
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rental record;
  v_form_id uuid;
  v_terms_id uuid;
  v_application_id uuid;
  v_created boolean := false;
begin
  if p_owner_user_id is null or nullif(btrim(p_rental_slug), '') is null then
    raise exception using errcode = '22023', message = 'A Client and published rental are required.';
  end if;

  if not exists (
    select 1
    from public.client_profiles profile
    where profile.user_id = p_owner_user_id
      and profile.is_active
  ) or public.is_active_admin(p_owner_user_id) then
    raise exception using errcode = '42501', message = 'An active Client account is required.';
  end if;

  select rental.id, rental.slug, rental.title, rental.address_line
  into v_rental
  from public.public_rental_listing_details rental
  where rental.slug = btrim(p_rental_slug)
  limit 1;

  if not found then
    raise exception using errcode = 'P0002', message = 'The published rental was not found.';
  end if;

  select application.id
  into v_application_id
  from public.client_applications application
  where application.owner_user_id = p_owner_user_id
    and application.rental_listing_id = v_rental.id
    and application.deleted_at is null
  limit 1;

  if v_application_id is not null then
    return v_application_id;
  end if;

  select form.id
  into v_form_id
  from public.application_form_versions form
  where form.form_key = 'residential-rental-application'
    and form.is_active
    and form.legal_review_status = 'approved'
  limit 1;

  select terms.id
  into v_terms_id
  from public.application_terms_versions terms
  where terms.is_active
    and terms.legal_review_status = 'approved'
  limit 1;

  if v_form_id is null or v_terms_id is null then
    raise exception using errcode = '55000', message = 'Active application materials are unavailable.';
  end if;

  insert into public.client_applications(
    owner_user_id,
    rental_listing_id,
    property_title,
    property_address,
    form_version_id,
    terms_version_id
  ) values (
    p_owner_user_id,
    v_rental.id,
    v_rental.title,
    v_rental.address_line,
    v_form_id,
    v_terms_id
  )
  on conflict (owner_user_id, rental_listing_id)
    where rental_listing_id is not null and deleted_at is null
  do nothing
  returning id into v_application_id;

  if v_application_id is not null then
    v_created := true;
  else
    select application.id
    into v_application_id
    from public.client_applications application
    where application.owner_user_id = p_owner_user_id
      and application.rental_listing_id = v_rental.id
      and application.deleted_at is null
    limit 1;
  end if;

  if v_application_id is null then
    raise exception using errcode = '55000', message = 'The application could not be started.';
  end if;

  if v_created then
    insert into public.client_application_audit_events(
      application_id,
      actor_user_id,
      actor_type,
      action,
      request_context
    ) values (
      v_application_id,
      p_owner_user_id,
      'client',
      'application.client_started',
      jsonb_build_object('rentalSlug', v_rental.slug)
    );
  end if;

  return v_application_id;
end;
$$;

revoke all on function public.start_client_application(uuid, text)
  from public, anon, authenticated;
grant execute on function public.start_client_application(uuid, text)
  to service_role;

comment on function public.start_client_application(uuid, text) is
  'Atomically creates or returns one active application owned by an active non-Admin Client for a published rental; service-role only.';
