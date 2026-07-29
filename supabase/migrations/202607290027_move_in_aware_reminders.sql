-- Recurring rent starts with the first payment date strictly after move-in.
-- The move-in payment itself is treated as already handled.

create or replace function public.next_move_in_aware_reminder_occurrence(
  p_rent_due_day smallint,
  p_move_in_date date,
  p_lead_days smallint,
  p_local_time time,
  p_timezone text,
  p_after_instant timestamptz,
  p_catch_up_before_due boolean
)
returns table(next_run_at timestamptz, send_local_date date, due_date date)
language plpgsql
immutable
set search_path = public
as $$
declare
  v_after_local timestamp;
  v_month date;
  v_due date;
  v_send date;
  v_local timestamp;
  v_candidate timestamptz;
  v_offset integer;
begin
  if p_rent_due_day not between 1 and 31
    or p_lead_days not between 0 and 31 then
    raise exception using errcode = '22023', message = 'invalid reminder date input';
  end if;

  v_after_local := p_after_instant at time zone p_timezone;
  v_month := date_trunc('month', v_after_local)::date;
  if p_move_in_date is not null then
    v_month := greatest(v_month, date_trunc('month', p_move_in_date)::date);
  end if;

  for v_offset in 0..35 loop
    v_due := (
      v_month
      + make_interval(months => v_offset)
      + (
        least(
          p_rent_due_day::integer,
          extract(day from (
            date_trunc('month', v_month + make_interval(months => v_offset))
            + interval '1 month - 1 day'
          ))::integer
        ) - 1
      ) * interval '1 day'
    )::date;

    if p_move_in_date is not null and v_due <= p_move_in_date then
      continue;
    end if;

    v_send := v_due - p_lead_days::integer;
    v_local := v_send + p_local_time;
    v_candidate := v_local at time zone p_timezone;

    -- Match the product's earlier-instant policy during the fall-back hour.
    if ((v_candidate - interval '1 hour') at time zone p_timezone) = v_local then
      v_candidate := v_candidate - interval '1 hour';
    end if;

    if v_candidate > p_after_instant then
      next_run_at := v_candidate;
      send_local_date := v_send;
      due_date := v_due;
      return next;
      return;
    end if;

    if p_catch_up_before_due and v_due >= v_after_local::date then
      next_run_at := v_candidate;
      send_local_date := v_send;
      due_date := v_due;
      return next;
      return;
    end if;
  end loop;

  raise exception using errcode = '22023', message = 'unable to calculate reminder occurrence';
end;
$$;

revoke all on function public.next_move_in_aware_reminder_occurrence(
  smallint, date, smallint, time, text, timestamptz, boolean
) from public, anon, authenticated;
grant execute on function public.next_move_in_aware_reminder_occurrence(
  smallint, date, smallint, time, text, timestamptz, boolean
) to service_role;

-- The existing tenant trigger owns eligibility and schedule creation. This
-- later-named trigger corrects timing after that trigger has completed.
create or replace function public.apply_move_in_aware_tenant_schedule()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings jsonb;
  v_template_id uuid;
  v_was_eligible boolean := false;
  v_eligible boolean;
  v_occurrence record;
