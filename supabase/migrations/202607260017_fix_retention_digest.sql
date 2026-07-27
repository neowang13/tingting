-- pgcrypto is installed in the extensions schema on Supabase. Existing
-- apply_data_retention functions retain their original body, so include that
-- schema in the function's fixed security-definer search path.

alter function public.apply_data_retention(timestamptz, uuid)
  set search_path = public, extensions;
