-- OAuth grants are issued only after the existing Admin login and explicit consent.
-- No static connector keys, passwords, plaintext authorization codes or tokens.
create table public.mcp_oauth_clients (
  client_id uuid primary key, client_name text not null, redirect_uris text[] not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.mcp_oauth_consents (
  id uuid primary key, client_id uuid not null references public.mcp_oauth_clients(client_id),
  admin_user_id uuid not null references public.admin_profiles(user_id), redirect_uri text not null, resource text not null,
  scopes text[] not null, state text not null, challenge text not null, csrf_sha256 text not null,
  expires_at timestamptz not null, consumed_at timestamptz null
);
create table public.mcp_oauth_grants (
  id uuid primary key, client_id uuid not null references public.mcp_oauth_clients(client_id),
  admin_user_id uuid not null references public.admin_profiles(user_id), resource text not null,
  scopes text[] not null check(cardinality(scopes)>0 and scopes <@ array['rentals:read','rentals:write','applications:read','applications:write','showings:read','showings:write']),
  assurance_level text not null check(assurance_level in ('aal1','aal2')), authenticated_at timestamptz not null,
  expires_at timestamptz not null, revoked_at timestamptz null, created_at timestamptz not null default clock_timestamp()
);
create table public.mcp_oauth_codes (
  code_sha256 text primary key check(code_sha256 ~ '^[a-f0-9]{64}$'), grant_id uuid not null references public.mcp_oauth_grants(id),
  redirect_uri text not null, challenge text not null, expires_at timestamptz not null, consumed_at timestamptz null
);
create table public.mcp_oauth_tokens (
  token_sha256 text primary key check(token_sha256 ~ '^[a-f0-9]{64}$'), grant_id uuid not null references public.mcp_oauth_grants(id),
  kind text not null check(kind in ('access','refresh')), expires_at timestamptz not null, consumed_at timestamptz null
);
create index mcp_oauth_grants_admin_idx on public.mcp_oauth_grants(admin_user_id,created_at);
create index mcp_oauth_tokens_grant_idx on public.mcp_oauth_tokens(grant_id);
alter table public.mcp_oauth_clients enable row level security;
alter table public.mcp_oauth_consents enable row level security;
alter table public.mcp_oauth_grants enable row level security;
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;
revoke all on public.mcp_oauth_clients,public.mcp_oauth_consents,public.mcp_oauth_grants,public.mcp_oauth_codes,public.mcp_oauth_tokens from public,anon,authenticated;
grant all on public.mcp_oauth_clients,public.mcp_oauth_consents,public.mcp_oauth_grants,public.mcp_oauth_codes,public.mcp_oauth_tokens to service_role;

create function public.audit_mcp_connection_revocation() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    insert into public.audit_events(actor_user_id,action,target_type,target_id,metadata)
      values(new.admin_user_id,'mcp.connection.revoked','mcp_connection',new.id::text,jsonb_build_object('clientId',new.client_id));
  end if;
  return new;
end $$;
create trigger mcp_connection_revoked after update of revoked_at on public.mcp_oauth_grants
  for each row execute function public.audit_mcp_connection_revocation();
revoke all on function public.audit_mcp_connection_revocation() from public,anon,authenticated;

create function public.mcp_oauth_authorize(p_id uuid,p_csrf_hash text,p_admin_id uuid,p_scopes text[],p_denied boolean,
  p_grant_id uuid,p_code_hash text,p_aal text,p_authenticated_at timestamptz)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.mcp_oauth_consents;
begin
  if not public.is_active_admin(p_admin_id) then raise insufficient_privilege; end if;
  select * into v from public.mcp_oauth_consents where id=p_id for update;
  if not found or v.admin_user_id is distinct from p_admin_id or v.csrf_sha256 is distinct from p_csrf_hash or v.expires_at<=clock_timestamp() or v.consumed_at is not null
    or p_denied is null or (not p_denied and (p_scopes is null or cardinality(p_scopes)=0 or not p_scopes <@ v.scopes)) then
    raise exception 'invalid_consent' using errcode='TT409';
  end if;
  update public.mcp_oauth_consents set consumed_at=clock_timestamp() where id=p_id;
  if not p_denied then
    insert into public.mcp_oauth_grants(id,client_id,admin_user_id,resource,scopes,assurance_level,authenticated_at,expires_at)
      values(p_grant_id,v.client_id,p_admin_id,v.resource,p_scopes,p_aal,p_authenticated_at,clock_timestamp()+interval '7 days');
    insert into public.mcp_oauth_codes(code_sha256,grant_id,redirect_uri,challenge,expires_at)
      values(p_code_hash,p_grant_id,v.redirect_uri,v.challenge,clock_timestamp()+interval '5 minutes');
  end if;
  insert into public.audit_events(actor_user_id,action,target_type,target_id,metadata)
    values(p_admin_id,case when p_denied then 'mcp.connection.denied' else 'mcp.connection.authorized' end,'mcp_connection',p_grant_id::text,jsonb_build_object('clientId',v.client_id,'scopes',p_scopes));
  return to_jsonb(v);
end $$;
revoke all on function public.mcp_oauth_authorize(uuid,text,uuid,text[],boolean,uuid,text,text,timestamptz) from public,anon,authenticated;
grant execute on function public.mcp_oauth_authorize(uuid,text,uuid,text[],boolean,uuid,text,text,timestamptz) to service_role;

create function public.mcp_oauth_exchange(p_kind text,p_client_id uuid,p_resource text,p_code_hash text,p_challenge text,
 p_redirect_uri text,p_refresh_hash text,p_access_hash text,p_next_refresh_hash text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_code public.mcp_oauth_codes; v_token public.mcp_oauth_tokens; v_grant public.mcp_oauth_grants; v_id uuid;
begin
 if p_kind='authorization_code' then
   select * into v_code from public.mcp_oauth_codes where code_sha256=p_code_hash for update;
   if not found or v_code.expires_at<=clock_timestamp() or v_code.challenge is distinct from p_challenge or v_code.redirect_uri is distinct from p_redirect_uri then return '{"error":"invalid_grant"}'; end if;
   v_id:=v_code.grant_id;
 elsif p_kind='refresh_token' then
   select * into v_token from public.mcp_oauth_tokens where token_sha256=p_refresh_hash for update;
   if not found or v_token.kind<>'refresh' or v_token.expires_at<=clock_timestamp() then return '{"error":"invalid_grant"}'; end if;
   v_id:=v_token.grant_id;
 else return '{"error":"invalid_grant"}'; end if;
 select * into v_grant from public.mcp_oauth_grants where id=v_id for update;
 if not found or v_grant.client_id is distinct from p_client_id or v_grant.resource is distinct from p_resource or v_grant.revoked_at is not null
   or v_grant.expires_at<=clock_timestamp() or not public.is_active_admin(v_grant.admin_user_id) then return '{"error":"invalid_grant"}'; end if;
 if (p_kind='refresh_token' and v_token.consumed_at is not null) or (p_kind='authorization_code' and v_code.consumed_at is not null) then
   update public.mcp_oauth_grants set revoked_at=clock_timestamp() where id=v_id;
   return '{"error":"invalid_grant"}'; -- Return rather than raise so revocation commits.
 end if;
 if p_kind='authorization_code' then update public.mcp_oauth_codes set consumed_at=clock_timestamp() where code_sha256=p_code_hash;
 else update public.mcp_oauth_tokens set consumed_at=clock_timestamp() where token_sha256=p_refresh_hash; end if;
 insert into public.mcp_oauth_tokens(token_sha256,grant_id,kind,expires_at) values
   (p_access_hash,v_id,'access',least(clock_timestamp()+interval '15 minutes',v_grant.expires_at)),
   (p_next_refresh_hash,v_id,'refresh',v_grant.expires_at);
 return to_jsonb(v_grant);
end $$;
revoke all on function public.mcp_oauth_exchange(text,uuid,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.mcp_oauth_exchange(text,uuid,text,text,text,text,text,text,text) to service_role;
