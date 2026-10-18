-- Each verified applicant supplies their own legal name. Correcting an unsigned
-- applicant's name is a personal-detail edit, even after another applicant signs.
-- Signed identities, invitation recipients and the shared roster remain locked.
create or replace function public.prevent_signed_applicant_roster_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application_id uuid := case when tg_op = 'DELETE' then old.application_id else new.application_id end;
begin
  if tg_op = 'INSERT' then
    perform 1 from public.client_applications where id = v_application_id for update;
  end if;
  if tg_op = 'INSERT' and new.role = 'co_applicant'
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  elsif tg_op = 'DELETE' and old.role = 'co_applicant'
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  elsif tg_op = 'UPDATE'
    and ((new.legal_name is distinct from old.legal_name and old.status = 'signed')
      or (new.email is distinct from old.email and (old.role = 'co_applicant' or old.status = 'signed'))
      or (new.status = 'revoked' and old.status <> 'revoked'))
    and exists (select 1 from public.application_applicant_signatures where application_id = v_application_id) then
    raise exception using errcode = 'TT409', message = 'application_signatures_locked';
  end if;
  if tg_op = 'UPDATE' and new.draft_payload is distinct from old.draft_payload and old.status = 'signed' then
    raise exception using errcode = 'TT409', message = 'applicant_signed';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
