-- Publish the reviewed consent without the obsolete pre-production disclaimer.
-- Existing submitted applications keep their immutable historical version;
-- only drafts move to this approved active version.

do $$
declare
  v_terms text := E'Application collection and consent notice\n\nTing Ting Xu/property management collects the completed application and supporting documents to assess the rental application, verify the information supplied, contact references, and communicate about the application. Information may be shared with the landlord of the unit being applied for and with service providers used for authorized screening and secure processing, only for those purposes.\n\nBy affirmatively agreeing at submission, the applicant authorizes the property manager to share application information with the landlord of the unit and consents to credit-score and reference checks for the rental application. Declining means the application cannot be submitted through this workflow. This consent does not include marketing.\n\nAccess is limited to authorized applicant and staff accounts. Submitted records are retained only for the approved operational/legal period, normally 12 months after submission unless a decision, dispute, legal duty, or authorized retention hold requires otherwise, then securely deleted or de-identified. To request access, correction, withdrawal, or deletion review, contact info@silverkey.ca. Withdrawal may not require deletion where retention is legally required.\n\nVersion 2026-08-08.1.\n';
  v_terms_sha256 text;
  v_terms_id uuid;
  v_existing public.application_terms_versions%rowtype;
begin
  v_terms_sha256 := encode(digest(v_terms, 'sha256'), 'hex');

  select * into v_existing
  from public.application_terms_versions
  where version = '2026-08-08.1'
  for update;

  if found then
    if v_existing.displayed_text <> v_terms or v_existing.sha256 <> v_terms_sha256 then
      raise exception 'Application terms version 2026-08-08.1 already exists with different immutable content.';
    end if;
    v_terms_id := v_existing.id;
  else
    insert into public.application_terms_versions (
      version, displayed_text, sha256, legal_review_status, is_active
    ) values (
      '2026-08-08.1',
      v_terms,
      v_terms_sha256,
      'approved',
      false
    )
    returning id into v_terms_id;
  end if;

  update public.application_terms_versions
  set is_active = false
  where is_active and id <> v_terms_id;

  update public.application_terms_versions
  set legal_review_status = 'approved',
      is_active = true
  where id = v_terms_id;

  update public.client_applications
  set terms_version_id = v_terms_id,
      updated_at = now()
  where status = 'draft'
    and terms_version_id <> v_terms_id;
end;
$$;
