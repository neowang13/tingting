-- Keep a durable cleanup locator and an idempotency receipt in the same
-- transaction that detaches an unsigned document from the application.
create table public.application_file_cleanup_jobs (
  file_id uuid primary key,
  application_id uuid not null,
  applicant_id uuid not null,
  owner_user_id uuid not null,
  storage_bucket text not null,
  storage_path text,
  status text not null default 'pending' check (status in ('pending', 'completed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  locked_until timestamptz,
  lease_token uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (status <> 'pending' or storage_path is not null)
);
-- Deliberately independent of parent FKs: deleting an account/application must
-- not discard a queued object's cleanup locator.
alter table public.application_file_cleanup_jobs enable row level security;
revoke all on public.application_file_cleanup_jobs from public, anon, authenticated;
grant select, update on public.application_file_cleanup_jobs to service_role;
create index application_file_cleanup_due_idx on public.application_file_cleanup_jobs(next_attempt_at)
  where status = 'pending';

create function public.remove_unsigned_application_file(
  p_application_id uuid, p_applicant_id uuid, p_file_id uuid, p_user_id uuid,
  p_session_sha256 text, p_storage_bucket text, p_request_context jsonb
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_app public.client_applications%rowtype; v_person public.application_applicants%rowtype;
  v_file public.client_application_files%rowtype;
begin
  if auth.role() <> 'service_role' then raise insufficient_privilege; end if;
  select * into v_app from public.client_applications where id=p_application_id and deleted_at is null for update;
  if not found then raise exception using errcode='TT404', message='application_not_found'; end if;
  select * into v_person from public.application_applicants
    where id=p_applicant_id and application_id=p_application_id and owner_user_id=p_user_id and status <> 'revoked' for update;
  if not found then raise exception using errcode='TT404', message='application_file_not_found'; end if;
  if v_person.role='primary' then
    if v_app.owner_user_id is distinct from p_user_id or p_session_sha256 is not null then
      raise exception using errcode='TT404', message='application_file_not_found'; end if;
  elsif v_person.role='co_applicant' then
    if p_session_sha256 is null or not exists(select 1 from public.application_guest_sessions
      where applicant_id=v_person.id and token_sha256=p_session_sha256 and revoked_at is null and expires_at > clock_timestamp()) then
      raise exception using errcode='TT401', message='guest_session_invalid'; end if;
  else raise exception using errcode='TT404', message='application_file_not_found'; end if;
  -- A receipt remains valid after signing, but never authorizes a new deletion.
  if exists(select 1 from public.application_file_cleanup_jobs where file_id=p_file_id
    and application_id=p_application_id and applicant_id=p_applicant_id and owner_user_id=p_user_id) then return true; end if;
  if v_app.status <> 'draft' or v_person.status='signed'
    or exists(select 1 from public.application_applicant_signatures where applicant_id=p_applicant_id) then
    raise exception using errcode='TT409', message='application_signatures_locked'; end if;
  select * into v_file from public.client_application_files
    where id=p_file_id and application_id=p_application_id and applicant_id=p_applicant_id for update;
  if not found then raise exception using errcode='TT404', message='application_file_not_found'; end if;
  if p_storage_bucket is null or length(trim(p_storage_bucket))=0 then
    raise exception using errcode='TT422', message='storage_bucket_required'; end if;
  insert into public.application_file_cleanup_jobs(file_id,application_id,applicant_id,owner_user_id,storage_bucket,storage_path)
    values (v_file.id,p_application_id,p_applicant_id,p_user_id,p_storage_bucket,v_file.storage_path);
  delete from public.client_application_files where id=v_file.id;
  insert into public.client_application_audit_events(application_id,actor_user_id,actor_type,action,request_context)
    values(p_application_id,p_user_id,'client','application.file_removed',
      coalesce(p_request_context,'{}'::jsonb) || jsonb_build_object('fileId',p_file_id,'applicantId',p_applicant_id,'cleanupQueued',true));
  return true;
end $$;
revoke all on function public.remove_unsigned_application_file(uuid,uuid,uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.remove_unsigned_application_file(uuid,uuid,uuid,uuid,text,text,jsonb) to service_role;

create function public.claim_application_file_cleanup(p_limit integer default 6, p_file_id uuid default null)
returns setof public.application_file_cleanup_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.role() <> 'service_role' then raise insufficient_privilege; end if;
  return query with due as (
    select file_id from public.application_file_cleanup_jobs
    where status='pending' and next_attempt_at <= clock_timestamp()
      and (locked_until is null or locked_until < clock_timestamp()) and (p_file_id is null or file_id=p_file_id)
    order by next_attempt_at,file_id limit greatest(1,least(coalesce(p_limit,6),20)) for update skip locked
  ) update public.application_file_cleanup_jobs j
    set attempts=j.attempts+1, locked_until=clock_timestamp()+interval '2 minutes', lease_token=gen_random_uuid()
    from due where j.file_id=due.file_id returning j.*;
end $$;
revoke all on function public.claim_application_file_cleanup(integer,uuid) from public,anon,authenticated;
grant execute on function public.claim_application_file_cleanup(integer,uuid) to service_role;

-- Recover v0.2.10's explicitly recorded pending objects and successful deletion
-- receipts. The deployed application bucket is client-applications.
insert into public.application_file_cleanup_jobs(file_id,application_id,applicant_id,owner_user_id,storage_bucket,storage_path,status,completed_at)
select distinct on (e.request_context->>'fileId') (e.request_context->>'fileId')::uuid,e.application_id,
  (e.request_context->>'applicantId')::uuid,e.actor_user_id,'client-applications',
  case when e.request_context->>'storageCleanupPending'='true' then e.request_context->>'storagePath' else null end,
  case when e.request_context->>'storageCleanupPending'='true' then 'pending' else 'completed' end,
  case when e.request_context->>'storageCleanupPending'='true' then null else e.created_at end
from public.client_application_audit_events e where e.action='application.file_removed' and e.actor_user_id is not null
  and e.request_context->>'fileId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  and e.request_context->>'applicantId' ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
  and (e.request_context->>'storageCleanupPending' is distinct from 'true' or nullif(e.request_context->>'storagePath','') is not null)
order by e.request_context->>'fileId',e.created_at desc on conflict (file_id) do nothing;
