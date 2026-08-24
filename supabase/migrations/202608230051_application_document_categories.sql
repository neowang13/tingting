alter table public.client_application_files
  add column document_type text not null default 'other'
  check (document_type in (
    'rental_payment_history',
    'credit_score_report',
    'employment_income_proof',
    'bank_statement',
    'other'
  ));

create index client_application_files_document_type_idx
  on public.client_application_files(application_id, document_type)
  where deleted_at is null;

comment on column public.client_application_files.document_type is
  'Applicant-selected document category used to enforce the required rental payment, credit score, and employment/income evidence set.';