begin
  if tg_op = 'UPDATE' then
    v_was_eligible :=
      old.is_active
      and old.archived_at is null
      and old.email is not null
      and old.email_contact_status = 'allowed';

    if old.move_in_date is not distinct from new.move_in_date
      and old.rent_due_day is not distinct from new.rent_due_day
      and old.is_active is not distinct from new.is_active
      and old.archived_at is not distinct from new.archived_at
      and old.email is not distinct from new.email
      and old.email_contact_status is not distinct from new.email_contact_status then
      return new;
    end if;
  end if;

  select value into v_settings
  from public.system_settings
  where key = 'reminders';
  v_template_id := nullif(v_settings->>'emailTemplateId', '')::uuid;
  v_eligible :=
    new.is_active
    and new.archived_at is null
    and new.email is not null
    and new.email_contact_status = 'allowed'
    and v_template_id is not null;

  if not v_eligible then
    return new;
  end if;

  select * into v_occurrence
  from public.next_move_in_aware_reminder_occurrence(
    new.rent_due_day,
    new.move_in_date,
    coalesce((v_settings->>'leadDays')::smallint, 3::smallint),
    coalesce((v_settings->>'localTime')::time, '09:00'::time),
    coalesce(v_settings->>'timezone', 'America/Vancouver'),
    now(),
    tg_op = 'INSERT'
      or not v_was_eligible
      or (tg_op = 'UPDATE' and (
        old.move_in_date is distinct from new.move_in_date
        or old.rent_due_day is distinct from new.rent_due_day
      ))
  );

  update public.reminder_schedules
  set rent_due_day = new.rent_due_day,
      day_of_month = extract(day from v_occurrence.send_local_date)::smallint,
      local_time = coalesce((v_settings->>'localTime')::time, '09:00'::time),
      timezone = coalesce(v_settings->>'timezone', 'America/Vancouver'),
      email_template_id = v_template_id,
      is_enabled = true,
      next_run_at = v_occurrence.next_run_at,
      updated_by = new.updated_by,
      updated_at = now()
  where tenant_id = new.id;

  return new;
end;
$$;

drop trigger if exists zz_move_in_aware_reminder_trigger on public.tenants;
create trigger zz_move_in_aware_reminder_trigger
after insert or update of move_in_date, rent_due_day, is_active, archived_at, email, email_contact_status
on public.tenants
for each row execute function public.apply_move_in_aware_tenant_schedule();

revoke all on function public.apply_move_in_aware_tenant_schedule()
  from public, anon, authenticated;
grant execute on function public.apply_move_in_aware_tenant_schedule()
  to service_role;

-- Global timing changes are applied by save_global_reminder_settings first.
-- This deferred trigger runs afterward and adds the move-in boundary without
-- replacing an occurrence that is already due.
create or replace function public.recalculate_move_in_aware_schedules()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant public.tenants;
  v_schedule public.reminder_schedules;
  v_occurrence record;
  v_template_id uuid := nullif(new.value->>'emailTemplateId', '')::uuid;
  v_now timestamptz := now();
begin
  if new.key <> 'reminders' then
    return new;
  end if;

  for v_tenant in
    select *
    from public.tenants
    where is_active
      and archived_at is null
      and email is not null
      and email_contact_status = 'allowed'
    order by id
  loop
    select * into v_schedule
    from public.reminder_schedules
    where tenant_id = v_tenant.id
    for update;

    if v_schedule.id is null
      or (v_schedule.next_run_at is not null and v_schedule.next_run_at <= v_now) then
      continue;
    end if;

    select * into v_occurrence
    from public.next_move_in_aware_reminder_occurrence(
      v_tenant.rent_due_day,
      v_tenant.move_in_date,
      coalesce((new.value->>'leadDays')::smallint, 3::smallint),
      coalesce((new.value->>'localTime')::time, '09:00'::time),
      coalesce(new.value->>'timezone', 'America/Vancouver'),
      v_now,
      false
    );

    update public.reminder_schedules
    set rent_due_day = v_tenant.rent_due_day,
        day_of_month = extract(day from v_occurrence.send_local_date)::smallint,
        local_time = coalesce((new.value->>'localTime')::time, '09:00'::time),
        timezone = coalesce(new.value->>'timezone', 'America/Vancouver'),
        email_template_id = v_template_id,
        is_enabled = v_template_id is not null,
        next_run_at = v_occurrence.next_run_at,
        updated_at = v_now
    where id = v_schedule.id;
  end loop;

  return new;
end;
$$;

drop trigger if exists zz_recalculate_move_in_aware_schedules on public.system_settings;
create constraint trigger zz_recalculate_move_in_aware_schedules
after update of value on public.system_settings
deferrable initially deferred
for each row
when (new.key = 'reminders')
execute function public.recalculate_move_in_aware_schedules();

revoke all on function public.recalculate_move_in_aware_schedules()
  from public, anon, authenticated;
grant execute on function public.recalculate_move_in_aware_schedules()
  to service_role;

-- Re-evaluate future schedules once when this migration is installed. Already
-- due occurrences are deliberately preserved by the deferred trigger.
update public.system_settings
set value = value
where key = 'reminders';
