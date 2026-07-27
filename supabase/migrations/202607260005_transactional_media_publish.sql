create or replace function public.publish_site_section_with_media(
  p_key text,
  p_expected_updated_at timestamptz,
  p_actor_id uuid,
  p_media jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_section public.site_sections;
  v_revision_id uuid;
  v_media_item jsonb;
begin
  select * into v_section
  from public.site_sections
  where key = p_key and updated_at = p_expected_updated_at
  for update;
  if not found then
    raise exception using errcode = 'TT409', message = 'stale section';
  end if;

  for v_media_item in select * from jsonb_array_elements(coalesce(p_media, '[]'::jsonb))
  loop
    update public.media_assets
    set state = 'published',
        published_storage_path = v_media_item->>'path',
        public_url = v_media_item->>'url'
    where id = (v_media_item->>'id')::uuid
      and state in ('draft', 'published');
    if not found then
      raise exception using errcode = '23514', message = 'referenced media is unavailable';
    end if;
  end loop;

  insert into public.site_section_revisions(section_key, schema_version, content, created_by)
  values (v_section.key, v_section.schema_version, v_section.draft_content, p_actor_id)
  returning id into v_revision_id;

  update public.site_sections
  set published_content = draft_content,
      published_revision_id = v_revision_id,
      published_at = now(),
      updated_at = now(),
      updated_by = p_actor_id
  where key = p_key
  returning * into v_section;

  insert into public.audit_events(actor_user_id, action, target_type, target_id, metadata)
  values (
    p_actor_id,
    'section.published',
    'site_section',
    p_key,
    jsonb_build_object('revisionId', v_revision_id, 'mediaCount', jsonb_array_length(coalesce(p_media, '[]'::jsonb)))
  );
  return to_jsonb(v_section);
end;
$$;

revoke all on function public.publish_site_section_with_media(text, timestamptz, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.publish_site_section_with_media(text, timestamptz, uuid, jsonb)
  to service_role;
