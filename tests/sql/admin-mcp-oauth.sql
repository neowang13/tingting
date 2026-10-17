\set ON_ERROR_STOP on
begin;
set local search_path=public,extensions;
insert into auth.users(id,email) values('00000000-0000-4000-8000-000000000670','oauth-admin@example.test');
insert into public.admin_profiles(user_id,display_name) values('00000000-0000-4000-8000-000000000670','OAuth Admin');
insert into public.mcp_oauth_clients(client_id,client_name,redirect_uris)
  values('00000000-0000-4000-8000-000000000671','Test Muse',array['https://muse-client.example/callback']);
insert into public.mcp_oauth_consents(id,client_id,admin_user_id,redirect_uri,resource,scopes,state,challenge,csrf_sha256,expires_at)
  values('00000000-0000-4000-8000-000000000672','00000000-0000-4000-8000-000000000671','00000000-0000-4000-8000-000000000670',
  'https://muse-client.example/callback','https://silverkey.example/api/mcp',array['rentals:read','rentals:write'],'test-state',repeat('z',43),repeat('c',64),clock_timestamp()+interval '10 minutes');
do $$
declare r jsonb; v_id uuid:='00000000-0000-4000-8000-000000000673';
begin
 if has_table_privilege('authenticated','public.mcp_oauth_tokens','SELECT')
   or has_table_privilege('anon','public.mcp_oauth_consents','INSERT')
   or has_function_privilege('authenticated','public.mcp_oauth_authorize(uuid,text,uuid,text[],boolean,uuid,text,text,timestamptz)','EXECUTE') then raise exception 'OAuth privilege boundary leaked'; end if;
 begin
   perform public.mcp_oauth_authorize('00000000-0000-4000-8000-000000000672',repeat('c',64),'00000000-0000-4000-8000-000000000699',array['rentals:read'],false,v_id,repeat('d',64),'aal1',now());
   raise exception 'non-Admin authorized a connection';
 exception when insufficient_privilege then null; end;
 begin
   perform public.mcp_oauth_authorize('00000000-0000-4000-8000-000000000672',repeat('x',64),'00000000-0000-4000-8000-000000000670',array['rentals:read'],false,v_id,repeat('d',64),'aal1',now());
   raise exception 'wrong browser nonce accepted';
 exception when sqlstate 'TT409' then null; end;
 begin
   perform public.mcp_oauth_authorize('00000000-0000-4000-8000-000000000672',repeat('c',64),'00000000-0000-4000-8000-000000000670',array['applications:write'],false,v_id,repeat('d',64),'aal1',now());
   raise exception 'scope escalation accepted';
 exception when sqlstate 'TT409' then null; end;
 if exists(select 1 from public.mcp_oauth_grants where id=v_id) then raise exception 'failed consent created a grant'; end if;
 perform public.mcp_oauth_authorize('00000000-0000-4000-8000-000000000672',repeat('c',64),'00000000-0000-4000-8000-000000000670',array['rentals:read','rentals:write'],false,v_id,repeat('d',64),'aal2',now());
 begin
   perform public.mcp_oauth_authorize('00000000-0000-4000-8000-000000000672',repeat('c',64),'00000000-0000-4000-8000-000000000670',array['rentals:read'],false,v_id,repeat('a',64),'aal1',now());
   raise exception 'consent consumed twice';
 exception when sqlstate 'TT409' then null; end;
 r:=public.mcp_oauth_exchange('authorization_code','00000000-0000-4000-8000-000000000671','https://silverkey.example/api/mcp',repeat('d',64),repeat('q',43),'https://muse-client.example/callback','',repeat('e',64),repeat('f',64));
 if r->>'error'<>'invalid_grant' then raise exception 'wrong PKCE verifier accepted'; end if;
 r:=public.mcp_oauth_exchange('authorization_code','00000000-0000-4000-8000-000000000671','https://silverkey.example/api/mcp',repeat('d',64),null,'https://muse-client.example/callback','',repeat('e',64),repeat('f',64));
 if r->>'error'<>'invalid_grant' then raise exception 'null PKCE verifier accepted'; end if;
 r:=public.mcp_oauth_exchange('authorization_code','00000000-0000-4000-8000-000000000671','https://attacker.example/api/mcp',repeat('d',64),repeat('z',43),'https://muse-client.example/callback','',repeat('e',64),repeat('f',64));
 if r->>'error'<>'invalid_grant' then raise exception 'wrong token audience accepted'; end if;
 r:=public.mcp_oauth_exchange('authorization_code','00000000-0000-4000-8000-000000000671','https://silverkey.example/api/mcp',repeat('d',64),repeat('z',43),'https://muse-client.example/callback','',repeat('e',64),repeat('f',64));
 if r->>'id'<>v_id::text then raise exception 'valid exchange failed'; end if;
 if (select count(*) from public.mcp_oauth_tokens where grant_id=v_id)<>2 then raise exception 'access and refresh not issued atomically'; end if;
 if (select expires_at from public.mcp_oauth_tokens where token_sha256=repeat('e',64))>clock_timestamp()+interval '15 minutes' then raise exception 'access token lifetime too long'; end if;
 r:=public.mcp_oauth_exchange('refresh_token','00000000-0000-4000-8000-000000000671','https://silverkey.example/api/mcp','','','',repeat('f',64),repeat('1',64),repeat('2',64));
 if r->>'id'<>v_id::text then raise exception 'refresh failed'; end if;
 r:=public.mcp_oauth_exchange('refresh_token','00000000-0000-4000-8000-000000000671','https://silverkey.example/api/mcp','','','',repeat('f',64),repeat('3',64),repeat('4',64));
 if r->>'error'<>'invalid_grant' or (select revoked_at is null from public.mcp_oauth_grants where id=v_id) then raise exception 'refresh replay did not revoke connection'; end if;
 if exists(select 1 from public.mcp_oauth_tokens where token_sha256=repeat('3',64)) then raise exception 'replay issued another access token'; end if;
 if (select count(*) from public.audit_events where target_id=v_id::text and action='mcp.connection.revoked')<>1 then raise exception 'revocation audit missing'; end if;
end $$;
rollback;
