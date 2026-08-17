-- The active application form and consent were confirmed as reviewed and
-- approved for production use on 2026-08-08. Keep this as an append-only
-- deployment record instead of relying on an out-of-band status update.

do $$
begin
  update public.application_form_versions
  set legal_review_status = 'approved'
  where form_key = 'residential-rental-application'
    and version = '2026-07-31.1'
    and is_active
    and legal_review_status = 'pending';

  if not exists (
    select 1
    from public.application_form_versions
    where form_key = 'residential-rental-application'
      and version = '2026-07-31.1'
      and is_active
      and legal_review_status = 'approved'
  ) then
    raise exception 'The reviewed active application form version is unavailable.';
  end if;

end;
$$;
