-- The original security-definer function intentionally restricted its
-- search_path to public, while pgcrypto is installed in extensions on
-- Supabase. Existing installations therefore need extensions in the function
-- search path; fresh installations use an explicitly qualified call.

alter function public.create_notification_batch(jsonb, uuid)
  set search_path = public, extensions;
