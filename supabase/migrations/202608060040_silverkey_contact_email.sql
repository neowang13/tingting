-- Move every public/business contact surface to the Silver Key mailbox while
-- preserving submitted applications against their original consent version.

update public.site_sections
set draft_content = jsonb_set(draft_content, '{publicEmail}', '"info@silverkey.ca"'::jsonb, true),
    published_content = jsonb_set(published_content, '{publicEmail}', '"info@silverkey.ca"'::jsonb, true),
    updated_at = now()
where key = 'contact';

do $$
declare
  v_terms text := E'Application collection and consent notice\n\nTing Ting Xu/property management collects the completed application and supporting documents to assess the rental application, verify the information supplied, contact references, and communicate about the application. Information may be shared with the landlord of the unit being applied for and with service providers used for authorized screening and secure processing, only for those purposes.\n\nBy affirmatively agreeing at submission, the applicant authorizes the property manager to share application information with the landlord of the unit and consents to credit-score and reference checks for the rental application. Declining means the application cannot be submitted through this workflow. This consent does not include marketing.\n\nAccess is limited to authorized applicant and staff accounts. Submitted records are retained only for the approved operational/legal period, normally 12 months after submission unless a decision, dispute, legal duty, or authorized retention hold requires otherwise, then securely deleted or de-identified. To request access, correction, withdrawal, or deletion review, contact info@silverkey.ca. Withdrawal may not require deletion where retention is legally required.\n\nVersion 2026-08-06.1. Draft for final legal/privacy review before production launch. The controller identity, recipient details, screening provider, credit-check type, retention exceptions, and applicant rights must be confirmed.\n';
  v_terms_id uuid;
begin
  insert into public.application_terms_versions (
    version, displayed_text, sha256, legal_review_status, is_active
  ) values (
    '2026-08-06.1',
    v_terms,
    encode(digest(v_terms, 'sha256'), 'hex'),
    'pending',
    false
  )
  returning id into v_terms_id;

  update public.application_terms_versions
  set is_active = false
  where is_active;

  update public.application_terms_versions
  set is_active = true
  where id = v_terms_id;

  update public.client_applications
  set terms_version_id = v_terms_id,
      updated_at = now()
  where status = 'draft';
end
$$;
