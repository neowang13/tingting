-- Client self-registration creates only a client profile. Authorization fields in
-- user-controlled metadata are deliberately ignored.

create or replace function public.create_client_profile_for_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text := btrim(coalesce(new.raw_user_meta_data ->> 'display_name', ''));
begin
  if
    new.raw_user_meta_data ->> 'account_type' = 'client'
    and jsonb_typeof(new.raw_user_meta_data -> 'display_name') = 'string'
    and char_length(v_display_name) between 1 and 120
  then
    insert into public.client_profiles(user_id, display_name, is_active)
    values (new.id, v_display_name, true)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

revoke all on function public.create_client_profile_for_new_auth_user() from public;
revoke all on function public.create_client_profile_for_new_auth_user() from anon, authenticated;

drop trigger if exists create_client_profile_after_auth_signup on auth.users;
create trigger create_client_profile_after_auth_signup
  after insert on auth.users
  for each row execute function public.create_client_profile_for_new_auth_user();
