-- Make the notification business name an administrator-managed setting.

update public.system_settings
set value = value || jsonb_build_object(
  'businessName',
  coalesce(nullif(btrim(value->>'businessName'), ''), 'Ting Ting Xu Real Estate')
)
where key = 'reminders';

create or replace function public.preserve_reminder_business_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.key = 'reminders' and not (new.value ? 'businessName') then
    new.value := new.value || jsonb_build_object(
      'businessName',
      coalesce(nullif(btrim(old.value->>'businessName'), ''), 'Ting Ting Xu Real Estate')
    );
  end if;
  return new;
end;
$$;

drop trigger if exists preserve_reminder_business_name on public.system_settings;
create trigger preserve_reminder_business_name
before update of value on public.system_settings
for each row
when (new.key = 'reminders')
execute function public.preserve_reminder_business_name();

create or replace function public.current_business_name()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(btrim(value->>'businessName'), ''),
    'Ting Ting Xu Real Estate'
  )
  from public.system_settings
  where key = 'reminders'
$$;

create or replace function public.set_business_name(
  p_business_name text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting public.system_settings;
  v_business_name text := btrim(p_business_name);
begin
  if not public.is_active_admin(p_actor_id) then
    raise exception using errcode = '42501', message = 'active admin required';
  end if;
  if v_business_name = '' or char_length(v_business_name) > 100 then
    raise exception using errcode = '22023', message = 'business name must contain 1 to 100 characters';
  end if;

  select * into v_setting
  from public.system_settings
  where key = 'reminders'
  for update;
  if v_setting.updated_at <> p_expected_updated_at then
    raise exception using errcode = 'TT409', message = 'stale reminder settings';
  end if;

  update public.system_settings
  set value = jsonb_set(value, '{businessName}', to_jsonb(v_business_name), true),
      updated_by = p_actor_id,
      updated_at = now()
  where key = 'reminders'
  returning * into v_setting;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'business.name_updated',
    'system_setting',
    'reminders',
    jsonb_build_object('businessName', v_business_name)
  );

  return jsonb_build_object(
    'businessName', v_business_name,
    'updatedAt', v_setting.updated_at
  );
end;
$$;

-- Existing notification functions embedded the original name in their render
-- context. Replace that literal with the setting lookup without duplicating
-- several large, independently versioned function bodies in this migration.
do $migration$
declare
  v_name text;
  v_definition text;
  v_updated_definition text;
begin
  foreach v_name in array array[
    'confirm_notification_batch',
    'create_test_notification_event',
    'materialize_due_reminders'
  ]
  loop
    select pg_get_functiondef(proc.oid)
    into v_definition
    from pg_proc proc
    join pg_namespace namespace on namespace.oid = proc.pronamespace
    where namespace.nspname = 'public'
      and proc.proname = v_name
    order by proc.oid desc
    limit 1;

    if v_definition is null then
      raise exception 'expected notification function % was not found', v_name;
    end if;

    v_updated_definition := replace(
      v_definition,
      '''business_name'', ''Ting Ting Xu Real Estate''',
      '''business_name'', public.current_business_name()'
    );
    if v_updated_definition = v_definition then
      if strpos(v_definition, 'public.current_business_name()') = 0 then
        raise exception 'business name render context was not found in function %', v_name;
      end if;
    else
      execute v_updated_definition;
    end if;
  end loop;
end;
$migration$;

revoke all on function public.preserve_reminder_business_name()
  from public, anon, authenticated;
revoke all on function public.current_business_name()
  from public, anon, authenticated;
revoke all on function public.set_business_name(text, timestamptz, uuid)
  from public, anon, authenticated;

grant execute on function public.set_business_name(text, timestamptz, uuid)
  to service_role;
